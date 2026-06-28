-- ============================================================
-- 生徒会サイト ver3.10 マイグレーション
-- Supabase の SQL Editor で実行してください（migration_v12.sqlの後に1回だけ）
-- ============================================================

-- 1. 行事の表示モード。投稿の「募集」タグと連動して作られた行事は、
--    カレンダー上で期間の全日に表示するのではなく、開始日・終了日のみに表示する
alter table events add column if not exists display_mode text not null default 'range';
alter table events drop constraint if exists events_display_mode_check;
alter table events add constraint events_display_mode_check check (display_mode in ('range', 'endpoints'));

-- 2. リマインダーの基準日（行事の開始日からの何日前か、終了日からの何日前か）
alter table reminders add column if not exists base_date text not null default 'start';
alter table reminders drop constraint if exists reminders_base_date_check;
alter table reminders add constraint reminders_base_date_check check (base_date in ('start', 'end'));
