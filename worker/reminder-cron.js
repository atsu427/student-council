// Cloudflare Workers Cron Trigger（1分おき）: 2つの仕事をする
//   1. 期限が来たリマインダー（行事の何日前の何時、で指定）をLINEで送信する
//   2. 予約投稿（publish_atが未来）が公開時刻を過ぎても、サイト経由のメンション通知が送られないままになっていたのを検知して自動送信する
// 設定する環境変数(Secrets): LINE_CHANNEL_ACCESS_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// デプロイ方法はこのファイルと同じ階層の README.md を参照

function sbHeaders(env) {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
}

// ── リマインダー ──

// 行事の日付(JST想定のカレンダー日)・何日前・何時(JST)から、送信すべきUTC時刻を計算する。
// WorkerはUTCで動くため、JSTの壁時計時刻からはマイナス9時間する
function computeRemindAtUtc(startDate, daysBefore, remindTimeHHMM) {
  const [y, mo, d] = startDate.split('-').map(Number);
  const [hh, mm] = remindTimeHHMM.split(':').map(Number);
  return new Date(Date.UTC(y, mo - 1, d - daysBefore, hh - 9, mm));
}

async function getPendingReminders(env) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/reminders?sent=eq.false&select=*`, { headers: sbHeaders(env) });
  if (!res.ok) { console.error('reminders取得失敗:', res.status, await res.text()); return []; }
  return res.json();
}

async function getEvent(env, eventId) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/events?id=eq.${eventId}&select=id,title,start_date,end_date`, { headers: sbHeaders(env) });
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function getLineUserIdsByRoles(env, roles) {
  // 「全体」ロールはメンバーのroles配列に実際に入っているわけではない特別な「全員」扱いの値なので、overlapsでは引っかからない
  const isAll = !roles || roles.length === 0 || roles.includes('全体');
  const url = isAll
    ? `${env.SUPABASE_URL}/rest/v1/members?select=id,email,line_user_id`
    : `${env.SUPABASE_URL}/rest/v1/members?roles=ov.{${roles.join(',')}}&select=id,email,line_user_id`;
  const res = await fetch(url, { headers: sbHeaders(env) });
  if (!res.ok) { console.error('members(ロール)取得失敗:', res.status, await res.text()); return []; }
  const rows = await res.json();
  return (Array.isArray(rows) ? rows : []);
}

async function linePush(env, to, messages) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
    body: JSON.stringify({ to, messages })
  });
  if (!res.ok) console.error('LINE push失敗:', res.status, await res.text());
}

// sent=false の場合のみtrueにする「条件付き更新」。これが本当に更新できたかどうかでロックの取得に成功したかを判定する。
// 1分おきの実行が重なったり、何らかの理由で同じリマインダーが2回処理されそうになっても、
// 実際にsentをfalse→trueに変えられたインスタンスだけが送信を行うため、二重送信が起きない
async function claimReminder(env, reminderId) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/reminders?id=eq.${reminderId}&sent=eq.false`, {
    method: 'PATCH',
    headers: { ...sbHeaders(env), 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ sent: true })
  });
  if (!res.ok) { console.error('reminderのロック取得失敗:', res.status, await res.text()); return false; }
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0;
}

// 同じLINEアカウントが複数のmembers行に紐づいている場合（同一人物が別メールで2アカウント登録し、
// 両方に同じLINE連携コードでリンクしてしまった等）、member.idでの重複排除では検知できず、
// 同じLINEアカウントに二重送信されてしまう。送信直前に必ずline_user_id基準で重複排除する
function dedupeByLineUserId(members) {
  const seen = new Set();
  return members.filter(m => {
    if (seen.has(m.line_user_id)) return false;
    seen.add(m.line_user_id);
    return true;
  });
}

async function processReminders(env) {
  const pending = await getPendingReminders(env);
  const now = new Date();
  for (const reminder of pending) {
    const event = await getEvent(env, reminder.event_id);
    if (!event) { await claimReminder(env, reminder.id); continue; } // 行事が削除済みなら送らずに片付ける
    const remindTime = (reminder.remind_time || '08:00:00').slice(0, 5);
    const baseDate = reminder.base_date === 'end' ? (event.end_date || event.start_date) : event.start_date;
    const dueAt = computeRemindAtUtc(baseDate, reminder.days_before, remindTime);
    if (dueAt > now) continue;

    // 送信前に必ずロックを取得し、取得できた場合のみ送信する（取得できなければ別の実行が既に処理済み）
    if (!(await claimReminder(env, reminder.id))) continue;

    const text = `【リマインダー】${event.title}\n\n${reminder.message || ''}`.trim();
    const members = dedupeByLineUserId((await getLineUserIdsByRoles(env, reminder.target_roles)).filter(m => m.line_user_id));
    for (const m of members) {
      await linePush(env, m.line_user_id, [{ type: 'text', text }]);
    }
  }
}

// ── 予約投稿のメンション通知漏れフォロー ──

async function getDueScheduledPosts(env) {
  const nowIso = new Date().toISOString();
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/posts?published=eq.true&publish_at=lte.${encodeURIComponent(nowIso)}&mentions_sent_at=is.null&select=id,title,body,tags,is_special,mentioned_emails,mentioned_roles,file_paths,author,event_date,event_end_date`,
    { headers: sbHeaders(env) }
  );
  if (!res.ok) { console.error('posts取得失敗:', res.status, await res.text()); return []; }
  const rows = await res.json();
  return (Array.isArray(rows) ? rows : []).filter(p => (p.mentioned_emails || []).length > 0 || (p.mentioned_roles || []).length > 0);
}

