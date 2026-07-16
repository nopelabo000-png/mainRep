'use strict';

/**
 * テンプレート定義。各テンプレートは app メタデータを受け取り、
 * { 相対パス: ファイル内容 } のマップを返す。
 * 依存を増やさないため文字列テンプレートで生成する。
 */

const { SDKS, HUD_GUIDE } = require('./rokid-spec');

// アプリの Android パッケージ名を決める（未指定なら id から生成）
function derivePackage(app) {
  return app.androidPackage || `com.example.${app.id.replace(/-/g, '')}`;
}

function javaPackagePath(pkg) {
  return pkg.replace(/\./g, '/');
}

// Android アプリ共通の骨格（gradle / manifest / Activity）を生成するヘルパー
function androidApp(app, { sdkId, compileSdk, cls, permissions, extraManifest, activityBody }) {
  const pkg = derivePackage(app);
  const pkgPath = javaPackagePath(pkg);
  const sdk = SDKS[sdkId];
  return {
    'build.gradle':
`plugins { id 'com.android.application' }

android {
    namespace '${pkg}'
    compileSdk ${compileSdk}
    defaultConfig {
        applicationId '${pkg}'
        minSdk ${sdk.minSdk}
        targetSdk ${compileSdk}
        versionCode ${app.versionCode || 1}
        versionName '${app.version || '1.0.0'}'${sdkId === 'cxr-s' ? "\n        ndk { abiFilters 'arm64-v8a' }" : ''}
    }
    buildTypes { release { minifyEnabled false } }
}

dependencies {
    implementation '${sdk.maven}'
}
`,
    'src/main/AndroidManifest.xml':
`<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
${permissions.map((p) => `    <uses-permission android:name="${p}"/>`).join('\n')}
    <application android:label="${app.name}">
        <activity android:name=".${cls}" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN"/>
                <category android:name="android.intent.category.LAUNCHER"/>
            </intent-filter>${extraManifest ? '\n' + extraManifest : ''}
        </activity>
    </application>
</manifest>
`,
    [`src/main/java/${pkgPath}/${cls}.java`]:
`package ${pkg};

import android.app.Activity;
import android.os.Bundle;
${activityBody.imports || ''}
/**
 * ${app.name}
 * ${activityBody.doc}
 */
public class ${cls} extends Activity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
${activityBody.onCreate}
    }
}
`,
    'rokid.app.json': JSON.stringify(rokidManifest(app, sdkId), null, 2) + '\n',
  };
}

// ---- CXR-S: オンデバイス HUD アプリ ----
function cxrSOnDevice(app) {
  const files = androidApp(app, {
    sdkId: 'cxr-s',
    compileSdk: SDKS['cxr-s'].minSdk,
    cls: 'HudActivity',
    permissions: ['android.permission.RECORD_AUDIO'],
    extraManifest:
      `            <!-- 音声コマンドで起動 -->\n` +
      `            <meta-data android:name="rokid.voice.command" android:value="${app.voiceCommand || app.name}"/>`,
    activityBody: {
      imports: 'import android.widget.TextView;\nimport android.graphics.Color;\nimport android.view.Gravity;\n',
      doc: '単眼グリーンHUD。CXR-S 経由で音声コマンドと連携する。',
      onCreate:
`        TextView hud = new TextView(this);
        hud.setText("${app.name}\\n${app.tagline || 'Hello Rokid'}");
        hud.setTextColor(Color.parseColor("${HUD_GUIDE.palette.fg}"));
        hud.setBackgroundColor(Color.BLACK);
        hud.setTextSize(${HUD_GUIDE.minFontPx});
        hud.setGravity(Gravity.CENTER);
        setContentView(hud);
        // TODO: CxrServiceBridge で音声コマンド/センサーを購読する`,
    },
  });
  files['README.md'] =
`# ${app.name} (CXR-S オンデバイス)

YodaOS (Android 12 / SDK ${SDKS['cxr-s'].minSdk}) のグラス本体で動作する HUD アプリ。

## ビルド & 配信（ワイヤレス可）
\`\`\`
./gradlew assembleDebug           # build/outputs/apk/debug/*.apk を生成
adb connect <glasses-ip>:5555     # Wi-Fi 経由で接続（有線ケーブル不要）
adb install -r app-debug.apk      # グラスへインストール
\`\`\`
CXR-M/Bluetooth+Wi-Fi Direct でのPush配信も可能（docs 参照）。

## 設計メモ（単眼・単色グリーン）
${HUD_GUIDE.rules.map((r) => '- ' + r).join('\n')}
`;
  return files;
}

