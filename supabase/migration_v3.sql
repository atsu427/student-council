-- ============================================================
-- 生徒会サイト ver3.0 マイグレーション
-- Supabase の SQL Editor で実行してください（上から順に1回だけ）
-- ============================================================

-- ── 0. members: 複数ロール対応（is_admin()がこの列を参照するため先に追加） ──
alter table members add column if not exists roles text[] not null default '{}'::text[];
alter table members add column if not exists display_name text;
alter table members add column if not exists line_user_id text;
alter table members add column if not exists line_link_code text unique default substr(md5(random()::text), 1, 8);

-- 既存の単一role列をrolesに移行（roleが空でなければ配列の先頭に入れる）
update members set roles = array[role] where role is not null and role <> '' and (roles is null or roles = '{}'::text[]);

-- 既定の管理者メールには必ず管理者ロールを付与
update members set roles = array(select distinct unnest(roles || array['管理者']))
where lower(email) = 'j170470@stg.nada.ac.jp';

-- ── 1. 管理者判定関数 ──────────────────────────────
-- members.roles 配列に「管理者」が含まれているかで判定する
create or replace function is_admin() returns boolean
language sql security definer stable as $$
  select exists (
    select 1 from members
    where id = auth.uid() and roles @> array['管理者']::text[]
  );
$$;

-- members RLS
alter table members enable row level security;
drop policy if exists members_select on members;
drop policy if exists members_insert_self on members;
drop policy if exists members_update_self_or_admin on members;
drop policy if exists members_admin_all on members;

create policy members_select on members for select to authenticated using (true);
create policy members_insert_self on members for insert to authenticated with check (id = auth.uid());
create policy members_update_self_or_admin on members for update to authenticated
  using (id = auth.uid() or is_admin())
  with check (id = auth.uid() or is_admin());
create policy members_admin_delete on members for delete to authenticated using (is_admin());

-- ── 2. roles: 管理者だけが追加・削除できる ──────────
alter table roles enable row level security;
drop policy if exists roles_select on roles;
drop policy if exists roles_admin_write on roles;

create policy roles_select on roles for select to authenticated using (true);
create policy roles_admin_write on roles for insert to authenticated with check (is_admin());
create policy roles_admin_update on roles for update to authenticated using (is_admin()) with check (is_admin());
create policy roles_admin_delete on roles for delete to authenticated using (is_admin());

-- 「管理者」ロールが無ければ作成
insert into roles (name) select '管理者' where not exists (select 1 from roles where name = '管理者');

-- ── 3. posts: カテゴリ可変・メンション対応 ──────────
alter table posts add column if not exists mentioned_emails text[] not null default '{}'::text[];

alter table posts enable row level security;
drop policy if exists posts_select on posts;
drop policy if exists posts_admin_write on posts;

create policy posts_select on posts for select to authenticated using (published = true or is_admin());
create policy posts_admin_insert on posts for insert to authenticated with check (is_admin());
create policy posts_admin_update on posts for update to authenticated using (is_admin()) with check (is_admin());
create policy posts_admin_delete on posts for delete to authenticated using (is_admin());

