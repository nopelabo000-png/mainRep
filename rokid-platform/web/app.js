'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const api = (p, opt) => fetch('/api' + p, opt).then(async (r) => {
  const t = await r.text();
  const data = t ? JSON.parse(t) : null;
  if (!r.ok) throw new Error((data && data.error) || r.statusText);
  return data;
});

let SPEC = null;
let CURRENT = null; // 選択中アプリ id

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 2600);
}

// ---- タブ ----
$$('.tab').forEach((b) =>
  b.addEventListener('click', () => {
    $$('.tab').forEach((x) => x.classList.remove('active'));
    $$('.tabpanel').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    $('#tab-' + b.dataset.tab).classList.add('active');
    if (b.dataset.tab === 'deploy') fillDeployApps();
  })
);

// ---- 一覧 ----
async function loadApps() {
  const apps = await api('/apps');
  const ul = $('#appList');
  ul.innerHTML = '';
  if (!apps.length) {
    ul.innerHTML = '<li class="muted small" style="cursor:default">まだありません</li>';
  }
  apps.forEach((a) => {
    const li = document.createElement('li');
    li.dataset.id = a.id;
    if (a.id === CURRENT) li.classList.add('active');
    li.innerHTML = `<div class="nm">${esc(a.name)}</div><div class="sd">${esc(a.sdk || '')} · ${esc(a.id)}</div>`;
    li.addEventListener('click', () => selectApp(a.id));
    ul.appendChild(li);
  });
}

// ---- 詳細 ----
async function selectApp(id) {
  CURRENT = id;
  $$('.app-list li').forEach((li) => li.classList.toggle('active', li.dataset.id === id));
  const a = await api('/apps/' + id);
  $('#emptyDetail').hidden = true;
  $('#appDetail').hidden = false;
  $('#dName').textContent = a.name;
  $('#dMeta').textContent = `${a.sdk} · ${a.template} · v${a.version} · ${a.id}`;

  // HUD シミュレータ
  $('#hudName').textContent = a.name;
  $('#hudTagline').textContent = a.tagline || '';
  $('#hudVoice').textContent = a.voiceCommand ? '🎤 ' + a.voiceCommand : '';
  $('#simNote').textContent = (SPEC && SPEC.hudGuide.rules[0]) || '';

  // ファイル
  const files = await api(`/apps/${id}/files`);
  const names = Object.keys(files).sort();
  const fl = $('#fileList');
  fl.innerHTML = '';
  names.forEach((n, i) => {
    const li = document.createElement('li');
    li.textContent = n;
    li.addEventListener('click', () => {
      $$('#fileList li').forEach((x) => x.classList.remove('active'));
      li.classList.add('active');
      $('#fileView').textContent = files[n];
    });
    fl.appendChild(li);
    if (i === 0) li.click();
  });
}

$('#exportBtn').addEventListener('click', async () => {
  if (!CURRENT) return;
  const data = await api(`/apps/${CURRENT}/export`);
  const blob = new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)],
    { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = CURRENT + '.rokidapp';
  a.click();
  URL.revokeObjectURL(url);
  toast('エクスポートしました');
});

$('#deleteBtn').addEventListener('click', async () => {
  if (!CURRENT || !confirm('削除しますか?')) return;
  await api('/apps/' + CURRENT, { method: 'DELETE' });
  CURRENT = null;
  $('#appDetail').hidden = true;
  $('#emptyDetail').hidden = false;
  await loadApps();
  toast('削除しました');
});

$('#installBtn').addEventListener('click', () => {
  if (!CURRENT) return;
  // 配信タブへ移動し、対象アプリを選択した状態にする
  $('.tab[data-tab="deploy"]').click();
  fillDeployApps(CURRENT);
});

// ---- 配信（実機 TCP 連携）----
function dpLog(msg, cls) {
  const el = $('#dpLog');
  el.textContent = msg;
  el.className = 'dp-log' + (cls ? ' ' + cls : '');
}

function dpTarget() {
  return $('#dpTarget').value.trim() || undefined;
}

