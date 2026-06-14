'use strict';

/**
 * テンプレート定義。各テンプレートは app メタデータを受け取り、
 * { 相対パス: ファイル内容 } のマップを返す。
 * 依存を増やさないため文字列テンプレートで生成する。
 */

const { SDKS, HUD_GUIDE } = require('./rokid-spec');

function javaPackagePath(pkg) {
  return pkg.replace(/\./g, '/');
}

// ---- CXR-S: オンデバイス HUD アプリ ----
function cxrSOnDevice(app) {
  const pkg = app.androidPackage || `com.example.${app.id.replace(/-/g, '')}`;
  const pkgPath = javaPackagePath(pkg);
  const cls = 'HudActivity';
  return {
    'README.md':
`# ${app.name} (CXR-S オンデバイス)

YodaOS (Android 12 / SDK ${SDKS['cxr-s'].minSdk}) のグラス本体で動作する HUD アプリ。

## ビルド
\`\`\`
./gradlew assembleDebug   # build/outputs/apk/debug/*.apk を生成
adb install -r app.apk    # USB/WiFi デバッグでグラスへ
\`\`\`

## 設計メモ（単眼・単色グリーン）
${HUD_GUIDE.rules.map((r) => '- ' + r).join('\n')}
`,
    'build.gradle':
`plugins { id 'com.android.application' }

android {
    namespace '${pkg}'
    compileSdk ${SDKS['cxr-s'].minSdk}
    defaultConfig {
        applicationId '${pkg}'
        minSdk ${SDKS['cxr-s'].minSdk}
        targetSdk ${SDKS['cxr-s'].minSdk}
        versionCode ${app.versionCode || 1}
        versionName '${app.version || '1.0.0'}'
        ndk { abiFilters 'arm64-v8a' }
    }
    buildTypes { release { minifyEnabled false } }
}

dependencies {
    implementation '${SDKS['cxr-s'].maven}'
}
`,
    'src/main/AndroidManifest.xml':
`<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.RECORD_AUDIO"/>
    <uses-feature android:name="rokid.hardware.display" android:required="true"/>

    <application android:label="${app.name}">
        <activity android:name=".${cls}" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN"/>
                <category android:name="android.intent.category.LAUNCHER"/>
            </intent-filter>
            <!-- 音声コマンドで起動 -->
            <meta-data android:name="rokid.voice.command" android:value="${app.voiceCommand || app.name}"/>
        </activity>
    </application>
</manifest>
`,
    [`src/main/java/${pkgPath}/${cls}.java`]:
`package ${pkg};

import android.app.Activity;
import android.os.Bundle;
import android.widget.TextView;
import android.graphics.Color;
import android.view.Gravity;

/**
 * ${app.name}
 * 単眼グリーンHUD。CXR-S 経由で音声コマンドと連携する。
 */
public class ${cls} extends Activity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        TextView hud = new TextView(this);
        hud.setText("${app.name}\\n${app.tagline || 'Hello Rokid'}");
        hud.setTextColor(Color.parseColor("${HUD_GUIDE.palette.fg}"));
        hud.setBackgroundColor(Color.BLACK);
        hud.setTextSize(${HUD_GUIDE.minFontPx});
        hud.setGravity(Gravity.CENTER);
        setContentView(hud);
        // TODO: CxrServiceBridge で音声コマンド/センサーを購読する
    }
}
`,
    'rokid.app.json': JSON.stringify(rokidManifest(app, 'cxr-s'), null, 2) + '\n',
  };
}

// ---- CXR-M: スマホ連携アプリ ----
function cxrMCompanion(app) {
  const pkg = app.androidPackage || `com.example.${app.id.replace(/-/g, '')}`;
  const pkgPath = javaPackagePath(pkg);
  const cls = 'CompanionActivity';
  return {
    'README.md':
`# ${app.name} (CXR-M スマホ連携)

Android コンパニオンアプリ (minSdk ${SDKS['cxr-m'].minSdk})。
Bluetooth/WiFi でグラスと接続し、HUD を送信する。

## ビルド
\`\`\`
./gradlew assembleDebug
\`\`\`
`,
    'build.gradle':
`plugins { id 'com.android.application' }

android {
    namespace '${pkg}'
    compileSdk 34
    defaultConfig {
        applicationId '${pkg}'
        minSdk ${SDKS['cxr-m'].minSdk}
        targetSdk 34
        versionCode ${app.versionCode || 1}
        versionName '${app.version || '1.0.0'}'
    }
}

dependencies {
    implementation '${SDKS['cxr-m'].maven}'
}
`,
    'src/main/AndroidManifest.xml':
`<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT"/>
    <uses-permission android:name="android.permission.BLUETOOTH_SCAN"/>
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
    <application android:label="${app.name}">
        <activity android:name=".${cls}" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN"/>
                <category android:name="android.intent.category.LAUNCHER"/>
            </intent-filter>
        </activity>
    </application>
</manifest>
`,
    [`src/main/java/${pkgPath}/${cls}.java`]:
`package ${pkg};

import android.app.Activity;
import android.os.Bundle;

/**
 * ${app.name}
 * CXR-M クライアントでグラスへ接続し、HUDメッセージを送る。
 */
public class ${cls} extends Activity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        // TODO: CxrClientM.connect() でグラスへ接続
        // TODO: sendHud("${app.tagline || 'Hello from phone'}")
    }
}
`,
    'rokid.app.json': JSON.stringify(rokidManifest(app, 'cxr-m'), null, 2) + '\n',
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
    androidPackage: app.androidPackage || null,
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
  'web-hud': webHud,
};

function generate(templateId, app) {
  const gen = GENERATORS[templateId];
  if (!gen) throw new Error(`unknown template: ${templateId}`);
  return gen(app);
}

module.exports = { generate, rokidManifest, GENERATORS };
