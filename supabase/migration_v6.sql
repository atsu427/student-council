-- ============================================================
-- 生徒会サイト ver3.3 マイグレーション
-- Supabase の SQL Editor で実行してください（migration_v5.sql の後に1回だけ）
-- ============================================================

-- ── 1. 投稿削除時に通知のpost_idで外部キー違反になる問題の修正 ──
-- notifications.post_id が削除対象の投稿を参照していると、
-- 外部キー制約（ON DELETE指定なし=NO ACTION）により posts の削除自体が失敗していた。
-- 投稿が消えても通知本文（メンションされた旨のテキスト）は残してよいので、
-- 参照だけnullにするSET NULLへ変更する。
alter table notifications drop constraint if exists notifications_post_id_fkey;
alter table notifications
  add constraint notifications_post_id_fkey
  foreign key (post_id) references posts(id) on delete set null;

-- ── 2. 管理者が他の生徒の通知のpost_idを更新できるようにする ──
-- （上記のDB側の自動SET NULLだけで十分だが、管理画面側でも明示的にクリアできるようにしておく）
drop policy if exists notif_admin_update on notifications;
create policy notif_admin_update on notifications for update to authenticated using (is_admin()) with check (is_admin());