async function dpRun(label, fn) {
  dpLog(label + ' 実行中…');
  try {
    const r = await fn();
    dpLog(label + ' 完了', 'ok');
    return r;
  } catch (e) {
    dpLog(label + ' 失敗: ' + e.message, 'err');
    return null;
  }
}

function fillDeployApps(selectId) {
  api('/apps').then((apps) => {
    const sel = $('#dpAppSelect');
    sel.innerHTML = '';
    const targets = apps.filter((a) => a.sdk !== 'web-hud'); // APK系のみ
    if (!targets.length) {
      sel.innerHTML = '<option value="">（APK系アプリがありません）</option>';
      return;
    }
    targets.forEach((a) => {
      const o = document.createElement('option');
      o.value = a.id;
      o.textContent = `${a.name} (${a.id})`;
      if (a.id === selectId) o.selected = true;
      sel.appendChild(o);
    });
  });
}

$('#dpFind').addEventListener('click', async () => {
  const mac = $('#dpMac').value.trim();
  if (!mac) return dpLog('MAC アドレスを入力してください', 'err');
  const r = await dpRun('IP 検索（LAN掃引・数十秒）', () =>
    api('/device/find', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mac }),
    }));
  if (r && r.found) {
    $('#dpTarget').value = r.ip;
    dpLog(`発見: ${r.ip} → 「接続」を押してください`, 'ok');
  } else if (r) {
    dpLog('見つかりませんでした。グラスが同じWi-Fiに接続済みか確認してください（Bluetoothだけでは不可）', 'err');
  }
});

$('#dpConnect').addEventListener('click', async () => {
  const target = dpTarget();
  if (!target) return dpLog('接続先 IP を入力してください', 'err');
  const r = await dpRun('接続', () =>
    api('/device/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target }),
    }));
  if (r) { $('#dpDevicesOut').hidden = false; $('#dpDevicesOut').textContent = r.output; }
});

$('#dpDevices').addEventListener('click', async () => {
  const r = await dpRun('端末一覧', () => api('/device/devices'));
  if (r) { $('#dpDevicesOut').hidden = false; $('#dpDevicesOut').textContent = r.output; }
});

$('#dpInstall').addEventListener('click', async () => {
  const id = $('#dpAppSelect').value;
  if (!id) return dpLog('アプリを選択してください', 'err');
  const r = await dpRun('インストール', () =>
    api('/device/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, target: dpTarget() }),
    }));
  if (r) dpLog(`インストール完了: ${r.apk}\n${r.result}`, 'ok');
});

$('#dpBackup').addEventListener('click', async () => {
  const filter = $('#dpFilter').value.trim() || undefined;
  const r = await dpRun('バックアップ', () =>
    api('/device/backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filter, target: dpTarget() }),
    }));
  if (r) {
    dpLog(`バックアップ完了: ${r.count} 個 → ${r.dir}`, 'ok');
    $('#dpRestoreDir').value = r.dir;
  }
});

$('#dpRestore').addEventListener('click', async () => {
  const dir = $('#dpRestoreDir').value.trim();
  if (!dir) return dpLog('リストア元ディレクトリを入力してください', 'err');
  const r = await dpRun('リストア', () =>
    api('/device/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir, target: dpTarget() }),
    }));
  if (r) dpLog(`リストア完了: ${r.count} 個`, 'ok');
});

async function dpShowPackages(third) {
  const q = new URLSearchParams();
  if (third) q.set('third', '1');
  const t = dpTarget();
  if (t) q.set('target', t);
  const r = await dpRun(third ? 'サードパーティ一覧' : 'プリイン一覧', () =>
    api('/device/packages?' + q));
  if (r) {
    $('#dpPkgsOut').hidden = false;
    $('#dpPkgsOut').textContent =
      r.map((p) => p.pkg).join('\n') || '(なし)';
  }
}
$('#dpPkgsSys').addEventListener('click', () => dpShowPackages(false));
$('#dpPkgsThird').addEventListener('click', () => dpShowPackages(true));

