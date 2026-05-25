# iPhone Numpad — 表入力補助テンキー

iPhone を MacBook Air 用の「Excel / Google スプレッドシート / Numbers 入力補助パッド」として使うためのローカル Web アプリです。
ブラウザに表示したテンキーをタップすると、Mac の **今アクティブなアプリ** にキーストロークが送られます。

特徴:

- Mac 側は Node.js + Express + Socket.IO だけ。外部サービス不要、すべてローカル LAN 内
- キー送信は AppleScript (`osascript` → System Events `keystroke` / `key code`) なので **アプリを問わず動く**
- iPhone 側はホーム画面に追加できる PWA 風 UI(`display: standalone`)
- 右下に Enter を大きく配置した、右手親指片手操作向けレイアウト
- `pointerdown` で送信して 300ms の click 遅延を回避

---

## 必要なもの

- macOS(Apple Silicon / Intel どちらでも)
- Node.js 18 以上
- iPhone と Mac が **同じ Wi-Fi** に接続されていること

---

## セットアップ

```bash
cd ~/iphone-numpad
npm install
```

---

## 起動

```bash
npm start
```

起動すると以下のようなログが出ます:

```
================ iPhone Numpad ================
 listening   : http://0.0.0.0:3000
 token       : 9f3c2a8b1e4d6f70
 open on your iPhone (same Wi-Fi):
   http://192.168.1.23:3000/?t=9f3c2a8b1e4d6f70
===============================================
```

トークンはプロジェクト直下の `.token` ファイルに保存され、次回以降の起動でも同じ URL が使えます。
固定したい場合は環境変数で上書きできます:

```bash
NUMPAD_TOKEN=mysecret npm start
PORT=4000 npm start
```

止める時は `Ctrl+C`。

---

## iPhone からアクセス

1. ログに表示された `http://192.168.x.x:3000/?t=...` を iPhone の Safari で開く
   (Mac で URL をコピーして AirDrop / メモ / メッセージで送るのが楽です)
2. 初回アクセスで一度トークンを localStorage に保存するので、以降は `?t=...` 無しの URL でも動きます
3. **ホーム画面に追加**:
   - Safari の「共有」→「ホーム画面に追加」
   - フルスクリーン(ステータスバー含めて UI 化)で起動するようになります

---

## macOS 側で必要な権限設定

`osascript` 経由で **System Events** にキーストロークを送るので、**アクセシビリティ権限** が必要です。

1. はじめてキーを押した瞬間に macOS のダイアログが出ます。
   出ない場合は手動で:
   - `システム設定` → `プライバシーとセキュリティ` → `アクセシビリティ`
   - **node を実行している親アプリ** を追加してオンにする
     - ターミナル.app から起動なら **ターミナル**
     - iTerm2 / Warp / VS Code のターミナルから起動なら **そのアプリ自身**
2. 同じ画面の **オートメーション** に「System Events を制御」の項目が出る場合があるので、それも許可

権限を変えた直後は、Node プロセスを一度終了して再起動してください。

> ヒント: 「ターミナルからキー入力ができない」場合の典型原因はこれです。アクセシビリティとオートメーションの両方を確認。

---

## UI 配置

```
 7    8    9    /
 4    5    6    -
 1    2    3    :
 0   00    .    %
Tab  ⌫    ←   Enter
```

- 数字 0–9 / `00` / `.`
- 記号 `/` `-` `:` `%`(オレンジ系)
- 操作キー Tab / Backspace / ←(青系)
- Enter は右下にオレンジで大きめに固定

---

## セキュリティ上の注意

- **インターネットに公開しないでください。** ローカル LAN 内専用です。`0.0.0.0` で待ち受けているので、同じ Wi-Fi にいる人なら誰でも到達できます
- 認証はトークン 1 本のみ(URL クエリ or `localStorage`)。トークンを知らない人は接続できません
- カフェ・空港など **信頼できない Wi-Fi では使わない** こと。家や職場の閉じた LAN を推奨
- 何を受け付けるかはサーバ側で限定しています:
  - `type=char` の `value` は 8 文字以下の文字列
  - `type=key` の `value` は `enter / tab / backspace / left / right / up / down` のみ
  - AppleScript に渡す前に `\` と `"` をエスケープ
- ルータが LAN の機器間通信を遮断する設定(AP isolation)になっていると iPhone から Mac に届きません

---

## トラブルシューティング

**iPhone のブラウザで開けない**
- Mac が「インターネット共有」モードでなく、両者が同じ SSID か確認
- Mac のファイアウォールで Node の受信を許可
  `システム設定` → `ネットワーク` → `ファイアウォール` → `オプション` で `node` を「すべての受信接続を許可」に
- ログに表示された IP が複数ある場合は、iPhone と同じセグメントの IP を選ぶ
  (例: iPhone が 192.168.1.x なら Mac の 192.168.1.x の方)

**接続はできるがキーが入力されない**
- 上記の **アクセシビリティ権限** を再確認(`node` を動かしている親アプリに付与)
- 一度 Node プロセスを終了 → 再起動

**`¥` `@` `(` `)` などを足したい**
- `public/index.html` の `<button data-type="char" data-value="...">...</button>` を追加するだけで OK
- ただし `¥` は JIS / US などキーボードレイアウトによって入力結果が変わることがあります

**矢印キー(→ ↑ ↓)を足したい**
- 同じく HTML に `data-type="key" data-value="right" | "up" | "down"` を追加すれば動きます(サーバ側は対応済み)

**反応が遅い**
- Wi-Fi が 2.4GHz でルータが遠いと辛いです。5GHz / Mac の有線 LAN で改善
- AC 電源に挿した Mac の方がレイテンシが安定します

**iPhone をホーム画面に追加したらアイコンがダサい**
- `public/icon.svg` を差し替えてください
- iOS の `apple-touch-icon` は 180×180 PNG が一番きれいに出ます。`public/icon-180.png` を置いて HTML の `<link rel="apple-touch-icon" href="/icon-180.png" />` に書き換えればOK

---

## 仕組み(簡単に)

```
[iPhone Safari] --(WebSocket/Socket.IO, JSON)-->  [Node/Express on Mac]
                                                       │
                                                       ▼
                                              execFile("osascript", ...)
                                                       │
                                                       ▼
                                      tell application "System Events"
                                          to keystroke "5"
                                          to key code 36   (= Enter)
                                                       │
                                                       ▼
                                       前面のアプリ(Excel / Sheets / ...)
                                          に普通のキー入力として届く
```

`type` は 2 種類だけ:

- `{ type: "char", value: "5" }` → `keystroke "5"`(複数文字 OK、例 `"00"`)
- `{ type: "key", value: "enter" }` → `key code 36`

これだけなので、ボタンを増やすのも簡単です。

---

## ファイル構成

```
iphone-numpad/
├── package.json
├── server.js              # Express + Socket.IO + osascript
├── .gitignore
├── .token                 # 起動時に自動生成(コミット禁止)
└── public/
    ├── index.html         # テンキー UI
    ├── style.css          # 暗色テーマ・大ボタン
    ├── app.js             # Socket.IO クライアント + pointerdown 送信
    ├── manifest.webmanifest
    ├── sw.js              # ServiceWorker(HTTPS / localhost のみ動作)
    └── icon.svg
```

---

## ライセンス

個人利用前提のサンプル実装です。自由に改変してお使いください。
