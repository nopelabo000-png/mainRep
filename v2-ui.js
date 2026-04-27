// ============================================================
// v2-ui.js — UI レンダリング + イベントリスナー
// ============================================================

// ============================================================
// 5W1H テキストレンダリング（v5.6移植）
// ============================================================

function render5W1HText(options) {
  options = options || {};
  const scope = options.scope || 'merged';
  const includeGlossary = options.includeGlossary !== false;
  const includeSpeechPattern = options.includeSpeechPattern || false;
  const includeRecent = options.includeRecent !== false;
  const includeMemories = options.includeMemories || false;
  const sanitize = options.sanitize || false;
  const charIndices = options.charIndices || null;
  const lines = [];

  const getVal = (section, field) => {
    const base = state.situation[section]?.base?.[field] || '';
    const recent = state.situation[section]?.recent?.[field] || '';
    if (scope === 'base') return base;
    if (scope === 'recent') return recent;
    return recent || base;
  };

  if (state.situation.where.active) {
    const parts = [];
    const name = getVal('where', 'name');
    const desc = getVal('where', 'description');
    const light = getVal('where', 'lighting');
    if (name) parts.push(name);
    if (desc) parts.push(desc);
    if (light) parts.push(light);
    if (parts.length) lines.push('【場所】' + parts.join('、'));
  }

  if (state.situation.when.active) {
    const parts = [];
    const time = getVal('when', 'timeOfDay');
    const weather = getVal('when', 'weather');
    if (time) parts.push(time);
    if (weather) parts.push(weather);
    if (parts.length) lines.push('【時間】' + parts.join('、'));
  }

  const charLines = [];
  const targetChars = charIndices
    ? charIndices.map(i => ({ index: i, char: state.situation.who[i] })).filter(c => c.char)
    : state.situation.who.map((char, i) => ({ index: i, char }));

  targetChars.forEach(({ index, char }) => {
    if (!char.active) return;
    const b = char.base;
    if (!b.name) return;
    const header = '■ ' + b.name + (b.species ? '（' + b.species + (b.gender ? '、' + (b.gender === 'female' ? '女性' : b.gender === 'male' ? '男性' : b.gender) : '') + '）' : '');
    charLines.push(header);
    const appearance = [];
    if (b.hairColor || b.hairStyle) appearance.push((b.hairColor || '') + (b.hairStyle || ''));
    if (b.eyeColor) appearance.push(b.eyeColor + 'の瞳');
    if (b.ears) appearance.push(b.ears);
    if (b.tail) appearance.push(b.tail);
    if (b.otherFeatures) appearance.push(b.otherFeatures);
    if (b.facialFeatures) appearance.push(b.facialFeatures);
    if (b.bodyType) appearance.push(b.bodyType);
    if (appearance.length) charLines.push('  外見: ' + appearance.join('、'));
    const clothing = (scope === 'merged' || scope === 'recent') ? (char.recent.clothingState || b.clothing) : (scope === 'base' ? b.clothing : char.recent.clothingState);
    if (clothing) charLines.push('  服装: ' + clothing);
    if (includeSpeechPattern && b.speechPattern) charLines.push('  口調: ' + b.speechPattern);
    if (includeRecent && (scope === 'merged' || scope === 'recent')) {
      const r = char.recent;
      const recentParts = [];
      if (r.currentPose) recentParts.push(r.currentPose);
      if (r.currentExpression) recentParts.push(r.currentExpression + 'な表情');
      if (r.currentAction) recentParts.push(r.currentAction);
      if (recentParts.length) charLines.push('  直近状態: ' + recentParts.join('、'));
    }
    if (includeGlossary && b.notes) charLines.push('  補足: ' + b.notes);
    if (b.values) charLines.push('  価値観: ' + b.values);
    if (b.relationships) charLines.push('  人間関係: ' + b.relationships);
    if (b.speciesBiology) charLines.push('  種族生態: ' + b.speciesBiology);
    if (includeMemories && char.memories && char.memories.length > 0) {
      charLines.push('  【過去の記憶】');
      char.memories.forEach((m, mi) => {
        const srcLabel = (m.source && m.source.length > 0) ? ' [出典:' + m.source.join(',') + ']' : '';
        const scnLabel = m.scene ? ' @' + m.scene : '';
        charLines.push('    ' + (mi + 1) + '. ' + (m.summary || '(空)') + srcLabel + scnLabel);
      });
    }
  });
  if (charLines.length) lines.push('【登場人物】\n' + charLines.join('\n'));

  if (state.situation.what.active) {
    const event = getVal('what', 'mainEvent');
    if (event) lines.push('【出来事】' + event);
  }
  if (state.situation.why.active) {
    const ctx = getVal('why', 'context');
    if (ctx) lines.push('【背景】' + ctx);
    const rules = state.situation.why.base.worldRules;
    if (rules) lines.push('【世界のルール】\n' + rules);
  }
  if (state.situation.how.active) {
    const mood = getVal('how', 'mood');
    if (mood) lines.push('【雰囲気】' + mood);
    const style = state.situation.how.base.narrativeStyle;
    if (style) lines.push('【文体】' + style);
  }
  if (includeGlossary) {
    const glossaryParts = [];
    const glossary = state.situation.why.base.glossary;
    if (glossary) glossary.split('\n').forEach(line => { if (line.trim()) glossaryParts.push('・' + line.trim()); });
    if (glossaryParts.length) lines.push('【補足】\n' + glossaryParts.join('\n'));
  }
  if (sanitize) lines.push('\n※ 上記の情報は画像生成用です。性的・暴力的な表現は穏やかな表現に置き換えてください。');
  return lines.join('\n');
}

