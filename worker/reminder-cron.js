// Cloudflare Workers Cron Trigger: 期限が来たリマインダーをLINEで送信する
// 設定する環境変数(Secrets): LINE_CHANNEL_ACCESS_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// デプロイ方法はこのファイルと同じ階層の README.md を参照

async function getDueReminders(env) {
  const nowIso = new Date().toISOString();
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/reminders?sent=eq.false&remind_at=lte.${encodeURIComponent(nowIso)}&select=*`,
    { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } }
  );
  if (!res.ok) { console.error('reminders取得失敗:', res.status, await res.text()); return []; }
  return res.json();
}

async function getEvent(env, eventId) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/events?id=eq.${eventId}&select=id,title,start_date,end_date`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function getLineUserIdsByRoles(env, roles) {
  // 「全体」ロールはメンバーのroles配列に実際に入っているわけではない特別な「全員」扱いの値なので、overlapsでは引っかからない
  const isAll = !roles || roles.length === 0 || roles.includes('全体');
  const url = isAll
    ? `${env.SUPABASE_URL}/rest/v1/members?select=id,line_user_id`
    : `${env.SUPABASE_URL}/rest/v1/members?roles=ov.{${roles.join(',')}}&select=id,line_user_id`;
  const res = await fetch(url, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
  });
  if (!res.ok) { console.error('members(ロール)取得失敗:', res.status, await res.text()); return []; }
  const rows = await res.json();
  return (Array.isArray(rows) ? rows : []).filter(r => r.line_user_id);
}

async function linePush(env, to, text) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
    body: JSON.stringify({ to, messages: [{ type: 'text', text }] })
  });
  if (!res.ok) console.error('LINE push失敗:', res.status, await res.text());
}

async function markSent(env, reminderId) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/reminders?id=eq.${reminderId}`, {
    method: 'PATCH',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify({ sent: true })
  });
}

async function processReminder(env, reminder) {
  const event = await getEvent(env, reminder.event_id);
  const eventTitle = event?.title || '行事予定';
  const text = `【リマインダー】${eventTitle}\n\n${reminder.message || ''}`.trim();
  const members = await getLineUserIdsByRoles(env, reminder.target_roles);
  for (const m of members) {
    await linePush(env, m.line_user_id, text);
  }
  await markSent(env, reminder.id);
}

export default {
  async scheduled(controller, env, ctx) {
    if (!env.LINE_CHANNEL_ACCESS_TOKEN) { console.error('LINE_CHANNEL_ACCESS_TOKEN未設定のためスキップ'); return; }
    const due = await getDueReminders(env);
    for (const reminder of due) {
      await processReminder(env, reminder);
    }
  },
  // wrangler dev での動作確認用（ブラウザ/curlからGETで叩くと即時実行される）
  async fetch(request, env, ctx) {
    if (!env.LINE_CHANNEL_ACCESS_TOKEN) return new Response('LINE_CHANNEL_ACCESS_TOKEN未設定', { status: 200 });
    const due = await getDueReminders(env);
    for (const reminder of due) {
      await processReminder(env, reminder);
    }
    return new Response(`processed ${due.length} reminder(s)`, { status: 200 });
  }
};