// ---- CXR-M: スマホ連携アプリ ----
function cxrMCompanion(app) {
  const files = androidApp(app, {
    sdkId: 'cxr-m',
    compileSdk: 34,
    cls: 'CompanionActivity',
    permissions: [
      'android.permission.BLUETOOTH_CONNECT',
      'android.permission.BLUETOOTH_SCAN',
      'android.permission.ACCESS_FINE_LOCATION',
    ],
    activityBody: {
      imports: '',
      doc: 'CXR-M クライアントでグラスへ接続し、HUDメッセージを送る。',
      onCreate:
`        // TODO: CxrClientM.connect() でグラスへ接続（Bluetooth/Wi-Fi）
        // TODO: sendHud("${app.tagline || 'Hello from phone'}")`,
    },
  });
  files['README.md'] =
`# ${app.name} (CXR-M スマホ連携)

Android コンパニオンアプリ (minSdk ${SDKS['cxr-m'].minSdk})。
Bluetooth/Wi-Fi でグラスと接続し、HUD を送信する。APK の Push 配信も担える。

## ビルド
\`\`\`
./gradlew assembleDebug
\`\`\`
`;
  return files;
}

// ---- CXR-L: スタンドアロンアプリ ----
function cxrLStandalone(app) {
  const files = androidApp(app, {
    sdkId: 'cxr-l',
    compileSdk: 34,
    cls: 'StandaloneActivity',
    permissions: [
      'android.permission.BLUETOOTH_CONNECT',
      'android.permission.BLUETOOTH_SCAN',
      'android.permission.RECORD_AUDIO',
      'android.permission.CAMERA',
    ],
    activityBody: {
      imports: '',
      doc: 'CXR-L で標準 Rokid アプリを置き換えるスタンドアロン構成。AIDL で AI サービスへバインドする。',
      onCreate:
`        // TODO: CxrClientL.bind(this) — AIDL で Rokid AI サービスへ接続
        // TODO: 認証は Rokid AI App / Hi Rokid 経由（グラスのシリアル番号）
        // TODO: カメラ/音声ストリームを購読し、CustomView UI を駆動する`,
    },
  });
  files['README.md'] =
`# ${app.name} (CXR-L スタンドアロン)

標準の Rokid アプリを**置き換える**スタンドアロンアプリ (minSdk ${SDKS['cxr-l'].minSdk})。
Android AIDL で AI サービスへ直接バインドし、グラスの写真/音声ストリームの取得や
CustomView UI の駆動まで自前で行う。

## CXR-M との違い
- CXR-M: 公式 Rokid アプリと**併存**するコンパニオン
- CXR-L: 公式アプリの役割ごと**置き換える**(認証・ストリーム管理も自前)

## ビルド
\`\`\`
./gradlew assembleDebug
\`\`\`
`;
  return files;
}