// ============================================================
// パイプラインUI
// ============================================================

function updatePipelineUI() {
  const btn = els.generateBtn;
  const status = els.pipelineStatus;
  if (!btn || !status) return;
  const map = {
    'idle': { btn: '✨ 生成開始', status: '待機中', cls: 'idle' },
    'step0': { btn: '📋 コンテキスト収集...', status: 'Step 0', cls: 'running' },
    'step1': { btn: '🦴 骨組み生成...', status: 'Step 1', cls: 'running' },
    'step1_waiting': { btn: '🎮 プレイヤー入力待ち', status: '入力待ち', cls: 'waiting' },
    'step2': { btn: '📝 本文生成...', status: 'Step 2', cls: 'running' },
    'step2_editing': { btn: '✏️ プレイヤー編集待ち', status: '編集待ち', cls: 'waiting' },
    'step3': { btn: '⚙️ 後処理...', status: 'Step 3', cls: 'running' }
  };
  const m = map[state.pipeline.phase] || map.idle;
  btn.textContent = m.btn;
  btn.disabled = state.pipeline.phase !== 'idle';
  status.textContent = m.status;
  status.className = 'pipeline-status ' + m.cls;

  // プレイヤー送信ボタンのラベル更新
  const submitBtn = els.playerSubmitBtn;
  if (submitBtn) {
    const isWaiting = state.pipeline.phase === 'step1_waiting';
    const isIdle = state.pipeline.phase === 'idle';
    submitBtn.textContent = isWaiting ? '📝 送信 → 連鎖反応を継続' : '📝 送信 → 骨組み生成';
    submitBtn.disabled = !isIdle && !isWaiting;
  }
}

// ============================================================
// 骨組みビューア
// ============================================================

async function renderSkeletonViewer() {
  const viewer = els.skeletonViewer;
  if (!viewer) return;
  const skeleton = await loadSkeletonFromDB(state.currentScene.key);
  if (!skeleton || !skeleton.events || Object.keys(skeleton.events).length === 0) {
    viewer.innerHTML = '<p style="font-size:0.75rem;color:var(--text-muted);text-align:center;padding:1rem;">骨組みなし</p>';
    return;
  }
  let html = '';
  for (const [eventId, event] of Object.entries(skeleton.events)) {
    html += '<div class="skeleton-event">';
    html += '<div class="event-tag">' + eventId + '</div>';
    if (event.causedBy) html += '<div class="event-cause">← ' + event.causedBy + '</div>';
    for (const [charName, desc] of Object.entries(event.chains || {})) {
      if (desc === 'PLAYER_INPUT_REQUIRED') {
        html += '<div class="chain-entry"><span class="player-required">🎮 ' + escapeHtml(charName) + ': PLAYER_INPUT_REQUIRED</span></div>';
      } else if (charName === '環境') {
        html += '<div class="chain-entry"><span class="chain-env">' + escapeHtml(charName) + '</span>: ' + escapeHtml(desc) + '</div>';
      } else {
        html += '<div class="chain-entry"><span class="chain-char">' + escapeHtml(charName) + '</span>: ' + escapeHtml(desc) + '</div>';
      }
    }
    if (event.empty && event.empty.length > 0) {
      html += '<div style="font-size:0.65rem;color:var(--text-muted);">空: ' + event.empty.join(', ') + '</div>';
    }
    html += '</div>';
  }
  viewer.innerHTML = html;
  viewer.scrollTop = viewer.scrollHeight;
}

