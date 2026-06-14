'use strict';

/**
 * Rokid 開発プラットフォーム Web サーバー。
 * 依存ゼロ (Node 標準 http モジュールのみ)。
 *   GET  /api/spec                 要件/テンプレート定義
 *   GET  /api/apps                 アプリ一覧
 *   POST /api/apps                 新規生成 (JSON body)
 *   GET  /api/apps/:id             詳細
 *   GET  /api/apps/:id/files       ファイル内容
 *   DELETE /api/apps/:id           削除
 *   GET  /api/apps/:id/export      .rokidapp ダウンロード
 *   POST /api/import               .rokidapp 取り込み (JSON body)
 *   GET  /api/device/devices       接続中の端末一覧 (TCP)
 *   POST /api/device/connect       TCPで端末へ接続 {target}
 *   POST /api/device/backup        デフォルトアプリ等をバックアップ
 *   POST /api/device/install       作成アプリを端末へインストール {id}
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const spec = require('../lib/rokid-spec');
const registry = require('../lib/registry');
const scaffold = require('../lib/scaffold');
const bundle = require('../lib/bundle');
const device = require('../lib/device');

const WEB_DIR = path.join(__dirname, '..', 'web');
const PORT = parseInt(process.env.ROKID_PORT || '4173', 10);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function send(res, code, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 50 * 1024 * 1024) reject(new Error('body too large'));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const full = path.join(WEB_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!full.startsWith(WEB_DIR) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    return send(res, 404, { error: 'not found' });
  }
  const ext = path.extname(full);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(fs.readFileSync(full));
}

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const method = req.method;

  // /api/spec
  if (parts[1] === 'spec' && method === 'GET') {
    return send(res, 200, {
      device: spec.DEVICE,
      sdks: spec.listSdks(),
      templates: spec.listTemplates(),
      hudGuide: spec.HUD_GUIDE,
      platformVersion: spec.PLATFORM_VERSION,
    });
  }

  // /api/import
  if (parts[1] === 'import' && method === 'POST') {
    const body = await readBody(req);
    const meta = bundle.importBundle(body.bundle || body);
    return send(res, 201, meta);
  }

  // /api/device ... 実機(TCP)連携
  if (parts[1] === 'device') {
    const sub = parts[2];
    if (sub === 'devices' && method === 'GET') {
      return send(res, 200, { output: device.devices() });
    }
    if (sub === 'connect' && method === 'POST') {
      const body = await readBody(req);
      return send(res, 200, { output: device.connect(body.target) });
    }
    if (sub === 'tcpip' && method === 'POST') {
      const body = await readBody(req);
      return send(res, 200, { output: device.enableTcpip(body.port) });
    }
    if (sub === 'packages' && method === 'GET') {
      const third = url.searchParams.get('third') === '1';
      const target = url.searchParams.get('target') || undefined;
      return send(res, 200, device.listPackages({ third, system: !third, target }));
    }
    if (sub === 'backup' && method === 'POST') {
      const body = await readBody(req);
      return send(res, 200, device.backup(body));
    }
    if (sub === 'install' && method === 'POST') {
      const body = await readBody(req);
      return send(res, 200, device.installApp(body.id || body.apk, { target: body.target }));
    }
    if (sub === 'restore' && method === 'POST') {
      const body = await readBody(req);
      return send(res, 200, device.restore(body.dir, { target: body.target }));
    }
  }

  // /api/apps ...
  if (parts[1] === 'apps') {
    const id = parts[2];
    if (!id) {
      if (method === 'GET') return send(res, 200, registry.list());
      if (method === 'POST') {
        const body = await readBody(req);
        const meta = scaffold.createApp(body);
        return send(res, 201, meta);
      }
    } else {
      const sub = parts[3];
      if (sub === 'export' && method === 'GET') {
        const json = bundle.exportApp(id);
        return send(res, 200, json, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${id}.rokidapp"`,
        });
      }
      if (sub === 'files' && method === 'GET') {
        const files = scaffold.readAppFiles(id);
        const text = {};
        for (const [k, v] of Object.entries(files)) text[k] = v.toString('utf8');
        return send(res, 200, text);
      }
      if (!sub && method === 'GET') {
        const a = registry.get(id);
        return a ? send(res, 200, a) : send(res, 404, { error: 'not found' });
      }
      if (!sub && method === 'DELETE') {
        registry.remove(id);
        return send(res, 200, { ok: true });
      }
    }
  }

  return send(res, 404, { error: 'unknown endpoint' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    return serveStatic(req, res);
  } catch (e) {
    return send(res, 400, { error: e.message });
  }
});

server.listen(PORT, () => {
  registry.ensure();
  console.log(`Rokid 開発プラットフォーム: http://localhost:${PORT}`);
});

module.exports = server;
