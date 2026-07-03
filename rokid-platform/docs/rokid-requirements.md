# Rokid 開発要件まとめ

AIスマートグラス **Rokid Glasses** 向けアプリ開発の技術要件を整理したもの。
本プラットフォームのテンプレート・検証ルールはこの内容に基づく。

> 出典: コミュニティ/公式ドキュメント（rokid-docs, UXR-docs, awesome-rokid, Rokid AR Platform）。
> 仕様はモデル/SDKバージョンで変わるため、実装前に必ず公式ドキュメントで最新を確認すること。

## 1. ターゲットデバイス

| 項目 | 内容 |
|------|------|
| OS | YodaOS（Android 12 ベース, SDK 32） |
| ABI | arm64-v8a |
| SoC | Qualcomm（Kryo 300 系） |
| ディスプレイ | JBD Micro-LED、**右目のみの単眼**、単色グリーン |
| センサー | IMU（加速度/ジャイロ）、12MP カメラ、マイク |
| 入力 | 音声、IMU、タッチパッド、スマホ連携 |
| 通信 | Caps（バイナリシリアライズ）over Bluetooth / WiFi-Direct |
| 重量 | 約49g（軽量フレーム） |

## 2. SDK の種類と選び方

| SDK | 実行場所 | 用途 | Maven | minSdk |
|-----|----------|------|-------|--------|
| **CXR-S** | グラス本体 | オンデバイスHUD/音声アプリ | `com.rokid.cxr:cxr-service-bridge:1.0-SNAPSHOT` | 32 |
| **CXR-M** | スマホ | コンパニオン（Bluetooth/WiFiで接続） | `com.rokid.cxr:client-m:1.0.8` | 28 |
| **CXR-L** | スマホ | 標準アプリを置き換えるスタンドアロン（AIDL） | `com.rokid.cxr:client-l:0.0.1` | 28 |
| **UXR** | Unity | XR/3D体験（Dock/Phone SDKの2系統） | — | — |

- **グラス上で直接動かす** → CXR-S（APK をサイドロード）
- **スマホで重い処理をしてHUDだけ送る** → CXR-M
- **3D/空間表現を作る** → UXR（Unity）
- **素早く試作する** → Web HUD（グラス内ブラウザ/シミュレータ）

## 3. パッケージ・配布

- アプリは標準 **APK**（Web HUD は HTML 一式）。
- **配信は有線に限らない**。むしろワイヤレスが主流:
  - 📶 CXR-M SDK で Wi-Fi 経由サイドロード（ケーブル不要、シリアル番号のみ）
  - 📶 Bluetooth SPP + Wi-Fi Direct でスマホからPush
  - 📶 ADB over TCP（`adb tcpip 5555` → `adb connect <ip>`）
  - 🔌 ADB over USB / WebUSB（有線、最も確実）
  - 詳細と出典は [import-export-investigation.md](import-export-investigation.md)。
- 本プラットフォームでは配布用に **`.rokidapp`** バンドル（依存ゼロのJSON、
  ファイルをbase64格納）を採用し、環境間でアプリを丸ごと授受できる（ネットワーク経路は任意）。

## 4. HUD デザインガイド（単眼・単色グリーン）

右目単眼かつ単色のため、通常のスマホUIとは設計指針が異なる。

- 主要情報は画面中央〜やや上に置く（視野の中心に来るため）。
- 色で意味を分けない。明度・レイアウト・サイズで区別する。
- 1画面は5行以内、フォントは28px相当以上。
- 音声コマンドを主操作系として最低1つ定義する。
- セーフエリア目安: 640×400 論理ピクセル。

## 5. 開発フロー（本プラットフォーム）

1. `rokid new <name> -t <template>` でひな型生成（または Web UI の「新規作成」）。
2. 生成された `apps/<id>/` を Claude Code で編集（Android Studio へ取り込んでビルドも可）。
3. `rokid export <id>` で `.rokidapp` を出力し、他環境/メンバーへ共有。
4. 受け取り側は `rokid import <file>` または UI のインポートで復元。
5. APK は別途 Gradle でビルドし、`adb install` でグラスへ。