-- ── 4. categories: カテゴリ管理 ─────────────────────
create table if not exists categories (
  id serial primary key,
  name text not null unique,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
insert into categories (name, sort_order) values
  ('お知らせ', 1), ('行事', 2), ('部活', 3), ('募集', 4), ('その他', 5)
on conflict (name) do nothing;

alter table categories enable row level security;
drop policy if exists categories_select on categories;
drop policy if exists categories_admin_write on categories;
create policy categories_select on categories for select to authenticated using (true);
create policy categories_admin_write on categories for insert to authenticated with check (is_admin());
create policy categories_admin_update on categories for update to authenticated using (is_admin()) with check (is_admin());
create policy categories_admin_delete on categories for delete to authenticated using (is_admin());

-- ── 5. 時間割 ───────────────────────────────────────
-- grade: '中1','中2','中3','高1','高2','高3' / class_no: 1-4 / weekday: 1(月)-6(土) / period: 1-7
create table if not exists timetable_slots (
  id serial primary key,
  grade text not null,
  class_no int not null,
  weekday int not null,
  period int not null,
  subject text not null default '',
  updated_at timestamptz not null default now(),
  unique (grade, class_no, weekday, period)
);

create table if not exists timetable_overrides (
  id serial primary key,
  date date not null,
  grade text not null,
  class_no int not null,
  period int not null,
  type text not null check (type in ('subject_change','swap','self_study','cancelled')),
  subject text,
  swap_with_period int,
  note text,
  created_at timestamptz not null default now()
);

alter table timetable_slots enable row level security;
alter table timetable_overrides enable row level security;
drop policy if exists slots_select on timetable_slots;
drop policy if exists slots_admin_write on timetable_slots;
drop policy if exists overrides_select on timetable_overrides;
drop policy if exists overrides_admin_write on timetable_overrides;

create policy slots_select on timetable_slots for select to authenticated using (true);
create policy slots_admin_write on timetable_slots for insert to authenticated with check (is_admin());
create policy slots_admin_update on timetable_slots for update to authenticated using (is_admin()) with check (is_admin());
create policy slots_admin_delete on timetable_slots for delete to authenticated using (is_admin());

create policy overrides_select on timetable_overrides for select to authenticated using (true);
create policy overrides_admin_write on timetable_overrides for insert to authenticated with check (is_admin());
create policy overrides_admin_update on timetable_overrides for update to authenticated using (is_admin()) with check (is_admin());
create policy overrides_admin_delete on timetable_overrides for delete to authenticated using (is_admin());

-- ── 6. 意見箱・DM ───────────────────────────────────
create table if not exists suggestions (
  id serial primary key,
  member_id uuid references members(id),
  email text,
  body text not null,
  status text not null default 'open' check (status in ('open','read','closed')),
  created_at timestamptz not null default now()
);

create table if not exists dm_messages (
  id serial primary key,
  member_id uuid not null references members(id),
  sender text not null check (sender in ('admin','student')),
  body text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table suggestions enable row level security;
alter table dm_messages enable row level security;
drop policy if exists suggestions_insert_self on suggestions;
drop policy if exists suggestions_select on suggestions;
drop policy if exists suggestions_admin_update on suggestions;
drop policy if exists dm_select on dm_messages;
drop policy if exists dm_insert on dm_messages;

create policy suggestions_insert_self on suggestions for insert to authenticated with check (member_id = auth.uid() or is_admin());
create policy suggestions_select on suggestions for select to authenticated using (member_id = auth.uid() or is_admin());
create policy suggestions_admin_update on suggestions for update to authenticated using (is_admin()) with check (is_admin());

create policy dm_select on dm_messages for select to authenticated using (member_id = auth.uid() or is_admin());
create policy dm_insert on dm_messages for insert to authenticated with check (
  (sender = 'student' and member_id = auth.uid()) or (sender = 'admin' and is_admin())
);

-- ── 7. 通知（メンション） ───────────────────────────
create table if not exists notifications (
  id serial primary key,
  member_id uuid not null references members(id),
  post_id int references posts(id),
  body text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table notifications enable row level security;
drop policy if exists notif_select on notifications;
drop policy if exists notif_update_self on notifications;
drop policy if exists notif_admin_insert on notifications;

create policy notif_select on notifications for select to authenticated using (member_id = auth.uid() or is_admin());
create policy notif_update_self on notifications for update to authenticated using (member_id = auth.uid()) with check (member_id = auth.uid());
create policy notif_admin_insert on notifications for insert to authenticated with check (is_admin());

-- ── 8. Storage（添付ファイル）RLS ───────────────────
-- post-files バケットへの読み書きを「ログイン済みユーザー」に許可
drop policy if exists post_files_select on storage.objects;
drop policy if exists post_files_admin_write on storage.objects;

create policy post_files_select on storage.objects for select to authenticated
  using (bucket_id = 'post-files');
create policy post_files_admin_write on storage.objects for insert to authenticated
  with check (bucket_id = 'post-files' and is_admin());
create policy post_files_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'post-files' and is_admin());
create policy post_files_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'post-files' and is_admin());

-- ============================================================
-- 実行後、Storage > post-files バケットの「Public」がOFFになっている場合、
-- getPublicUrl() で取得したファイルが開けない可能性があります。
-- バケット設定で Public を ON にしてください（添付ファイル閲覧に必須）。
-- ============================================================
