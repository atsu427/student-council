-- ============================================================
-- 生徒会サイト ver4.0 マイグレーション
-- Supabase の SQL Editor で実行してください（migration_v3.sql の後に1回だけ）
-- ============================================================

-- ── 1. posts: ロール宛メンション・特別メッセージ対応 ──
alter table posts add column if not exists mentioned_roles text[] not null default '{}'::text[];
alter table posts add column if not exists is_special boolean not null default false;

-- ============================================================
-- members の削除権限は migration_v3.sql の members_admin_delete
-- ポリシーで既に許可済みのため、ここでの変更は不要です。
-- ============================================================
