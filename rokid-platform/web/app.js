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