// ============================================================
// キャラクター本文タブ
// ============================================================

async function renderCharacterTextTabs() {
  const tabsEl = els.charTextTabs;
  const contentsEl = els.charTextContents;
  if (!tabsEl || !contentsEl) return;

  const texts = await loadCharacterTextsByScene(state.currentScene.key);
  if (!texts || texts.length === 0) {
    tabsEl.innerHTML = '<span style="font-size:0.7rem;color:var(--text-muted);padding:0.3rem;">本文なし</span>';
    contentsEl.innerHTML = '';
    return;
  }

  let tabsHtml = '';
  let contentsHtml = '';
  texts.forEach((ct, idx) => {
    const active = idx === 0 ? ' active' : '';
    tabsHtml += '<button class="char-text-tab' + active + '" data-char-tab="' + idx + '">' + escapeHtml(ct.character) + '</button>';
    contentsHtml += '<div class="char-text-content' + active + '" data-char-content="' + idx + '">';
    if (ct.paragraphs) {
      for (const [tag, para] of Object.entries(ct.paragraphs)) {
        const text = typeof para === 'string' ? para : (para.text || '');
        contentsHtml += '<div class="char-text-paragraph"><div class="para-tag">[' + escapeHtml(tag) + ']</div><div>' + escapeHtml(text) + '</div></div>';
      }
    }
    contentsHtml += '</div>';
  });
  tabsEl.innerHTML = tabsHtml;
  contentsEl.innerHTML = contentsHtml;

  // タブ切り替えイベント
  tabsEl.querySelectorAll('.char-text-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      tabsEl.querySelectorAll('.char-text-tab').forEach(t => t.classList.remove('active'));
      contentsEl.querySelectorAll('.char-text-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const content = contentsEl.querySelector('[data-char-content="' + tab.dataset.charTab + '"]');
      if (content) content.classList.add('active');
    });
  });
}

// ============================================================
// プレイヤー入力UI
// ============================================================

function showPlayerInputUI(events) {
  const ctx = els.playerContextDisplay;
  const badge = document.getElementById('playerWaitingBadge');
  if (!ctx) return;

  // 直近イベントをコンテキスト表示
  let html = '<div style="font-size:0.7rem;color:var(--accent);margin-bottom:0.3rem;">直近の出来事:</div>';
  for (const [eid, ev] of Object.entries(events)) {
    html += '<div style="margin-bottom:0.3rem;">';
    html += '<strong>' + eid + '</strong>: ';
    for (const [ch, desc] of Object.entries(ev.chains || {})) {
      if (desc === 'PLAYER_INPUT_REQUIRED') {
        html += '<span style="color:#ff5252;font-weight:bold;">🎮 ' + escapeHtml(ch) + 'の番です</span> ';
      } else {
        html += escapeHtml(ch) + '→' + escapeHtml(desc) + ' ';
      }
    }
    html += '</div>';
  }
  ctx.innerHTML = html;
  ctx.style.display = 'block';
  if (badge) badge.style.display = 'block';
  els.playerInputText.value = '';
  els.playerInputText.focus();
}

function hidePlayerInputWaiting() {
  var ctx = els.playerContextDisplay;
  var badge = document.getElementById('playerWaitingBadge');
  if (ctx) ctx.style.display = 'none';
  if (badge) badge.style.display = 'none';
}

// ============================================================
// プレイヤー本文編集UI
// ============================================================

