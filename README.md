# KeyFlow

iPhone を MacBook の表入力補助テンキーとして使う macOS アプリです。
スプレッドシート（Excel / Google スプレッドシート / Numbers）の数値入力を iPhone から快適に行えます。

---

## ダウンロード

[Releases](https://github.com/daisukenagashima-boop/keyflow/releases) から最新の `KeyFlow-x.x.x-universal.dmg` をダウンロードしてください。

---

## インストール

1. DMG を開いて `KeyFlow.app` を `/Applications` にドラッグ
2. 初回起動時に **「壊れている」エラーが出た場合**:
   ```bash
   xattr -cr /Applications/KeyFlow.app
   ```
3. KeyFlow を起動 → メニューバーにアイコンが現れる

---

## 初回セットアップ

### 1. アクセシビリティ権限を許可する

キーストロークを送るために macOS の権限が必要です。  
起動時に自動でガイド画面が表示されます。

1. 「設定を開く →」をクリック
2. 「プライバシーとセキュリティ」→「アクセシビリティ」で `+` をクリック
3. `KeyFlow.app` を追加してスイッチをオン
4. アプリに戻り「許可した ✓」をクリック

### 2. iPhone を接続する

1. Mac と iPhone を **同じ Wi-Fi** に接続
2. 画面に表示された QR コードを iPhone のカメラで読み込む
3. Safari が開き「● connected」と表示されれば完了

> iPhone のホーム画面に追加しておくと、次回からアイコンをタップするだけで起動できます（QR 読み込みは初回のみ）。

---

## 使い方

| 操作 | 動作 |
|------|------|
| ボタンをタップ | 対応するキーを Mac に送信 |
| ⌫ を長押し（0.6秒） | 入力フィールドを全削除（Cmd+A → Delete） |
| その他のキーを長押し | カーソル移動モード（指をスライドで移動） |

### キー一覧

```
%    /    +    -
7    8    9   Tab
4    5    6    ⌫
1    2    3
0   00    .   Enter
```

---

## トレイメニュー

メニューバーのアイコンを右クリックで以下の操作ができます:

- **QR コードを表示** — 接続用 QR を再表示
- **ログイン時に自動起動** — Mac 起動時に自動で常駐（デフォルトでオン）
- **アップデートを確認…** — 最新バージョンを手動チェック
- **終了** — アプリを終了

---

## アップデート

起動時に自動で新バージョンを確認します。新しいバージョンがあると通知が表示され、**「自動でインストール」** をクリックするだけで更新完了（再起動あり）。

---

## Android でも使える

QR コード画面には iPhone 用（`.local` URL）と Android 用（IP URL）の 2 種類が表示されます。Android の場合は Chrome で開いてください。

---

## セキュリティ

- **ローカル LAN 専用**。インターネットには公開しないでください
- 接続にはランダム生成されたトークンが必要です（URL に埋め込み済み）
- 受け付けるキー入力は限定されています（任意コマンド実行などは不可）

---

## トラブルシューティング

**QR コードが表示されない**
- トレイアイコンを右クリック → 「QR コードを表示」
- それでも出ない場合は「終了」してから再起動

**接続できるが入力が効かない**
- アクセシビリティ権限が切れている可能性があります
- システム設定 → プライバシーとセキュリティ → アクセシビリティ で KeyFlow を削除して追加し直す

**「壊れている」エラーが出る（Gatekeeper）**
```bash
xattr -cr /Applications/KeyFlow.app
```

**iPhone から繋がらない**
- Mac と iPhone が同じ Wi-Fi にいるか確認
- ルーターの AP Isolation（クライアント間通信遮断）をオフにする

---

## 仕組み

```
[iPhone Safari]
     │ WebSocket (Socket.IO)
     ▼
[KeyFlow (Electron + Express) on Mac]
     │ execFile("osascript")
     ▼
tell application "System Events" to keystroke "5"
     │
     ▼
前面のアプリ（Excel / Sheets / Numbers）にキー入力として届く
```

---

## ファイル構成

```
keyflow/
├── electron-main.js       # Electron メインプロセス・自動アップデート
├── server.js              # Express + Socket.IO + osascript
├── latest.json            # アップデート確認用バージョン情報
├── src/
│   ├── index.html         # Mac 側ウィンドウ（QR表示・設定ガイド）
│   ├── style.css
│   └── preload.js
└── public/
    ├── index.html         # iPhone 側テンキー UI
    ├── style.css
    ├── app.js             # キー送信・長押し・カーソルモード
    ├── sw.js              # Service Worker
    └── manifest.webmanifest
```

---

## ライセンス

個人・社内利用前提のツールです。自由に改変してお使いください。
