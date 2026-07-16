# Meet Glasses (CXR-S オンデバイス)

Rokid Glasses を **Google Meet のカメラ・マイク・スピーカーとして使う**アプリ。
2つのモードがある:

| モード | ログイン | 仕組み | 場所 |
|--------|---------|--------|------|
| **A. バイパス（推奨・すぐ動く）** | 不要（PC側の通常ログインのみ） | PCのChrome拡張が getUserMedia をフックし、グラスの映像/音声をMeetへ注入。受話はグラスへ返送 | [`bridge/`](bridge/) |
| **B. 直接参加（ログイン型）** | 必要（OAuth / Meet Media API） | グラス本体が WebRTC で会議へ直接参加 | `src/`（本README以下） |

まず動かすなら **モードA** → [`bridge/README.md`](bridge/README.md)。
以下はモードB（グラス単体で完結させたい場合）の説明。

## アーキテクチャ（モードB）

```
[Rokid Glasses 本体 / YodaOS]
  HudActivity              … 単眼グリーンHUD（状態表示・音声起動）
        │ startForegroundService
        ▼
  MeetForegroundService    … 常駐サービス（HUDを閉じても会議継続）
     ├─ LocalControlServer … ★ グラス上のローカルHTTPサーバー :8765
     │      POST /join {"code":"abc-defg-hij"}
     │      POST /leave
     │      GET  /status
     ├─ MeetMediaClient     … OAuth2 → Meet Media API → WebRTC PeerConnection
     └─ GlassMediaIO        … マイク→送話 / 受話→スピーカー / カメラ→映像
        ▼
  WebRTC（音声・映像）
        ▼
  Google Meet 会議
```

- **「サーバーを建てる」** = `LocalControlServer`（依存ゼロの ServerSocket 実装）が
  グラス本体のポート `8765` で待受。`adb forward tcp:8765 tcp:8765` や
  コンパニオンアプリ、音声コマンドから会議の参加/退出を制御できる。
- **「直接接続」** = `MeetMediaClient` が Meet Media API のシグナリングを経て
  WebRTC PeerConnection を確立。中継サーバーを挟まずグラス↔Meet を結ぶ。
- **入出力** = `GlassMediaIO` がグラスのマイク/スピーカー/カメラを WebRTC トラックへ。

## ビルド

```bash
# Meet Media API 用 OAuth クライアントIDを渡す
./gradlew assembleDebug -PmeetClientId=<your-oauth-client-id>
adb install -r build/outputs/apk/debug/app-debug.apk   # USB/WiFi デバッグでグラスへ
```

## 制御の例（開発時）

```bash
adb forward tcp:8765 tcp:8765
curl -X POST localhost:8765/join  -d '{"code":"abc-defg-hij"}'
curl       localhost:8765/status
curl -X POST localhost:8765/leave
```

## 事前準備（Google 側）

1. Google Cloud プロジェクトで **Meet Media API**（開発者プレビュー）を有効化。
2. OAuth 同意画面とクライアントIDを作成し、必要スコープを付与
   （例: `https://www.googleapis.com/auth/meetings.space.created`）。
3. 初回のみ同意フローでリフレッシュトークンを取得し、端末に安全に保存。

> Meet Media API はプレビュー段階で、利用可否・スコープ・上限は変わり得る。
> 実装前に必ず公式ドキュメントで最新仕様を確認すること。

## 実装状況

雛形＋骨組み（状態機械・サーバー・I/O 経路）まで実装済み。
以下は実機 SDK 接続時に埋める `TODO`:

- `MeetMediaClient#acquireAccessToken` … OAuth2 トークン発行
- `MeetMediaClient#resolveMeetSession` … Meet Media API シグナリング
- `MeetMediaClient#establishWebRtc`    … PeerConnection / トラック接続
- `GlassMediaIO#selectGlassCamera`     … Camera2Enumerator でグラスカメラ選択
- `HudActivity`（音声コマンド購読）     … CxrServiceBridge 連携

## 設計メモ（単眼・単色グリーン）

- 右目単眼のため画面中央〜やや上に主要情報を配置する
- 単色グリーン想定。色で意味を分けず、明度とレイアウトで区別する
- 1画面5行以内、フォントは28px相当以上
- 音声コマンド「ミート開始」を主操作系として定義
