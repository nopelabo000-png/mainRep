#!/usr/bin/env node
'use strict';

/**
 * rokid CLI — Claude Code から Rokid アプリを開発・格納・入出力する。
 *
 * 使い方:
 *   rokid templates                              テンプレート/SDK一覧
 *   rokid spec                                   Rokid 開発要件サマリ
 *   rokid new <name> -t <template> [--opt v]     アプリ生成
 *   rokid list                                   格納済みアプリ一覧
 *   rokid show <id>                              アプリ詳細
 *   rokid export <id> [out.rokidapp]             エクスポート
 *   rokid import <file.rokidapp>                 インポート
 *   rokid remove <id>                            削除
 *   rokid serve [port]                           Web UI を起動
 */

const path = require('path');
const fs = require('fs');
const spec = require('../lib/rokid-spec');
const registry = require('../lib/registry');
const scaffold = require('../lib/scaffold');
const bundle = require('../lib/bundle');

function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-t') flags.template = args[++i];
    else if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) flags[key] = true;
      else flags[key] = args[++i];
    } else positional.push(a);
  }
  return { flags, positional };
}

function out(obj) {
  if (typeof obj === 'string') console.log(obj);
  else console.log(JSON.stringify(obj, null, 2));
}

const commands = {
  templates() {
    out('利用可能なテンプレート:');
    for (const t of spec.listTemplates()) {
      out(`  ${t.id.padEnd(18)} [${t.sdk}] ${t.label} — ${t.desc}`);
    }
    out('\nSDK:');
    for (const s of spec.listSdks()) {
      out(`  ${s.id.padEnd(8)} ${s.label} (runsOn: ${s.runsOn}, pkg: ${s.package})`);
    }
  },

  spec() {
    out({ device: spec.DEVICE, hudGuide: spec.HUD_GUIDE });
  },

  new(args) {
    const { flags, positional } = parseFlags(args);
    const name = positional.join(' ').trim();
    if (!name) throw new Error('使い方: rokid new <name> -t <template>');
    const meta = scaffold.createApp({
      name,
      template: flags.template || 'web-hud',
      androidPackage: flags.pkg,
      voiceCommand: flags.voice,
      tagline: flags.tagline,
      description: flags.desc,
      author: flags.author,
      version: flags.version,
    });
    out(`生成しました: ${meta.id}  (${registry.appDir(meta.id)})`);
    out(meta.files.map((f) => '  ' + f).join('\n'));
  },

  list() {
    const apps = registry.list();
    if (!apps.length) return out('(アプリはまだありません)');
    for (const a of apps) {
      out(`  ${a.id.padEnd(24)} ${(a.sdk || '').padEnd(8)} ${a.name}`);
    }
  },

  show(args) {
    const id = args[0];
    const a = registry.get(id);
    if (!a) throw new Error(`not found: ${id}`);
    out(a);
  },

  export(args) {
    const [id, outPath] = args;
    const target = bundle.exportToFile(id, outPath);
    out(`エクスポート完了: ${target}`);
  },

  import(args) {
    const file = args[0];
    if (!file || !fs.existsSync(file)) throw new Error(`ファイルがありません: ${file}`);
    const meta = bundle.importBundle(fs.readFileSync(file, 'utf8'));
    out(`インポート完了: ${meta.id}`);
  },

  remove(args) {
    const id = args[0];
    registry.remove(id);
    out(`削除しました: ${id}`);
  },

  serve(args) {
    process.env.ROKID_PORT = args[0] || process.env.ROKID_PORT || '4173';
    require('../server/server');
  },

  help() {
    out(fs.readFileSync(path.join(__dirname, 'rokid.js'), 'utf8')
      .split('\n').slice(4, 22).map((l) => l.replace(/^ \*?/, '')).join('\n'));
  },
};

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const fn = commands[cmd] || commands.help;
  try {
    fn(rest);
  } catch (e) {
    console.error('エラー: ' + e.message);
    process.exit(1);
  }
}

main();