function showPlayerEditUIAsync(charName, paragraphs, skeletonRef) {
  return new Promise(resolve => {
    const panel = els.playerEditPanel;
    if (!panel) { resolve(paragraphs); return; }

    state.pipeline.phase = 'step2_editing';
    updatePipelineUI();

    els.playerEditCharName.textContent = charName;
    els.playerEditSkeleton.innerHTML = '<div style="font-size:0.7rem;color:var(--accent);margin-bottom:0.3rem;">骨組み参照:</div><pre style="font-size:0.7rem;white-space:pre-wrap;">' + escapeHtml(skeletonRef) + '</pre>';

    // 全段落のテキストを結合して表示
    let fullText = '';
    for (const [tag, para] of Object.entries(paragraphs)) {
      const text = typeof para === 'string' ? para : (para.text || '');
      fullText += '[' + tag + ']\n' + text + '\n\n';
    }
    els.playerEditText.value = fullText;
    panel.style.display = 'block';
    els.playerEditText.focus();

    // 承認ボタン
    const approveHandler = () => {
      panel.style.display = 'none';
      els.playerEditApproveBtn.removeEventListener('click', approveHandler);
      els.playerEditRegenerateBtn.removeEventListener('click', regenHandler);
      // 編集結果をパース
      const editedText = els.playerEditText.value;
      const editedParagraphs = {};
      const regex = /\[([^\]]+)\]\n([\s\S]*?)(?=\n\[|$)/g;
      let m;
      while ((m = regex.exec(editedText)) !== null) {
        editedParagraphs[m[1]] = { text: m[2].trim() };
      }
      // パースに失敗したら元のテキストを1段落として返す
      if (Object.keys(editedParagraphs).length === 0) {
        const firstTag = Object.keys(paragraphs)[0];
        editedParagraphs[firstTag] = { text: editedText };
      }
      state.pipeline.phase = 'step2';
      updatePipelineUI();
      resolve(editedParagraphs);
    };

    const regenHandler = () => {
      panel.style.display = 'none';
      els.playerEditApproveBtn.removeEventListener('click', approveHandler);
      els.playerEditRegenerateBtn.removeEventListener('click', regenHandler);
      state.pipeline.phase = 'step2';
      updatePipelineUI();
      resolve(paragraphs); // 元のまま返す（再生成は呼び出し側で制御）
    };

    els.playerEditApproveBtn.addEventListener('click', approveHandler);
    els.playerEditRegenerateBtn.addEventListener('click', regenHandler);
  });
}

// ============================================================
// キャラクター設定レンダリング（v5.6ベース + writerMode）
// ============================================================

