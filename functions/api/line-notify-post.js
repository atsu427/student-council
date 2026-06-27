// Cloudflare Pages Functions: 投稿公開時にLINE通知を送る
// admin.html から、保存に成功した投稿のIDを渡して呼び出される。
// 設定する環境変数(Secrets): LINE_CHANNEL_ACCESS_TOKEN, SUPABASE_URL,
//   SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SITE_URL

async function getAuthedUser(env, accessToken) {
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) return null;
  return res.json();
}

async function isAdmin(env, userId) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/members?id=eq.${userId}&select=roles`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
  });
  const rows = await res.json();
  return Array.isArray(rows) && rows[0]?.roles?.includes('管理者');
}

async function getPost(env, postId) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/posts?id=eq.${postId}&select=id,title,body,published,mentioned_emails`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
  });
  const rows = await res.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function getLineUserIdsByEmails(env, emails) {
  if (!emails || emails.length === 0) return [];
  const list = emails.map(e => `"${e}"`).join(',');
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/members?email=in.(${list})&select=email,line_user_id`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
  });
  const rows = await res.json();
  return (Array.isArray(rows) ? rows : []).filter(r => r.line_user_id);
}

function buildPostMessage(post, env) {
  const excerpt = (post.body || '').slice(0, 80);
  return [{
    type: 'text',
    text: `【生徒会からのお知らせ】\n${post.title}\n\n${excerpt}${post.body.length > 80 ? '…' : ''}`,
  }, {
    type: 'template',
    altText: post.title,
    template: {
      type: 'buttons',
      text: '詳しくはサイトでご確認ください',
      actions: [{ type: 'uri', label: '生徒会ページを見る', uri: env.SITE_URL || 'https://example.pages.dev' }]
    }
  }];
}

async function lineBroadcast(env, messages) {
  await fetch('https://api.line.me/v2/bot/message/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
    body: JSON.stringify({ messages })
  });
}

async function linePush(env, to, messages) {
  await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
    body: JSON.stringify({ to, messages })
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const authHeader = request.headers.get('authorization') || '';
    const accessToken = authHeader.replace(/^Bearer\s+/i, '');
    if (!accessToken) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });

    const user = await getAuthedUser(env, accessToken);
    if (!user?.id) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
    if (!(await isAdmin(env, user.id))) return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });

    const { postId } = await request.json();
    const post = await getPost(env, postId);
    if (!post) return new Response(JSON.stringify({ error: 'post not found' }), { status: 404 });
    if (!post.published) return new Response(JSON.stringify({ skipped: 'not published' }), { status: 200 });

    if (!env.LINE_CHANNEL_ACCESS_TOKEN) {
      return new Response(JSON.stringify({ skipped: 'LINE未設定（環境変数LINE_CHANNEL_ACCESS_TOKEN未設定）' }), { status: 200 });
    }

    await lineBroadcast(env, buildPostMessage(post, env));

    const mentioned = await getLineUserIdsByEmails(env, post.mentioned_emails);
    for (const m of mentioned) {
      await linePush(env, m.line_user_id, [{ type: 'text', text: `【メンション通知】\n「${post.title}」であなたが言及されました。\n${env.SITE_URL || ''}` }]);
    }

    return new Response(JSON.stringify({ ok: true, mentioned: mentioned.length }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
