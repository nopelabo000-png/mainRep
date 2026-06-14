'use strict';

/**
 * 実機(グラス)連携モジュール — TCP 接続(adb over WiFi)で
 *  1. Rokid デフォルトアプリのバックアップ（APK を端末から吸い出す）
 *  2. 作成アプリのインポート（ビルド済み APK を端末へインストール）
 * を行う。
 *
 * Rokid Glasses は YodaOS(Android 12) のため、開発は adb で行える。
 * USB で一度 `adb tcpip` を有効化すれば、以降は WiFi 上の TCP 接続
 * (既定 5555) だけでバックアップ/インストールが完結する。
 *
 * 依存ゼロ: Node 標準の child_process のみを使用。
 * adb バイナリのパスは環境変数 ROKID_ADB で差し替え可能（既定 'adb'）。
 * ROKID_ADB_DRYRUN=1 で実行せずコマンドだけ返す（テスト/確認用）。
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const registry = require('./registry');

const ADB = process.env.ROKID_ADB || 'adb';
const DEFAULT_PORT = 5555;
const BACKUP_DIR = path.join(registry.ROOT, 'backups');

/** host だけ渡された場合は :5555 を補う。 */
function normalizeTarget(t) {
  if (!t) return null;
  return /:\d+$/.test(t) ? t : `${t}:${DEFAULT_PORT}`;
}

function sel(target) {
  return target ? ['-s', target] : [];
}

// ---- 純粋なコマンド組み立て（副作用なし・テスト対象）----
const cmd = {
  tcpip: (port = DEFAULT_PORT) => ['tcpip', String(port)],
  connect: (target) => ['connect', target],
  disconnect: (target) => (target ? ['disconnect', target] : ['disconnect']),
  devices: () => ['devices', '-l'],
  listPackages: ({ system, third, target } = {}) => {
    const a = [...sel(target), 'shell', 'pm', 'list', 'packages', '-f'];
    if (system) a.push('-s');
    else if (third) a.push('-3');
    return a;
  },
  pathOf: (pkg, target) => [...sel(target), 'shell', 'pm', 'path', pkg],
  pull: (remote, local, target) => [...sel(target), 'pull', remote, local],
  install: (apk, target) => [...sel(target), 'install', '-r', apk],
};