function renderCharacters() {
  const list = els.characterList;
  if (!list) return;
  list.innerHTML = '';
  if (els.charBadge) els.charBadge.textContent = state.situation.who.length + '人';

  state.situation.who.forEach((char, idx) => {
    const card = document.createElement('div');
    card.className = 'character-card' + (char.active ? '' : ' inactive');
    let html = '<div class="char-header">';
    html += '<span class="char-name">' + (char.base.name || '未設定キャラ ' + (idx + 1)) + '</span>';
    html += '<div class="char-controls">';
    html += '<button class="char-toggle" data-char-toggle="' + idx + '">' + (char.active ? '✓' : '✗') + '</button>';
    html += '<button class="char-delete" data-char-delete="' + idx + '">🗑️</button>';
    html += '</div></div>';

    // writerMode toggle
    html += '<div class="writer-mode-toggle">';
    html += '<label style="font-size:0.7rem;color:var(--text-secondary);">執筆:</label>';
    html += '<select data-char-writer-mode="' + idx + '">';
    html += '<option value="ai"' + (char.writerMode !== 'player' ? ' selected' : '') + '>🤖 AI</option>';
    html += '<option value="player"' + (char.writerMode === 'player' ? ' selected' : '') + '>🎮 プレイヤー</option>';
    html += '</select></div>';

    // 設定フィールド
    const sectionOrder = ['identity', 'physical', 'face', 'beastFeatures', 'outfit', 'personality', 'behavior', 'social', 'biology', 'supplement', 'recent'];
    sectionOrder.forEach(secKey => {
      const fields = CHAR_FIELDS[secKey];
      if (!fields) return;
      fields.forEach(f => {
        const isRecent = secKey === 'recent';
        const val = isRecent ? (char.recent[f.key] || '') : (char.base[f.key] || '');
        const dataAttr = isRecent ? 'data-char-recent' : 'data-char-base';
        if (f.type === 'textarea') {
          html += '<div class="situation-field"><label>' + f.label + '</label>';
          html += '<textarea ' + dataAttr + '="' + idx + '" data-field="' + f.key + '" placeholder="' + (f.placeholder || '') + '" style="min-height:50px;font-size:0.75rem;">' + escapeHtml(val) + '</textarea></div>';
        } else if (f.type === 'select') {
          html += '<div class="situation-field"><label>' + f.label + '</label>';
          html += '<select ' + dataAttr + '="' + idx + '" data-field="' + f.key + '" style="width:100%;padding:0.3rem;background:rgba(0,0,0,0.3);border:1px solid var(--border);border-radius:4px;color:var(--text-primary);font-size:0.75rem;">';
          (f.options || []).forEach(opt => {
            html += '<option value="' + opt + '"' + (val === opt ? ' selected' : '') + '>' + opt + '</option>';
          });
          html += '</select></div>';
        } else {
          html += '<div class="situation-field"><label>' + f.label + '</label>';
          html += '<input type="text" ' + dataAttr + '="' + idx + '" data-field="' + f.key + '" value="' + escapeHtml(val) + '" placeholder="' + (f.placeholder || '') + '"></div>';
        }
      });
    });

    // 参照画像
    html += '<div class="situation-field"><label>📷 参照画像 (' + (char.referenceImages ? char.referenceImages.length : 0) + '/' + MAX_REFERENCE_IMAGES + ')</label>';
    html += '<input type="file" accept="image/*" data-char-ref-img="' + idx + '" style="font-size:0.7rem;">';
    if (char.referenceImages && char.referenceImages.length > 0) {
      html += '<div style="display:flex;gap:0.3rem;flex-wrap:wrap;margin-top:0.3rem;">';
      char.referenceImages.forEach((img, imgIdx) => {
        html += '<div style="position:relative;"><img src="' + img + '" style="width:60px;height:60px;object-fit:cover;border-radius:4px;border:1px solid var(--border);">';
        html += '<button data-del-ref="' + idx + '-' + imgIdx + '" style="position:absolute;top:-4px;right:-4px;width:16px;height:16px;border-radius:50%;border:none;background:#ff5252;color:white;font-size:10px;cursor:pointer;line-height:16px;padding:0;">×</button></div>';
      });
      html += '</div>';
    }
    html += '</div>';

    // 記憶
    html += '<div class="situation-field"><label>💭 記憶 (' + (char.memories ? char.memories.length : 0) + '件)</label>';
    if (char.memories && char.memories.length > 0) {
      html += '<div style="max-height:150px;overflow-y:auto;">';
      char.memories.forEach(mem => {
        const srcLabel = (mem.source && mem.source.length > 0) ? ' <span style="color:var(--accent);font-size:0.6rem;">[' + mem.source.join(',') + ']</span>' : '';
        html += '<div style="display:flex;align-items:start;gap:0.3rem;margin-bottom:0.2rem;font-size:0.7rem;padding:0.2rem;background:rgba(0,0,0,0.1);border-radius:3px;">';
        html += '<span style="flex:1;">' + escapeHtml(mem.summary).substring(0, 80) + srcLabel + '</span>';
        html += '<button data-del-mem="' + idx + '-' + mem.id + '" style="flex-shrink:0;border:none;background:none;color:#ff5252;cursor:pointer;font-size:0.65rem;">×</button>';
        html += '</div>';
      });
      html += '</div>';
    }
    html += '<div style="display:flex;gap:0.3rem;margin-top:0.3rem;">';
    html += '<input type="text" data-mem-input="' + idx + '" placeholder="記憶を追加..." style="flex:1;font-size:0.7rem;">';
    html += '<button data-add-mem="' + idx + '" class="story-btn secondary" style="font-size:0.65rem;padding:0.2rem 0.4rem;">+</button>';
    html += '</div></div>';

    card.innerHTML = html;
    list.appendChild(card);
  });

  // イベント接続
  attachCharacterEvents();
  updateClearCharSelect();
}

