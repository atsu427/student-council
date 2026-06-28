-- ============================================================
-- 生徒会サイト ver3.5 マイグレーション（追加分）
-- Supabase の SQL Editor で実行してください（migration_v8.sql の後に1回だけ）
-- ============================================================

-- タグ（posts.tags）に完全移行するため、旧来の単一カテゴリ列(category)を必須から外す。
-- 列自体は削除せず残す（過去データの参照・ロールバックの保険として）。
alter table posts alter column category drop not null;
alter table posts alter column category set default '';
