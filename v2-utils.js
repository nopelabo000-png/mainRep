// ============================================================
// v2-utils.js — ユーティリティ + Gemini API呼び出し
// ============================================================

// ============================================================
// Gemini API
// ============================================================

async function geminiApiFetch(url, body, label, maxRetries = 4) {
  let lastError = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    let apiKey = state.apiKey;
    if (attempt > 0 && state.apiKeys && state.apiKeys.length > 1) {
      apiKey = state.apiKeys[attempt % state.apiKeys.length] || state.apiKey;
    }
    const fetchUrl = url.replace(/key=[^&]+/, 'key=' + apiKey);
    if (attempt > 0) {
      const waitSec = Math.min(5 * Math.pow(2, attempt - 1), 30);
      addLog('🔄 ' + label + ' リトライ ' + attempt + '/' + (maxRetries - 1) + '（' + waitSec + '秒後' +
        (apiKey !== state.apiKey ? ', 別キー' : '') + '）', 'info');
      await new Promise(r => setTimeout(r, waitSec * 1000));
    }
    try {
      const res = await fetch(fetchUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.status === 503 || res.status === 429) {
        const errText = await res.text().catch(() => '');
        addLog('⚠️ ' + label + ' HTTP ' + res.status + ': ' + errText.substring(0, 120), 'warning');
        lastError = new Error(label + ' HTTP ' + res.status);
        continue;
      }
      if (!res.ok) throw new Error(label + ' API Error: ' + res.status);
      return await res.json();
    } catch (e) {
      if (e.message.includes('HTTP 503') || e.message.includes('HTTP 429')) {
        lastError = e; continue;
      }
      throw e;
    }
  }
  throw lastError || new Error(label + ' 全リトライ失敗');
}

function getGeminiUrl(modelKey) {
  const m = MODELS.text[modelKey] || MODELS.image[modelKey] || MODELS.tts[modelKey] || MODELS.embedding[modelKey];
  if (!m) return '';
  return 'https://generativelanguage.googleapis.com/v1beta/models/' + m.endpoint + ':generateContent?key=' + state.apiKey;
}

// ============================================================
// OpenRouter API
// ============================================================