// ---- UXR: Unity XR プロジェクト骨格 ----
function uxrUnity(app) {
  const pkg = derivePackage(app);
  const cls = app.name.replace(/[^A-Za-z0-9]/g, '') || 'RokidApp';
  return {
    'README.md':
`# ${app.name} (UXR / Unity XR)

Unity3D で作る Rokid 向け 3D/空間アプリの骨格。

## セットアップ
1. Unity Hub で本フォルダをプロジェクトとして開く（Unity 2021.3 LTS 以降推奨）
2. UXR SDK を導入 — Package Manager で \`${SDKS.uxr.upm}\`
   （UXR2.0: AR Studio/Lite = Rokid Max Pro/Max2 + Station Pro/2 構成向け。
    Dock 用と Phone 用で SDK が分かれ、互換性はない点に注意）
3. Build Settings → Android / arm64-v8a / minSdk ${SDKS.uxr.minSdk} で APK 出力
4. 配信はワイヤレス可: \`rokid device install <apk> --target <glasses-ip>\`

## 単眼HUDの注意
3D 空間でも主要 UI は視野中央±10°以内・高コントラストで。
`,
    [`Assets/Scripts/${cls}Main.cs`]:
`using UnityEngine;

/// <summary>
/// ${app.name} — UXR エントリポイント。
/// RKCameraRig を配置したシーンから起動する。
/// </summary>
public class ${cls}Main : MonoBehaviour
{
    [SerializeField] private TextMesh hud;

    void Start()
    {
        // TODO: UXR SDK 初期化 (RKCameraRig / RKInput)
        if (hud != null)
        {
            hud.text = "${app.tagline || app.name}";
            hud.color = new Color(0.2f, 1f, 0.53f); // 単色グリーンHUD
        }
    }

    void Update()
    {
        // TODO: 音声コマンド '${app.voiceCommand || app.name}' / ヘッドポーズ入力
    }
}
`,
    'Packages/manifest.json': JSON.stringify(
      {
        dependencies: {
          [SDKS.uxr.upm]: '2.x — Rokid UXR レジストリから導入',
          'com.unity.xr.management': '4.4.0',
        },
        note: 'UXR SDK の正確な導入手順は公式 UXR-docs を参照。Dock/Phone 版は非互換。',
      },
      null,
      2
    ) + '\n',
    'ProjectSettings/ProjectSettings.txt':
`# Unity プロジェクト設定の要点（Unity エディタが正式な ProjectSettings.asset を生成する）
productName: ${app.name}
applicationIdentifier: ${pkg}
minSdkVersion: ${SDKS.uxr.minSdk}
targetArchitectures: ARM64
`,
    'rokid.app.json': JSON.stringify(rokidManifest(app, 'uxr'), null, 2) + '\n',
  };
}

// ---- Web HUD: ブラウザ向けプロトタイプ ----
function webHud(app) {
  return {
    'README.md':
`# ${app.name} (Web HUD プロトタイプ)

グラス内ブラウザ / シミュレータで動く最小HUD。ビルド不要。
\`index.html\` をブラウザで開くだけで確認できる。
`,
    'index.html':
`<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${HUD_GUIDE.safeArea.width}, initial-scale=1">
<title>${app.name}</title>
<style>
  html,body{margin:0;background:${HUD_GUIDE.palette.bg};color:${HUD_GUIDE.palette.fg};
    font-family:monospace;height:100%;display:flex;align-items:center;justify-content:center}
  .hud{text-align:center}
  .hud h1{font-size:${HUD_GUIDE.minFontPx + 8}px;margin:0 0 12px}
  .hud p{font-size:${HUD_GUIDE.minFontPx}px;color:${HUD_GUIDE.palette.dim};margin:0}
</style>
</head>
<body>
  <div class="hud">
    <h1>${app.name}</h1>
    <p id="line">${app.tagline || 'Hello Rokid'}</p>
  </div>
  <script>
    // 音声コマンド '${app.voiceCommand || app.name}' で更新する想定
    // TODO: グラスのイベントAPIに接続
  </script>
</body>
</html>
`,
    'rokid.app.json': JSON.stringify(rokidManifest(app, 'web-hud'), null, 2) + '\n',
  };
}

// 共通: rokid.app.json（プラットフォームが扱うアプリ記述子）
function rokidManifest(app, sdk) {
  return {
    schema: 'rokid.app/v1',
    id: app.id,
    name: app.name,
    sdk,
    version: app.version || '1.0.0',
    package: SDKS[sdk].package,
    androidPackage: SDKS[sdk].package === 'apk' ? derivePackage(app) : null,
    voiceCommand: app.voiceCommand || null,
    tagline: app.tagline || null,
    description: app.description || '',
    author: app.author || '',
    createdAt: app.createdAt || new Date().toISOString(),
  };
}

const GENERATORS = {
  'cxr-s-ondevice': cxrSOnDevice,
  'cxr-m-companion': cxrMCompanion,
  'cxr-l-standalone': cxrLStandalone,
  'uxr-unity': uxrUnity,
  'web-hud': webHud,
};

function generate(templateId, app) {
  const gen = GENERATORS[templateId];
  if (!gen) throw new Error(`unknown template: ${templateId}`);
  return gen(app);
}

module.exports = { generate, rokidManifest, derivePackage, GENERATORS };
