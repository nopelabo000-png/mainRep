'use strict';

/**
 * アプリの生成・更新。テンプレートからファイルを書き出し、
 * レジストリにメタデータを登録する。
 */

const fs = require('fs');
const path = require('path');
const registry = require('./registry');
const { generate } = require('./templates');
const { TEMPLATES } = require('./rokid-spec');

function writeFiles(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
}

/**
 * @param {object} opts { name, template, ...meta }
 * @returns 登録済みメタデータ
 */
function createApp(opts) {
  if (!opts || !opts.name) throw new Error('name は必須です');
  const template = opts.template || 'web-hud';
  if (!TEMPLATES[template]) throw new Error(`unknown template: ${template}`);

  const id = registry.uniqueId(registry.slugify(opts.name));
  const meta = {
    id,
    name: opts.name,
    template,
    sdk: TEMPLATES[template].sdk,
    version: opts.version || '1.0.0',
    androidPackage: opts.androidPackage || null,
    voiceCommand: opts.voiceCommand || null,
    tagline: opts.tagline || null,
    description: opts.description || '',
    author: opts.author || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const files = generate(template, meta);
  const dir = registry.appDir(id);
  fs.mkdirSync(dir, { recursive: true });
  writeFiles(dir, files);

  meta.files = Object.keys(files).sort();
  registry.upsert(meta);
  return meta;
}

// アプリ配下の全ファイルを { 相対パス: 内容 } で読み出す
function readAppFiles(id) {
  const dir = registry.appDir(id);
  const out = {};
  function walk(d, base) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      const rel = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, rel);
      else out[rel] = fs.readFileSync(full);
    }
  }
  if (fs.existsSync(dir)) walk(dir, '');
  return out;
}

module.exports = { createApp, writeFiles, readAppFiles };