/** adb を実行し stdout を返す。DRYRUN 時はコマンド文字列を返す。 */
function run(args) {
  if (process.env.ROKID_ADB_DRYRUN === '1') {
    return `[dry-run] ${ADB} ${args.join(' ')}`;
  }
  try {
    return execFileSync(ADB, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
  } catch (e) {
    if (e.code === 'ENOENT') {
      throw new Error(`adb が見つかりません。Android Platform Tools を入れるか ROKID_ADB を設定してください。`);
    }
    const msg = (e.stderr || e.stdout || e.message || '').toString().trim();
    throw new Error(`adb 失敗: ${msg}`);
  }
}

/** `pm list packages -f` / `pm path` 出力を {pkg, apk} 配列へ。 */
function parsePackages(output) {
  const out = [];
  for (const line of String(output).split('\n')) {
    const m = line.trim().match(/^package:(.+\.apk)=([\w.]+)$/);
    if (m) out.push({ apk: m[1], pkg: m[2] });
  }
  return out;
}

/** `pm path <pkg>` 出力（package:/path のみ）を APK パス配列へ。 */
function parsePaths(output) {
  const out = [];
  for (const line of String(output).split('\n')) {
    const m = line.trim().match(/^package:(.+)$/);
    if (m) out.push(m[1]);
  }
  return out;
}

// ---- 接続まわり ----

/** USB 接続中の端末を TCP モードへ（以降 WiFi で接続可能になる）。 */
function enableTcpip(port = DEFAULT_PORT) {
  return run(cmd.tcpip(port));
}

/** TCP で端末へ接続。host のみなら :5555 を補う。 */
function connect(target) {
  const t = normalizeTarget(target);
  if (!t) throw new Error('接続先を指定してください（例: 192.168.1.50 もしくは 192.168.1.50:5555）');
  return run(cmd.connect(t));
}

function disconnect(target) {
  return run(cmd.disconnect(normalizeTarget(target)));
}

function devices() {
  return run(cmd.devices());
}

/** 端末上のパッケージ一覧（既定はシステム=プリインアプリ）。 */
function listPackages({ system = true, third = false, target } = {}) {
  const t = normalizeTarget(target);
  return parsePackages(run(cmd.listPackages({ system, third, target: t })));
}

// ---- ① デフォルトアプリのバックアップ ----

/**
 * 端末のアプリ APK を吸い出して backups/<serial>/ に保存する。
 * @param {object} opts
 *   target        接続先（host[:port]）
 *   system        システム(プリイン)アプリを対象に含む（既定 true）
 *   third         サードパーティのみ対象（system より優先）
 *   filter        パッケージ名フィルタ（部分一致 or 正規表現文字列）
 *   outDir        保存先（既定 backups/<target|local>/）
 * @returns {object} { dir, count, packages }
 */
function backup(opts = {}) {
  const target = normalizeTarget(opts.target);
  const useThird = !!opts.third;
  const pkgs = listPackages({ system: !useThird && opts.system !== false, third: useThird, target });

  let filtered = pkgs;
  if (opts.filter) {
    const re = new RegExp(opts.filter);
    filtered = pkgs.filter((p) => re.test(p.pkg));
  }

  const label = (target || 'device').replace(/[^\w.-]/g, '_');
  const dir = opts.outDir || path.join(BACKUP_DIR, label);
  fs.mkdirSync(dir, { recursive: true });

  const saved = [];
  for (const p of filtered) {
    // split APK にも対応するため pm path で全パスを取得
    const paths = parsePaths(run(cmd.pathOf(p.pkg, target)));
    const list = paths.length ? paths : [p.apk];
    const pkgDir = path.join(dir, p.pkg);
    fs.mkdirSync(pkgDir, { recursive: true });
    const localApks = [];
    list.forEach((remote, i) => {
      const base = path.basename(remote) || (list.length > 1 ? `split_${i}.apk` : 'base.apk');
      const local = path.join(pkgDir, base);
      run(cmd.pull(remote, local, target));
      localApks.push(path.relative(dir, local));
    });
    saved.push({ pkg: p.pkg, apks: localApks });
  }

  const manifest = {
    schema: 'rokid-backup/v1',
    target: target || null,
    createdAt: new Date().toISOString(),
    count: saved.length,
    packages: saved,
  };
  fs.writeFileSync(path.join(dir, 'backup.json'), JSON.stringify(manifest, null, 2));
  return { dir, count: saved.length, packages: saved };
}

// ---- ② 作成アプリのインポート（インストール）----

/** apps/<id>/build/outputs/apk 配下のビルド済み APK を探す。 */
function findApk(id) {
  const base = path.join(registry.appDir(id), 'build', 'outputs', 'apk');
  if (!fs.existsSync(base)) return null;
  const found = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.apk')) found.push(full);
    }
  })(base);
  // debug より release を優先、その中で新しいもの
  found.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return found[0] || null;
}

/**
 * 作成アプリ（id）または APK パスを端末へインストールする。
 * @returns {object} { apk, result }
 */
function installApp(idOrApk, opts = {}) {
  const target = normalizeTarget(opts.target);
  let apk = idOrApk;
  if (registry.get(idOrApk)) {
    apk = findApk(idOrApk);
    if (!apk) {
      throw new Error(
        `ビルド済み APK が見つかりません: ${idOrApk}\n` +
        `先に apps/${idOrApk} で ./gradlew assembleDebug を実行してください。`
      );
    }
  } else if (!fs.existsSync(idOrApk)) {
    throw new Error(`アプリIDでもAPKパスでもありません: ${idOrApk}`);
  }
  return { apk, result: run(cmd.install(apk, target)) };
}

/** バックアップディレクトリの APK 群を端末へ書き戻す（リストア）。 */
function restore(dir, opts = {}) {
  const target = normalizeTarget(opts.target);
  const manifestPath = path.join(dir, 'backup.json');
  let apks = [];
  if (fs.existsSync(manifestPath)) {
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    // split があるパッケージはまとめて install-multiple が必要だが、
    // ここでは単一 base のみ対応（split は要 adb install-multiple）。
    for (const p of m.packages) {
      const single = p.apks.filter((a) => a.endsWith('.apk'));
      if (single.length === 1) apks.push(path.join(dir, single[0]));
    }
  } else {
    throw new Error(`backup.json がありません: ${dir}`);
  }
  const results = apks.map((apk) => ({ apk, result: run(cmd.install(apk, target)) }));
  return { count: results.length, results };
}

module.exports = {
  ADB,
  DEFAULT_PORT,
  BACKUP_DIR,
  cmd,
  normalizeTarget,
  parsePackages,
  parsePaths,
  findApk,
  enableTcpip,
  connect,
  disconnect,
  devices,
  listPackages,
  backup,
  installApp,
  restore,
};
