'use strict';

/**
 * MAC アドレスから LAN 内の IP を特定する。
 * Hi Rokid は MAC/シリアルは表示するが IP を表示しないため、
 * ここで MAC → IP を解決してから `rokid device connect <ip>` へ繋ぐ。
 *
 * 手法: ローカル /24 へ ping を一斉送信して OS の ARP テーブルを埋め、
 * `arp -a` の出力から MAC を照合する（Windows / macOS / Linux 対応・依存ゼロ）。
 */

const os = require('os');
const { execFile, execFileSync } = require('child_process');

/** "AA-BB-CC-DD-EE-FF" / "aa:bb:cc:dd:ee:ff" → "aabbccddeeff" */
function normalizeMac(mac) {
  return String(mac || '').toLowerCase().replace(/[^0-9a-f]/g, '');
}

/**
 * `arp -a` の出力を [{ip, mac}] へ。
 * macOS/Linux: "? (192.168.1.50) at a4:c1:38:aa:bb:cc on en0 ..."
 * Windows   : "  192.168.1.50          a4-c1-38-aa-bb-cc     dynamic"
 */
function parseArp(output) {
  const out = [];
  for (const line of String(output).split('\n')) {
    const ip = line.match(/\(?((?:\d{1,3}\.){3}\d{1,3})\)?/);
    const mac = line.match(/((?:[0-9a-fA-F]{1,2}[:-]){5}[0-9a-fA-F]{1,2})/);
    if (ip && mac && !line.includes('incomplete')) {
      out.push({ ip: ip[1], mac: normalizeMac(mac[1]) });
    }
  }
  return out;
}

/** 自マシンの IPv4 /24 サブネット基底 ("192.168.1") 一覧 */
function localSubnets() {
  const bases = new Set();
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === 'IPv4' && !i.internal) {
        bases.add(i.address.split('.').slice(0, 3).join('.'));
      }
    }
  }
  return [...bases];
}

/** base.1〜254 へ ping を打って ARP テーブルを埋める（応答は捨てる） */
function sweep(base, { concurrency = 64, timeoutMs = 400 } = {}) {
  const isWin = process.platform === 'win32';
  const ips = Array.from({ length: 254 }, (_, i) => `${base}.${i + 1}`);
  let idx = 0;
  return new Promise((resolve) => {
    let active = 0;
    const next = () => {
      while (active < concurrency && idx < ips.length) {
        const ip = ips[idx++];
        active++;
        const args = isWin
          ? ['-n', '1', '-w', String(timeoutMs), ip]
          : ['-c', '1', '-W', '1', ip];
        execFile('ping', args, { timeout: timeoutMs + 700 }, () => {
          active--;
          if (idx >= ips.length && active === 0) resolve();
          else next();
        });
      }
    };
    next();
  });
}

function arpTable() {
  // arp -a (Win/mac/多くのLinux) → ip neigh (iproute2のみのLinux) の順に試す
  const attempts = [
    ['arp', ['-a']],
    ['ip', ['neigh']],
  ];
  const errors = [];
  for (const [cmd, args] of attempts) {
    try {
      return parseArp(execFileSync(cmd, args, { encoding: 'utf8' }));
    } catch (e) {
      errors.push(`${cmd}: ${e.code || e.message}`);
    }
  }
  throw new Error('ARPテーブルを取得できません (' + errors.join(', ') + ')');
}

/**
 * MAC から IP を探す。
 * @returns {Promise<{ip, mac}|null>} 見つからなければ null
 */
async function findByMac(mac, { skipSweep = false } = {}) {
  const target = normalizeMac(mac);
  if (target.length !== 12) {
    throw new Error(`MAC アドレスの形式が不正です: ${mac}（例: A4:C1:38:12:34:56）`);
  }
  // まず既存の ARP キャッシュを見る（掃引不要で当たることも多い）
  let hit = arpTable().find((e) => e.mac === target);
  if (hit || skipSweep) return hit || null;
  // 無ければ全サブネットを掃引してから再照合
  for (const base of localSubnets()) {
    await sweep(base);
  }
  hit = arpTable().find((e) => e.mac === target);
  return hit || null;
}

/**
 * LAN を掃引し、見えた全端末 [{ip, mac}] を返す（デバッグ用）。
 * 目的の MAC が見つからない時、実際に何が見えているかを確認する。
 */
async function scan({ skipSweep = false } = {}) {
  if (!skipSweep) {
    for (const base of localSubnets()) await sweep(base);
  }
  // IP昇順で重複排除
  const seen = new Map();
  for (const e of arpTable()) if (!seen.has(e.ip)) seen.set(e.ip, e);
  return [...seen.values()].sort((a, b) => {
    const na = a.ip.split('.').map(Number);
    const nb = b.ip.split('.').map(Number);
    for (let i = 0; i < 4; i++) if (na[i] !== nb[i]) return na[i] - nb[i];
    return 0;
  });
}

module.exports = { normalizeMac, parseArp, localSubnets, sweep, arpTable, findByMac, scan };
