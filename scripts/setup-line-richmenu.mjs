// 公式LINEに「生徒会ページを開く」ボタン付きのリッチメニューを設定する初期セットアップ用スクリプト。
// LINE公式アカウント作成後、1回だけ実行する。
//
// 使い方:
//   LINE_CHANNEL_ACCESS_TOKEN=xxxx SITE_URL=https://your-site.pages.dev node scripts/setup-line-richmenu.mjs
//
// 画像は用意していないため、まずはテキストのみのシンプルなリッチメニューを作成する。
// デザイン画像を用意した場合は uploadRichMenuImage() を呼び出す処理を追加すること。

const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const SITE_URL = process.env.SITE_URL;

if (!TOKEN || !SITE_URL) {
  console.error('環境変数 LINE_CHANNEL_ACCESS_TOKEN と SITE_URL を指定してください。');
  process.exit(1);
}

const richMenu = {
  size: { width: 2500, height: 843 },
  selected: true,
  name: '生徒会メニュー',
  chatBarText: 'メニュー',
  areas: [{
    bounds: { x: 0, y: 0, width: 2500, height: 843 },
    action: { type: 'uri', label: '生徒会ページを開く', uri: SITE_URL }
  }]
};

async function main() {
  const createRes = await fetch('https://api.line.me/v2/bot/richmenu', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(richMenu)
  });
  const created = await createRes.json();
  if (!created.richMenuId) {
    console.error('リッチメニュー作成に失敗しました:', created);
    process.exit(1);
  }
  console.log('リッチメニュー作成完了:', created.richMenuId);
  console.log('※画像が未設定のため、LINE Official Account Managerの管理画面から画像をアップロードしてから');
  console.log('  次のコマンドでデフォルト設定にしてください:');
  console.log(`  curl -X POST https://api.line.me/v2/bot/user/all/richmenu/${created.richMenuId} -H "Authorization: Bearer $LINE_CHANNEL_ACCESS_TOKEN"`);
}

main();
