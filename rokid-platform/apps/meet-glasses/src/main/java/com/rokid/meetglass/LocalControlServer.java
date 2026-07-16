package com.rokid.meetglass;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * グラス本体で動くローカル制御サーバー（依存ゼロの最小 HTTP）。
 *
 * 「ロキッドにサーバーを建てる」要件をこのクラスが担う。
 * adb forward（USB/WiFiデバッグ）やコンパニオンアプリから叩いて、
 * 会議への参加/退出/状態取得を制御する。
 *
 * エンドポイント:
 *   POST /join   body: {"code":"abc-defg-hij"}   会議へ参加
 *   POST /leave                                    退出
 *   GET  /status                                   現在状態(JSON)
 *
 * NanoHTTPD 等を使わず java.net.ServerSocket のみで実装し、
 * APK の依存を増やさない。
 */
public class LocalControlServer {

    public interface Handler {
        void onJoin(String meetingCode);
        void onLeave();
        String status(); // JSON 文字列
    }

    private final int port;
    private final Handler handler;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private volatile ServerSocket socket;
    private volatile boolean running;

    public LocalControlServer(int port, Handler handler) {
        this.port = port;
        this.handler = handler;
    }

    public void start() throws Exception {
        socket = new ServerSocket(port);
        running = true;
        pool.submit(this::acceptLoop);
    }

    public void stop() {
        running = false;
        try { if (socket != null) socket.close(); } catch (Exception ignored) {}
        pool.shutdownNow();
    }

    private void acceptLoop() {
        while (running) {
            try {
                Socket client = socket.accept();
                pool.submit(() -> handle(client));
            } catch (Exception e) {
                if (running) { /* ログのみ。ループ継続 */ }
            }
        }
    }

    private void handle(Socket client) {
        try (Socket c = client) {
            BufferedReader in = new BufferedReader(
                    new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8));

            String requestLine = in.readLine();
            if (requestLine == null) return;
            String[] parts = requestLine.split(" ");
            String method = parts.length > 0 ? parts[0] : "";
            String path = parts.length > 1 ? parts[1] : "/";

            // ヘッダを読み飛ばしつつ Content-Length を取得
            int contentLength = 0;
            String header;
            while ((header = in.readLine()) != null && !header.isEmpty()) {
                String lower = header.toLowerCase();
                if (lower.startsWith("content-length:")) {
                    contentLength = Integer.parseInt(header.substring(15).trim());
                }
            }
            String body = readBody(in, contentLength);

            route(c, method, path, body);
        } catch (Exception ignored) {
            // 個別接続の失敗はサーバー全体を止めない
        }
    }

    private String readBody(BufferedReader in, int len) throws Exception {
        if (len <= 0) return "";
        char[] buf = new char[len];
        int read = 0;
        while (read < len) {
            int n = in.read(buf, read, len - read);
            if (n < 0) break;
            read += n;
        }
        return new String(buf, 0, read);
    }

    private void route(Socket c, String method, String path, String body) throws Exception {
        if ("POST".equals(method) && path.startsWith("/join")) {
            String code = extractJsonString(body, "code");
            handler.onJoin(code);
            respond(c, 200, "{\"ok\":true,\"action\":\"join\"}");
        } else if ("POST".equals(method) && path.startsWith("/leave")) {
            handler.onLeave();
            respond(c, 200, "{\"ok\":true,\"action\":\"leave\"}");
        } else if ("GET".equals(method) && path.startsWith("/status")) {
            respond(c, 200, handler.status());
        } else {
            respond(c, 404, "{\"ok\":false,\"error\":\"not found\"}");
        }
    }

    /** 依存を増やさないための極小 JSON 文字列抽出（"key":"value"）。 */
    static String extractJsonString(String json, String key) {
        if (json == null) return null;
        String needle = "\"" + key + "\"";
        int k = json.indexOf(needle);
        if (k < 0) return null;
        int colon = json.indexOf(':', k + needle.length());
        if (colon < 0) return null;
        int q1 = json.indexOf('"', colon + 1);
        if (q1 < 0) return null;
        int q2 = json.indexOf('"', q1 + 1);
        if (q2 < 0) return null;
        return json.substring(q1 + 1, q2);
    }

    private void respond(Socket c, int status, String json) throws Exception {
        byte[] payload = json.getBytes(StandardCharsets.UTF_8);
        String head = "HTTP/1.1 " + status + " OK\r\n"
                + "Content-Type: application/json; charset=utf-8\r\n"
                + "Content-Length: " + payload.length + "\r\n"
                + "Connection: close\r\n\r\n";
        OutputStream out = c.getOutputStream();
        out.write(head.getBytes(StandardCharsets.UTF_8));
        out.write(payload);
        out.flush();
    }
}
