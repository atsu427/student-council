-- ============================================================
-- 生徒会サイト ver3.2 マイグレーション
-- Supabase の SQL Editor で実行してください（migration_v4.sql の後に1回だけ）
-- ============================================================

-- ── 1. posts: 時間指定での投稿（公開日時を指定し、それまでは非表示） ──
alter table posts add column if not exists publish_at timestamptz;

-- ── 2. 全データ初期化ボタンのための削除権限（管理者のみ） ──
-- notifications/dm_messagesにはこれまで削除ポリシーが無く、管理画面の「全データ削除」が失敗するため追加
drop policy if exists notif_admin_delete on notifications;
create policy notif_admin_delete on notifications for delete to authenticated using (is_admin());

drop policy if exists dm_admin_delete on dm_messages;
create policy dm_admin_delete on dm_messages for delete to authenticated using (is_admin());
