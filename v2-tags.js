// ============================================================
// v2-tags.js — タグシステム（段落タグ解決・ファイルキー変換）
// ============================================================

/**
 * 段落タグを解析する
 * "[A-003-ルミア]" or "A-003-ルミア" → { scene: "A", num: "003", entity: "ルミア" }
 */
function resolveTag(tag) {
  const cleaned = tag.replace(/^\[|\]$/g, '');
  const m = cleaned.match(/^([A-Z]{1,2})-(\d{3})-(.+)$/);
  if (!m) return null;
  return { scene: m[1], num: m[2], entity: m[3] };
}

/**
 * タグからIndexedDBのキーを生成
 * "A-003-ルミア" → "A_ルミア"
 */
function tagToFileKey(tag) {
  const r = resolveTag(tag);
  if (!r) return null;
  return r.scene + '_' + r.entity;
}

/**
 * タグからシーンキーを取得
 * "A-003-ルミア" → "A"
 */
function tagToSceneKey(tag) {
  const r = resolveTag(tag);
  return r ? r.scene : null;
}

/**
 * イベント番号を生成（3桁ゼロパディング）
 * @param {number} num
 * @returns {string} "001", "012", "123"
 */
function formatEventNum(num) {
  return String(num).padStart(3, '0');
}

/**
 * イベントIDを生成
 * @param {string} sceneKey - "A"
 * @param {number} num - 3
 * @returns {string} "A-003"
 */
function makeEventId(sceneKey, num) {
  return sceneKey + '-' + formatEventNum(num);
}

/**
 * 完全タグを生成
 * @param {string} sceneKey - "A"
 * @param {number} num - 3
 * @param {string} entity - "ルミア"
 * @returns {string} "A-003-ルミア"
 */
function makeFullTag(sceneKey, num, entity) {
  return sceneKey + '-' + formatEventNum(num) + '-' + entity;
}

/**
 * 次のシーンキーを取得
 * "A" → "B", "Z" → "AA"
 */
function nextSceneKey(currentKey) {
  if (currentKey.length === 1) {
    if (currentKey === 'Z') return 'AA';
    return String.fromCharCode(currentKey.charCodeAt(0) + 1);
  }
  const last = currentKey.charCodeAt(currentKey.length - 1);
  if (last < 90) return currentKey.slice(0, -1) + String.fromCharCode(last + 1);
  return currentKey + 'A';
}
