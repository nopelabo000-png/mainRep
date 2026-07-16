# Rokid Dev Platform

AIスマートグラス **Rokid Glasses** 向けアプリの開発プラットフォーム。
Claude Code から **アプリの開発・格納・インポート/エクスポート** を簡単に行え、
同時に Web UI でも操作できる。**依存パッケージはゼロ**（Node.js 標準ライブラリのみ）。

```
rokid-platform/
├── cli/rokid.js          # CLI（Claude Code から直接操作）
├── server/server.js      # Web サーバー + REST API（依存ゼロ）
├── web/                  # Web UI（一覧/作成/HUDシミュレータ/要件）
├── lib/                  # コア（仕様・レジストリ・テンプレート・バンドル）
├── templates → lib/templates.js が生成
├── apps/                 # 格納済みアプリ + registry.json
├── docs/rokid-requirements.md   # Rokid 開発要件まとめ
└── test/smoke.js         # 依存ゼロのスモークテスト
```

## クイックスタート

### Web UI を起動

```bash
cd rokid-platform
npm run serve            # → http://localhost:4173
# または: node cli/rokid.js serve 4173
```

UI では「アプリ一覧 / 新規作成 / 開発要件」のタブを切り替えられ、
アプリ選択時に **HUDシミュレータ（右目単眼・単色グリーン）** でプレビューできる。
インポート/エクスポートもボタンで完結する。

### CLI（Claude Code から）

```bash
node cli/rokid.js templates                 # テンプレート/SDK一覧
node cli/rokid.js spec                       # Rokid 開発要件サマリ

# アプリ生成
node cli/rokid.js new "Live Translator" -t cxr-s-ondevice \
  --voice "翻訳開始" --tagline "Real-time AR translation" --pkg com.example.translator

node cli/rokid.js list                       # 格納済み一覧
node cli/rokid.js show live-translator        # 詳細
node cli/rokid.js export live-translator       # → exports/live-translator.rokidapp
node cli/rokid.js import path/to/app.rokidapp  # インポート
node cli/rokid.js remove live-translator        # 削除
```

### 実機(TCP)連携 — バックアップ & インストール

Rokid Glasses は YodaOS(Android 12) なので **adb over WiFi（TCP接続）**で
実機連携できる。USB で一度 `tcpip` を有効化すれば、以降は WiFi だけで
「①デフォルトアプリのバックアップ」「②作成アプリのインポート（インストール）」が完結する。

```bash
# 0) 初回のみ USB 接続中に TCP を有効化（以降は WiFi で接続できる）
node cli/rokid.js device tcpip

# 1) グラスへ TCP 接続（host のみ指定で :5555 を補完）
node cli/rokid.js device connect 192.168.1.50
node cli/rokid.js device devices

# 2) ① デフォルトアプリのバックアップ（APKを backups/<host>/ へ吸い出す）
node cli/rokid.js device backup --target 192.168.1.50              # プリイン全体
node cli/rokid.js device backup --filter '^com\.rokid'             # Rokid製のみ
node cli/rokid.js device restore backups/192.168.1.50_5555         # 書き戻し

# 3) ② 作成アプリのインポート（ビルド済みAPKを端末へインストール）
#    先に apps/<id> で ./gradlew assembleDebug を実行しておく
node cli/rokid.js device install meet-glasses --target 192.168.1.50
node cli/rokid.js device install path/to/any.apk                   # 任意APKも可
```

- `ROKID_ADB` で adb バイナリのパスを差し替え可能（既定 `adb`）。
- `ROKID_ADB_DRYRUN=1` で実行せず発行コマンドだけ確認できる（CI/動作確認用）。

## テンプレート

| テンプレート | SDK | 実行場所 | 用途 |
|--------------|-----|----------|------|
| `cxr-s-ondevice` | CXR-S | グラス本体 | 音声起動の常駐HUDアプリ（APK） |
| `cxr-m-companion` | CXR-M | スマホ | グラスへHUDを送るコンパニオン（APK） |
| `cxr-l-standalone` | CXR-L | スマホ | 標準Rokidアプリを置き換えるスタンドアロン（APK/AIDL） |
| `uxr-unity` | UXR | グラス(Unity) | Unity3Dで作る3D/空間アプリの骨格（APK出力） |
| `web-hud` | Web | ブラウザ | ビルド不要の最小HUD試作 |

生成物には Android マニフェスト・`build.gradle`・実装スケルトン・
プラットフォーム記述子 `rokid.app.json` が含まれる。

## インポート/エクスポート形式

`.rokidapp` は依存ゼロで扱える JSON バンドル（ファイルを base64 格納）。
1ファイルでアプリ一式を授受でき、取り込み側でフォルダとレジストリを完全再構築する。
ID 衝突時は自動でユニークIDを採番する。

## REST API

| メソッド | パス | 内容 |
|----------|------|------|
| GET | `/api/spec` | 要件/SDK/テンプレート定義 |
| GET/POST | `/api/apps` | 一覧 / 新規生成 |
| GET/DELETE | `/api/apps/:id` | 詳細 / 削除 |
| GET | `/api/apps/:id/files` | ファイル内容 |
| GET | `/api/apps/:id/export` | `.rokidapp` ダウンロード |
| POST | `/api/import` | バンドル取り込み |
| GET | `/api/device/devices` | 接続中の端末一覧（TCP） |
| POST | `/api/device/connect` | TCPで端末へ接続 `{target}` |
| GET | `/api/device/packages` | パッケージ一覧 `?third=1&target=` |
| POST | `/api/device/backup` | デフォルトアプリ等をバックアップ |
| POST | `/api/device/install` | 作成アプリ/APKをインストール `{id}` |
| POST | `/api/device/restore` | バックアップを書き戻す `{dir}` |

## テスト

```bash
npm test    # lib + device + HTTP API の 19 項目を検証
```

## Rokid 開発要件

ターゲットは YodaOS（Android 12 / SDK 32, arm64-v8a）、表示は右目単眼の単色グリーン。
詳細は [docs/rokid-requirements.md](docs/rokid-requirements.md) を参照。
