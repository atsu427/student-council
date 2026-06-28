-- ============================================================
-- 生徒会サイト ver3.9 マイグレーション
-- Supabase の SQL Editor で実行してください（migration_v11.sqlの後に1回だけ）
-- ============================================================

-- 1. リマインダーを「絶対日時」指定から「行事の何日前の何時」指定に変更
--    （行事の日付が変わってもリマインダーが追従するように）
alter table reminders add column if not exists days_before integer not null default 0;
alter table reminders add column if not exists remind_time time not null default '08:00';
alter table reminders drop column if exists remind_at;

-- 2. 行事予定に時間指定を追加（NULL=終日の行事として扱う）
alter table events add column if not exists start_time time;
alter table events add column if not exists end_time time;

-- 3. 投稿⇔カレンダー連携を「単一の対象日」から「開始日・終了日（期間）」に拡張
--    募集系タグの投稿で「募集期間」をカレンダーに反映するのに使う
alter table posts add column if not exists event_end_date date;

-- 4. 予約投稿（publish_atが未来）のメンション通知が、公開時刻になっても自動送信されていなかった不具合の対処。
--    Cloudflare Workers Cron（worker/）が公開時刻を過ぎた未通知の予約投稿を検知して送信し、ここに送信済み時刻を記録する。
alter table posts add column if not exists mentions_sent_at timestamptz;
