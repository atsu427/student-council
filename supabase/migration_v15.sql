-- ============================================================
-- 生徒会サイト ver3.13 マイグレーション（セキュリティ修正）
-- Supabase の SQL Editor で実行してください（migration_v14.sqlの後に1回だけ）
-- ============================================================
-- migration_v14.sqlでmembersの野良ポリシーを調査した際、posts にも同様の
-- 野良ポリシー（どのmigration_*.sqlにも記録が無く、Supabase Studioで過去に
-- 直接作られたとみられるもの）が残っていることが判明。
-- 「認証ユーザーは編集できる」「認証ユーザーは投稿できる」「認証ユーザーは削除できる」は
-- いずれも条件無し（=管理者でなくても全投稿を編集・新規作成・削除できる）、
-- 「認証ユーザーは全投稿を読める」は未公開の下書きも含めて誰でも読める状態だった。
--
-- posts_select/posts_admin_insert/posts_admin_update/posts_admin_delete（migration_v3.sqlで作成、
-- is_admin()でちゃんと絞られている）が既に存在しており、生徒側ページ(index.html/post.html)・
-- 管理画面(admin.html)とも常にこちら経由でしか投稿を読み書きしていないため、
-- 以下の野良ポリシーを削除しても挙動への影響は無い。

drop policy if exists "認証ユーザーは削除できる" on posts;
drop policy if exists "認証ユーザーは投稿できる" on posts;
drop policy if exists "認証ユーザーは全投稿を読める" on posts;
drop policy if exists "認証ユーザーは編集できる" on posts;
drop policy if exists "誰でも公開投稿を読める" on posts; -- posts_selectのpublished=trueと完全に重複するため整理
