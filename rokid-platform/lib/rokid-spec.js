'use strict';

/**
 * Rokid 開発要件の中央定義。
 * 公開ドキュメント (rokid-docs / UXR-docs / awesome-rokid) を基に整理した
 * ハードウェア・SDK・パッケージ要件のスナップショット。
 * テンプレート生成や UI の表示、検証ルールはこの定義を参照する。
 */

const PLATFORM_VERSION = '0.1.0';

// グラス本体 (YodaOS) のターゲット環境
const DEVICE = {
  name: 'Rokid Glasses',
  os: 'YodaOS (Android 12 ベース)',
  androidSdk: 32, // compileSdk / targetSdk
  minSdkOnDevice: 32,
  abi: 'arm64-v8a',
  soc: 'Qualcomm (Kryo 300 系)',
  display: {
    type: 'JBD Micro-LED',
    eyes: 'monocular-right', // 右目のみ
    color: 'green-monochrome', // 単色グリーン前提でUIを設計する
    note: '単眼・単色のため高コントラスト＆最小要素でHUDを構成する',
  },
  input: ['voice', 'imu', 'touchpad', 'companion-phone'],
  serialization: 'Caps (バイナリ)',
  transports: ['bluetooth', 'wifi-direct'],
};

// SDK 種別。アプリの実行場所と役割で選ぶ。
const SDKS = {
  'cxr-s': {
    id: 'cxr-s',
    label: 'CXR-S (オンデバイス)',
    runsOn: 'glasses',
    desc: 'グラス本体(YodaOS)上で動作するアプリ。HUD表示・音声コマンドを実装。',
    maven: 'com.rokid.cxr:cxr-service-bridge:1.0-SNAPSHOT',
    minSdk: 32,
    package: 'apk',
  },
  'cxr-m': {
    id: 'cxr-m',
    label: 'CXR-M (スマホ連携)',
    runsOn: 'phone',
    desc: 'Android/iOS のコンパニオンアプリ。Bluetooth/WiFiでグラスと通信。',
    maven: 'com.rokid.cxr:client-m:1.0.8',
    minSdk: 28,
    package: 'apk',
  },
  'cxr-l': {
    id: 'cxr-l',
    label: 'CXR-L (スタンドアロン)',
    runsOn: 'phone',
    desc: '標準アプリを置き換えるスタンドアロン構成。AI サービスへ AIDL で接続。',
    maven: 'com.rokid.cxr:client-l:0.0.1',
    minSdk: 28,
    package: 'apk',
  },
  uxr: {
    id: 'uxr',
    label: 'UXR (Unity XR)',
    runsOn: 'glasses-unity',
    desc: 'Unity3D で 3D/空間表現を作る XR SDK。UXR2.0 は AR Studio/Lite 構成に対応。',
    maven: null, // Unity Package Manager (UPM) 経由で導入
    upm: 'com.rokid.xr.core',
    minSdk: 29,
    package: 'apk', // Unity から Android APK として書き出す
  },
  'web-hud': {
    id: 'web-hud',
    label: 'Web HUD (プロトタイプ)',
    runsOn: 'glasses-browser',
    desc: 'グラス内ブラウザ向けの軽量HUD。ビルド不要で素早く検証できる。',
    maven: null,
    minSdk: null,
    package: 'web',
  },
};

// 利用可能なアプリテンプレート
const TEMPLATES = {
  'cxr-s-ondevice': {
    id: 'cxr-s-ondevice',
    sdk: 'cxr-s',
    label: 'オンデバイス HUD アプリ',
    desc: '音声コマンドで起動し、単眼グリーンHUDに情報を出すグラス常駐アプリ。',
  },
  'cxr-m-companion': {
    id: 'cxr-m-companion',
    sdk: 'cxr-m',
    label: 'スマホ連携アプリ',
    desc: 'スマホ側で重い処理を行い、グラスへHUDを送るコンパニオンアプリ。',
  },
  'cxr-l-standalone': {
    id: 'cxr-l-standalone',
    sdk: 'cxr-l',
    label: 'スタンドアロンアプリ (CXR-L)',
    desc: '標準の Rokid アプリを置き換える構成。AIDL で AI サービスへ直接バインドする。',
  },
  'uxr-unity': {
    id: 'uxr-unity',
    sdk: 'uxr',
    label: 'Unity XR アプリ (UXR)',
    desc: 'Unity3D プロジェクトの骨格。3D/空間コンテンツを UXR SDK で構築し APK 出力。',
  },
  'web-hud': {
    id: 'web-hud',
    sdk: 'web-hud',
    label: 'Web HUD プロトタイプ',
    desc: 'HTML/JS だけで動く最小HUD。デザイン検証や社内デモ向け。',
  },
};

// アプリをグラスへ配信する方法。
// 調査の結論: 有線(USB)は選択肢の一つに過ぎず、ワイヤレスが主流。
// docs/import-export-investigation.md に根拠と出典。
const DEPLOY_METHODS = [
  {
    id: 'cxr-m-wifi',
    label: 'CXR-M / Wi-Fi アップロード',
    wireless: true,
    desc: 'CXR-M SDK でスマホから Wi-Fi 経由 APK をサイドロード。開発ケーブル不要、シリアル番号のみ。',
    ref: 'RokidApkUploader',
  },
  {
    id: 'bt-wifi-direct',
    label: 'Bluetooth + Wi-Fi Direct',
    wireless: true,
    desc: 'スマホのコンパニオンアプリからBluetooth SPPで制御し、APKをWi-Fi DirectでグラスへPush。',
    ref: 'Rokid-APKs',
  },
  {
    id: 'adb-tcp',
    label: 'ADB over TCP/Wi-Fi',
    wireless: true,
    desc: 'YodaOSはAndroidベース。adb tcpip 後は Wi-Fi 経由で adb install が可能。',
    ref: 'adb connect <ip>:5555',
  },
  {
    id: 'companion-store',
    label: 'コンパニオン / ストア配信',
    wireless: true,
    desc: 'Hi Rokid(CXR-L)等のコンパニオン経由でグラスへ転送し、端末側インストーラで確認。',
    ref: 'Hi Rokid app',
  },
  {
    id: 'adb-usb',
    label: 'ADB over USB（有線）',
    wireless: false,
    desc: '開発ケーブルで adb install。最も確実だが物理接続が必要。',
    ref: 'adb install -r app.apk',
  },
  {
    id: 'webusb',
    label: 'WebUSB インストーラ（有線）',
    wireless: false,
    desc: 'ブラウザからUSB接続でAPKを書き込む。ドライバ不要だが物理接続が必要。',
    ref: 'WebUSB',
  },
];

// HUD デザイン推奨ガイド (単眼・単色前提)
const HUD_GUIDE = {
  safeArea: { width: 640, height: 400 }, // 論理ピクセルの目安
  maxLinesPerView: 5,
  minFontPx: 28,
  palette: { fg: '#33ff88', dim: '#1f8a4c', bg: '#000000' },
  rules: [
    '右目単眼のため画面中央〜やや上に主要情報を配置する',
    '単色グリーン想定。色で意味を分けず、明度とレイアウトで区別する',
    '1画面5行以内、フォントは28px相当以上',
    '音声コマンドを主操作系として必ず1つ以上定義する',
  ],
};

function listSdks() {
  return Object.values(SDKS);
}

function listTemplates() {
  return Object.values(TEMPLATES);
}

module.exports = {
  PLATFORM_VERSION,
  DEVICE,
  SDKS,
  TEMPLATES,
  DEPLOY_METHODS,
  HUD_GUIDE,
  listSdks,
  listTemplates,
};
