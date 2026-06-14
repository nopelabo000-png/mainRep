package com.rokid.meetglass;

import android.content.Context;
import android.util.Log;

/**
 * Google Meet への直接接続クライアント。
 *
 * 接続方式: Google Meet Media API（開発者プレビュー）+ WebRTC。
 *   1. OAuth2 でアクセストークンを取得（scope: meetings.space.created など）。
 *   2. Meet REST でスペース/参加情報を解決し、Media API のシグナリングを行う。
 *   3. WebRTC PeerConnection を確立し、
 *        - 送信: グラスのマイク音声 + カメラ映像（{@link GlassMediaIO}）
 *        - 受信: 会議の音声 → グラスのスピーカー、映像 → HUD（任意）
 *
 * ここではアプリの状態機械と WebRTC 接続の骨組みを定義する。
 * 実際の PeerConnectionFactory / シグナリングは WebRTC SDK と
 * Meet Media API のリファレンス手順に従って実装する（README 参照）。
 */
public class MeetMediaClient {

    private static final String TAG = "MeetMediaClient";

    public interface Listener {
        void onState(String state);
        void onError(String message);
    }

    public enum State { IDLE, AUTHORIZING, SIGNALING, CONNECTED, FAILED }

    private final Context ctx;
    private final GlassMediaIO media;
    private final Listener listener;

    private volatile State state = State.IDLE;
    private volatile String meetingCode;

    public MeetMediaClient(Context ctx, GlassMediaIO media, Listener listener) {
        this.ctx = ctx.getApplicationContext();
        this.media = media;
        this.listener = listener;
    }

    /**
     * 会議へ参加する。meetingCode は "abc-defg-hij" 形式、または会議スペース ID。
     * ネットワーク処理はワーカースレッドで行う。
     */
    public synchronized void join(String code) {
        this.meetingCode = code;
        setState(State.AUTHORIZING);
        new Thread(() -> {
            try {
                // 1) OAuth2 アクセストークン取得（BuildConfig.GOOGLE_OAUTH_CLIENT_ID を使用）
                //    com.google.auth の UserCredentials / AuthorizationCodeFlow を利用。
                String accessToken = acquireAccessToken();

                // 2) Meet REST + Media API シグナリング
                setState(State.SIGNALING);
                Object signaling = resolveMeetSession(accessToken, code);

                // 3) WebRTC PeerConnection を確立し、ローカルメディアを接続
                media.routeAudioToSpeaker();
                establishWebRtc(signaling);

                setState(State.CONNECTED);
            } catch (Exception e) {
                Log.e(TAG, "join failed", e);
                setState(State.FAILED);
                listener.onError(String.valueOf(e.getMessage()));
            }
        }, "meet-join").start();
    }

    public synchronized void leave() {
        if (state == State.IDLE) return;
        // TODO: PeerConnection.close() / dispose、トラック停止
        media.release();
        meetingCode = null;
        setState(State.IDLE);
    }

    public String statusJson() {
        return "{\"state\":\"" + state.name().toLowerCase()
                + "\",\"meeting\":" + (meetingCode == null ? "null" : "\"" + meetingCode + "\"")
                + "}";
    }

    // ---- 以下は実デバイス実装で埋めるフック ----

    /** OAuth2 アクセストークンを取得する。 */
    private String acquireAccessToken() throws Exception {
        // TODO: google-auth-library で client_id（BuildConfig）を使い、
        //       offline アクセスのリフレッシュトークンからアクセストークンを発行。
        //       初回はブラウザ/コンパニオンで同意フローを通す。
        return "TODO-access-token";
    }

    /** Meet REST / Media API で会議セッション（SDP/ICE交換先）を解決する。 */
    private Object resolveMeetSession(String accessToken, String code) throws Exception {
        // TODO: Meet Media API のシグナリングエンドポイントに接続し、
        //       offer/answer 用のセッションを取得する（OkHttp）。
        return new Object();
    }

    /** WebRTC PeerConnection を作り、グラスのマイク/カメラを送信、受信音声をスピーカーへ。 */
    private void establishWebRtc(Object signaling) throws Exception {
        // TODO: PeerConnectionFactory を生成。
        //       - AudioSource（マイク）→ AudioTrack を addTrack
        //       - Camera2Enumerator で media.selectGlassCamera() のカメラを掴み
        //         VideoSource → VideoTrack を addTrack
        //       - リモート AudioTrack を受けてスピーカー出力（routeAudioToSpeaker 済み）
        //       - createOffer → setLocalDescription → シグナリングへ送信 → answer 適用
    }

    private void setState(State s) {
        this.state = s;
        listener.onState(s.name().toLowerCase());
    }
}
