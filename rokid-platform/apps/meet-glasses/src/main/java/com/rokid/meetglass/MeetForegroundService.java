package com.rokid.meetglass;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.IBinder;
import android.util.Log;

/**
 * グラス本体に常駐する前景サービス。
 *
 *  1. {@link LocalControlServer} を起動（グラス上の HTTP 制御サーバー）。
 *  2. 制御サーバーからの join/leave 指示で {@link MeetMediaClient} を駆動し、
 *     Google Meet へ WebRTC で直接接続する。
 *  3. 入出力にグラスのマイク/スピーカー/カメラ（{@link GlassMediaIO}）を使う。
 *
 * Activity と切り離すことで、HUD を閉じても会議が継続する。
 */
public class MeetForegroundService extends Service {

    public static final String ACTION_START = "com.rokid.meetglass.START";
    public static final String ACTION_STOP  = "com.rokid.meetglass.STOP";
    private static final String TAG = "MeetGlassSvc";
    private static final String CHANNEL_ID = "meet_glasses";
    private static final int NOTIF_ID = 41;

    /** 制御サーバーの待受ポート。adb forward / コンパニオンからアクセスする。 */
    public static final int CONTROL_PORT = 8765;

    /** HUD への状態通知。Activity 生存時のみセットされる。 */
    public interface StatusListener { void onStatus(String title, String sub); }
    private static volatile StatusListener statusListener;
    public static void setStatusListener(StatusListener l) { statusListener = l; }
    static void publish(String title, String sub) {
        StatusListener l = statusListener;
        if (l != null) l.onStatus(title, sub);
    }

    private LocalControlServer server;
    private MeetMediaClient meet;
    private GlassMediaIO media;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        startForeground(NOTIF_ID, buildNotification("待機中"),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                        | ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA);

        // グラスのマイク/スピーカー/カメラを束ねる I/O 層
        media = new GlassMediaIO(this);

        // Meet への WebRTC 接続を担うクライアント
        meet = new MeetMediaClient(this, media, new MeetMediaClient.Listener() {
            @Override public void onState(String state) {
                updateNotification(state);
                publish("Meet: " + state, "ポート " + CONTROL_PORT);
            }
            @Override public void onError(String message) {
                updateNotification("エラー");
                publish("接続エラー", message);
            }
        });

        // グラス上のローカル制御サーバー（join/leave/status）
        server = new LocalControlServer(CONTROL_PORT, new LocalControlServer.Handler() {
            @Override public void onJoin(String meetingCode) {
                publish("接続中…", meetingCode);
                meet.join(meetingCode);
            }
            @Override public void onLeave() {
                meet.leave();
                publish("退出", "待機中");
            }
            @Override public String status() {
                return meet.statusJson();
            }
        });
        try {
            server.start();
            Log.i(TAG, "control server on :" + CONTROL_PORT);
            publish("待機中", "http://<glass>:" + CONTROL_PORT);
        } catch (Exception e) {
            Log.e(TAG, "server start failed", e);
            publish("サーバー起動失敗", String.valueOf(e.getMessage()));
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        // 自動再起動して会議の常駐性を高める
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (server != null) server.stop();
        if (meet != null) meet.leave();
        if (media != null) media.release();
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    // ---- 通知まわり ----

    private void createChannel() {
        NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, "Meet Glasses", NotificationManager.IMPORTANCE_LOW);
        getSystemService(NotificationManager.class).createNotificationChannel(ch);
    }

    private Notification buildNotification(String text) {
        return new Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("Meet Glasses")
                .setContentText(text)
                .setSmallIcon(android.R.drawable.presence_video_online)
                .setOngoing(true)
                .build();
    }

    private void updateNotification(String text) {
        getSystemService(NotificationManager.class)
                .notify(NOTIF_ID, buildNotification(text));
    }
}
