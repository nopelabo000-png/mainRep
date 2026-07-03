# 調査: インポート/エクスポートは有線接続以外あり得ないのか

**結論: いいえ。有線(USB)は選択肢の一つに過ぎず、Rokid Glasses ではむしろワイヤレス配信が主流。**

「インポート/エクスポート」を2層に分けて整理する。

## 1. プラットフォーム間の授受（本プラットフォームの `.rokidapp`）

これはそもそも物理接続と無関係。`.rokidapp` は依存ゼロの JSON バンドルで、
ファイル共有・チャット・リポジトリなど任意のネットワーク経路で 1 ファイルとして渡せる。
有線は一切不要。

## 2. アプリ(APK)をグラス実機へ載せる段階

ここが「有線しかないのか?」の本題。調査の結果、**ワイヤレス手段が複数あり、公式SDKもそれを前提にしている**。

| 方式 | 有線/無線 | 概要 | 根拠 |
|------|-----------|------|------|
| CXR-M / Wi-Fi アップロード | 📶 無線 | CXR-M SDK でスマホから Wi-Fi 経由 APK をサイドロード。開発ケーブル不要、ライセンス不要、シリアル番号のみ | RokidApkUploader |
| Bluetooth + Wi-Fi Direct | 📶 無線 | スマホのコンパニオンが Bluetooth SPP で制御、APK を Wi-Fi Direct でグラスへ Push。グラス側インストーラで確認 | Rokid-APKs / awesome-rokid |
| ADB over TCP/Wi-Fi | 📶 無線 | YodaOS は Android 12 ベース。`adb tcpip 5555` 後は `adb connect <ip>` で無線インストール可 | YodaOS = Android |
| コンパニオン / ストア配信 | 📶 無線 | Hi Rokid(CXR-L) 等のコンパニオン経由で転送 | Hi Rokid app |
| ADB over USB | 🔌 有線 | 開発ケーブルで `adb install`。最も確実 | 標準 Android |
| WebUSB インストーラ | 🔌 有線 | ブラウザから USB で書き込み。ドライバ不要だが物理接続要 | awesome-rokid |

### 転送の4モード（コミュニティ整理）
スマホ→グラスの APK 転送には、公式CXR-M / Hi Rokid CXR-L / Bluetooth SPP / Wi-Fi LAN の
4つの明示的モードが存在する。いずれもワイヤレスで完結する。

## プラットフォームへの反映

- `lib/rokid-spec.js` に `DEPLOY_METHODS` を追加（有線/無線フラグ付き）。
- CLI に `rokid deploy` を追加し、配信方式を一覧表示。
- Web UI「開発要件」タブに配信方式テーブルを追加。
- 生成テンプレートの README を「`adb connect <ip>:5555`（Wi-Fi 経由）」主体に修正。
- 利用ガイド (docs/usage-guide.html) の実機配信ステップをワイヤレス前提に修正。

## 出典
- RokidApkUploader — https://github.com/Miniontoby/RokidApkUploader
- Rokid-APKs — https://github.com/Anezium/Rokid-APKs
- awesome-rokid — https://github.com/Anezium/awesome-rokid
- File Manager (AnExplorer) — https://anexplorer.io/device/glasses/rokid
- Hi Rokid (Companion) — https://apps.apple.com/us/app/hi-rokid-rokid-glasses/id6749669942
