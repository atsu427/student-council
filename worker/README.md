# リマインダー送信ワーカー（デプロイ手順）

このディレクトリは、`reminders`テーブルと予約投稿を1分おきにチェックしてLINEに送信するCloudflare Workerです。
サイト本体（Cloudflare Pages、GitHub連携で自動デプロイ）とは別の仕組みなので、最初に1回だけ、ターミナルから手動でデプロイする必要があります。

## 手順

ターミナル（macOSの「ターミナル」アプリ）を開いて、上から順にコマンドを実行してください。

```bash
cd "/Users/atsu/Documents/書類 - AtsuMacPro/Claude/student-council/files/worker"

npx wrangler login
```
→ ブラウザが開くので、Cloudflareにログインして「Allow」を押す（サイト本体と同じCloudflareアカウントでログインする）。

```bash
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
```
→ 値の入力を求められるので、LINEのチャネルアクセストークンを貼り付けてEnter。
　値は Cloudflare Pages の管理画面 →（既存サイトのPagesプロジェクト）→ Settings → Environment variables の `LINE_CHANNEL_ACCESS_TOKEN` を表示すれば確認できます（既存のLINE通知機能で使っているのと同じ値）。

```bash
npx wrangler secret put SUPABASE_URL
```
→ 次の値をそのまま貼り付けてEnter：
```
https://uvqidlzkiuyvqxqttuae.supabase.co
```

```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```
→ Supabaseダッシュボード →（このプロジェクト）→ Project Settings → API → 「service_role」キー（**anonキーではない方**。これはRLSを無視できる強い権限のキーなので、GitHubには絶対にコミットしないこと）を表示してコピーし、貼り付けてEnter。

```bash
npx wrangler deploy
```
→ 成功すると `https://nada-sc-reminder-cron.<あなたのサブドメイン>.workers.dev` のようなURLが表示されます。これで完了です。

## 確認方法

- デプロイ直後、表示されたURLをブラウザで開く → `ok` と表示されればその場で1回処理が実行される（リマインダー・予約投稿がまだ無ければ何も起きないだけで、これでエラーが出なければOK）
- Cloudflareダッシュボード → Workers & Pages → `nada-sc-reminder-cron` → Triggers タブで `*/1 * * * *` のCron Triggerが登録されていることを確認
- 以降は1分おきに自動実行されるので、再デプロイ等は基本的に不要（コード変更時のみ`npx wrangler deploy`を再実行。シークレットは再設定不要）
