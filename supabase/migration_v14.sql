-- ============================================================
-- 生徒会サイト ver3.12 マイグレーション（セキュリティ修正）
-- Supabase の SQL Editor で実行してください（migration_v13.sqlの後に1回だけ）
-- ============================================================
-- 第三者レビューで発見されたCritical指摘3件への対応：
--   1. members の自己更新ポリシーがroles等を含む全列更新を許可しており、
--      一般ユーザーが自分のrolesに「管理者」を入れて自己昇格できた
--   2. members_select が全認証ユーザーに無条件で公開され、他人のemail/roles/
--      line_link_code等を直接APIで読めた
--   3. 1・2を組み合わせると、他人のline_link_codeを読んでLINEに送るだけで
--      その人のLINE連携を乗っ取れた（line-webhook.jsはコード一致だけで再連携する）

-- ── 1・3. members: roles/line_user_id/line_link_code/emailの自己書き換えを禁止する ──
-- RLSは行単位の制御しかできないため、列単位の制御はトリガーで行う。
-- service_role（LINE Webhook・Workers Cronなど）・SQL Editor等のpostgresロール・既に管理者ロールを持つ本人による変更は許可する。
-- 既定の管理者メールアドレスのみ、初回ログイン時に限り管理者ロールでの初期登録を許可する（既存のブートストラップ運用を維持）。
-- 注: security definer にすると関数内のcurrent_userが常に関数所有者(postgres)になってしまい、
--     呼び出し元の本当のロール（service_role/authenticatedなど）を判定できなくなるため、
--     意図的にデフォルトのsecurity invoker（指定なし）にしている。
create or replace function members_protect_admin_columns() returns trigger
language plpgsql as $$
declare
  jwt_email text := lower(coalesce((auth.jwt() ->> 'email'), ''));
begin
  if current_user in ('service_role', 'postgres') or is_admin() then
    return new;
  end if;

  if jwt_email = 'j170470@stg.nada.ac.jp' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.roles := '{}'::text[];
    new.line_user_id := null;
  else
    new.roles := old.roles;
    new.line_user_id := old.line_user_id;
    new.line_link_code := old.line_link_code;
    new.email := old.email;
  end if;
  return new;
end;
$$;

drop trigger if exists members_protect_admin_columns_trigger on members;
create trigger members_protect_admin_columns_trigger
  before insert or update on members
  for each row execute function members_protect_admin_columns();

-- ── 2. members: 自分の行か、管理者だけが他人の行を読めるようにする ──
-- 生徒側ページ(index.html/post.html)は常に自分のidでしか絞り込んでおらず、
-- 他人の行を読む処理は管理画面(admin.html、is_adminのみ)にしか無いため、挙動への影響は無い。
drop policy if exists members_select on members;
create policy members_select on members for select to authenticated using (id = auth.uid() or is_admin());

-- ── 番外: members上に過去Supabase Studioで作られたまま放置されていた「野良」ポリシーを削除 ──
-- これらはどのmigration_*.sqlにも記録が無く、認証済みなら誰でも全員のmembers行を読み書きできてしまっていた
-- （上記2の制限がこれらのせいで実質無効化されていたことをライブDB調査で確認済み）。
drop policy if exists "全員読める" on members;
drop policy if exists "全員更新できる" on members;
drop policy if exists "members_select_self_or_admin" on members;
drop policy if exists "自分を挿入できる" on members;
