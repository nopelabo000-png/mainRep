package com.rokid.meetglass;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.widget.TextView;

/**
 * Meet Glasses — 単眼グリーンHUD のフロント。
 *
 * 役割:
 *  - 音声コマンド「ミート開始」で起動し、{@link MeetForegroundService} を開始する。
 *  - サービス（ローカルサーバー + Meet 接続）の状態を HUD に表示する。
 *
 * 実際の通信・メディア処理は UI を持たないサービス側に置き、
 * Activity が落ちても会議が継続できるようにする。
 */
public class HudActivity extends Activity {

    private TextView hud;
    private final Handler ui = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);

        hud = new TextView(this);
        hud.setTextColor(Color.parseColor("#33ff88")); // 単色グリーン
        hud.setBackgroundColor(Color.BLACK);
        hud.setTextSize(28);                            // 28px 以上
        hud.setGravity(Gravity.CENTER);
        setContentView(hud);

        // グラス本体に常駐サービスを起動（ローカルサーバーもここで立つ）
        Intent svc = new Intent(this, MeetForegroundService.class);
        svc.setAction(MeetForegroundService.ACTION_START);
        startForegroundService(svc);

        render("起動中…", "ローカルサーバー待機");

        // サービスから状態ブロードキャストを受け取り HUD を更新
        MeetForegroundService.setStatusListener((title, sub) -> ui.post(() -> render(title, sub)));

        // TODO: CxrServiceBridge で音声コマンドを購読し、
        //       「ミート開始 <会議コード>」→ サービスへ join インテントを送る。
    }

    /** 単眼・単色のため 2 行（見出し + 補足）に絞って中央表示する。 */
    private void render(String title, String sub) {
        hud.setText(title + "\n" + sub);
    }

    @Override
    protected void onDestroy() {
        MeetForegroundService.setStatusListener(null);
        super.onDestroy();
    }
}
