// 公式LINEに「生徒会ページを開く」ボタン付きのリッチメニューを設定する初期セットアップ用スクリプト。
// ボタンの配置・リンク先など構造を変える場合に実行する（画像だけ変えたい場合は
// update-richmenu-image.mjs を使うこと。LINE Official Account ManagerのUIから
// 画像をアップロードしても、このスクリプトで作ったrichMenuIdには反映されないので注意）。
//
// 使い方:
//   LINE_CHANNEL_ACCESS_TOKEN=xxxx SITE_URL=https://your-site.pages.dev node scripts/setup-line-richmenu.mjs
//
// 実行後の流れ:
//   1. 表示されたrichMenuIdに対して、画像（2500x843）をAPI経由でアップロードする
//      （update-richmenu-image.mjs、または直接 POST /v2/bot/richmenu/{richMenuId}/content）
//   2. 最後に表示されるcurlコマンドで全ユーザーに適用する
//   3. 古いリッチメニューが残っている場合は
//      DELETE https://api.line.me/v2/bot/richmenu/{古いrichMenuId} で削除しておく

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
