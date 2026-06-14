package com.example.translator;

import android.app.Activity;
import android.os.Bundle;
import android.widget.TextView;
import android.graphics.Color;
import android.view.Gravity;

/**
 * Live Translator
 * 単眼グリーンHUD。CXR-S 経由で音声コマンドと連携する。
 */
public class HudActivity extends Activity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        TextView hud = new TextView(this);
        hud.setText("Live Translator\nReal-time AR translation");
        hud.setTextColor(Color.parseColor("#33ff88"));
        hud.setBackgroundColor(Color.BLACK);
        hud.setTextSize(28);
        hud.setGravity(Gravity.CENTER);
        setContentView(hud);
        // TODO: CxrServiceBridge で音声コマンド/センサーを購読する
    }
}
