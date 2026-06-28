-- ============================================================
-- 生徒会サイト ver3.4 マイグレーション
-- Supabase の SQL Editor で実行してください（migration_v6.sql の後に1回だけ）
-- ============================================================

-- ── 1. 時間割変更タイプに「移動」を追加 ──
-- 「交換」ではなく一方通行の移動（例：1限の科目を3限に移す。3限に元あった科目は上書きされる）。
-- 移動元の時限を記録するfrom_period列を追加し、type制約に'moved'を追加する。
alter table timetable_overrides add column if not exists from_period int;

-- 'swap'は旧「入れ替え」機能(ver3.2で廃止済み)の値。既存データにまだ残っている可能性があるため
-- 制約からは外さず、新しく'moved'だけを追加する。
alter table timetable_overrides drop constraint if exists timetable_overrides_type_check;
alter table timetable_overrides
  add constraint timetable_overrides_type_check
  check (type in ('subject_change', 'self_study', 'cancelled', 'swap', 'moved'));
