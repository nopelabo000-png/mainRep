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
 *   rokid device <sub> ...                        実機(TCP)連携: 接続/バックアップ/導入
 */

const fs = require('fs');
const spec = require('../lib/rokid-spec');
const registry = require('../lib/registry');
const scaffold = require('../lib/scaffold');
const bundle = require('../lib/bundle');
const device = require('../lib/device');

const HELP = `rokid — Rokid アプリ開発 CLI

使い方:
  rokid templates                          テンプレート/SDK一覧
  rokid spec                               Rokid 開発要件サマリ
  rokid deploy                             グラスへの配信方式（有線/ワイヤレス）
  rokid new <name> -t <template> [--opt v] アプリ生成
  rokid list                               格納済みアプリ一覧
  rokid show <id>                          アプリ詳細
  rokid export <id> [out.rokidapp]         エクスポート
  rokid import <file.rokidapp>             インポート
  rokid remove <id>                        削除
  rokid serve [port]                       Web UI を起動

new のオプション: --pkg --voice --tagline --desc --author --version`;

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

  deploy() {
    out('グラスへのアプリ配信方式 (調査結果):');
    for (const m of spec.DEPLOY_METHODS) {
      const tag = m.wireless ? '📶 ワイヤレス' : '🔌 有線    ';
      out(`  ${tag}  ${m.label}`);
      out(`             ${m.desc}`);
    }
    out('\n結論: 有線(USB)は選択肢の一つに過ぎず、Wi-Fi/Bluetooth 経由の配信が主流。');
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

  device(args) {
    const [sub, ...rest] = args;
    const { flags, positional } = parseFlags(rest);
    const target = flags.target || flags.t;
    switch (sub) {
      case 'find': { // MACアドレスからLAN内のIPを特定（Hi RokidはIP非表示のため）
        const netfind = require('../lib/netfind');
        const mac = positional[0];
        if (!mac) throw new Error('使い方: rokid device find <MACアドレス>');
        if (netfind.normalizeMac(mac).length !== 12) {
          throw new Error(`MAC アドレスの形式が不正です: ${mac}（例: A4:C1:38:12:34:56）`);
        }
        out(`LAN を掃引して ${mac} を検索中…（数十秒かかることがあります）`);
        return netfind.findByMac(mac).then((hit) => {
          if (!hit) {
            out('見つかりませんでした。グラスが同じWi-Fiに接続済みか確認してください。');
            out('（Bluetoothペアリングだけでは IP は付与されません）');
            process.exitCode = 1;
            return;
          }
          out(`発見: ${hit.ip}`);
          out(`次: rokid device connect ${hit.ip}`);
        });
      }
      case 'scan': { // LAN上の全端末を一覧（目的MACが見つからない時の切り分け）
        const netfind = require('../lib/netfind');
        out(`自分のサブネット: ${netfind.localSubnets().map((b) => b + '.0/24').join(', ') || '(なし)'}`);
        out('LAN を掃引中…（数十秒）');
        return netfind.scan().then((list) => {
          if (!list.length) return out('端末が見つかりません（掃引が届いていない可能性）');
          out(`発見 ${list.length} 台:`);
          for (const e of list) out(`  ${e.ip.padEnd(16)} ${e.mac}`);
          out('\nこの中にグラスのMAC(WiFi側)があるか確認してください。');
          out('無ければ グラスとPCが別ネットワーク、またはHi Rokid表示がBluetooth MACの可能性。');
        });
      }
      case 'tcpip': // USB接続中に実行→以降WiFiでTCP接続できる
        return out(device.enableTcpip(positional[0]));
      case 'connect':
        return out(device.connect(positional[0] || target));
      case 'disconnect':
        return out(device.disconnect(positional[0] || target));
      case 'devices':
        return out(device.devices());
      case 'apps':
      case 'packages': {
        const pkgs = device.listPackages({
          target,
          system: flags.system !== false && !flags.third,
          third: !!flags.third,
        });
        return out(pkgs.map((p) => `  ${p.pkg}`).join('\n') || '(なし)');
      }
      case 'backup': { // ① デフォルトアプリのバックアップ
        const r = device.backup({
          target,
          third: !!flags.third,
          system: flags.system !== false,
          filter: typeof flags.filter === 'string' ? flags.filter : undefined,
          outDir: typeof flags.out === 'string' ? flags.out : undefined,
        });
        return out(`バックアップ完了: ${r.count} 個 → ${r.dir}`);
      }
      case 'install': // ② 作成アプリのインポート(インストール)
      case 'import': {
        const r = device.installApp(positional[0], { target });
        return out(`インストール: ${r.apk}\n${r.result}`);
      }
      case 'restore': {
        const r = device.restore(positional[0], { target });
        return out(`リストア完了: ${r.count} 個`);
      }
      default:
        return out(
          'device サブコマンド:\n' +
          '  find <MAC>                  MACアドレスからLAN内のIPを特定\n' +
          '  scan                        LAN上の全端末をIP+MACで一覧(切り分け用)\n' +
          '  tcpip [port]                USB接続中の端末をTCPモードへ(以降WiFi可)\n' +
          '  connect <host[:port]>       TCPで端末へ接続\n' +
          '  disconnect [host[:port]]    切断\n' +
          '  devices                     接続中の端末一覧\n' +
          '  apps [--third] [--target h] パッケージ一覧(既定:プリイン)\n' +
          '  backup [--third] [--filter re] [--out dir] [--target h]  デフォルトアプリ等をAPK保存\n' +
          '  install <id|apk> [--target h]   作成アプリ/APKを端末へインストール\n' +
          '  restore <backupDir> [--target h] バックアップを書き戻す'
        );
    }
  },

  serve(args) {
    process.env.ROKID_PORT = args[0] || process.env.ROKID_PORT || '4173';
    require('../server/server');
  },

  help() {
    out(HELP);
  },
};

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const fn = commands[cmd] || commands.help;
  const fail = (e) => {
    console.error('エラー: ' + e.message);
    process.exit(1);
  };
  try {
    const r = fn(rest);
    if (r && typeof r.catch === 'function') r.catch(fail); // 非同期コマンド対応
  } catch (e) {
    fail(e);
  }
}

main();
