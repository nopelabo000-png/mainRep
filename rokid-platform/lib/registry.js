'use strict';

/**
 * アプリレジストリ。apps/ 配下に各アプリのフォルダを置き、
 * apps/registry.json でメタデータ一覧を管理する。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APPS_DIR = path.join(ROOT, 'apps');
const REGISTRY_FILE = path.join(APPS_DIR, 'registry.json');

function ensure() {
  if (!fs.existsSync(APPS_DIR)) fs.mkdirSync(APPS_DIR, { recursive: true });
  if (!fs.existsSync(REGISTRY_FILE)) {
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify({ apps: [] }, null, 2));
  }
}

function read() {
  ensure();
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
  } catch (e) {
    return { apps: [] };
  }
}

function write(data) {
  ensure();
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(data, null, 2));
}

function list() {
  return read().apps;
}

function get(id) {
  return read().apps.find((a) => a.id === id) || null;
}

function appDir(id) {
  return path.join(APPS_DIR, id);
}

// id は英小文字・数字・ハイフンのみに正規化
function slugify(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'app';
}

function uniqueId(base) {
  const existing = new Set(list().map((a) => a.id));
  let id = base;
  let n = 1;
  while (existing.has(id)) id = `${base}-${n++}`;
  return id;
}

function upsert(meta) {
  const data = read();
  const i = data.apps.findIndex((a) => a.id === meta.id);
  if (i >= 0) data.apps[i] = { ...data.apps[i], ...meta };
  else data.apps.push(meta);
  write(data);
  return meta;
}

function remove(id) {
  const data = read();
  data.apps = data.apps.filter((a) => a.id !== id);
  write(data);
  const dir = appDir(id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = {
  ROOT,
  APPS_DIR,
  REGISTRY_FILE,
  ensure,
  read,
  write,
  list,
  get,
  appDir,
  slugify,
  uniqueId,
  upsert,
  remove,
};
