// 既存のリッチメニューの「画像だけ」を差し替える。ボタンの配置・リンク先は変えない場合に使う。
//
// 使い方:
//   LINE_CHANNEL_ACCESS_TOKEN=xxxx RICH_MENU_ID=richmenu-xxxx node scripts/update-richmenu-image.mjs ./path/to/image.png
//
// 画像サイズはリッチメニュー作成時に指定したサイズ（setup-line-richmenu.mjsでは2500x843）と一致させること。

import { readFile } from 'node:fs/promises';

const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const RICH_MENU_ID = process.env.RICH_MENU_ID;
const imagePath = process.argv[2];

if (!TOKEN || !RICH_MENU_ID || !imagePath) {
  console.error('環境変数 LINE_CHANNEL_ACCESS_TOKEN, RICH_MENU_ID と、画像ファイルパスを指定してください。');
  process.exit(1);
}

async function main() {
  const image = await readFile(imagePath);
  const contentType = imagePath.endsWith('.jpg') || imagePath.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';

  const res = await fetch(`https://api-data.line.me/v2/bot/richmenu/${RICH_MENU_ID}/content`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': contentType },
    body: image
  });

  if (!res.ok) {
    console.error('画像更新に失敗しました:', res.status, await res.text());
    process.exit(1);
  }
  console.log(`画像を更新しました（${RICH_MENU_ID}）。既にデフォルト設定済みのリッチメニューなら、これだけで反映されます。`);
}

main();