async function getMembersByEmails(env, emails) {
  if (!emails || emails.length === 0) return [];
  const list = emails.map(e => `"${e}"`).join(',');
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/members?email=in.(${list})&select=id,email,line_user_id`, { headers: sbHeaders(env) });
  if (!res.ok) return [];
  return res.json();
}

function isImagePath(path) { return /\.(jpe?g|png|gif|webp)$/i.test(path); }

function formatJaDateShort(d) {
  const [, m, day] = d.split('-').map(Number);
  return `${m}月${day}日`;
}

// LINEは1リクエストあたり最大5メッセージまでなので、テキスト1件+画像は最大4件までにする
function buildPostMessages(post, env) {
  const body = (post.body || '').replace(/\[([^\[\]]+)\]\((https?:\/\/[^\s()]+)\)/g, '$1 $2');
  const excerpt = body.length > 1500 ? body.slice(0, 1500) + '…' : body;
  const specialPrefix = post.is_special ? '【重要】' : '';
  const tagsLine = (post.tags && post.tags.length > 0) ? `\n\n${post.tags.map(t => `#${t}`).join(' ')}` : '';
  const authorLine = post.author ? `\n投稿者：${post.author}` : '';
  const isRecruitment = (post.tags || []).includes('募集') && post.event_date;
  const periodLine = isRecruitment
    ? `\n募集期間：${formatJaDateShort(post.event_date)}${post.event_end_date && post.event_end_date !== post.event_date ? '〜' + formatJaDateShort(post.event_end_date) : ''}`
    : '';
  const text = `${specialPrefix}${post.title}${authorLine}${periodLine}\n\n${excerpt}${tagsLine}`;
  const messages = [{ type: 'text', text }];
  const imagePaths = (post.file_paths || []).filter(isImagePath).slice(0, 4);
  for (const path of imagePaths) {
    const url = `${env.SUPABASE_URL}/storage/v1/object/public/post-files/${path}`;
    messages.push({ type: 'image', originalContentUrl: url, previewImageUrl: url });
  }
  return messages;
}

async function insertNotifications(env, memberIds, post) {
  if (memberIds.length === 0) return;
  const rows = memberIds.map(id => ({ member_id: id, post_id: post.id, body: `あなたが投稿「${post.title}」でメンションされました` }));
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/notifications`, {
    method: 'POST',
    headers: { ...sbHeaders(env), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(rows)
  });
  if (!res.ok) console.error('notifications追加失敗:', res.status, await res.text());
}

// mentions_sent_atがNULLの場合のみ更新する「条件付き更新」。これが本当に更新できたかどうかでロックの取得に成功したかを判定する。
// admin.html側の即時送信・「通知を送る」ボタンと、このWorkerの自動送信が同じ投稿に対して同時に走っても、
// 実際にmentions_sent_atをNULL→現在時刻に変えられた側だけが送信を行うため、二重送信が起きない
async function claimPostMentions(env, postId) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/posts?id=eq.${postId}&mentions_sent_at=is.null`, {
    method: 'PATCH',
    headers: { ...sbHeaders(env), 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ mentions_sent_at: new Date().toISOString() })
  });
  if (!res.ok) { console.error('postのロック取得失敗:', res.status, await res.text()); return false; }
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0;
}

async function processScheduledPostMentions(env) {
  const duePosts = await getDueScheduledPosts(env);
  for (const post of duePosts) {
    // 送信前に必ずロックを取得し、取得できた場合のみ送信する（取得できなければ別の経路で既に送信済み）
    if (!(await claimPostMentions(env, post.id))) continue;

    const hasRoles = post.mentioned_roles && post.mentioned_roles.length > 0;
    const [byEmail, byRole] = await Promise.all([
      getMembersByEmails(env, post.mentioned_emails),
      hasRoles ? getLineUserIdsByRoles(env, post.mentioned_roles) : Promise.resolve([])
    ]);
    const memberMap = new Map();
    [...byEmail, ...byRole].forEach(m => memberMap.set(m.id, m));
    const members = Array.from(memberMap.values());

    await insertNotifications(env, members.map(m => m.id), post);

    if (env.LINE_CHANNEL_ACCESS_TOKEN) {
      const messages = buildPostMessages(post, env);
      // サイト内通知(insertNotifications)はmember単位で全員に残すが、LINE pushはline_user_id単位で重複排除してから送る
      for (const m of dedupeByLineUserId(members.filter(m => m.line_user_id))) {
        await linePush(env, m.line_user_id, messages);
      }
    }
  }
}

async function runAll(env) {
  await processReminders(env);
  await processScheduledPostMentions(env);
}

export default {
  async scheduled(controller, env, ctx) {
    await runAll(env);
  },
  // wrangler dev での動作確認用（ブラウザ/curlからGETで叩くと即時実行される）
  async fetch(request, env, ctx) {
    await runAll(env);
    return new Response('ok', { status: 200 });
  }
};
