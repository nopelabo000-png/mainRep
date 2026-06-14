package com.rokid.meetglass;

import android.content.Context;
import android.media.AudioManager;

/**
 * グラスのマイク / スピーカー / カメラを WebRTC のトラックへ橋渡しする I/O 層。
 *
 *  - マイク  : WebRTC の AudioSource（内部で AudioRecord を使用）→ 送話
 *  - スピーカー: 受話オーディオを {@link AudioManager} 経由でグラスの SCO/スピーカーへ
 *  - カメラ  : Camera2Enumerator でグラスの 12MP カメラを掴み、VideoSource へ
 *
 * ここでは WebRTC の各オブジェクト生成を {@link MeetMediaClient} 側の
 * PeerConnectionFactory に委ねるためのフックを定義する。
 * 実デバイス実装では Rokid カメラの cameraId を Camera2Enumerator から選ぶ。
 */
public class GlassMediaIO {

    private final Context ctx;
    private final AudioManager audio;
    private boolean started;

    public GlassMediaIO(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        this.audio = (AudioManager) this.ctx.getSystemService(Context.AUDIO_SERVICE);
    }

    /** 受話音声をグラスのスピーカーへ出すためのオーディオ経路設定。 */
    public void routeAudioToSpeaker() {
        audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
        audio.setSpeakerphoneOn(true);
        started = true;
    }

    /**
     * グラスのカメラ ID を選ぶ。
     * Camera2Enumerator#getDeviceNames() から前方/外向きカメラを選択する想定。
     * 実装では WebRTC の {@code Camera2Enumerator} を渡して列挙する。
     *
     * @return 選択したカメラのデバイス名（見つからなければ null）
     */
    public String selectGlassCamera(String[] deviceNames) {
        if (deviceNames == null || deviceNames.length == 0) return null;
        // TODO: Camera2Enumerator#isFrontFacing 等で外向きカメラを優先選択。
        //       Rokid Glasses は単一の外向き 12MP カメラを公開する想定。
        return deviceNames[0];
    }

    public boolean isStarted() { return started; }

    public void release() {
        if (started) {
            audio.setMode(AudioManager.MODE_NORMAL);
            audio.setSpeakerphoneOn(false);
            started = false;
        }
    }
}
