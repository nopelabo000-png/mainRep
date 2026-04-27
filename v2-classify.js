// ============================================================
// v2-classify.js — F8参考文章解析, 設定エクスポート, 文章→直近設定
// ============================================================

// ============================================================
// F8: 参考文章 → 基本設定追記
// ============================================================

async function classifyReferenceText() {
  if (!isTextReady()) { showMessage('APIキーを設定してください（選択中のモデルに対応するキー）', 'error'); return; }
  if (state.isClassifying) { addLog('⚠️ F8 解析中です', 'warning'); return; }
  var ref = els.referenceText ? els.referenceText.value.trim() : '';
  if (!ref) { showMessage('参考文章を入力してください', 'error'); return; }
  state.isClassifying = true;
  if (els.classifyBtn) { els.classifyBtn.disabled = true; els.classifyBtn.innerHTML = '<span class="spinner"></span> 解析中...'; }
  try {
    var m = MODELS.text[state.selectedTextModel];
    addLog('📝 基本設定に追記中...', 'info');
    var base5W1H = render5W1HText({ scope: 'base', includeGlossary: true, includeSpeechPattern: true });

    var sys = 'あなたは設定抽出AIです。日本語テキストから5W1H情報を抽出し、既存の基本設定の【空欄のみ】に追記してください。\n\n' +
      '【現在の基本設定】\n' + base5W1H + '\n\n' +
      '【キャラクター(who)のフィールド】\n' +
      'name, epithet, species, height, bodyType, skinTone, hairColor, hairStyle, eyeColor, facialFeatures, ears, tail, otherFeatures, clothing, traits, values, speechPattern, mentalState, movement, habits, relationships, speciesBiology, notes\n\n' +
      '【ルール】\n' +
      '1. 空欄("")のフィールドのみ値を追記。既存値は絶対に変更しない\n' +
      '2. 全ての値は日本語で簡潔に記述する（英語タグは使わない。画像生成用の英語変換は別工程が担当する）\n' +
      '3. 新規キャラクターは追加可能（nameが必須）\n' +
      '4. 身体的特徴は日本語で具体的に（例: 「青みがかった黒髪のショートカット」「金色の虹彩」「長身で細身」）\n' +
      '5. 服装は形状・色・素材を日本語で記述（例: 「黒いドレス、深いスリット入り」）\n' +
      '6. speechPattern: キャラの口調・語尾パターン（日本語で記述）\n' +
      '7. notes: キャラ固有の補足情報（固有装備、特殊能力名等、日本語で記述）\n' +
      '8. values: キャラの価値観・信念（何を大切にし、何を許せないか、日本語で記述）\n' +
      '9. relationships: 他キャラとの関係（「相手名→関係性・感情」の形式、日本語で記述）\n' +
      '10. speciesBiology: 種族固有の身体能力・生態・弱点（日本語で記述）\n' +
      '11. glossary: 作中専門用語・世界設定の補足（日本語、改行区切り）\n' +
      '12. worldRules: 世界のルール・制約・法則（日本語、改行区切り）\n' +
      '13. narrativeStyle: 文体指示（人称・語り口・比喩傾向等、日本語で記述）\n' +
      '14. テキストにない情報は推測せず空欄のまま\n' +
      '15. JSONのみを出力。説明文は不要\n\n' +
      '【出力形式】JSON:\n' +
      '{\n' +
      '  "where": { "name": "", "description": "", "lighting": "" },\n' +
      '  "when": { "timeOfDay": "", "weather": "" },\n' +
      '  "who": [\n' +
      '    {\n' +
      '      "name": "", "epithet": "", "species": "",\n' +
      '      "height": "", "bodyType": "", "skinTone": "",\n' +
      '      "hairColor": "", "hairStyle": "", "eyeColor": "", "facialFeatures": "",\n' +
      '      "ears": "", "tail": "", "otherFeatures": "",\n' +
      '      "clothing": "",\n' +
      '      "traits": "", "values": "", "speechPattern": "", "mentalState": "",\n' +
      '      "movement": "", "habits": "", "relationships": "", "speciesBiology": "", "notes": ""\n' +
      '    }\n' +
      '  ],\n' +
      '  "what": { "mainEvent": "" },\n' +
      '  "why": { "context": "", "glossary": "", "worldRules": "" },\n' +
      '  "how": { "mood": "", "narrativeStyle": "", "artStyle": "" }\n' +
      '}';

    dbg('dbgClassifyInput', '=== system_instruction ===\n' + sys + '\n\n=== user contents ===\n【参考文章】\n' + ref);
    var fullSysText = sys + '\n\n【参考文章】\n' + ref;
    addLog('📐 F8 system_instruction: ' + Math.round(fullSysText.length / 1000) + 'K文字, ref: ' + Math.round(ref.length / 1000) + 'K文字', 'info');
    var data = await textApiFetch(
      {
        system_instruction: { parts: [{ text: fullSysText }] },
        contents: [{ role: 'user', parts: [{ text: '上記の参考文章から設定を抽出してJSON形式で出力してください。' }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 8192, responseMimeType: 'application/json' },
        safetySettings: SAFETY_OFF
      }, 'F8'
    );

    if (data.promptFeedback && data.promptFeedback.blockReason) {
      addLog('🚫 F8 promptFeedback blocked: ' + data.promptFeedback.blockReason, 'error');
      throw new Error('Blocked by promptFeedback: ' + data.promptFeedback.blockReason);
    }
    var finishReason = (data.candidates && data.candidates[0] && data.candidates[0].finishReason) || '';
    if (finishReason && finishReason !== 'STOP') {
      addLog('⚠️ F8 finishReason: ' + finishReason, 'warning');
    }

    var txt = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text) || '';
    if (!txt || txt.length < 10) {
      addLog('⚠️ F8 応答が空です (finishReason=' + finishReason + ')', 'warning');
      addLog('⚠️ F8 raw response: ' + JSON.stringify(data).substring(0, 300), 'warning');
      throw new Error('Empty response (finishReason=' + finishReason + ')');
    }
    txt = txt.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    var jm = txt.match(/\{[\s\S]*\}/);
    if (!jm) {
      addLog('⚠️ 応答: ' + txt.substring(0, 100), 'warning');
      throw new Error('JSON not found');
    }
    var parsed = safeParseJSON(jm[0], 'F8');
    dbg('dbgClassifyOutput', txt);
    mergeToBaseSettings(parsed);
    renderAllSections(); renderCharacters();
    if (typeof updateAllPromptPreviews === 'function') updateAllPromptPreviews();
    saveToStorage();
    if (els.referenceText) els.referenceText.value = '';
    addLog('✅ 基本設定に追記完了', 'success');
    showMessage('✅ 基本設定に追記しました', 'success');
  } catch (e) { showMessage('エラー: ' + e.message, 'error'); addLog('❌ ' + e.message, 'error'); }
  finally {
    state.isClassifying = false;
    if (els.classifyBtn) { els.classifyBtn.disabled = false; els.classifyBtn.innerHTML = '📄 解析→基本設定追記 (F8)'; }
  }
}

function mergeToBaseSettings(u) {
  ['where', 'when', 'what', 'why', 'how'].forEach(function(sec) {
    if (!u[sec]) return;
    Object.keys(state.situation[sec].base).forEach(function(k) {
      if (u[sec][k] !== undefined && u[sec][k] !== '' && u[sec][k] !== null) {
        state.situation[sec].base[k] = u[sec][k];
      }
    });
  });
  if (u.who && Array.isArray(u.who)) {
    u.who.forEach(function(nc) {
      if (!nc.name) return;
      var existing = state.situation.who.find(function(c) { return c.base.name === nc.name; });
      if (existing) {
        Object.keys(existing.base).forEach(function(k) {
          if (nc[k] !== undefined && nc[k] !== '' && nc[k] !== null) {
            existing.base[k] = nc[k];
          }
        });
      } else {
        var newChar = createEmptyCharacter();
        Object.keys(newChar.base).forEach(function(k) { if (nc[k]) newChar.base[k] = nc[k]; });
        state.situation.who.push(newChar);
      }
    });
  }
  addLog('📝 マージ完了: 新規→上書き / 未定義→既存保持', 'info');
}

// ============================================================
// 設定エクスポート
// ============================================================

function exportBaseSettings() {
  var settings = {
    where: state.situation.where.base,
    when: state.situation.when.base,
    what: state.situation.what.base,
    why: state.situation.why.base,
    how: state.situation.how.base,
    who: state.situation.who.map(function(c) {
      var obj = {};
      Object.keys(c.base).forEach(function(k) { obj[k] = c.base[k]; });
      obj._recent = c.recent;
      return obj;
    })
  };

  var text = '=== Story Canvas 基本設定 ===\n';
  text += '出力日時: ' + new Date().toLocaleString('ja-JP') + '\n\n';

  var sectionLabels = { where: '場所 (Where)', when: '時間 (When)', what: '出来事 (What)', why: '背景・理由 (Why)', how: '雰囲気・スタイル (How)' };
  ['where', 'when', 'what', 'why', 'how'].forEach(function(sec) {
    text += '【' + sectionLabels[sec] + '】\n';
    Object.keys(settings[sec]).forEach(function(k) {
      if (settings[sec][k]) text += '  ' + k + ': ' + settings[sec][k] + '\n';
    });
    text += '\n';
  });

  text += '【登場人物 (Who)】\n';
  settings.who.forEach(function(c, i) {
    text += '\n--- キャラクター ' + (i + 1) + ' ---\n';
    Object.keys(c).forEach(function(k) {
      if (k === '_recent') return;
      if (c[k]) text += '  ' + k + ': ' + c[k] + '\n';
    });
    if (c._recent) {
      text += '  [直近状態]\n';
      Object.keys(c._recent).forEach(function(k) {
        if (c._recent[k]) text += '    ' + k + ': ' + c._recent[k] + '\n';
      });
    }
  });

  text += '\n\n=== JSON形式（再インポート用） ===\n';
  text += JSON.stringify(settings, null, 2);

  var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'story-canvas-settings-' + new Date().toISOString().slice(0, 10) + '.txt';
  a.click();
  URL.revokeObjectURL(url);

  addLog('💾 基本設定をエクスポートしました', 'success');
  showMessage('✅ 基本設定をダウンロードしました', 'success');
}

// ============================================================
// 基本設定クリア
// ============================================================

function clearBaseSettings(clearAll) {
  var label = clearAll ? '全設定' : '直近設定';
  if (!confirm('⚠️ ' + label + 'をクリアします。\nこの操作は元に戻せません。よろしいですか？')) return;

  if (clearAll) {
    var emptySections = {
      where: { name: '', description: '', lighting: '' },
      when: { timeOfDay: '', weather: '' },
      what: { mainEvent: '' },
      why: { context: '', glossary: '', worldRules: '' },
      how: { mood: '', narrativeStyle: '', artStyle: 'modern anime style, high quality, masterpiece, detailed illustration' }
    };
    Object.keys(emptySections).forEach(function(sec) {
      Object.keys(emptySections[sec]).forEach(function(k) {
        state.situation[sec].base[k] = emptySections[sec][k];
      });
    });
    state.situation.where.recent = { name: '', description: '', lighting: '' };
    state.situation.when.recent = { timeOfDay: '', weather: '' };
    state.situation.what.recent = { mainEvent: '' };
    state.situation.why.recent = { context: '' };
    state.situation.how.recent = { mood: '' };
    state.situation.who = [];
    state.poseRecords = {};
    state.poseImagesByChar = {};
  } else {
    state.situation.where.recent = { name: '', description: '', lighting: '' };
    state.situation.when.recent = { timeOfDay: '', weather: '' };
    state.situation.what.recent = { mainEvent: '' };
    state.situation.why.recent = { context: '' };
    state.situation.how.recent = { mood: '' };
    state.situation.who.forEach(function(char) {
      Object.keys(char.recent).forEach(function(k) { char.recent[k] = ''; });
    });
    state.poseRecords = {};
    state.poseImagesByChar = {};
  }

  renderAllSections(); renderCharacters(); renderCameraGrid();
  if (typeof updateAllPromptPreviews === 'function') updateAllPromptPreviews();
  saveToStorage();
  addLog('🧹 ' + label + 'をクリアしました', 'success');
  showMessage('✅ ' + label + 'をクリアしました', 'success');
}

// ============================================================
// F2: 文章→直近設定 (convertStoryToPrompt)
// ============================================================

function getRecentParagraphs(maxChars) {
  if (!maxChars) maxChars = 1500;
  // v2: キャラクター本文タブの全テキストを結合
  var full = '';
  var contents = document.querySelectorAll('.char-text-content');
  contents.forEach(function(el) {
    var t = el.textContent.trim();
    if (t) full += (full ? '\n\n' : '') + t;
  });
  if (!full) return '';
  if (full.length <= maxChars) return full;
  var paragraphs = full.split(/\n\n+/);
  var result = '';
  for (var i = paragraphs.length - 1; i >= 0; i--) {
    var candidate = paragraphs[i] + (result ? '\n\n' + result : '');
    if (candidate.length > maxChars && result) break;
    result = candidate;
  }
  return result || full.slice(-maxChars);
}

async function convertStoryToPrompt() {
  if (!isTextReady()) { showMessage('APIキーを設定してください（選択中のモデルに対応するキー）', 'error'); return; }
  if (state.isConverting) return;
  var st = getRecentParagraphs(2000);
  if (!st) { showMessage('物語テキストがありません', 'error'); return; }
  state.isConverting = true;
  var convertBtn = document.getElementById('convertToPromptBtn');
  if (convertBtn) { convertBtn.disabled = true; convertBtn.innerHTML = '<span class="spinner"></span>'; }
  try {
    var m = MODELS.text[state.selectedTextModel];
    addLog('🔄 キャラクターのポーズを抽出中...', 'info');
    var base5W1H = render5W1HText({ scope: 'base', includeGlossary: true, includeSpeechPattern: false });

    var sys = '物語テキストから各キャラクターの【ポーズ・体勢・行動】を最優先で抽出してください。\n' +
      '物語の現在の状態を正確に把握するため、視覚的に描写可能な情報を日本語で詳細に抽出してください。\n\n' +
      '【登録済みキャラクター・世界設定】\n' + base5W1H + '\n\n' +
      '【出力形式】以下のJSON形式のみを出力してください。説明文や前置きは不要です:\n' +
      '{\n' +
      '  "where": { "name": "場所名(日本語)", "description": "場所の視覚描写(日本語)", "lighting": "照明(日本語)" },\n' +
      '  "when": { "timeOfDay": "時間帯(日本語)", "weather": "天候(日本語)" },\n' +
      '  "who": [\n' +
      '    {\n' +
      '      "name": "キャラ名(登録名と一致させる)",\n' +
      '      "currentPose": "体勢・ポーズの詳細(日本語)",\n' +
      '      "currentExpression": "表情の詳細(日本語)",\n' +
      '      "currentAction": "現在の行動(日本語)",\n' +
      '      "clothingState": "服装の状態(日本語)"\n' +
      '    }\n' +
      '  ],\n' +
      '  "what": { "mainEvent": "シーンの主要イベント(日本語)" },\n' +
      '  "how": { "mood": "雰囲気(日本語)" }\n' +
      '}\n\n' +
      '【重要】\n' +
      '- JSONのみを出力。前後に説明文を付けない\n' +
      '- currentPoseは画像生成で最も重要。体の向き、四肢の位置、姿勢を具体的に記述\n' +
      '- 物語に明示されていなくても、文脈から推測できるポーズは記述する\n' +
      '- 値は全て日本語で具体的に記述する（英語タグは使わない。画像生成用の英語変換は別工程が担当する）';

    dbg('dbgConvertInput', '=== system_instruction ===\n' + sys + '\n\n=== user contents ===\n【物語テキスト】\n' + st);
    var f2SysText = sys + '\n\n【物語テキスト】\n' + st;
    var data = await textApiFetch(
      {
        system_instruction: { parts: [{ text: f2SysText }] },
        contents: [{ role: 'user', parts: [{ text: '上記の物語テキストからキャラクターの状態を抽出してJSON形式で出力してください。' }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 4096, responseMimeType: 'application/json' },
        safetySettings: SAFETY_OFF
      }, 'F2'
    );
    var txt = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text) || '';

    if (!txt || txt.length < 10) {
      addLog('⚠️ 応答が空です。セーフティフィルターの可能性', 'warning');
      throw new Error('Empty response from API');
    }
    txt = txt.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    var jm = txt.match(/\{[\s\S]*\}/);
    if (!jm) {
      addLog('⚠️ 応答: ' + txt.substring(0, 100), 'warning');
      throw new Error('JSON not found in response');
    }
    var parsed = safeParseJSON(jm[0], 'F2');
    dbg('dbgConvertOutput', txt);
    updateRecentSettings(parsed);
    renderAllSections(); renderCharacters(); renderCameraGrid();
    if (typeof updateAllPromptPreviews === 'function') updateAllPromptPreviews();
    saveToStorage();

    if (parsed.who && parsed.who.length > 0) {
      parsed.who.forEach(function(c) {
        if (c.currentPose) addLog('👤 ' + c.name + ': ' + c.currentPose, 'success');
      });
    }
    addLog('✅ ポーズ抽出完了', 'success');
    showMessage('✅ 直近設定を更新しました', 'success');
  } catch (e) { showMessage('エラー: ' + e.message, 'error'); addLog('❌ ' + e.message, 'error'); }
  finally {
    state.isConverting = false;
    if (convertBtn) { convertBtn.disabled = false; convertBtn.innerHTML = '🔄 文章→直近設定'; }
  }
}

function updateRecentSettings(u) {
  ['where', 'when', 'what', 'how'].forEach(function(sec) {
    if (!u[sec]) return;
    Object.keys(state.situation[sec].recent).forEach(function(k) {
      if (u[sec][k]) state.situation[sec].recent[k] = u[sec][k];
    });
  });
  if (u.who && Array.isArray(u.who)) {
    u.who.forEach(function(nc) {
      var existing = state.situation.who.find(function(c) { return c.base.name === nc.name; });
      if (existing) {
        if (nc.currentPose) existing.recent.currentPose = nc.currentPose;
        if (nc.currentExpression) existing.recent.currentExpression = nc.currentExpression;
        if (nc.currentAction) existing.recent.currentAction = nc.currentAction;
        if (nc.clothingState) existing.recent.clothingState = nc.clothingState;
      }
    });
  }
}
