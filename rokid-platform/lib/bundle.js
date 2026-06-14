'use strict';

/**
 * インポート/エクスポート。
 * 配布形式 ".rokidapp" は依存ゼロで扱えるよう JSON ベース:
 *   { schema, meta, files: { 相対パス: base64 } }
 * これによりOS/ツールを問わず1ファイルで授受でき、
 * import 側でアプリフォルダとレジストリを完全に再構築できる。
 */

const fs = require('fs');
const path = require('path');
const registry = require('./registry');
const scaffold = require('./scaffold');

const SCHEMA = 'rokidapp-bundle/v1';

/** アプリを .rokidapp バンドル(JSON文字列)へ書き出す */
function exportApp(id) {
  const meta = registry.get(id);
  if (!meta) throw new Error(`app not found: ${id}`);
  const files = scaffold.readAppFiles(id);
  const encoded = {};
  for (const [rel, buf] of Object.entries(files)) {
    encoded[rel] = Buffer.from(buf).toString('base64');
  }
  return JSON.stringify(
    { schema: SCHEMA, exportedAt: new Date().toISOString(), meta, files: encoded },
    null,
    2
  );
}

/** .rokidapp バンドルをファイルへ保存 */
function exportToFile(id, outPath) {
  const json = exportApp(id);
  const target =
    outPath || path.join(registry.ROOT, 'exports', `${id}.rokidapp`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, json);
  return target;
}

/**
 * バンドル(JSON文字列 or オブジェクト)をレジストリへ取り込む。
 * 既存IDと衝突する場合は新しいユニークIDを採番する。
 */
function importBundle(input) {
  const bundle = typeof input === 'string' ? JSON.parse(input) : input;
  if (!bundle || bundle.schema !== SCHEMA) {
    throw new Error('未対応のバンドル形式です (.rokidapp が必要)');
  }
  const src = bundle.meta || {};
  const baseId = registry.slugify(src.id || src.name || 'imported');
  const id = registry.uniqueId(baseId);

  const dir = registry.appDir(id);
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, b64] of Object.entries(bundle.files || {})) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, Buffer.from(b64, 'base64'));
  }

  const meta = {
    ...src,
    id,
    importedFrom: src.id || null,
    importedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    files: Object.keys(bundle.files || {}).sort(),
  };
  registry.upsert(meta);
  return meta;
}

module.exports = { SCHEMA, exportApp, exportToFile, importBundle };
