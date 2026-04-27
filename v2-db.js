// ============================================================
// v2-db.js — IndexedDB v3 + 全ストアCRUD
// ============================================================

const DB_NAME = 'StoryCanvasDB';
const DB_VERSION = 3;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      // v1互換: 参照画像
      if (!db.objectStoreNames.contains('referenceImages')) {
        db.createObjectStore('referenceImages', { keyPath: 'id' });
      }
      // v2互換: chapters（廃止予定だが残す）
      if (!db.objectStoreNames.contains('chapters')) {
        db.createObjectStore('chapters', { keyPath: 'key' });
      }
      // v3新規: 骨組み履歴
      if (!db.objectStoreNames.contains('skeletons')) {
        db.createObjectStore('skeletons', { keyPath: 'scene' });
      }
      // v3新規: キャラクター本文
      if (!db.objectStoreNames.contains('characterTexts')) {
        const s = db.createObjectStore('characterTexts', { keyPath: 'id' });
        s.createIndex('by_scene', 'scene');
        s.createIndex('by_character', 'character');
      }
      // v3新規: 客観記憶
      if (!db.objectStoreNames.contains('objectiveMemories')) {
        const s = db.createObjectStore('objectiveMemories', { keyPath: 'id' });
        s.createIndex('by_character', 'character');
      }
    };
  });
}

// ============================================================
// 汎用ヘルパー
// ============================================================