async function openrouterApiFetch(body, label, modelKey, maxRetries = 4) {
  const m = MODELS.text[modelKey];
  if (!m) throw new Error('OpenRouter: モデル未定義: ' + modelKey);
  if (!state.openrouterApiKey) throw new Error('OpenRouter: APIキー未設定');

  // モデル別プロファイル取得
  var profile = (typeof getModelProfile === 'function') ? getModelProfile(modelKey) : { jsonMode: 'response_format', systemRole: 'message', tempBias: 0 };
  var wantsJson = body.generationConfig && body.generationConfig.responseMimeType === 'application/json';

  // system_instruction の本文抽出
  var systemText = '';
  if (body.system_instruction && body.system_instruction.parts) {
    systemText = body.system_instruction.parts.map(function(p) { return p.text || ''; }).join('\n');
  }

  // JSON モード = 'instruction' の場合、systemTextに JSON 強制ヒントを追記
  if (wantsJson && profile.jsonMode === 'instruction' && profile.jsonHint) {
    systemText = systemText + profile.jsonHint;
  } else if (wantsJson && profile.jsonHint && profile.systemRole === 'merge') {
    // Gemma系: response_format対応でも、merge時は補強しておくと安定する
    systemText = systemText + profile.jsonHint;
  }

  // メッセージ列を構築
  var messages = [];
  var systemRole = profile.systemRole || 'message';

  if (systemText && systemRole === 'message') {
    messages.push({ role: 'system', content: systemText });
  }

  if (body.contents) {
    body.contents.forEach(function(c, idx) {
      var role = c.role === 'model' ? 'assistant' : 'user';
      var contentParts = [];
      if (c.parts) {
        c.parts.forEach(function(p) {
          if (p.text) contentParts.push({ type: 'text', text: p.text });
          else if (p.inlineData) contentParts.push({ type: 'image_url', image_url: { url: 'data:' + p.inlineData.mimeType + ';base64,' + p.inlineData.data } });
        });
      }
      // 最初のuserメッセージにsystemをマージ／プレフィクス付与
      var isFirstUser = (idx === 0 && role === 'user');
      if (isFirstUser && systemText && systemRole === 'merge') {
        var merged = systemText + '\n\n---\n\n' + (contentParts.find(function(cp) { return cp.type === 'text'; }) || {}).text;
        contentParts = [{ type: 'text', text: merged }].concat(contentParts.filter(function(cp) { return cp.type !== 'text'; }));
      }
      if (isFirstUser && profile.prefix) {
        var firstText = contentParts.find(function(cp) { return cp.type === 'text'; });
        if (firstText) firstText.text = profile.prefix + firstText.text;
      }
      if (contentParts.length === 1 && contentParts[0].type === 'text') {
        messages.push({ role: role, content: contentParts[0].text });
      } else if (contentParts.length > 0) {
        messages.push({ role: role, content: contentParts });
      }
    });
  }

  // 温度・トークン上限の調整
  var baseTemp = (body.generationConfig && body.generationConfig.temperature != null) ? body.generationConfig.temperature : 0.7;
  var adjTemp = Math.max(0, Math.min(2, baseTemp + (profile.tempBias || 0)));
  var baseMax = (body.generationConfig && body.generationConfig.maxOutputTokens) || 16384;
  var adjMax = profile.maxTokensCap ? Math.min(baseMax, profile.maxTokensCap) : baseMax;

  var orBody = {
    model: m.endpoint,
    messages: messages,
    max_tokens: adjMax,
    temperature: adjTemp
  };

  // JSON mode (response_format)
  if (wantsJson && profile.jsonMode === 'response_format') {
    orBody.response_format = { type: 'json_object' };
  } else if (wantsJson && profile.jsonMode === 'mime') {
    // OpenRouter経由でも mime指定ベースなら一応 response_format を付ける
    orBody.response_format = { type: 'json_object' };
  }
  // jsonMode==='instruction' の場合は response_format を付けない (Hy3 等の非対応モデル)

  addLog('🌐 OpenRouter [' + label + '] ' + modelKey + ' (jsonMode=' + (profile.jsonMode || '-') + ', sysRole=' + systemRole + ', T=' + adjTemp.toFixed(2) + ')', 'info');

  var lastError = null;
  for (var attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      var waitSec = Math.min(8 * Math.pow(2, attempt - 1), 60);
      addLog('🔄 OpenRouter ' + label + ' リトライ ' + attempt + '/' + (maxRetries - 1) + '（' + waitSec + '秒後）', 'info');
      await new Promise(function(r) { setTimeout(r, waitSec * 1000); });
    }
    try {
      var res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + state.openrouterApiKey,
          'HTTP-Referer': location.href,
          'X-Title': 'Story Canvas v2'
        },
        body: JSON.stringify(orBody)
      });
      if (res.status === 429 || res.status === 503) {
        var errText = await res.text().catch(function() { return ''; });
        addLog('⚠️ OpenRouter ' + label + ' HTTP ' + res.status + ': ' + errText.substring(0, 120), 'warning');
        lastError = new Error('OpenRouter ' + label + ' HTTP ' + res.status);
        continue;
      }
      if (!res.ok) {
        var et = await res.text().catch(function() { return ''; });
        throw new Error('OpenRouter ' + label + ' Error ' + res.status + ': ' + et.substring(0, 200));
      }
      var data = await res.json();

      // OpenAI response → Gemini response format に変換
      var text = '';
      if (data.choices && data.choices[0] && data.choices[0].message) {
        text = data.choices[0].message.content || '';
      }
      addLog('🌐 OpenRouter ' + label + ' 完了 (' + (data.usage ? data.usage.total_tokens + 'tok' : '?') + ')', 'success');
      return {
        candidates: [{ content: { parts: [{ text: text }], role: 'model' }, finishReason: 'STOP' }],
        usageMetadata: data.usage ? { promptTokenCount: data.usage.prompt_tokens, candidatesTokenCount: data.usage.completion_tokens, totalTokenCount: data.usage.total_tokens } : {}
      };
    } catch (e) {
      if (e.message.includes('HTTP 429') || e.message.includes('HTTP 503')) {
        lastError = e; continue;
      }
      throw e;
    }
  }
  throw lastError || new Error('OpenRouter ' + label + ' 全リトライ失敗');
}

