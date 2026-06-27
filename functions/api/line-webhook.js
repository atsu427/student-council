// Cloudflare Pages Functions: LINE Messaging API Webhook
// 設定する環境変数(Secrets): LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN,
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

async function verifySignature(secret, rawBody, signature) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return expected === signature;
}

async function lineReply(env, replyToken, messages) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`
    },
    body: JSON.stringify({ replyToken, messages })
  });
}

async function findMemberByLinkCode(env, code) {
  const url = `${env.SUPABASE_URL}/rest/v1/members?line_link_code=eq.${encodeURIComponent(code)}&select=id,email,line_link_code`;
  const res = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  const rows = await res.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function linkLineUser(env, memberId, lineUserId) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/members?id=eq.${memberId}`, {
    method: 'PATCH',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify({ line_user_id: lineUserId })
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const rawBody = await request.text();
  const signature = request.headers.get('x-line-signature') || '';

  const valid = await verifySignature(env.LINE_CHANNEL_SECRET, rawBody, signature);
  if (!valid) return new Response('invalid signature', { status: 403 });

  const payload = JSON.parse(rawBody || '{}');
  const events = payload.events || [];

  for (const event of events) {
    if (event.type === 'follow') {
      await lineReply(env, event.replyToken, [{
        type: 'text',
        text: '灘校生徒会公式LINEに登録ありがとうございます。\nサイトにログイン後、マイページに表示される「連携コード」をこのトークにそのまま送信すると、メンション通知などの個別通知を受け取れるようになります。'
      }]);
    }

    if (event.type === 'message' && event.message?.type === 'text') {
      const text = (event.message.text || '').trim();
      const member = await findMemberByLinkCode(env, text);
      if (member) {
        await linkLineUser(env, member.id, event.source.userId);
        await lineReply(env, event.replyToken, [{
          type: 'text',
          text: `連携が完了しました（${member.email}）。これ以降、あなた宛のメンション通知をLINEでお届けします。`
        }]);
      } else {
        await lineReply(env, event.replyToken, [{
          type: 'text',
          text: 'コードが見つかりませんでした。サイトにログインし、マイページに表示される連携コードを送信してください。'
        }]);
      }
    }
  }

  return new Response('ok', { status: 200 });
}
