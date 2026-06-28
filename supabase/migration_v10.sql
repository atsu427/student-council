-- ============================================================
-- 生徒会サイト ver3.7 マイグレーション
-- Supabase の SQL Editor で実行してください（migration_v9.sql の後に1回だけ）
-- ============================================================

-- 行事予定（events）にタグと表示対象ロールを追加。
-- 意味はposts.tags/posts.target_rolesと同じ（target_rolesが空配列＝全員に表示）。
alter table events add column if not exists tags text[] not null default '{}'::text[];
alter table events add column if not exists target_roles text[] not null default '{}'::text[];