// ============================================================
// 統合テキストAPIルーター
// ============================================================

async function textApiFetch(body, label, modelKeyOverride) {
  var modelKey = modelKeyOverride || state.selectedTextModel;
  var m = MODELS.text[modelKey];
  if (!m) throw new Error('モデル未定義: ' + modelKey);

  if (m.provider === 'openrouter') {
    if (!state.openrouterReady) throw new Error('OpenRouter APIキーが未設定です');
    return await openrouterApiFetch(body, label, modelKey);
  } else {
    var url = getGeminiUrl(modelKey);
    if (!url) throw new Error('Gemini URL生成失敗: ' + modelKey);
    return await geminiApiFetch(url, body, label);
  }
}

// ============================================================
// API接続
// ============================================================

function saveApiKey() {
  if (!els.apiKeyInput) {
    addLog('❌ apiKeyInput 要素が見つかりません', 'error');
    showMessage('❌ APIキー入力欄が見つかりません', 'error');
    return;
  }
  const raw = els.apiKeyInput.value.trim();
  if (!raw) {
    state.apiKey = '';
    state.apiKeys = [];
    updateAPIStatus();
    saveToStorage();
    addLog('⚠️ Gemini APIキーが空です', 'warning');
    showMessage('❌ Gemini APIキーを入力してください', 'error');
    return;
  }
  const keys = raw.split(/[,\s]+/).map(k => k.trim()).filter(k => k.length >= 8);
  if (keys.length === 0) {
    addLog('⚠️ Gemini APIキーが短すぎます（8文字以上必須）', 'warning');
    showMessage('❌ APIキーが短すぎます (8文字以上必須)', 'error');
    return;
  }
  state.apiKey = keys[0];
  state.apiKeys = keys;
  updateAPIStatus();
  saveToStorage();
  addLog('🔑 Gemini APIキー設定完了: ' + keys.length + '個', 'success');
  showMessage('✅ Gemini APIキー設定完了 (' + keys.length + '個)', 'success');
}

function saveOpenrouterKey() {
  if (!els.openrouterApiKey) {
    addLog('❌ openrouterApiKey 要素が見つかりません', 'error');
    showMessage('❌ OpenRouterキー入力欄が見つかりません', 'error');
    return;
  }
  var key = els.openrouterApiKey.value.trim();
  if (!key) {
    state.openrouterApiKey = '';
    state.openrouterReady = false;
    updateAPIStatus();
    saveToStorage();
    addLog('⚠️ OpenRouter APIキーが空です', 'warning');
    showMessage('❌ OpenRouter APIキーを入力してください', 'error');
    return;
  }
  if (key.length < 8) {
    addLog('⚠️ OpenRouter APIキーが短すぎます（8文字以上必須）', 'warning');
    showMessage('❌ OpenRouter APIキーが短すぎます (8文字以上必須)', 'error');
    return;
  }
  state.openrouterApiKey = key;
  state.openrouterReady = true;
  updateAPIStatus();
  saveToStorage();
  addLog('🌐 OpenRouter APIキー設定完了', 'success');
  showMessage('✅ OpenRouter APIキー設定完了', 'success');
}