function attachCharacterEvents() {
  // writerModeトグル
  document.querySelectorAll('[data-char-writer-mode]').forEach(sel => {
    sel.addEventListener('change', () => {
      const idx = parseInt(sel.dataset.charWriterMode);
      state.situation.who[idx].writerMode = sel.value;
      saveToStorage();
    });
  });
  // Active toggle
  document.querySelectorAll('[data-char-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.charToggle);
      state.situation.who[idx].active = !state.situation.who[idx].active;
      renderCharacters();
      saveToStorage();
    });
  });
  // Delete
  document.querySelectorAll('[data-char-delete]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.charDelete);
      if (confirm('キャラ「' + (state.situation.who[idx].base.name || idx) + '」を削除しますか？')) {
        state.situation.who.splice(idx, 1);
        renderCharacters();
        saveToStorage();
      }
    });
  });
  // Base fields
  document.querySelectorAll('[data-char-base]').forEach(el => {
    el.addEventListener('change', () => {
      const idx = parseInt(el.dataset.charBase);
      state.situation.who[idx].base[el.dataset.field] = el.value;
      saveToStorage();
    });
  });
  // Recent fields
  document.querySelectorAll('[data-char-recent]').forEach(el => {
    el.addEventListener('change', () => {
      const idx = parseInt(el.dataset.charRecent);
      state.situation.who[idx].recent[el.dataset.field] = el.value;
      saveToStorage();
    });
  });
  // Reference image upload
  document.querySelectorAll('[data-char-ref-img]').forEach(input => {
    input.addEventListener('change', async (e) => {
      const idx = parseInt(input.dataset.charRefImg);
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (ev) => {
        if (!state.situation.who[idx].referenceImages) state.situation.who[idx].referenceImages = [];
        if (state.situation.who[idx].referenceImages.length >= MAX_REFERENCE_IMAGES) {
          showMessage('参照画像は最大' + MAX_REFERENCE_IMAGES + '枚です', 'warning'); return;
        }
        const resized = await resizeBase64Image(ev.target.result, 512, 512, 0.8);
        state.situation.who[idx].referenceImages.push(resized);
        renderCharacters();
        saveToStorage();
      };
      reader.readAsDataURL(file);
    });
  });
  // Delete reference image
  document.querySelectorAll('[data-del-ref]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [charIdx, imgIdx] = btn.dataset.delRef.split('-').map(Number);
      state.situation.who[charIdx].referenceImages.splice(imgIdx, 1);
      renderCharacters();
      saveToStorage();
    });
  });
  // Add memory
  document.querySelectorAll('[data-add-mem]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.addMem);
      const input = document.querySelector('[data-mem-input="' + idx + '"]');
      if (input && input.value.trim()) {
        addMemoryEntry(idx, input.value.trim());
        input.value = '';
        renderCharacters();
      }
    });
  });
  // Delete memory
  document.querySelectorAll('[data-del-mem]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [charIdx, memId] = btn.dataset.delMem.split('-');
      deleteMemoryEntry(parseInt(charIdx), btn.dataset.delMem.substring(charIdx.length + 1));
    });
  });
}

// ============================================================
// 5W1Hセクション レンダリング
// ============================================================

function renderAllSections() {
  const container = els.situationSections;
  if (!container) return;

  const sections = [
    { key: 'where', label: '📍 場所 (Where)', fields: [
      { key: 'name', label: '場所名', type: 'input', target: 'base' },
      { key: 'description', label: '説明', type: 'textarea', target: 'base' },
      { key: 'lighting', label: '照明', type: 'input', target: 'base' },
      { key: 'name', label: '直近の場所', type: 'input', target: 'recent' },
      { key: 'description', label: '直近の説明', type: 'input', target: 'recent' },
      { key: 'lighting', label: '直近の照明', type: 'input', target: 'recent' }
    ]},
    { key: 'when', label: '🕐 時間 (When)', fields: [
      { key: 'timeOfDay', label: '時刻', type: 'input', target: 'base' },
      { key: 'weather', label: '天候', type: 'input', target: 'base' },
      { key: 'timeOfDay', label: '直近の時刻', type: 'input', target: 'recent' },
      { key: 'weather', label: '直近の天候', type: 'input', target: 'recent' }
    ]},
    { key: 'what', label: '📌 出来事 (What)', fields: [
      { key: 'mainEvent', label: 'メインイベント', type: 'textarea', target: 'base' },
      { key: 'mainEvent', label: '直近の出来事', type: 'input', target: 'recent' }
    ]},
    { key: 'why', label: '📖 背景 (Why)', fields: [
      { key: 'context', label: 'コンテキスト', type: 'textarea', target: 'base' },
      { key: 'glossary', label: '補足・用語集', type: 'textarea', target: 'base' },
      { key: 'worldRules', label: '世界のルール', type: 'textarea', target: 'base' },
      { key: 'context', label: '直近の背景', type: 'input', target: 'recent' }
    ]},
    { key: 'how', label: '🎭 雰囲気 (How)', fields: [
      { key: 'mood', label: '雰囲気', type: 'input', target: 'base' },
      { key: 'narrativeStyle', label: '文体', type: 'input', target: 'base' },
      { key: 'artStyle', label: '画風', type: 'input', target: 'base' },
      { key: 'mood', label: '直近の雰囲気', type: 'input', target: 'recent' }
    ]}
  ];

  let html = '';
  sections.forEach(sec => {
    const secData = state.situation[sec.key];
    html += '<div class="situation-section">';
    html += '<div class="section-header">';
    html += '<h4><span class="collapse-icon">▼</span> ' + sec.label + '</h4>';
    html += '<div class="toggle-switch' + (secData.active ? ' active' : '') + '" data-section-toggle="' + sec.key + '"></div>';
    html += '</div><div class="section-body">';
    sec.fields.forEach(f => {
      const val = secData[f.target]?.[f.key] || '';
      const dataAttr = 'data-5w1h="' + sec.key + '" data-target="' + f.target + '" data-field="' + f.key + '"';
      if (f.type === 'textarea') {
        html += '<div class="situation-field"><label>' + f.label + '</label><textarea ' + dataAttr + ' style="min-height:60px;font-size:0.8rem;">' + escapeHtml(val) + '</textarea></div>';
      } else {
        html += '<div class="situation-field"><label>' + f.label + '</label><input type="text" ' + dataAttr + ' value="' + escapeHtml(val) + '"></div>';
      }
    });
    html += '</div></div>';
  });
  container.innerHTML = html;

  // 5W1Hフィールドのchangeイベント
  container.querySelectorAll('[data-5w1h]').forEach(el => {
    el.addEventListener('change', () => {
      const secKey = el.dataset['5w1h'];
      const target = el.dataset.target;
      const field = el.dataset.field;
      state.situation[secKey][target][field] = el.value;
      saveToStorage();
    });
  });

  // セクショントグル
  container.querySelectorAll('[data-section-toggle]').forEach(toggle => {
    toggle.addEventListener('click', () => {
      const secKey = toggle.dataset.sectionToggle;
      state.situation[secKey].active = !state.situation[secKey].active;
      toggle.classList.toggle('active');
      saveToStorage();
    });
  });

  // セクション折りたたみ
  container.querySelectorAll('.section-header').forEach(header => {
    header.addEventListener('click', (e) => {
      if (e.target.classList.contains('toggle-switch')) return;
      const body = header.nextElementSibling;
      const icon = header.querySelector('.collapse-icon');
      if (body) body.classList.toggle('collapsed');
      if (icon) icon.textContent = body.classList.contains('collapsed') ? '▶' : '▼';
    });
  });
}

