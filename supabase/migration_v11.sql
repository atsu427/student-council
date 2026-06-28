-- ============================================================
-- 生徒会サイト ver3.8 マイグレーション
-- Supabase の SQL Editor で実行してください（migration_v10.sql の後に1回だけ）
-- ============================================================

-- 1. カレンダー専用のタグカタログ（投稿のタグ=categoriesとは別物。色を設定できる）
create table if not exists event_categories (
  id integer generated always as identity primary key,
  name text not null unique,
  color text not null default '#b4332a',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
alter table event_categories enable row level security;
create policy "event_categories_select" on event_categories for select to authenticated using (true);
create policy "event_categories_admin_write" on event_categories for insert to authenticated with check (is_admin());
create policy "event_categories_admin_update" on event_categories for update to authenticated using (is_admin()) with check (is_admin());
create policy "event_categories_admin_delete" on event_categories for delete to authenticated using (is_admin());

-- 既存のevents.tagsに入っている値をカタログへ登録（移行前のデータを引き継ぐ）
insert into event_categories (name)
select distinct t from events, unnest(tags) as t
where t is not null and t <> ''
on conflict (name) do nothing;

-- 2. 投稿の失効日時（指定時刻を過ぎたら生徒側に表示しない。NULL=失効しない）
alter table posts add column if not exists expires_at timestamptz;

-- 3. 投稿とカレンダーの連携（投稿に対象日を指定すると、紐づくeventsの行を自動生成・同期する）
alter table posts add column if not exists event_date date;
alter table posts add column if not exists event_id integer references events(id) on delete set null;

-- 4. リマインダー（行事予定に紐づく定期LINE通知。Cloudflare Workers Cronから参照する）
create table if not exists reminders (
  id bigint generated always as identity primary key,
  event_id integer not null references events(id) on delete cascade,
  remind_at timestamptz not null,
  message text,
  target_roles text[] not null default '{}'::text[],
  sent boolean not null default false,
  created_at timestamptz not null default now()
);
alter table reminders enable row level security;
create policy "reminders_select" on reminders for select to authenticated using (is_admin());
create policy "reminders_admin_insert" on reminders for insert to authenticated with check (is_admin());
create policy "reminders_admin_update" on reminders for update to authenticated using (is_admin()) with check (is_admin());
create policy "reminders_admin_delete" on reminders for delete to authenticated using (is_admin());
