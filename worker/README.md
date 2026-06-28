# リマインダー送信ワーカー（デプロイ手順）

このディレクトリは、`reminders` テーブルを5分おきにチェックしてLINEに送信するCloudflare Workerです。
Pages（既存サイト本体）とは別に、Wrangler CLIで1回だけ手動デプロイする必要があります。

```bash
cd worker
npm install -g wrangler   # 未インストールの場合のみ
wrangler login            # Cloudflareアカウントでログイン

# シークレットを設定（既存のline-notify-post.jsと同じ値でよい）
wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY

wrangler deploy
```

デプロイ後は `crons = ["*/5 * * * *"]` の設定により自動で5分おきに実行されます。
動作確認だけしたい場合は `wrangler dev` で起動し、表示されたURLをブラウザで開くと即時に1回実行されます。
