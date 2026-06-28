-- ============================================================
-- 生徒会サイト ver3.5 マイグレーション
-- Supabase の SQL Editor で実行してください（migration_v7.sql の後に1回だけ）
-- ============================================================

-- ── 1. カテゴリ→タグ（複数付与） ──
-- postsに複数タグを持たせるtags列を追加し、既存のcategory値を1件タグとして引き継ぐ。
-- categoryテーブル/列自体は残す（categoriesテーブルをタグ候補の管理にそのまま使う）。
alter table posts add column if not exists tags text[] not null default '{}'::text[];
update posts set tags = array[category] where category is not null and category <> '' and (tags is null or tags = '{}'::text[]);

-- ── 2. 時間割変更の重複防止（移動後にカットすると2件消える不具合の原因） ──
-- 同じ日付・学年・クラス・時限に対して複数のtimetable_overrides行が同時に存在できてしまい、
-- どちらが有効になるかが不定になっていた。先に重複行を整理してから一意制約を追加する
-- （period が無い「備考のみ」行はNULL同士なのでこの制約には影響されない）。
delete from timetable_overrides a
using timetable_overrides b
where a.id < b.id
  and a.date = b.date and a.grade = b.grade and a.class_no = b.class_no
  and a.period is not null and b.period is not null and a.period = b.period;

alter table timetable_overrides drop constraint if exists timetable_overrides_unique_period;
alter table timetable_overrides add constraint timetable_overrides_unique_period unique (date, grade, class_no, period);

-- ── 3. 備考のみ（自由記述・対象クラス複数）に対応 ──
alter table timetable_overrides alter column period drop not null;
alter table timetable_overrides drop constraint if exists timetable_overrides_type_check;
alter table timetable_overrides
  add constraint timetable_overrides_type_check
  check (type in ('subject_change', 'self_study', 'cancelled', 'swap', 'moved', 'note'));

-- ── 4. カレンダー（行事予定） ──
create table if not exists events (
  id serial primary key,
  title text not null,
  description text,
  start_date date not null,
  end_date date,
  created_at timestamptz not null default now()
);

alter table events enable row level security;
drop policy if exists events_select on events;
drop policy if exists events_admin_insert on events;
drop policy if exists events_admin_update on events;
drop policy if exists events_admin_delete on events;

create policy events_select on events for select to authenticated using (true);
create policy events_admin_insert on events for insert to authenticated with check (is_admin());
create policy events_admin_update on events for update to authenticated using (is_admin()) with check (is_admin());
create policy events_admin_delete on events for delete to authenticated using (is_admin());