// ---- インポート ----
$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  try {
    const meta = await api('/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bundle: JSON.parse(text) }),
    });
    await loadApps();
    selectApp(meta.id);
    toast('インポート: ' + meta.id);
  } catch (err) {
    toast('失敗: ' + err.message);
  }
  e.target.value = '';
});

// ---- 新規作成 ----
function fillTemplates() {
  const sel = $('#templateSelect');
  sel.innerHTML = '';
  SPEC.templates.forEach((t) => {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = `${t.label} [${t.sdk}]`;
    o.dataset.desc = t.desc;
    sel.appendChild(o);
  });
  const upd = () =>
    ($('#templateDesc').textContent = sel.selectedOptions[0]?.dataset.desc || '');
  sel.addEventListener('change', upd);
  upd();
}

$('#createForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  try {
    const meta = await api('/apps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    $('#createResult').style.color = 'var(--green)';
    $('#createResult').textContent = `生成しました: ${meta.id}（${meta.files.length} ファイル）`;
    e.target.reset();
    $('#templateSelect').dispatchEvent(new Event('change'));
    await loadApps();
    $('.tab[data-tab="apps"]').click();
    selectApp(meta.id);
  } catch (err) {
    $('#createResult').style.color = 'var(--danger)';
    $('#createResult').textContent = 'エラー: ' + err.message;
  }
});

// ---- 開発要件タブ ----
function renderSpec() {
  const d = SPEC.device;
  const el = $('#specContent');
  el.innerHTML = `
    <div class="spec-card">
      <h3>ターゲットデバイス: ${esc(d.name)}</h3>
      <table>
        <tr><td>OS</td><td>${esc(d.os)}</td></tr>
        <tr><td>Android SDK</td><td>${d.androidSdk}（オンデバイス最小 ${d.minSdkOnDevice}）</td></tr>
        <tr><td>ABI</td><td>${esc(d.abi)}</td></tr>
        <tr><td>SoC</td><td>${esc(d.soc)}</td></tr>
        <tr><td>ディスプレイ</td><td>${esc(d.display.type)} / ${esc(d.display.eyes)} / ${esc(d.display.color)}</td></tr>
        <tr><td>入力</td><td>${d.input.map((i) => `<span class="chip">${esc(i)}</span>`).join('')}</td></tr>
        <tr><td>通信</td><td>${esc(d.serialization)} over ${d.transports.join(', ')}</td></tr>
      </table>
    </div>
    <div class="spec-card">
      <h3>SDK / パッケージ</h3>
      <table>${SPEC.sdks.map((s) => `<tr><td>${esc(s.label)}</td>
        <td>runsOn: ${esc(s.runsOn)} · pkg: ${esc(s.package)}${s.maven ? '<br>' + esc(s.maven) : ''}</td></tr>`).join('')}</table>
    </div>
    <div class="spec-card">
      <h3>グラスへの配信方式</h3>
      <p class="muted small">有線(USB)は選択肢の一つ。実際は Wi-Fi / Bluetooth 経由の配信が主流。</p>
      <table>${(SPEC.deployMethods || []).map((m) => `<tr>
        <td>${m.wireless ? '<span class="chip">📶 ワイヤレス</span>' : '🔌 有線'} ${esc(m.label)}</td>
        <td>${esc(m.desc)}</td></tr>`).join('')}</table>
    </div>
    <div class="spec-card">
      <h3>HUD デザインガイド（単眼・単色グリーン）</h3>
      <p class="muted small">セーフエリア ${SPEC.hudGuide.safeArea.width}×${SPEC.hudGuide.safeArea.height} / 最小フォント ${SPEC.hudGuide.minFontPx}px / 1画面 ${SPEC.hudGuide.maxLinesPerView}行以内</p>
      <ul>${SPEC.hudGuide.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    </div>`;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---- 起動 ----
(async function init() {
  SPEC = await api('/spec');
  $('#subtitle').textContent = `AIスマートグラス アプリ開発環境 · ${SPEC.device.name} · v${SPEC.platformVersion}`;
  fillTemplates();
  renderSpec();
  await loadApps();
})().catch((e) => toast('初期化エラー: ' + e.message));