// ============================================================
// カメラグリッド
// ============================================================

function renderCameraGrid() {
  const grid = els.cameraGrid;
  if (!grid) return;
  let html = '';

  // 全体カメラ
  html += '<div class="camera-item active" data-camera="cam_overview">';
  html += '<span>' + CAMERA_OVERVIEW.name + '</span></div>';

  // キャラカメラ
  state.situation.who.forEach((char, idx) => {
    if (!char.active || !char.base.name) return;
    const emoji = getCharacterEmoji(char);
    html += '<div class="camera-item" data-camera="cam_char_' + idx + '">';
    html += '<span>' + emoji + ' ' + char.base.name + '</span></div>';
  });

  grid.innerHTML = html;

  // カメラ選択イベント
  grid.querySelectorAll('.camera-item').forEach(item => {
    item.addEventListener('click', () => { item.classList.toggle('active'); });
  });
}

function getSelectedCameras() {
  const cams = [];
  document.querySelectorAll('.camera-item.active').forEach(el => {
    const camId = el.dataset.camera;
    if (camId === 'cam_overview') {
      cams.push({ id: 'cam_overview', type: 'overview', name: CAMERA_OVERVIEW.name, charIndex: null });
    } else {
      const idx = parseInt(camId.replace('cam_char_', ''));
      const char = state.situation.who[idx];
      if (char) {
        cams.push({ id: camId, type: 'character', name: char.base.name || 'キャラ' + idx, charIndex: idx });
      }
    }
  });
  return cams;
}

function getCharacterEmoji(char) {
  const species = (char.base.species || '').toLowerCase();
  if (species.includes('cat')) return '🐱';
  if (species.includes('wolf') || species.includes('dog')) return '🐺';
  if (species.includes('fox')) return '🦊';
  if (species.includes('rabbit') || species.includes('bunny')) return '🐰';
  if (species.includes('bird') || species.includes('hawk') || species.includes('eagle')) return '🦅';
  if (species.includes('dragon')) return '🐉';
  if (species.includes('elf')) return '🧝';
  return '👤';
}

// ============================================================
// プロンプトプレビュー
// ============================================================

function updateAllPromptPreviews() {
  if (els.geminiPromptPreview) {
    els.geminiPromptPreview.textContent = render5W1HText({ sanitize: true });
  }
  updateSDPreviewCharSelect();
}

function updateSDPreviewCharSelect() {
  const select = els.sdPreviewCharSelect;
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="-1">-- キャラ選択 --</option>';
  state.situation.who.forEach((char, idx) => {
    if (!char.active || !char.base.name) return;
    select.innerHTML += '<option value="' + idx + '">' + char.base.name + '</option>';
  });
  select.value = current;
}