function isTextReady() {
  var m = MODELS.text[state.selectedTextModel];
  if (!m) return false;
  if (m.provider === 'openrouter') return state.openrouterReady;
  return state.isReady;
}

function updateAPIStatus() {
  state.isReady = state.apiKey.length > 0;
  if (els.statusDot) els.statusDot.classList.toggle('ready', state.isReady);
  if (els.openrouterStatusDot) els.openrouterStatusDot.classList.toggle('ready', state.openrouterReady);
  // ドロップダウンの値を復元
  if (els.apiKeyInput && state.apiKey) els.apiKeyInput.value = state.apiKeys.length > 1 ? state.apiKeys.join(',') : state.apiKey;
  if (els.openrouterApiKey && state.openrouterApiKey) els.openrouterApiKey.value = state.openrouterApiKey;
  if (els.textModel) els.textModel.value = state.selectedTextModel;
  if (els.imageModel) els.imageModel.value = state.selectedImageModel;
  if (els.ttsModel) els.ttsModel.value = state.selectedTTSModel;
  if (els.embeddingModel) els.embeddingModel.value = state.selectedEmbeddingModel;
  if (els.sdWebuiUrl && state.sdWebuiUrl) els.sdWebuiUrl.value = state.sdWebuiUrl;
  if (els.runpodApiKey && state.runpodApiKey) els.runpodApiKey.value = state.runpodApiKey;
  if (els.runpodEndpointId && state.runpodEndpointId) els.runpodEndpointId.value = state.runpodEndpointId;
}

function repairJSON(text) {
  let s = text;
  s = s.replace(/,\s*([\]}])/g, '$1');
  s = s.replace(/"([^"]*?)"/g, (match, inner) => {
    return '"' + inner.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';
  });
  const stack = [];
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' && (i === 0 || s[i - 1] !== '\\')) { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') stack.push('}');
    else if (c === '[') stack.push(']');
    else if (c === '}' || c === ']') stack.pop();
  }
  if (inStr) s += '"';
  s = s.replace(/,\s*$/, '');
  while (stack.length > 0) s += stack.pop();
  return s;
}

function safeParseJSON(text, label = '') {
  try { return JSON.parse(text); } catch (e1) {
    addLog('⚠️ JSON直接パース失敗' + (label ? '(' + label + ')' : '') + ': ' + e1.message.substring(0, 80), 'warning');
  }
  try {
    const repaired = repairJSON(text);
    const result = JSON.parse(repaired);
    addLog('🔧 JSON修復成功' + (label ? '(' + label + ')' : ''), 'info');
    return result;
  } catch (e2) {
    addLog('❌ JSON修復後もパース失敗: ' + e2.message.substring(0, 80), 'error');
    throw e2;
  }
}

// ============================================================
// UI ユーティリティ
// ============================================================

function dbg(id, text) {
  const el = els[id];
  if (el) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') el.value = text;
    else el.textContent = text;
  }
}

function showMessage(t, type) {
  if (els.messageArea) {
    els.messageArea.innerHTML = '<div class="message ' + type + '">' + t + '</div>';
    if (type === 'success') setTimeout(() => { if (els.messageArea) els.messageArea.innerHTML = ''; }, 4000);
  }
}

function addLog(msg, type) {
  type = type || 'info';
  const time = new Date().toLocaleTimeString();
  state.logs.push({ msg, type, time });
  if (state.logs.length > 200) state.logs.shift();
  if (els.logContent) {
    const div = document.createElement('div');
    div.className = 'log-entry log-' + type;
    div.innerHTML = '<span class="log-time">' + time + '</span> ' + msg;
    els.logContent.appendChild(div);
    els.logContent.scrollTop = els.logContent.scrollHeight;
  }
}

function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ============================================================
// キャラクター作成
// ============================================================

