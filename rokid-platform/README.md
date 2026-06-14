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

## テンプレート

| テンプレート | SDK | 実行場所 | 用途 |
|--------------|-----|----------|------|
| `cxr-s-ondevice` | CXR-S | グラス本体 | 音声起動の常駐HUDアプリ（APK） |
| `cxr-m-companion` | CXR-M | スマホ | グラスへHUDを送るコンパニオン（APK） |
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

## テスト

```bash
npm test    # lib + HTTP API の 12 項目を検証
```

## Rokid 開発要件

ターゲットは YodaOS（Android 12 / SDK 32, arm64-v8a）、表示は右目単眼の単色グリーン。
詳細は [docs/rokid-requirements.md](docs/rokid-requirements.md) を参照。
