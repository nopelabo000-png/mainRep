# Rokid Glasses (RV101) 実機アクセス手順 — 確定版

5ピン開発ケーブルでの PC→グラス データ転送（adb）の手順。
複数ソースの裏取り済み。【確認済】=一次/複数ソースで裏付けあり、【推定】=傍証のみ。

> 主要ソース: [cursive-team/rokid-apps](https://github.com/cursive-team/rokid-apps)
> (SETUP_MACOS.md / DEPLOY_RV101.md / TROUBLESHOOTING.md, 2026-02 実機検証記録あり),
> [rokid-docs](https://github.com/buildwithfenna/rokid-docs) (ファームウェア解析),
> [bcefghj/rokid-collection](https://github.com/bcefghj/rokid-collection),
> [marcinmiazga.com](https://marcinmiazga.com/rokid-development-cable),
> [Medium: Rooting the Rokid AR Glasses](https://medium.com/@20x05zero/rooting-the-rokid-ar-glasses-a-22-session-deep-dive-into-android-security-research-164c6bb11321)

## 0. 大前提（ここで詰まる人が大半）

- 【確認済】**3ピン充電ケーブルでは adb 不可**。データ線が無い。5ピン開発ケーブル
  （公式 "Cable only" $39.99）が必須。モード切替スイッチ等は存在せず、違いはケーブルのみ。
- 【確認済】ADB有効化は **Hi Rokid アプリ → Settings → Developer Options → ADB Debugging**。
- 【確認済】RV101 は `ro.adb.secure=1`（RSA認可必須）。**初回はグラス側での承認が要る**。
- 【推定】マグネット式ポゴピン端子は右テンプル末端（近縁モデルで確認、RV101明記資料なし）。
  グラスは**電源ONで接続**する（HUDに認可プロンプトが出るため）。
- 【確認済】**Windowsの Error Code 10 問題は Recovery/Sideload モード限定**。
  通常の adb（APK転送・logcat）には該当報告なし。ファーム書換をしない限り気にしなくてよい。

## 1. 接続 → 認可（初回）

```powershell
# adb 未PATHなら（本プラットフォームのCLI経由の場合）
$env:ROKID_ADB = "C:\dev\mainRep\platform-tools\adb.exe"

# 1) グラス電源ON → 5ピンケーブルをグラスへ(マグネット) → USBをPCへ直結
#    ※USBハブを避け、PC本体のポートに直結する（確認済のトラブル源）

# 2) 認識確認
node cli/rokid.js device devices        # または adb devices -l
```

結果の読み方:
| 表示 | 意味 | 対処 |
|---|---|---|
| `XXXXXXXX device product:rv101 model:RV101` | 成功 | 次へ |
| `unauthorized` | RSA未承認 | **グラスのHUDに出る認可プロンプトをテンプルのタッチパッドで「許可」**。出ない場合は Hi Rokid で ADB Debugging を OFF→ON |
| `offline` | 接続不安定 | `adb kill-server` → ケーブル抜く → **5秒待つ** → 挿し直す → `adb start-server` → グラス側で承認。ダメなら電源ボタン長押しでグラス再起動 |
| （何も出ない） | ケーブル/ポート | 5ピンか確認・ハブを外す・別ポート |

## 2. データ転送（やりたいこと別）

```powershell
# APKインストール（本プラットフォームの格納アプリ）
node cli/rokid.js device install live-translator     # ビルド済APKを自動検出
# 任意のAPK:  adb install -r path\to\app.apk
# 署名違いエラー(INSTALL_FAILED_UPDATE_INCOMPATIBLE)時: adb uninstall <pkg> してから

# プリインアプリのバックアップ（改造前に推奨）
node cli/rokid.js device backup --filter '^com\.rokid'

# ファイル転送
adb push file.txt /sdcard/Download/       # PC → グラス
adb pull /sdcard/Download/file.txt .      # グラス → PC

# アプリ起動・ログ・スクリーンショット
adb shell am start -n com.example.translator/.HudActivity
adb logcat -s AndroidRuntime:E
adb exec-out screencap -p > hud.png
```

## 3. 無線化（USBが通った後、ケーブルを卒業）

```powershell
node cli/rokid.js device tcpip            # USB接続中に一度だけ → :5555 が開く
# ケーブルを抜き、グラスと同一WiFi(テザリング可)で:
node cli/rokid.js device connect <グラスのIP>   # IP不明なら device find <WiFi側MAC>
```
※グラス再起動で USB モードに戻る（再度 tcpip が必要）。
※「ADB Debugging ON」だけでは :5555 は開かない（実測: タイムアウト）。tcpip が必須。

## 4. adb を使わない無線配信（参考）

- **RokidApkUploader**: スマホアプリ。シリアル番号のみで CXR-M 経由 APK 転送
  （Bluetooth発見→WiFi転送）。IP・adb・ケーブル不要だが動作は不安定と作者自身が警告。
- **Hi Rokid Toolbox**: ローカルアプリのインストール機能があればそこから直接。

## 5. 実機の確定スペック（DEPLOY_RV101.md より）

| 項目 | 値 |
|---|---|
| OS / SDK | YodaOS (Android 12) / SDK 32 |
| ABI | arm64-v8a |
| ディスプレイ | **480×640 モノクロ緑**（単眼ウェーブガイド） |
| ストレージ空き | 約18GB |

## 未確認事項（実機で分かったら追記する）

- HUD認可プロンプトの正確な見た目と承認ジェスチャ（タップ/スワイプ）
- 5ピン端子の正確な位置のRV101一次資料（右テンプル末端は近縁モデルからの推定）
- グラス本体設定からの開発者向けオプション（ビルド番号7回タップ）が海外版FWでも有効か
