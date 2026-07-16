# Meet Device Bridge — グラスを Meet の「カメラ・マイク・スピーカー」にする

**バイパスモード**の実装。グラスは Meet にログインせず、PC で開いている
Google Meet の**入出力デバイスとして機能**する。

```
[Rokid Glasses]                    [PC]
 ブラウザで index.html      Chrome + 本拡張 + meet.google.com
   カメラ/マイク ─────WebRTC(P2P)────▶ getUserMedia フック → Meet のカメラ/マイクに
   スピーカー   ◀────WebRTC(P2P)────── Meet の受話音声を AudioContext で合成して返送
        └──────── ws シグナリング ────────┘
                (bridge-server.js :8787 — SDP/ICE の中継のみ。メディアは通らない)
```

## 使い方（3ステップ）

```bash
# 1. PC でブリッジサーバーを起動（依存ゼロ）
node server/bridge-server.js            # :8787

# 2. グラスのブラウザで開いて「開始」
#    http://<PCのIP>:8787/?room=default

# 3. PC の Chrome に extension/ を読み込み（chrome://extensions → デベロッパーモード
#    → パッケージ化されていない拡張機能を読み込む）、ポップアップで
#    ws://<PCのIP>:8787/ws を設定して有効化 → Meet に参加
```

Meet が起動すると拡張が `getUserMedia` を横取りし、グラスの映像・音声を
カメラ/マイクとして返す。デバイス一覧にも「Rokid Glasses カメラ/マイク/
スピーカー (Bridge)」が表示される。受話音声はグラス側で自動再生される。

## 設計上の決定

- **ログイン不要（バイパス）を既定に** — Meet Media API は開発者プレビューで
  制約が多く、OAuth 設定の準備が重い。バイパス型は会議 URL さえあれば動き、
  会社アカウント等の制限も受けない。ログイン型（直接参加）は
  親アプリ（`../src`）にモードBとして残してある。
- **フォールバック安全** — ブリッジ未接続・タイムアウト(8秒)・無効化時は
  必ず元の getUserMedia に戻し、Meet を壊さない。
- **シグナリングとメディアの分離** — サーバーは SDP/ICE の JSON を右から左へ
  流すだけ（依存ゼロ・手書き RFC6455）。映像/音声は P2P で LAN 内直結。
- **受話は1トラックに合成** — Meet が生成する複数の `<audio>` を
  AudioContext で1本にまとめてから返送。再ネゴシエーションを避け安定化。

## 制約・注意

- 拡張を有効化したまま通常のカメラに戻したい場合はポップアップで無効化し
  タブを再読み込みする。
- PC 側でも受話音声は再生され続ける（二重に聞こえる場合は PC をミュート）。
- シグナリングは平文 ws。**信頼できる LAN 内でのみ使用**し、必要なら
  `?room=` に推測されにくい値を使うこと。
- グラス側ブラウザが getUserMedia(カメラ) を許可できることが前提。
  不可の機体では親アプリ（CXR-S 版）の GlassMediaIO を同じシグナリングに
  接続する実装に差し替える。

## 検証

```bash
node server/bridge-server.js --selftest   # WSフレーム処理の自己テスト
curl http://localhost:8787/health          # 稼働確認
```
