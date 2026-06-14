# Live Translator (CXR-S オンデバイス)

YodaOS (Android 12 / SDK 32) のグラス本体で動作する HUD アプリ。

## ビルド
```
./gradlew assembleDebug   # build/outputs/apk/debug/*.apk を生成
adb install -r app.apk    # USB/WiFi デバッグでグラスへ
```

## 設計メモ（単眼・単色グリーン）
- 右目単眼のため画面中央〜やや上に主要情報を配置する
- 単色グリーン想定。色で意味を分けず、明度とレイアウトで区別する
- 1画面5行以内、フォントは28px相当以上
- 音声コマンドを主操作系として必ず1つ以上定義する
