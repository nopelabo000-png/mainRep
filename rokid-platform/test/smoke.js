'use strict';

/**
 * 依存ゼロのスモークテスト。
 * create → list → readFiles → export → import → remove と
 * HTTP API の主要エンドポイントを検証する。
 */

const assert = require('assert');
const http = require('http');
const registry = require('../lib/registry');
const scaffold = require('../lib/scaffold');
const bundle = require('../lib/bundle');
const spec = require('../lib/rokid-spec');
const device = require('../lib/device');

let pass = 0;
function ok(name) {
  pass++;
  console.log('  ✓ ' + name);
}

(async function run() {
  console.log('lib テスト');

  // spec
  assert(spec.listTemplates().length >= 3, 'templates >= 3');
  ok('spec にテンプレートが定義されている');

  // create (各テンプレート)
  const created = [];
  for (const t of spec.listTemplates()) {
    const m = scaffold.createApp({ name: 'Test ' + t.id, template: t.id, tagline: 'tg', voiceCommand: 'vc' });
    assert(m.id && m.files.length > 0, 'created with files');
    created.push(m);
  }
  ok(`各テンプレートで生成成功 (${created.length}件)`);

  // 一意IDの確認
  const dup = scaffold.createApp({ name: 'Test ' + spec.listTemplates()[0].id, template: spec.listTemplates()[0].id });
  assert(dup.id !== created[0].id, 'unique id');
  created.push(dup);
  ok('同名でもユニークIDを採番');

  // files 読み出し
  const files = scaffold.readAppFiles(created[0].id);
  assert(files['rokid.app.json'], 'rokid.app.json exists');
  ok('rokid.app.json を含むファイルを生成');

  // export → import ラウンドトリップ
  const json = bundle.exportApp(created[0].id);
  const imported = bundle.importBundle(json);
  assert(imported.id !== created[0].id, 'import new id');
  const f2 = scaffold.readAppFiles(imported.id);
  assert(Object.keys(f2).length === Object.keys(files).length, 'same file count');
  ok('export → import ラウンドトリップ成功');

  // remove (テストデータ全削除)
  for (const m of created) registry.remove(m.id);
  registry.remove(imported.id);
  ok('クリーンアップ削除成功');

  // device: TCP連携の純粋関数（adb非依存）
  console.log('device テスト');
  assert.strictEqual(device.normalizeTarget('192.168.1.5'), '192.168.1.5:5555', 'port補完');
  assert.strictEqual(device.normalizeTarget('192.168.1.5:7000'), '192.168.1.5:7000', 'port保持');
  assert.deepStrictEqual(device.cmd.connect('h:5555'), ['connect', 'h:5555'], 'connect args');
  assert.deepStrictEqual(device.cmd.tcpip(5555), ['tcpip', '5555'], 'tcpip args');
  assert.deepStrictEqual(device.cmd.install('a.apk', 'h:1'), ['-s', 'h:1', 'install', '-r', 'a.apk'], 'install args');
  ok('device コマンド組み立てが正しい');

  const parsed = device.parsePackages(
    'package:/system/app/Foo/Foo.apk=com.rokid.foo\npackage:/data/app/Bar/base.apk=com.example.bar'
  );
  assert(parsed.length === 2 && parsed[0].pkg === 'com.rokid.foo', 'parsePackages');
  ok('pm list packages 出力を解析');

  assert.strictEqual(device.findApk('___nonexistent___'), null, 'no apk → null');
  assert.throws(() => device.installApp('___nonexistent___'), /アプリID|APK/, 'install 不正入力でエラー');
  ok('未ビルド/不正入力を適切に拒否');

  // DRYRUN で実行系がadb無しでも動く
  process.env.ROKID_ADB_DRYRUN = '1';
  assert(/connect/.test(device.connect('10.0.0.2')), 'dryrun connect');
  delete process.env.ROKID_ADB_DRYRUN;
  ok('DRYRUN で接続コマンドを生成');

  // netfind: MAC→IP 解決の純粋関数
  const netfind = require('../lib/netfind');
  assert.strictEqual(netfind.normalizeMac('A4-C1:38.aa bb CC'), 'a4c138aabbcc', 'mac正規化');
  const arpUnix = netfind.parseArp(
    '? (192.168.1.50) at a4:c1:38:aa:bb:cc on en0 ifscope [ethernet]\n' +
    '? (192.168.1.1) at (incomplete) on en0'
  );
  assert(arpUnix.length === 1 && arpUnix[0].ip === '192.168.1.50' &&
    arpUnix[0].mac === 'a4c138aabbcc', 'unix arp解析 + incomplete除外');
  const arpWin = netfind.parseArp('  192.168.1.51          a4-c1-38-aa-bb-cd     dynamic');
  assert(arpWin.length === 1 && arpWin[0].ip === '192.168.1.51' &&
    arpWin[0].mac === 'a4c138aabbcd', 'windows arp解析');
  await assert.rejects(() => netfind.findByMac('xx'), /形式が不正/, '不正MACを拒否');
  ok('netfind: ARP解析/MAC正規化が正しい');

  // HTTP API
  console.log('HTTP API テスト');
  process.env.ROKID_PORT = '4199';
  delete require.cache[require.resolve('../server/server')];
  const server = require('../server/server');
  await new Promise((r) => setTimeout(r, 250));

  const base = 'http://localhost:4199';
  const get = (p) => req('GET', p);
  const post = (p, b) => req('POST', p, b);
  function req(method, p, body) {
    return new Promise((resolve, reject) => {
      const data = body ? JSON.stringify(body) : null;
      const r = http.request(base + p, { method, headers: { 'Content-Type': 'application/json' } }, (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve({ status: res.statusCode, body: d ? JSON.parse(d) : null }));
      });
      r.on('error', reject);
      if (data) r.write(data);
      r.end();
    });
  }

  let res = await get('/api/spec');
  assert(res.status === 200 && res.body.device, 'spec ok');
  ok('GET /api/spec');

  res = await post('/api/apps', { name: 'API App', template: 'web-hud', tagline: 'hi' });
  assert(res.status === 201 && res.body.id, 'create ok');
  const apiId = res.body.id;
  ok('POST /api/apps');

  res = await get('/api/apps');
  assert(res.body.some((a) => a.id === apiId), 'list contains');
  ok('GET /api/apps');

  res = await get(`/api/apps/${apiId}/files`);
  assert(res.body['index.html'], 'files ok');
  ok('GET /api/apps/:id/files');

  res = await get(`/api/apps/${apiId}/export`);
  assert(res.status === 200, 'export ok');
  ok('GET /api/apps/:id/export');

  res = await req('DELETE', `/api/apps/${apiId}`);
  assert(res.status === 200, 'delete ok');
  ok('DELETE /api/apps/:id');

  // 配信API（DRYRUNでadb無しでも検証可能）
  process.env.ROKID_ADB_DRYRUN = '1';
  res = await post('/api/device/connect', { target: '10.0.0.9' });
  assert(res.status === 200 && /connect 10\.0\.0\.9:5555/.test(res.body.output), 'device connect');
  ok('POST /api/device/connect (dry-run)');

  res = await get('/api/device/devices');
  assert(res.status === 200 && /devices/.test(res.body.output), 'device devices');
  delete process.env.ROKID_ADB_DRYRUN;
  ok('GET /api/device/devices (dry-run)');

  // 新テンプレート（CXR-L / UXR）の生成物を確認
  res = await post('/api/apps', { name: 'L App', template: 'cxr-l-standalone' });
  assert(res.status === 201 && res.body.files.includes('build.gradle'), 'cxr-l files');
  await req('DELETE', `/api/apps/${res.body.id}`);
  res = await post('/api/apps', { name: 'U App', template: 'uxr-unity' });
  assert(res.status === 201 && res.body.files.some((f) => f.endsWith('.cs')), 'uxr files');
  await req('DELETE', `/api/apps/${res.body.id}`);
  ok('CXR-L / UXR テンプレートが生成できる');

  server.close();
  console.log(`\n全 ${pass} テスト成功 ✅`);
  process.exit(0);
})().catch((e) => {
  console.error('\n失敗 ❌ ' + e.stack);
  process.exit(1);
});