async function _dbPut(storeName, data) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put(data);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => { db.close(); resolve(true); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function _dbGet(storeName, key) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readonly');
  const req = tx.objectStore(storeName).get(key);
  return new Promise((resolve, reject) => {
    req.onsuccess = () => { db.close(); resolve(req.result || null); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

async function _dbGetAll(storeName) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readonly');
  const req = tx.objectStore(storeName).getAll();
  return new Promise((resolve, reject) => {
    req.onsuccess = () => { db.close(); resolve(req.result || []); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

async function _dbGetByIndex(storeName, indexName, key) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readonly');
  const idx = tx.objectStore(storeName).index(indexName);
  const req = idx.getAll(key);
  return new Promise((resolve, reject) => {
    req.onsuccess = () => { db.close(); resolve(req.result || []); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

async function _dbDelete(storeName, key) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).delete(key);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => { db.close(); resolve(true); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

// ============================================================
// 参照画像（v5.6互換）
// ============================================================

async function saveImagesToDB(images) {
  try {
    const db = await openDB();
    const tx = db.transaction('referenceImages', 'readwrite');
    const store = tx.objectStore('referenceImages');
    store.clear();
    images.forEach(img => store.put(img));
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch (e) { console.error('IndexedDB save error:', e); return false; }
}

async function loadImagesFromDB() {
  try { return await _dbGetAll('referenceImages'); }
  catch (e) { console.error('IndexedDB load error:', e); return []; }
}

// ============================================================
// 骨組み履歴 (skeletons)
// ============================================================

/**
 * 骨組みを保存（上書き）
 * @param {string} sceneKey - "A"
 * @param {Object} skeletonData - { scene, sceneTag, characters, lastEventNum, events }
 */
async function saveSkeletonToDB(sceneKey, skeletonData) {
  skeletonData.scene = sceneKey;
  return _dbPut('skeletons', skeletonData);
}

async function loadSkeletonFromDB(sceneKey) {
  return _dbGet('skeletons', sceneKey);
}

async function loadAllSkeletonsFromDB() {
  return _dbGetAll('skeletons');
}

/**
 * 骨組みにイベントを追記
 */
async function appendSkeletonEvents(sceneKey, newEvents, sceneTag, characters) {
  let existing = await loadSkeletonFromDB(sceneKey);
  if (!existing) {
    existing = { scene: sceneKey, sceneTag: sceneTag || '', characters: characters || [], lastEventNum: 0, events: {} };
  }
  for (const [eventId, eventData] of Object.entries(newEvents)) {
    existing.events[eventId] = eventData;
    const numStr = eventId.split('-')[1];
    const num = parseInt(numStr, 10);
    if (num > existing.lastEventNum) existing.lastEventNum = num;
  }
  if (sceneTag) existing.sceneTag = sceneTag;
  if (characters && characters.length) existing.characters = characters;
  return saveSkeletonToDB(sceneKey, existing);
}

/**
 * タグ配列から関連する骨組みイベントを検索
 * @param {string[]} tags - ["A-003-ルミア", "B-012-エルザ"]
 * @returns {Object} { "A-003": eventData, ... }
 */
async function grepSkeletonByTags(tags) {
  if (!tags || tags.length === 0) return {};
  const sceneKeys = new Set();
  const eventIds = new Set();
  for (const tag of tags) {
    const r = resolveTag(tag);
    if (r) {
      sceneKeys.add(r.scene);
      eventIds.add(r.scene + '-' + r.num);
    }
  }
  const result = {};
  for (const sk of sceneKeys) {
    const skeleton = await loadSkeletonFromDB(sk);
    if (!skeleton || !skeleton.events) continue;
    for (const eid of eventIds) {
      if (skeleton.events[eid]) result[eid] = skeleton.events[eid];
    }
  }
  return result;
}

// ============================================================
// キャラクター本文 (characterTexts)
// ============================================================

/**
 * キャラ本文を保存
 * @param {string} sceneKey - "A"
 * @param {string} charName - "ルミア"
 * @param {Object} paragraphs - { "A-008-ルミア": { text, skeleton_ref, generated_at } }
 */
async function saveCharacterTextToDB(sceneKey, charName, paragraphs) {
  const id = sceneKey + '_' + charName;
  const data = { id, scene: sceneKey, character: charName, paragraphs };
  return _dbPut('characterTexts', data);
}

async function loadCharacterTextFromDB(sceneKey, charName) {
  const id = sceneKey + '_' + charName;
  return _dbGet('characterTexts', id);
}

async function loadCharacterTextsByScene(sceneKey) {
  return _dbGetByIndex('characterTexts', 'by_scene', sceneKey);
}

async function loadCharacterTextsByCharacter(charName) {
  return _dbGetByIndex('characterTexts', 'by_character', charName);
}

/**
 * キャラ本文に段落を追記（既存段落は上書き）
 */
async function appendCharacterText(sceneKey, charName, newParagraphs) {
  let existing = await loadCharacterTextFromDB(sceneKey, charName);
  if (!existing) {
    existing = { id: sceneKey + '_' + charName, scene: sceneKey, character: charName, paragraphs: {} };
  }
  Object.assign(existing.paragraphs, newParagraphs);
  return _dbPut('characterTexts', existing);
}

/**
 * タグ配列から関連するキャラ本文を検索
 * @param {string[]} tags - ["A-003-ルミア", "B-012-エルザ"]
 * @returns {Object} { "A-003-ルミア": { text, ... }, ... }
 */
async function grepCharacterTextByTags(tags) {
  if (!tags || tags.length === 0) return {};
  const fileKeys = new Map(); // fileKey → [tag, ...]
  for (const tag of tags) {
    const fk = tagToFileKey(tag);
    if (fk) {
      if (!fileKeys.has(fk)) fileKeys.set(fk, []);
      fileKeys.get(fk).push(tag);
    }
  }
  const result = {};
  for (const [fk, fkTags] of fileKeys) {
    const doc = await _dbGet('characterTexts', fk);
    if (!doc || !doc.paragraphs) continue;
    for (const tag of fkTags) {
      if (doc.paragraphs[tag]) result[tag] = doc.paragraphs[tag];
    }
  }
  return result;
}

// ============================================================
// 客観記憶 (objectiveMemories)
// ============================================================

/**
 * 客観記憶を保存
 * @param {string} charName
 * @param {Object} memoryEntry - { summary, source: [tag], scene, timestamp }
 */
async function saveObjectiveMemory(charName, memoryEntry) {
  const id = charName;
  let existing = await _dbGet('objectiveMemories', id);
  if (!existing) {
    existing = { id, character: charName, memories: [] };
  }
  memoryEntry.id = memoryEntry.id || ('mem_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
  existing.memories.push(memoryEntry);
  return _dbPut('objectiveMemories', existing);
}

async function loadObjectiveMemories(charName) {
  const doc = await _dbGet('objectiveMemories', charName);
  return doc ? doc.memories : [];
}

async function loadAllObjectiveMemories() {
  return _dbGetAll('objectiveMemories');
}

/**
 * キャラの客観記憶を全件上書き保存
 */
async function replaceObjectiveMemories(charName, memories) {
  return _dbPut('objectiveMemories', { id: charName, character: charName, memories });
}

/**
 * 指定キャラの客観記憶から特定IDを削除
 */
async function deleteObjectiveMemory(charName, memId) {
  const doc = await _dbGet('objectiveMemories', charName);
  if (!doc) return;
  doc.memories = doc.memories.filter(m => m.id !== memId);
  return _dbPut('objectiveMemories', doc);
}