function createEmptyCharacter() {
  const char = { active: true, base: {}, recent: {}, memories: [], referenceImages: [], writerMode: 'ai' };
  Object.values(CHAR_FIELDS).forEach(section => {
    section.forEach(f => {
      if (f.key.startsWith('current') || f.key === 'clothingState') {
        char.recent[f.key] = '';
      } else {
        char.base[f.key] = f.default || '';
      }
    });
  });
  return char;
}

function addCharacter() {
  state.situation.who.push(createEmptyCharacter());
  renderCharacters();
  saveToStorage();
}

// ============================================================
// API接続 (SD WebUI / RunPod)
// ============================================================

async function connectToSDWebUI() {
  const url = els.sdWebuiUrl.value.trim();
  if (!url) return;
  state.sdWebuiUrl = url;
  try {
    const res = await fetch(url + '/sdapi/v1/sd-models');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    state.sdModels = await res.json();
    state.sdConnected = true;
    els.sdStatusDot.classList.add('ready');
    addLog('🎨 SD WebUI接続成功: ' + state.sdModels.length + 'モデル', 'success');
    saveToStorage();
  } catch (e) {
    state.sdConnected = false;
    els.sdStatusDot.classList.remove('ready');
    addLog('❌ SD WebUI接続失敗: ' + e.message, 'error');
  }
}

async function connectToRunPod() {
  const apiKey = els.runpodApiKey.value.trim();
  const endpointId = els.runpodEndpointId.value.trim();
  if (!apiKey || !endpointId) {
    addLog('⚠️ RunPod APIキーとEndpoint IDを入力してください', 'warning');
    return;
  }
  state.runpodApiKey = apiKey;
  state.runpodEndpointId = endpointId;
  try {
    const res = await fetch('https://api.runpod.ai/v2/' + endpointId + '/health', {
      headers: { 'Authorization': 'Bearer ' + apiKey }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    state.runpodConnected = true;
    els.runpodStatusDot.classList.add('ready');
    addLog('🚀 RunPod接続成功: workers=' + (data.workers ? JSON.stringify(data.workers) : 'N/A'), 'success');
    saveToStorage();
  } catch (e) {
    state.runpodConnected = false;
    els.runpodStatusDot.classList.remove('ready');
    addLog('❌ RunPod接続失敗: ' + e.message, 'error');
  }
}

// ============================================================
// 画像リサイズ
// ============================================================

async function resizeBase64Image(base64DataUri, maxWidth, maxHeight, quality, format) {
  maxWidth = maxWidth || 1024;
  maxHeight = maxHeight || 1024;
  quality = quality || 0.85;
  format = format || 'jpeg';
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxWidth || h > maxHeight) {
        const ratio = Math.min(maxWidth / w, maxHeight / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/' + format, quality));
    };
    img.onerror = reject;
    img.src = base64DataUri;
  });
}

// ============================================================
// 参照画像関連
// ============================================================

function collectActiveReferenceImages() {
  const entries = [];
  state.situation.who
    .filter(function(c) { return c.active && c.referenceImages && c.referenceImages.length > 0; })
    .forEach(function(c) {
      var name = c.base.name || '不明';
      c.referenceImages.forEach(function(img) {
        if (img) entries.push({ name: name, image: img });
      });
    });
  return entries;
}

function buildReferenceImageParts(refEntries, maxImages) {
  maxImages = maxImages || 1;
  var parts = [];
  var labeledChars = new Set();
  refEntries.slice(0, maxImages).forEach(function(entry) {
    var img = typeof entry === 'string' ? entry : entry.image;
    var name = typeof entry === 'string' ? '' : entry.name;
    var m = img.match(/^data:image\/(\w+);base64,(.+)$/);
    if (m) {
      if (name && !labeledChars.has(name)) {
        labeledChars.add(name);
        parts.push({ text: '【' + name + 'の参考画像】以下は「' + name + '」の外見参考です。' });
      }
      parts.push({ inlineData: { mimeType: 'image/' + m[1], data: m[2] } });
    }
  });
  return parts;
}
