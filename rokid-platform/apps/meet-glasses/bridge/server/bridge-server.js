#!/usr/bin/env node
'use strict';

/**
 * Meet Device Bridge — シグナリングサーバー（依存ゼロ）。
 *
 * 役割: グラス(ブラウザ/アプリ) と PC の Chrome 拡張の間で
 * WebRTC の SDP/ICE を中継するだけ。メディア(映像/音声)は P2P で流れ、
 * このサーバーを経由しない。
 *
 * - HTTP  : グラス用クライアント(glasses/index.html)の静的配信
 * - WS    : RFC6455 を手書き実装したシグナリング(テキストフレームのみ)
 * - ルーム : ?room=xxx で分離。同室の glasses / meet ロール同士を接続
 *
 * 起動:  node bridge-server.js [port]         (既定 8787)
 * 検証:  node bridge-server.js --selftest     (WSフレーム処理の自己テスト)
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.argv[2] || process.env.BRIDGE_PORT || '8787', 10);
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const GLASSES_DIR = path.join(__dirname, '..', 'glasses');

// ---- WebSocket プリミティブ（純粋関数・自己テスト対象）----

function acceptKey(secWebSocketKey) {
  return crypto.createHash('sha1').update(secWebSocketKey + WS_GUID).digest('base64');
}

/** テキストをサーバー→クライアントの WS フレームへ */
function encodeFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81; header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

/**
 * 受信バッファから完成フレームを取り出す。
 * @returns { frames: [{opcode, text}], rest: Buffer }
 */
function decodeFrames(buf) {
  const frames = [];
  let off = 0;
  while (buf.length - off >= 2) {
    const b0 = buf[off], b1 = buf[off + 1];
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let p = off + 2;
    if (len === 126) {
      if (buf.length - p < 2) break;
      len = buf.readUInt16BE(p); p += 2;
    } else if (len === 127) {
      if (buf.length - p < 8) break;
      len = Number(buf.readBigUInt64BE(p)); p += 8;
    }
    const maskLen = masked ? 4 : 0;
    if (buf.length - p < maskLen + len) break;
    let payload = buf.subarray(p + maskLen, p + maskLen + len);
    if (masked) {
      const mask = buf.subarray(p, p + 4);
      const un = Buffer.alloc(len);
      for (let i = 0; i < len; i++) un[i] = payload[i] ^ mask[i % 4];
      payload = un;
    }
    frames.push({ opcode, text: payload.toString('utf8') });
    off = p + maskLen + len;
  }
  return { frames, rest: buf.subarray(off) };
}

// ---- ルーム管理: 同室の glasses / meet を1対1で結ぶ ----

const rooms = new Map(); // room -> { glasses: socket|null, meet: socket|null }

function roomOf(name) {
  if (!rooms.has(name)) rooms.set(name, { glasses: null, meet: null });
  return rooms.get(name);
}

function wsSend(sock, obj) {
  if (sock && !sock.destroyed) sock.write(encodeFrame(JSON.stringify(obj)));
}

function otherRole(role) {
  return role === 'glasses' ? 'meet' : 'glasses';
}

function handleMessage(sock, msg) {
  let data;
  try { data = JSON.parse(msg); } catch { return; }

  if (data.type === 'hello') {
    const role = data.role === 'glasses' ? 'glasses' : 'meet';
    const room = String(data.room || 'default').slice(0, 64);
    const r = roomOf(room);
    // 同ロールの旧接続は置き換え
    if (r[role] && r[role] !== sock) wsSend(r[role], { type: 'replaced' });
    r[role] = sock;
    sock._bridge = { role, room };
    wsSend(sock, { type: 'welcome', role, room, peer: !!r[otherRole(role)] });
    // 相手が既に居れば両者へ準備完了を通知(拡張側がofferを作る)
    if (r[otherRole(role)]) {
      wsSend(r.meet, { type: 'peer-ready' });
      wsSend(r.glasses, { type: 'peer-ready' });
    }
    log(`hello: ${role} @ ${room}`);
    return;
  }

  // hello 済みなら相手ロールへそのまま中継 (offer/answer/ice/bye 等)
  const b = sock._bridge;
  if (!b) return;
  const r = roomOf(b.room);
  wsSend(r[otherRole(b.role)], data);
}

function cleanup(sock) {
  const b = sock._bridge;
  if (!b) return;
  const r = roomOf(b.room);
  if (r[b.role] === sock) {
    r[b.role] = null;
    wsSend(r[otherRole(b.role)], { type: 'peer-left' });
  }
}

function log(...a) {
  if (process.env.BRIDGE_QUIET !== '1') console.log('[bridge]', ...a);
}

// ---- HTTP: グラス用クライアント配信 + ヘルスチェック ----

function createServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, rooms: [...rooms.keys()] }));
    }
    let rel = url.pathname === '/' ? '/index.html' : url.pathname;
    const full = path.join(GLASSES_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!full.startsWith(GLASSES_DIR) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      res.writeHead(404); return res.end('not found');
    }
    const mime = full.endsWith('.html') ? 'text/html; charset=utf-8'
      : full.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(fs.readFileSync(full));
  });

  server.on('upgrade', (req, sock) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) return sock.destroy();
    sock.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`
    );
    let buf = Buffer.alloc(0);
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const { frames, rest } = decodeFrames(buf);
      buf = rest;
      for (const f of frames) {
        if (f.opcode === 0x8) { cleanup(sock); return sock.end(); } // close
        if (f.opcode === 0x9) { sock.write(Buffer.from([0x8a, 0])); continue; } // ping→pong
        if (f.opcode === 0x1) handleMessage(sock, f.text); // text
      }
    });
    sock.on('close', () => cleanup(sock));
    sock.on('error', () => cleanup(sock));
  });

  return server;
}

// ---- 自己テスト ----

function selftest() {
  const assert = require('assert');
  // RFC6455 の既知ベクタ
  assert.strictEqual(acceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  // encode → (クライアント風にマスク) → decode ラウンドトリップ
  const text = JSON.stringify({ type: 'offer', sdp: 'x'.repeat(300) }); // 126拡張長を通す
  const server2client = encodeFrame(text);
  const dec0 = decodeFrames(server2client);
  assert.strictEqual(dec0.frames[0].text, text);
  assert.strictEqual(dec0.rest.length, 0);
  // マスク付き(クライアント→サーバー)フレームを合成
  const payload = Buffer.from(text);
  const mask = Buffer.from([1, 2, 3, 4]);
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];
  const head = Buffer.alloc(4);
  head[0] = 0x81; head[1] = 0x80 | 126; head.writeUInt16BE(payload.length, 2);
  const clientFrame = Buffer.concat([head, mask, masked]);
  // 分割受信(チャンク境界)にも耐えること
  const half = Math.floor(clientFrame.length / 2);
  const first = decodeFrames(clientFrame.subarray(0, half));
  assert.strictEqual(first.frames.length, 0);
  const second = decodeFrames(Buffer.concat([first.rest, clientFrame.subarray(half)]));
  assert.strictEqual(second.frames[0].text, text);
  console.log('bridge-server selftest: OK');
}

if (require.main === module) {
  if (process.argv.includes('--selftest')) {
    selftest();
  } else {
    createServer().listen(PORT, () => {
      log(`Meet Device Bridge: http://<このPCのIP>:${PORT}/  (グラスのブラウザで開く)`);
      log(`WS シグナリング: ws://<このPCのIP>:${PORT}/ws`);
    });
  }
}

module.exports = { acceptKey, encodeFrame, decodeFrames, handleMessage, createServer };
