'use strict';

/**
 * Meet Device Bridge — ページ(MAIN world)側。document_start で実行。
 *
 * 役割:
 *  1. getUserMedia をフックし、有効時はグラスから届く WebRTC の
 *     映像/音声トラックを Meet へ「カメラ・マイク」として返す。
 *  2. Meet の受話音声(<audio> 要素群)を AudioContext で1本に合成し、
 *     同じ PeerConnection でグラスへ送り返す(=グラスがスピーカーになる)。
 *
 * 設定は content.js(拡張の隔離ワールド)から postMessage で受け取る。
 * ブリッジ未接続/失敗時は必ず元の getUserMedia にフォールバックし、
 * Meet を壊さないことを最優先とする。
 */

(() => {
  const origGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  const origEnum = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);

  const cfg = { enabled: false, server: '', room: 'default' };
  const bridge = {
    ws: null,
    pc: null,
    glassesVideo: null,   // グラスのカメラトラック
    glassesAudio: null,   // グラスのマイクトラック
    waiters: [],          // トラック待ちの resolve 群
    audioCtx: null,
    mixDest: null,        // Meet受話音声の合成先(→グラスへ送る1トラック)
    mixedIds: new Set(),  // 合成済み MediaStream.id
    state: 'idle',
  };

  const log = (...a) => console.log('%c[MeetBridge]', 'color:#0b7a43', ...a);

  // ---- 設定の受信 (content.js → ここ) ----
  window.addEventListener('message', (ev) => {
    if (ev.source !== window || !ev.data || ev.data.type !== 'MEET_BRIDGE_CONFIG') return;
    const { enabled, server, room } = ev.data.config || {};
    cfg.enabled = !!enabled;
    cfg.server = server || '';
    cfg.room = room || 'default';
    log('config', JSON.stringify(cfg));
    if (!cfg.enabled) teardown();
  });

  function teardown() {
    try { bridge.ws && bridge.ws.close(); } catch {}
    try { bridge.pc && bridge.pc.close(); } catch {}
    bridge.ws = bridge.pc = bridge.glassesVideo = bridge.glassesAudio = null;
    bridge.state = 'idle';
  }

  // ---- Meet 受話音声の収集(スピーカー経路) ----
  function ensureMix() {
    if (bridge.audioCtx) return;
    bridge.audioCtx = new AudioContext();
    bridge.mixDest = bridge.audioCtx.createMediaStreamDestination();
    // 定期スキャン: Meet が生成する <audio srcObject> を合成へ追加
    setInterval(() => {
      if (bridge.state !== 'connected') return;
      document.querySelectorAll('audio').forEach((el) => {
        const s = el.srcObject;
        if (!s || bridge.mixedIds.has(s.id) || !s.getAudioTracks().length) return;
        try {
          bridge.audioCtx.createMediaStreamSource(s).connect(bridge.mixDest);
          bridge.mixedIds.add(s.id);
          log('speaker: 受話ストリームを合成', s.id);
        } catch {}
      });
      if (bridge.audioCtx.state === 'suspended') bridge.audioCtx.resume().catch(() => {});
    }, 1500);
  }

  // ---- WebRTC 接続 (拡張 = offerer) ----
  function connect() {
    if (bridge.state === 'connecting' || bridge.state === 'connected') return;
    if (!cfg.server) { log('server 未設定'); return; }
    bridge.state = 'connecting';
    ensureMix();

    const ws = new WebSocket(cfg.server);
    bridge.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', role: 'meet', room: cfg.room }));
    ws.onmessage = async (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'welcome' && m.peer) await sendOffer();
      else if (m.type === 'peer-ready') await sendOffer();
      else if (m.type === 'answer' && bridge.pc) {
        await bridge.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
      } else if (m.type === 'ice' && bridge.pc) {
        try { await bridge.pc.addIceCandidate(m.candidate); } catch {}
      } else if (m.type === 'peer-left') {
        log('グラス切断');
      }
    };
    ws.onclose = () => {
      if (bridge.state !== 'idle') {
        bridge.state = 'idle';
        if (cfg.enabled) setTimeout(connect, 3000); // 自動再接続
      }
    };
  }

  async function sendOffer() {
    if (bridge.pc) bridge.pc.close();
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    bridge.pc = pc;

    // 受信: グラスのカメラ/マイク
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });
    // 送信: Meet の受話合成音声 → グラスのスピーカー
    const mixTrack = bridge.mixDest.stream.getAudioTracks()[0];
    if (mixTrack) pc.addTrack(mixTrack, bridge.mixDest.stream);

    pc.ontrack = (e) => {
      if (e.track.kind === 'video') bridge.glassesVideo = e.track;
      else bridge.glassesAudio = e.track;
      log('グラスから受信:', e.track.kind);
      if (bridge.glassesVideo && bridge.glassesAudio) {
        bridge.state = 'connected';
        bridge.waiters.splice(0).forEach((fn) => fn());
      }
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) bridge.ws.send(JSON.stringify({ type: 'ice', candidate: e.candidate }));
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'disconnected'].includes(pc.connectionState)) bridge.state = 'idle';
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    bridge.ws.send(JSON.stringify({ type: 'offer', sdp: offer.sdp }));
  }

  /** トラックが揃うまで待つ(タイムアウトでフォールバック) */
  function waitForTracks(ms) {
    if (bridge.state === 'connected') return Promise.resolve(true);
    connect();
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), ms);
      bridge.waiters.push(() => { clearTimeout(t); resolve(true); });
    });
  }

  // ---- getUserMedia フック ----
  navigator.mediaDevices.getUserMedia = async function (constraints = {}) {
    if (!cfg.enabled || (!constraints.video && !constraints.audio)) {
      return origGUM(constraints);
    }
    const ok = await waitForTracks(8000);
    if (!ok) {
      log('ブリッジ未接続 → 通常デバイスへフォールバック');
      return origGUM(constraints);
    }
    const out = new MediaStream();
    if (constraints.video && bridge.glassesVideo) out.addTrack(bridge.glassesVideo.clone());
    if (constraints.audio && bridge.glassesAudio) out.addTrack(bridge.glassesAudio.clone());
    log('getUserMedia → グラスのトラックを返却',
      out.getTracks().map((t) => t.kind).join('+'));
    return out;
  };

  // ---- enumerateDevices: 仮想デバイス名を見せる(表示用) ----
  navigator.mediaDevices.enumerateDevices = async function () {
    const list = await origEnum();
    if (!cfg.enabled) return list;
    const mk = (kind, label) => ({
      deviceId: 'rokid-glasses-' + kind, groupId: 'rokid-glasses', kind, label,
      toJSON() { return this; },
    });
    return [
      mk('videoinput', 'Rokid Glasses カメラ (Bridge)'),
      mk('audioinput', 'Rokid Glasses マイク (Bridge)'),
      mk('audiooutput', 'Rokid Glasses スピーカー (Bridge)'),
      ...list,
    ];
  };

  log('ロード完了 (待機中 — ポップアップで有効化)');
})();