function updateClearCharSelect() {
  const select = els.clearCharSelect;
  if (!select) return;
  select.innerHTML = '<option value="-1">-- キャラ選択 --</option>';
  state.situation.who.forEach((char, idx) => {
    if (!char.base.name) return;
    select.innerHTML += '<option value="' + idx + '">' + char.base.name + '</option>';
  });
}

// ============================================================
// 直近設定クリア
// ============================================================

function clearAllRecent() {
  ['where', 'when', 'what', 'why', 'how'].forEach(k => {
    const sec = state.situation[k];
    if (sec && sec.recent) Object.keys(sec.recent).forEach(f => { sec.recent[f] = ''; });
  });
  state.situation.who.forEach(char => {
    Object.keys(char.recent).forEach(f => { char.recent[f] = ''; });
  });
  renderAllSections();
  renderCharacters();
  saveToStorage();
  addLog('🗑️ 全直近設定クリア', 'info');
}

function clearAllCharRecent() {
  state.situation.who.forEach(char => {
    Object.keys(char.recent).forEach(f => { char.recent[f] = ''; });
  });
  renderCharacters();
  saveToStorage();
  addLog('🗑️ 全キャラ直近クリア', 'info');
}

function clearCharRecent(charIndex) {
  const char = state.situation.who[charIndex];
  if (!char) return;
  Object.keys(char.recent).forEach(f => { char.recent[f] = ''; });
  renderCharacters();
  saveToStorage();
  addLog('🗑️ ' + (char.base.name || 'Char' + charIndex) + ' 直近クリア', 'info');
}

// ============================================================
// 画像モーダル
// ============================================================

let currentModalImage = null;

function renderCurrentImages(imgs) {
  const container = els.currentSceneImages;
  if (!container) return;
  if (!imgs || imgs.length === 0) {
    container.innerHTML = '<div class="empty-scene"><p>📷 撮影してください</p></div>';
    return;
  }
  let html = '';
  imgs.forEach(img => {
    html += '<div class="scene-image" style="cursor:pointer;" data-img-idx="' + state.currentImages.indexOf(img) + '">';
    html += '<img src="' + img.src + '" alt="' + escapeHtml(img.cameraName) + '">';
    html += '<div style="font-size:0.65rem;color:var(--text-muted);text-align:center;">' + escapeHtml(img.cameraName) + '</div>';
    html += '</div>';
  });
  container.innerHTML = html;
  if (els.imageCount) els.imageCount.textContent = imgs.length + ' 枚';

  container.querySelectorAll('.scene-image').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.imgIdx);
      if (state.currentImages[idx]) openImageModal(state.currentImages[idx]);
    });
  });
}

function openImageModal(img) {
  currentModalImage = img;
  els.modalImage.src = img.src;
  els.modalTitle.textContent = '📷 ' + img.cameraName + ' - ' + img.model;
  els.modalPrompt.textContent = img.prompt;
  els.imageModal.classList.add('active');
}

function closeImageModal() {
  els.imageModal.classList.remove('active');
  currentModalImage = null;
}

function downloadImage() {
  if (!currentModalImage) return;
  const a = document.createElement('a');
  a.href = currentModalImage.src;
  a.download = 'scene_' + Date.now() + '.png';
  a.click();
}

function setAsReference() {
  if (!currentModalImage) return;
  if (!state.situation.who.length) { showMessage('キャラクターを追加してください', 'error'); return; }
  var cameraName = currentModalImage.cameraName;
  var targetIdx = 0;
  var matchedIdx = state.situation.who.findIndex(function(c) { return c.active && c.base.name === cameraName; });
  if (matchedIdx >= 0) targetIdx = matchedIdx;
  var targetChar = state.situation.who[targetIdx];
  if (!targetChar.referenceImages) targetChar.referenceImages = [];
  if (targetChar.referenceImages.length >= MAX_REFERENCE_IMAGES) {
    targetChar.referenceImages[MAX_REFERENCE_IMAGES - 1] = currentModalImage.src;
    showMessage('⚠️ 上限' + MAX_REFERENCE_IMAGES + '枚のため最後のスロットを上書きしました', 'warning');
  } else {
    targetChar.referenceImages.push(currentModalImage.src);
  }
  renderCharacters(); saveToStorage(); closeImageModal();
  showMessage('✅ ' + (targetChar.base.name || 'キャラクター') + ' の参照画像に追加しました（' + targetChar.referenceImages.length + '/' + MAX_REFERENCE_IMAGES + '枚）', 'success');
}
