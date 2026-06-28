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
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/posts?id=eq.${postId}&select=id,title,body,tags,is_special,published,mentioned_emails,mentioned_roles,file_paths`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
  });
  if (!res.ok) { console.error('posts取得失敗:', res.status, await res.text()); return null; }
  const rows = await res.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function getLineUserIdsByEmails(env, emails) {
  if (!emails || emails.length === 0) return [];
  const list = emails.map(e => `"${e}"`).join(',');
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/members?email=in.(${list})&select=id,email,line_user_id`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
  });
  const rows = await res.json();
  return (Array.isArray(rows) ? rows : []).filter(r => r.line_user_id);
}

async function getLineUserIdsByRoles(env, roles) {
  if (!roles || roles.length === 0) return [];
  // 「全体」ロールはメンバーのroles配列に実際に入っているわけではない特別な「全員」扱いの値なので、overlapsでは引っかからない
  const isAll = roles.includes('全体');
  const url = isAll
    ? `${env.SUPABASE_URL}/rest/v1/members?select=id,email,line_user_id`
    : `${env.SUPABASE_URL}/rest/v1/members?roles=ov.{${roles.join(',')}}&select=id,email,line_user_id`;
  const res = await fetch(url, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
  });
  if (!res.ok) { console.error('members(ロール)取得失敗:', res.status, await res.text()); return []; }
  const rows = await res.json();
  return (Array.isArray(rows) ? rows : []).filter(r => r.line_user_id);
}

function isImagePath(path) { return /\.(jpe?g|png|gif|webp)$/i.test(path); }

// LINEは1リクエストあたり最大5メッセージまでなので、テキスト1件+画像は最大4件までにする
function buildPostMessages(post, env, isCorrection) {
  // [表示文字](URL) 記法は表示文字だけ残すとURLが消えてLINE側でリンクとして認識されなくなるため、
  // URLをテキストとして残す（LINEは本文中の生のURLを自動でリンク化する）
  const body = (post.body || '').replace(/\[([^\[\]]+)\]\((https?:\/\/[^\s()]+)\)/g, '$1 $2');
  const excerpt = body.length > 1500 ? body.slice(0, 1500) + '…' : body;
  const specialPrefix = post.is_special ? '【重要】' : '';
  const correctionPrefix = isCorrection ? '【訂正】' : '';
  const tagsLine = (post.tags && post.tags.length > 0) ? `\n\n${post.tags.map(t => `#${t}`).join(' ')}` : '';
  const text = `${correctionPrefix}${specialPrefix}${post.title}\n\n${excerpt}${tagsLine}`;
  const messages = [{ type: 'text', text }];

  const imagePaths = (post.file_paths || []).filter(isImagePath).slice(0, 4);
  for (const path of imagePaths) {
    const url = `${env.SUPABASE_URL}/storage/v1/object/public/post-files/${path}`;
    messages.push({ type: 'image', originalContentUrl: url, previewImageUrl: url });
  }
  return messages;
}

async function linePush(env, to, messages) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
    body: JSON.stringify({ to, messages })
  });
  if (!res.ok) console.error('LINE push失敗:', res.status, await res.text());
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

    const { postId, isCorrection } = await request.json();
    const post = await getPost(env, postId);
    if (!post) return new Response(JSON.stringify({ error: 'post not found' }), { status: 404 });
    if (!post.published) return new Response(JSON.stringify({ skipped: 'not published' }), { status: 200 });

    if (!env.LINE_CHANNEL_ACCESS_TOKEN) {
      return new Response(JSON.stringify({ skipped: 'LINE未設定（環境変数LINE_CHANNEL_ACCESS_TOKEN未設定）' }), { status: 200 });
    }

    // メンション（個人・ロール）が誰にも設定されていない投稿は、誰にもLINE通知を送らない
    const [byEmail, byRole] = await Promise.all([
      getLineUserIdsByEmails(env, post.mentioned_emails),
      getLineUserIdsByRoles(env, post.mentioned_roles)
    ]);
    const mentionedMap = new Map();
    [...byEmail, ...byRole].forEach(m => mentionedMap.set(m.id, m));
    const mentioned = Array.from(mentionedMap.values());
    if (mentioned.length === 0) {
      return new Response(JSON.stringify({ skipped: 'メンションが設定されていないためLINE通知は送信されません' }), { status: 200 });
    }

    const messages = buildPostMessages(post, env, !!isCorrection);
    for (const m of mentioned) {
      await linePush(env, m.line_user_id, messages);
    }

    return new Response(JSON.stringify({ ok: true, mentioned: mentioned.length }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
