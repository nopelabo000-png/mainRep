// ============================================================
// v2-image-prompt.js — SD/Gemini プロンプト生成 + Danbooruタグ変換
// ============================================================

// ============================================================
// F3: ポーズ画像指示文生成（Gemini）
// ============================================================

async function generateSanitizedPosePrompt(cams) {
  var targetChars = [];
  var isOverview = cams.some(function(c) { return c.type === 'overview'; });
  if (isOverview) {
    state.situation.who.forEach(function(c, i) { if (c.active) targetChars.push({ index: i, char: c }); });
  } else {
    cams.forEach(function(cam) {
      if (cam.type === 'character' && cam.charIndex !== null) {
        var char = state.situation.who[cam.charIndex];
        if (char && char.active) targetChars.push({ index: cam.charIndex, char: char });
      }
    });
  }
  if (!targetChars.length) return null;

  var charSummary = targetChars.map(function(tc) {
    var b = tc.char.base;
    var charName = b.name || 'キャラ' + tc.index;
    var appearance = [b.hairColor, b.hairStyle, b.eyeColor ? b.eyeColor + 'の瞳' : '', b.ears, b.tail, b.otherFeatures].filter(Boolean).join('、');
    var clothing = tc.char.recent.clothingState || b.clothing || '';
    var poseFromTag = state.poseRecords ? state.poseRecords[charName] : null;
    var pose = poseFromTag || tc.char.recent.currentPose || '';
    var expr = tc.char.recent.currentExpression || '';
    var line = '■ ' + charName + ': ' + appearance;
    if (clothing) line += '\n  服装: ' + clothing;
    if (pose) line += '\n  ポーズ: ' + pose;
    if (expr) line += '\n  表情: ' + expr;
    return line;
  }).join('\n');

  var sanitizePrompt = state.sanitizeJailbreakPrompt || JAILBREAK_SANITIZE_PROMPT;
  var f3SysText = sanitizePrompt + '\n\n' +
    '【タスク】以下のキャラクター情報から、アニメイラスト風の画像生成用の日本語指示文を生成してください。\n\n' +
    '【重要】\n' +
    '- 必ず1人のキャラクターのみを描写すること（複数人は不可）\n' +
    '- この画像はポーズ参考図として使用されるため、キャラクターの体勢・姿勢が明確に分かるよう描写する\n' +
    '- 背景は簡素にし、キャラクターのポーズが際立つようにする\n\n' +
    '【ルール】\n' +
    '- ポーズ情報は一切省略・要約せず全て含める\n' +
    '- 性的・暴力的な表現は穏やかな表現に置き換える\n' +
    '- 出力はプレーンテキストの指示文のみ（JSONではない）\n' +
    '- 参考画像がある場合、外見はそちらを参照する旨を明記';

  var f3UserContent = '【対象キャラクターの外見・ポーズ情報】\n' + charSummary;

  try {
    var m = MODELS.text[state.selectedTextModel];
    if (els.reqPromptSanitize) els.reqPromptSanitize.value = '=== system_instruction ===\n' + f3SysText + '\n\n=== user contents ===\n' + f3UserContent;
    dbg('dbgSanitizeInput', '=== system_instruction ===\n' + f3SysText + '\n\n=== user contents ===\n' + f3UserContent);

    var data = await textApiFetch(
      {
        system_instruction: { parts: [{ text: f3SysText + '\n\n' + f3UserContent }] },
        contents: [{ role: 'user', parts: [{ text: '上記の情報からポーズ画像指示文を生成してください。' }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
        safetySettings: SAFETY_OFF
      }, 'F3'
    );
    var txt = data.candidates && data.candidates[0] && data.candidates[0].content &&
      data.candidates[0].content.parts && data.candidates[0].content.parts[0] &&
      data.candidates[0].content.parts[0].text || '';
    if (!txt || txt.length < 10) throw new Error('Empty response');
    dbg('dbgSanitizeOutput', txt);
    addLog('📝 F3 ポーズ画像指示文生成完了: ' + txt.substring(0, 50) + '...', 'success');
    return txt;
  } catch (e) {
    addLog('⚠️ F3 ポーズ指示文生成失敗: ' + e.message + ' → フォールバック', 'warning');
    return buildGeminiPromptJapanese();
  }
}

// ============================================================
// F6: キャラ画像SDプロンプト生成（Gemini）
// ============================================================

async function generateCharacterSDPromptGemini(charIndex) {
  var char = state.situation.who[charIndex];
  if (!char) return null;

  var poseFromTag = state.poseRecords ? state.poseRecords[char.base.name] : null;
  var poseInfo = poseFromTag || char.recent.currentPose || '';

  var attrs = [];
  attrs.push('キャラクター名: ' + (char.base.name || '不明'));
  if (char.base.gender) attrs.push('性別: ' + char.base.gender);
  if (char.base.species) attrs.push('種族: ' + char.base.species);
  if (char.base.hairColor) attrs.push('髪色: ' + char.base.hairColor);
  if (char.base.hairStyle) attrs.push('髪型: ' + char.base.hairStyle);
  if (char.base.eyeColor) attrs.push('瞳: ' + char.base.eyeColor);
  if (char.base.facialFeatures) attrs.push('顔の特徴: ' + char.base.facialFeatures);
  if (char.base.ears) attrs.push('耳: ' + char.base.ears);
  if (char.base.tail) attrs.push('尻尾: ' + char.base.tail);
  if (char.base.otherFeatures) attrs.push('その他の特徴: ' + char.base.otherFeatures);
  if (char.base.bodyType) attrs.push('体型: ' + char.base.bodyType);
  if (char.base.skinTone) attrs.push('肌: ' + char.base.skinTone);
  var clothing = char.recent.clothingState || char.base.clothing;
  if (clothing) attrs.push('服装: ' + clothing);
  if (char.recent.currentExpression) attrs.push('表情: ' + char.recent.currentExpression);
  if (char.recent.currentAction) attrs.push('行動: ' + char.recent.currentAction);

  var where = state.situation.where;
  var bgDesc = where.recent.description || where.base.description;
  var bgLight = where.recent.lighting || where.base.lighting;
  if (bgDesc) attrs.push('背景: ' + bgDesc);
  if (bgLight) attrs.push('照明: ' + bgLight);

  var f6Data = attrs.join('\n');

  var f6Sys = 'Pony Diffusion V6 XLプロンプト生成AI。日本語入力→英語Danbooruタグ変換。\n\n' +
    '出力: JSONのみ、説明不要。\n' +
    '{"positive": "score_9, score_8_up, score_7_up, score_6_up, score_5_up, score_4_up, source_anime, rating_safe, 1girl, solo, [構図], [ポーズ], [表情], [髪], [瞳], [種族特徴], [体型], [肌], [服装], [背景], [照明]", "negative": "score_5, score_4, source_pony, source_furry, lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, jpeg artifacts, signature, watermark, username, blurry", "lora": ""}\n\n' +
    '例: 入力「金髪ロング、青い瞳、猫耳、スレンダー、白いドレス、微笑み、立ちポーズ、月明かりの庭」\n' +
    '→ {"positive": "score_9, score_8_up, score_7_up, score_6_up, score_5_up, score_4_up, source_anime, rating_safe, 1girl, solo, full body, standing, smile, blonde hair, long hair, blue eyes, cat ears, slender, white dress, garden, moonlight, night", "negative": "score_5, score_4, source_pony, source_furry, lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, jpeg artifacts, signature, watermark, username, blurry", "lora": ""}\n\n' +
    'ルール: 全て英語タグ。masterpiece/best quality不要。negativeは必ず上記テンプレートを含める。';

  var f6Input = f6Data + (poseInfo ? '\n\nPose: ' + poseInfo : '');

  var m = MODELS.text[state.selectedTextModel];
  var safetySettings = [
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
  ];

  var result = null;

  // OpenRouterモデルの場合はtextApiFetchで統一ルーティング
  if (m && m.provider === 'openrouter') {
    try {
      var orData = await textApiFetch({
        system_instruction: { parts: [{ text: f6Sys + '\n\n' + f6Input }] },
        contents: [{ role: 'user', parts: [{ text: '上記の情報から英語SDプロンプトをJSON形式で出力してください。' }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 4096, responseMimeType: 'application/json' },
        safetySettings: safetySettings
      }, 'F6');
      var orTxt = (orData.candidates && orData.candidates[0] && orData.candidates[0].content &&
        orData.candidates[0].content.parts && orData.candidates[0].content.parts[0] &&
        orData.candidates[0].content.parts[0].text) || '';
      if (orTxt) {
        orTxt = orTxt.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
        var jm = orTxt.match(/\{[\s\S]*\}/);
        if (jm) {
          try {
            var parsed = JSON.parse(jm[0]);
            if (parsed.positive) result = parsed;
          } catch (e1) { /* JSON parse failed */ }
        }
        if (!result) result = _parseF6TextResponse(orTxt);
      }
    } catch (e) {
      addLog('⚠️ F6 OpenRouter失敗: ' + e.message, 'warning');
    }
  } else {
    // Gemini API (3段階試行)
    var apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/' + m.endpoint + ':generateContent?key=' + state.apiKey;

    // 試行1: 全データをsystem_instructionに統合
    result = await _f6ApiCall(apiUrl, {
      system_instruction: { parts: [{ text: f6Sys + '\n\n' + f6Input }] },
      contents: [{ role: 'user', parts: [{ text: '上記の情報から英語SDプロンプトをJSON形式で出力してください。' }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 4096, responseMimeType: 'application/json' },
      safetySettings: safetySettings
    }, 'attempt1');

    // 試行2: responseMimeTypeなしフォールバック
    if (!result) {
      addLog('🔄 F6 リトライ: responseMimeTypeなし + ユーザーメッセージ統合', 'info');
      result = await _f6ApiCall(apiUrl, {
        system_instruction: { parts: [{ text: f6Sys }] },
        contents: [{ role: 'user', parts: [{ text: f6Input + '\n\n上記から英語SDプロンプトをJSON形式で出力してください。' }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
        safetySettings: safetySettings
      }, 'attempt2-noMime');
    }

    // 試行3: APIキーローテーション
    if (!result && state.apiKeys && state.apiKeys.length > 1) {
      var altKey = state.apiKeys.find(function(k) { return k !== state.apiKey; }) || state.apiKey;
      var altUrl = 'https://generativelanguage.googleapis.com/v1beta/models/' + m.endpoint + ':generateContent?key=' + altKey;
      addLog('🔄 F6 リトライ: 別APIキー', 'info');
      result = await _f6ApiCall(altUrl, {
        system_instruction: { parts: [{ text: f6Sys + '\n\n' + f6Input }] },
        contents: [{ role: 'user', parts: [{ text: '上記の情報から英語SDプロンプトをJSON形式で出力してください。' }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 4096, responseMimeType: 'application/json' },
        safetySettings: safetySettings
      }, 'attempt3-altkey');
    }
  }

  if (result) {
    state.lastF6Output = result;
    addLog('🎯 F6 SDプロンプト生成完了: ' + (result.positive || '').substring(0, 50) + '...', 'success');
    return result;
  }

  addLog('⚠️ F6: 全試行失敗 → ローカルフォールバック', 'warning');
  var localPrompt = buildCharacterSDPromptEN(charIndex);
  return { positive: localPrompt, negative: SD_DEFAULTS.negativePrompt, lora: '' };
}

// ============================================================
// F6内部: API呼び出し + JSON抽出 + 品質検証
// ============================================================

async function _f6ApiCall(url, body, label) {
  try {
    var res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.status === 503 || res.status === 429) {
      var errBody = await res.text().catch(function() { return ''; });
      addLog('⚠️ F6(' + label + ') HTTP ' + res.status + ': ' + errBody.substring(0, 100) + ' → 5秒待機', 'warning');
      await new Promise(function(r) { setTimeout(r, 5000); });
      return null;
    }
    if (!res.ok) {
      var errBody2 = await res.text().catch(function() { return ''; });
      addLog('⚠️ F6(' + label + ') HTTP ' + res.status + ': ' + errBody2.substring(0, 150), 'warning');
      return null;
    }
    var data = await res.json();

    if (data.promptFeedback && data.promptFeedback.blockReason) {
      addLog('⚠️ F6(' + label + ') PromptBlocked: ' + data.promptFeedback.blockReason, 'warning');
      return null;
    }
    if (!data.candidates || data.candidates.length === 0) {
      addLog('⚠️ F6(' + label + ') No candidates. promptFeedback=' + JSON.stringify(data.promptFeedback || {}), 'warning');
      return null;
    }

    var candidate = data.candidates[0];
    var finishReason = candidate.finishReason || 'unknown';

    if (finishReason === 'SAFETY') {
      var ratings = (candidate.safetyRatings || []).filter(function(r) { return r.blocked; }).map(function(r) { return r.category; }).join(',');
      addLog('⚠️ F6(' + label + ') SafetyBlocked: ' + ratings, 'warning');
      return null;
    }

    var txt = candidate.content && candidate.content.parts && candidate.content.parts[0] && candidate.content.parts[0].text || '';
    if (!txt) {
      addLog('⚠️ F6(' + label + ') Empty text. finishReason=' + finishReason, 'warning');
      return null;
    }

    if (finishReason === 'MAX_TOKENS') {
      addLog('⚠️ F6(' + label + ') finishReason=MAX_TOKENS → レスポンス途中切れ', 'warning');
    } else if (finishReason !== 'STOP') {
      addLog('⚠️ F6(' + label + ') finishReason=' + finishReason + ' len=' + txt.length + '文字', 'warning');
    } else {
      addLog('📄 F6(' + label + ') finishReason=STOP len=' + txt.length + '文字', 'info');
    }

    txt = txt.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    addLog('📄 F6(' + label + ') レスポンス全文:\n' + txt.substring(0, 500), 'info');

    // 品質検証ヘルパー
    var _validateF6Result = function(parsed, source) {
      if (!parsed || !parsed.positive) return null;
      var pos = parsed.positive.toLowerCase();
      var tagCount = pos.split(',').length;
      if (tagCount < 10) {
        addLog('⚠️ F6(' + label + ') ' + source + ': タグ数不足（' + tagCount + '個）→ 棄却', 'warning');
        return null;
      }
      var hasHair = /\bhair\b/.test(pos);
      var hasEyes = /\beyes?\b/.test(pos);
      var hasSpecies = /\b(ears?|tail|horns?|antlers?|wings?|fangs?)\b/.test(pos);
      var hasCharFeature = hasHair || hasEyes || hasSpecies;
      if (!hasCharFeature) {
        addLog('⚠️ F6(' + label + ') ' + source + ': キャラ特徴なし → 棄却', 'warning');
        return null;
      }
      if (!parsed.negative) {
        addLog('⚠️ F6(' + label + ') ' + source + ': negative空 → baseNegで補完', 'warning');
      }
      addLog('✅ F6(' + label + ') ' + source + ': 品質OK（tags=' + tagCount + ' hair=' + hasHair + ' eyes=' + hasEyes + ' species=' + hasSpecies + '）', 'info');
      return parsed;
    };

    // JSON抽出
    var jm = txt.match(/\{[\s\S]*\}/);
    if (jm) {
      var parsed = safeParseJSON(jm[0], 'F6');
      var validated = _validateF6Result(parsed, 'JSON');
      if (validated) return validated;
      addLog('⚠️ F6(' + label + ') JSON解析成功だが品質不足 → 次の手段へ', 'warning');
    }

    // 不完全JSON修復
    var openBrace = txt.indexOf('{');
    if (openBrace >= 0) {
      addLog('🔧 F6(' + label + ') 不完全なJSON検出 → repairJSON()...', 'info');
      try {
        var repaired = repairJSON(txt.substring(openBrace));
        var parsed2 = JSON.parse(repaired);
        var validated2 = _validateF6Result(parsed2, 'repairJSON');
        if (validated2) {
          addLog('✅ F6(' + label + ') JSON修復+品質検証OK', 'success');
          return validated2;
        }
      } catch (e2) {
        addLog('⚠️ F6(' + label + ') JSON修復失敗: ' + e2.message, 'warning');
      }
    }

    // テキスト形式抽出
    var textParsed = _parseF6TextResponse(txt);
    if (textParsed) {
      var validated3 = _validateF6Result(textParsed, 'テキスト抽出');
      if (validated3) {
        addLog('✅ F6(' + label + ') テキスト形式から抽出+品質OK', 'success');
        return validated3;
      }
    }

    addLog('⚠️ F6(' + label + ') 全抽出手段で品質基準未達 → フォールバックへ', 'warning');
    return null;
  } catch (e) {
    addLog('⚠️ F6(' + label + ') Error: ' + e.message, 'warning');
    return null;
  }
}

// ============================================================
// F6テキスト形式レスポンスからpositive/negativeを抽出
// ============================================================

function _parseF6TextResponse(txt) {
  if (!txt) return null;
  var positive = '';
  var negative = '';
  var lora = '';

  var clean = txt.replace(/\*{1,2}/g, '').trim();

  var labelPat = '(?:negative|ネガティブ|Negative|positive|ポジティブ|Positive|lora|LoRA)(?:\\s*(?:Prompt|prompt))?\\s*[:：]';
  var posMatch = clean.match(new RegExp('(?:positive|ポジティブ|Positive)(?:\\s*(?:Prompt|prompt))?\\s*[:：]\\s*([\\s\\S]*?)(?=' + labelPat + '|$)', 'i'));
  var negMatch = clean.match(new RegExp('(?:negative|ネガティブ|Negative)(?:\\s*(?:Prompt|prompt))?\\s*[:：]\\s*([\\s\\S]*?)(?=' + labelPat + '|$)', 'i'));
  var loraMatch = clean.match(/(?:lora|LoRA)\s*[:：]\s*([^\n]*)/i);

  if (posMatch) positive = posMatch[1].trim();
  if (negMatch) negative = negMatch[1].trim();
  if (loraMatch) lora = loraMatch[1].trim();

  var cleanTags = function(s) {
    return s
      .replace(/^\s*[-•*]\s*/gm, '')
      .split('\n')
      .map(function(l) { return l.trim().replace(/,\s*$/, ''); })
      .filter(Boolean)
      .join(', ')
      .replace(/,\s*,/g, ',')
      .replace(/,\s*$/, '');
  };

  if (positive) positive = cleanTags(positive);
  if (negative) negative = cleanTags(negative);

  if (!positive && !negative) {
    var lines = clean.split('\n').map(function(l) { return l.trim(); }).filter(Boolean);
    var tagLine = lines.find(function(l) { return l.startsWith('score_9'); });
    if (tagLine) positive = tagLine;
  }

  if (positive) {
    addLog('📝 F6テキスト抽出: positive=' + positive.substring(0, 60) + '...', 'info');
    return { positive: positive, negative: negative, lora: lora };
  }
  return null;
}

// ============================================================
// ローカルフォールバック: SD/Pony用英語プロンプト生成
// ============================================================

function buildCharacterSDPromptEN(charIndex) {
  var char = state.situation.who[charIndex];
  if (!char) return '';

  var tags = [];

  // 0. Pony V6 XL品質スコア
  tags.push('score_9', 'score_8_up', 'score_7_up', 'score_6_up', 'score_5_up', 'score_4_up', 'source_anime', 'rating_safe');

  // 1. 性別・人数
  var gender = (char.base.gender || '').toLowerCase().trim();
  var isMale = (
    gender === 'male' || gender === 'boy' || gender === 'man' || gender === '1boy' ||
    gender === '男' || gender === '男性' ||
    (gender.includes('male') && !gender.includes('female'))
  );
  tags.push(isMale ? '1boy' : '1girl');
  tags.push('solo');

  // 2. 構図
  var pose = (char.recent.currentPose || '').toLowerCase();
  if (pose.includes('lying') || pose.includes('on back') || pose.includes('on bed') ||
    pose.includes('横たわ') || pose.includes('仰向け') || pose.includes('ベッド')) {
    tags.push('from above', 'looking at viewer');
  } else if (pose.includes('kneeling') || pose.includes('on knees') || pose.includes('all fours') ||
    pose.includes('膝をつ') || pose.includes('跪') || pose.includes('四つん這い')) {
    tags.push('full body');
  } else if (pose.includes('sitting') || pose.includes('seated') ||
    pose.includes('座') || pose.includes('腰掛')) {
    tags.push('upper body');
  } else if (pose.includes('standing') || pose.includes('立ち') || pose.includes('立って') || pose.includes('直立')) {
    tags.push('full body');
  } else {
    tags.push('cowboy shot');
  }

  // 3. ポーズ
  if (char.recent.currentPose) {
    var poseTags = _extractPoseTags(char.recent.currentPose);
    tags.push.apply(tags, poseTags);
  }

  // 4. 表情
  if (char.recent.currentExpression) {
    var exprTags = _mapExpressionTags(char.recent.currentExpression);
    tags.push.apply(tags, exprTags);
  }

  // 5. 髪色
  if (char.base.hairColor) {
    var hc = _extractColorTag(char.base.hairColor);
    if (hc) tags.push(hc.includes('hair') ? hc : hc + ' hair');
  }

  // 6. 髪型
  if (char.base.hairStyle) {
    var hs = _normalizeDanbooruTag(char.base.hairStyle);
    if (hs && _isValidTag(hs)) tags.push(hs);
  }

  // 7. 瞳
  if (char.base.eyeColor) {
    var ec = _extractColorTag(char.base.eyeColor);
    if (ec) tags.push(ec.includes('eyes') ? ec : ec + ' eyes');
  }

  // 8. 種族・獣特徴
  if (char.base.species) { var t = _normalizeDanbooruTag(char.base.species); if (_isValidTag(t)) tags.push(t); }
  if (char.base.ears) { var t2 = _normalizeDanbooruTag(char.base.ears); if (_isValidTag(t2)) tags.push(t2); }
  if (char.base.tail) { var t3 = _normalizeDanbooruTag(char.base.tail); if (_isValidTag(t3)) tags.push(t3); }
  if (char.base.otherFeatures) {
    _splitAndNormalize(char.base.otherFeatures).forEach(function(t) { if (_isValidTag(t)) tags.push(t); });
  }
  if (char.base.facialFeatures) {
    _splitAndNormalize(char.base.facialFeatures).forEach(function(t) { if (_isValidTag(t)) tags.push(t); });
  }

  // 9. 体型
  if (char.base.bodyType) {
    _splitAndNormalize(char.base.bodyType).forEach(function(t) { if (_isValidTag(t)) tags.push(t); });
  }

  // 10. 肌
  if (char.base.skinTone) {
    var st = _extractColorTag(char.base.skinTone);
    if (st) tags.push(st.includes('skin') ? st : st + ' skin');
  }

  // 11. 服装
  var clothingVal = char.recent.clothingState || char.base.clothing;
  if (clothingVal) {
    _splitAndNormalize(clothingVal).forEach(function(t) { if (_isValidTag(t)) tags.push(t); });
  }

  // 12. 行動
  if (char.recent.currentAction) {
    var actionTag = _normalizeDanbooruTag(char.recent.currentAction);
    if (_isValidTag(actionTag)) tags.push(actionTag);
  }

  // 13. 背景・照明
  var where = state.situation.where;
  var bgDesc = where.recent.description || where.base.description;
  if (bgDesc) { _splitAndNormalize(bgDesc).forEach(function(t) { if (_isValidTag(t)) tags.push(t); }); }
  var lighting = where.recent.lighting || where.base.lighting;
  if (lighting) { var lt = _normalizeDanbooruTag(lighting); if (_isValidTag(lt)) tags.push(lt); }

  // 重複除去 + フィルター
  var seen = new Set();
  return tags.filter(function(t) {
    if (!t || !_isValidTag(t)) return false;
    if (/[\u3000-\u9fff\uff00-\uffef]/.test(t)) return false;
    var key = t.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(', ');
}

// ============================================================
// Danbooruタグヘルパー
// ============================================================

function _extractColorTag(text) {
  if (!text) return '';
  var colorMap = [
    [/プラチナブロンド|白金/, 'platinum blonde'],
    [/アッシュブラウン/, 'ash brown'],
    [/ストロベリーブロンド/, 'strawberry blonde'],
    [/ライトブラウン|明るい茶/, 'light brown'],
    [/ダークブラウン|暗い茶|濃い茶/, 'dark brown'],
    [/淡灰青|淡灰blue|灰青/, 'grey-blue'],
    [/琥珀色|アンバー/, 'amber'],
    [/蜂蜜色/, 'honey'],
    [/純白|真っ白/, 'white'],
    [/漆黒|真っ黒|濡羽色/, 'black'],
    [/深紅|紅/, 'red'],
    [/蒼|碧/, 'blue'],
    [/金色|金髪|黄金/, 'blonde'],
    [/銀色|銀髪/, 'silver'],
    [/茶色|茶褐色|栗色|マロン/, 'brown'],
    [/赤色|赤い|赤/, 'red'],
    [/青色|青い|青/, 'blue'],
    [/緑色|緑/, 'green'],
    [/灰色|灰/, 'grey'],
    [/紫色|紫/, 'purple'],
    [/ピンク|桜色|桃色/, 'pink'],
    [/小麦色|褐色/, 'tan'],
    [/白色|白い|白/, 'white'],
    [/黒色|黒い|黒/, 'black'],
    [/淡い/, 'pale']
  ];
  for (var i = 0; i < colorMap.length; i++) {
    if (colorMap[i][0].test(text)) return colorMap[i][1];
  }
  var enColors = ['white', 'black', 'red', 'blue', 'green', 'brown', 'blonde', 'silver',
    'grey', 'purple', 'pink', 'amber', 'gold', 'platinum blonde', 'light brown', 'dark brown'];
  var lower = text.toLowerCase();
  for (var j = 0; j < enColors.length; j++) {
    if (lower.includes(enColors[j])) return enColors[j];
  }
  return '';
}

function _splitAndNormalize(text) {
  if (!text) return [];
  var parts = text.split(/[、,，。・]+/);
  var results = [];
  for (var i = 0; i < parts.length; i++) {
    var trimmed = parts[i].trim();
    if (!trimmed) continue;
    var normalized = _normalizeDanbooruTag(trimmed);
    if (normalized && _isValidTag(normalized)) {
      results.push(normalized);
    }
  }
  return results;
}

function _isValidTag(tag) {
  if (!tag || tag.length < 2) return false;
  if (/^[\d.%]+$/.test(tag)) return false;
  if (/^(kg|cm|mm|度|cc|ml|g)$/i.test(tag)) return false;
  var tooGeneric = ['red', 'blue', 'green', 'brown', 'white', 'black', 'pink', 'grey', 'purple', 'pale', 'tan', 'of', 'the', 'and', 'a'];
  if (tooGeneric.includes(tag.toLowerCase()) && !tag.includes(' ')) return false;
  if (/[\u3000-\u9fff\uff00-\uffef]/.test(tag)) return false;
  return true;
}

function _normalizeDanbooruTag(text) {
  if (!text) return '';
  var s = text.trim().toLowerCase();

  var jpToEn = [
    [/純白|白色|白い/g, 'white'], [/黒色|黒い|漆黒|濡羽色/g, 'black'],
    [/赤色|赤い|深紅|紅/g, 'red'], [/青色|青い|蒼/g, 'blue'],
    [/緑色|緑の|深緑/g, 'green'], [/茶色|茶褐色|栗色|マロン/g, 'brown'],
    [/金色|金髪|黄金/g, 'blonde'], [/銀色|銀髪/g, 'silver'],
    [/灰色|灰/g, 'grey'], [/紫色|紫/g, 'purple'],
    [/ピンク|桜色|桃色/g, 'pink'], [/小麦色|褐色/g, 'tan'],
    [/プラチナブロンド|白金/g, 'platinum blonde'],
    [/アッシュブラウン|灰みがかった栗色/g, 'ash brown'],
    [/ストロベリーブロンド/g, 'strawberry blonde'],
    [/琥珀色|アンバー/g, 'amber'], [/蜂蜜色/g, 'honey colored'],
    [/淡灰青色|淡い灰青/g, 'pale grey-blue'], [/淡い/g, 'pale'],
    [/ショートカット|ショートヘア|短髪/g, 'short hair'],
    [/ロングヘア|長髪|長い髪/g, 'long hair'],
    [/ミディアムヘア|中髪/g, 'medium hair'],
    [/ウェーブヘア|ウェーブ|波状/g, 'wavy hair'],
    [/ストレート|直毛/g, 'straight hair'],
    [/ボブカット|ボブ/g, 'bob cut'],
    [/ツインテール/g, 'twintails'], [/ポニーテール/g, 'ponytail'],
    [/前髪/g, 'bangs'], [/センターパート/g, 'center parting'],
    [/オールバック/g, 'slicked back'], [/ツーブロック/g, 'undercut'],
    [/外跳ね/g, 'flipped hair'], [/たてがみ|鬣/g, 'mane-like hair'],
    [/切れ長/g, 'sharp eyes'], [/丸い瞳|丸い目/g, 'round eyes'],
    [/大きい瞳|大きい目/g, 'large eyes'], [/瞳孔/g, 'pupils'],
    [/虹彩/g, 'iris'], [/瞬膜/g, 'nictitating membrane'],
    [/睫毛|まつ毛/g, 'eyelashes'],
    [/長身|高身長/g, 'tall'], [/小柄|低身長/g, 'short'],
    [/スレンダー|細身/g, 'slender'], [/豊満|ぽっちゃり/g, 'voluptuous'],
    [/筋肉質/g, 'muscular'], [/モデル体型/g, 'model-like figure'],
    [/巨乳|大きな胸/g, 'large breasts'], [/貧乳|小さな胸/g, 'small breasts'],
    [/引き締まった/g, 'toned'], [/均整の取れた/g, 'well-proportioned'],
    [/幼い|子供のような/g, 'child-like physique'],
    [/透き通った白肌|透明感のある白肌/g, 'pale white skin'],
    [/ペールベージュ/g, 'pale beige skin'], [/色白/g, 'fair skin'],
    [/健康的な肌/g, 'healthy skin'],
    [/猫耳/g, 'cat ears'], [/犬耳/g, 'dog ears'], [/狐耳/g, 'fox ears'],
    [/兎耳|うさ耳/g, 'rabbit ears'], [/狼耳/g, 'wolf ears'],
    [/鹿の耳|鹿耳/g, 'deer ears'], [/ライオンの耳|獅子耳|丸い耳/g, 'round animal ears'],
    [/ヤマアラシの耳/g, 'small round ears'],
    [/鹿の角|鹿角|枝角/g, 'antlers'], [/角/g, 'horns'],
    [/尻尾|しっぽ/g, 'tail'], [/翼|翅/g, 'wings'],
    [/羽毛|羽/g, 'feathers'], [/獣耳/g, 'animal ears'],
    [/エルフ耳|尖った耳/g, 'pointed ears'],
    [/耳介がない|耳孔のみ/g, 'no visible ears'],
    [/水かき/g, 'webbed fingers'], [/牙|ファング/g, 'fangs'],
    [/肩甲骨/g, 'protruding shoulder blades'],
    [/針|棘/g, 'quills'], [/逆立つ/g, 'bristling'],
    [/冷徹|冷淡|冷たい/g, 'cold expression'],
    [/怯え|恐怖/g, 'frightened'], [/涙/g, 'tears'],
    [/怒り|憤怒/g, 'angry'], [/微笑み|笑顔/g, 'smile'],
    [/無表情/g, 'expressionless'], [/羞恥|恥ずかし/g, 'embarrassed'],
    [/緊張/g, 'tense'], [/軽蔑/g, 'contemptuous look'],
    [/敵意/g, 'hostile expression'], [/睨み/g, 'glaring'],
    [/ドレス/g, 'dress'], [/スリット/g, 'slit dress'],
    [/ノースリーブ/g, 'sleeveless'], [/透ける|透け/g, 'see-through'],
    [/レース/g, 'lace'], [/リボン/g, 'ribbon'],
    [/立って|立ち姿|直立/g, 'standing'], [/座って|座り/g, 'sitting'],
    [/腕組み/g, 'arms crossed'], [/仁王立ち/g, 'wide stance'],
    [/内股/g, 'pigeon-toed'], [/俯い/g, 'looking down'],
    [/の$/g, ''], [/な$/g, ''], [/い$/g, '']
  ];

  for (var i = 0; i < jpToEn.length; i++) {
    s = s.replace(jpToEn[i][0], jpToEn[i][1]);
  }

  if (/[\u3000-\u9fff\uff00-\uffef]/.test(s)) {
    var englishParts = s.match(/[a-z][a-z\s\-]+/g);
    return englishParts ? englishParts.join(', ').trim() : '';
  }

  return s.replace(/\s+/g, ' ').trim();
}

function _extractPoseTags(poseText) {
  if (!poseText) return [];
  var text = poseText.toLowerCase();
  var found = [];
  var poseMap = {
    'standing': 'standing', 'sitting': 'sitting', 'kneeling': 'kneeling',
    'lying': 'lying down', 'crouching': 'crouching', 'leaning': 'leaning forward',
    'arms crossed': 'arms crossed', 'hands on hips': 'hands on hips',
    'hand on chest': 'hand on own chest', 'hands together': 'hands together',
    'looking away': 'looking away', 'looking at viewer': 'looking at viewer',
    'looking down': 'looking down', 'looking up': 'looking up',
    'looking to the side': 'looking to the side', 'looking back': 'looking back',
    'from behind': 'from behind', 'from side': 'from side',
    'pigeon-toed': 'pigeon-toed', 'crossed legs': 'crossed legs',
    'spread legs': 'spread legs', 'hunched': 'hunched over',
    'head tilt': 'head tilt', 'turned away': 'turned away',
    'facing away': 'facing away', 'facing side': 'facing to the side',
    'clasped': 'hands clasped', 'fidgeting': 'fidgeting',
    'trembling': 'trembling', 'curled': 'curled up',
    '立って': 'standing', '立ち': 'standing', '直立': 'standing',
    '座って': 'sitting', '座り': 'sitting', '腰掛け': 'sitting',
    '膝をつ': 'kneeling', '跪': 'kneeling',
    '横たわ': 'lying down', '寝て': 'lying down', '仰向け': 'on back',
    'しゃがみ': 'crouching', 'うずくまり': 'crouching',
    '腕組み': 'arms crossed', '腕を組': 'arms crossed',
    '仁王立ち': 'wide stance', '足を開': 'wide stance',
    '内股': 'pigeon-toed', '足を閉': 'legs together',
    '俯い': 'looking down', '見下ろ': 'looking down',
    '見上げ': 'looking up', '顔を背け': 'looking away',
    '振り向': 'looking back', '横を向': 'looking to the side',
    '正面': 'looking at viewer', '視線': 'looking at viewer',
    '丸まっ': 'curled up', '身を縮め': 'hunched over',
    '震え': 'trembling', '顎を上げ': 'chin up',
    '防御': 'defensive pose', '身構え': 'defensive pose',
    '手を重ね': 'hands together', '胸を隠': 'covering chest'
  };
  var keys = Object.keys(poseMap);
  for (var i = 0; i < keys.length; i++) {
    if (text.includes(keys[i])) found.push(poseMap[keys[i]]);
  }
  var unique = [];
  var seen = new Set();
  found.forEach(function(f) { if (!seen.has(f)) { seen.add(f); unique.push(f); } });
  if (unique.length === 0 && poseText.trim()) {
    if (!/[\u3000-\u9fff]/.test(poseText)) unique.push(poseText.trim());
  }
  return unique;
}

function _mapExpressionTags(expr) {
  if (!expr) return [];
  var text = expr.toLowerCase();
  var found = [];
  var exprMap = {
    'smile': 'smile', 'grin': 'grin', 'smirk': 'smirk',
    'blush': 'blush', 'embarrass': 'embarrassed',
    'angry': 'angry', 'frown': 'frowning',
    'sad': 'sad', 'crying': 'crying', 'tears': 'tears',
    'surprised': 'surprised', 'shocked': 'shocked', 'wide eyes': 'wide eyes',
    'nervous': 'nervous', 'anxious': 'nervous',
    'happy': 'happy', 'laughing': 'laughing', 'joy': 'joyful',
    'serious': 'serious', 'expressionless': 'expressionless',
    'closed eyes': 'closed eyes', 'half-closed': 'half-closed eyes',
    'open mouth': 'open mouth', 'closed mouth': 'closed mouth',
    'pout': 'pout', 'tongue out': 'tongue out',
    'scared': 'scared', 'fear': 'scared',
    'sleepy': 'sleepy', 'tired': 'tired',
    'confused': 'confused', 'annoyed': 'annoyed',
    '緊張': 'nervous', '恥ずかし': 'embarrassed', '羞恥': 'embarrassed',
    '怒': 'angry', '怒り': 'angry', '憤': 'angry',
    '悲し': 'sad', '泣': 'crying', '涙': 'tears',
    '笑': 'smile', '微笑': 'smile', '笑顔': 'smile',
    '驚': 'surprised', '冷徹': 'cold expression', '冷淡': 'cold expression',
    '軽蔑': 'contemptuous', '嘲笑': 'smirk', '自嘲': 'smirk',
    '怯え': 'scared', '恐怖': 'scared', '震え': 'trembling',
    '無表情': 'expressionless', '諦念': 'resigned expression',
    '敵意': 'hostile', '睨み': 'glaring', '殺気': 'menacing',
    '苛立': 'annoyed', '不快': 'annoyed', '屈辱': 'humiliated',
    '唇を噛': 'biting lip', '赤面': 'blush'
  };
  var keys = Object.keys(exprMap);
  for (var i = 0; i < keys.length; i++) {
    if (text.includes(keys[i])) found.push(exprMap[keys[i]]);
  }
  var unique = [];
  var seen = new Set();
  found.forEach(function(f) { if (!seen.has(f)) { seen.add(f); unique.push(f); } });
  if (unique.length === 0 && expr.trim()) {
    if (!/[\u3000-\u9fff]/.test(expr)) unique.push(expr.trim());
  }
  return unique;
}

// ============================================================
// ユーティリティ: 感情LoRA自動検出 / バリデーション / 互換ヘルパー
// ============================================================

function build5W1HSettingsInfo() {
  return render5W1HText({ scope: 'merged', includeRecent: true, includeGlossary: true });
}

function detectEmotionLoRA() {
  var textToCheck = [];
  textToCheck.push(state.situation.how.recent.mood || state.situation.how.base.mood || '');
  textToCheck.push(state.situation.what.recent.mainEvent || state.situation.what.base.mainEvent || '');
  state.situation.who.forEach(function(c) {
    if (c.active) {
      textToCheck.push(c.recent.currentExpression || '');
      textToCheck.push(c.recent.currentAction || '');
    }
  });
  var allText = textToCheck.join(' ').toLowerCase();
  var detectedLoras = new Set();
  var entries = Object.entries(EMOTION_LORA_MAP);
  for (var i = 0; i < entries.length; i++) {
    var jpKeyword = entries[i][0];
    var loraInfo = entries[i][1];
    if (allText.includes(jpKeyword)) {
      detectedLoras.add(loraInfo.tag);
      continue;
    }
    var enKeywords = loraInfo.en.split(', ');
    for (var j = 0; j < enKeywords.length; j++) {
      if (allText.includes(enKeywords[j])) {
        detectedLoras.add(loraInfo.tag);
        break;
      }
    }
  }
  return detectedLoras.size > 0 ? Array.from(detectedLoras)[0] : '';
}

function validateSDPrompt(prompt, char) {
  var warnings = [];
  var errors = [];
  var promptLower = prompt.toLowerCase();
  var gender = (char && char.base && char.base.gender || '').toLowerCase().trim();

  var isMale = (
    gender === 'male' || gender === 'boy' || gender === 'man' || gender === '1boy' ||
    gender === '男' || gender === '男性' ||
    (gender.includes('male') && !gender.includes('female'))
  );
  var isFemale = !isMale;

  if (isFemale) {
    var maleTagsFound = [];
    ['1boy', 'male focus', 'male solo'].forEach(function(tag) {
      if (promptLower.includes(tag)) maleTagsFound.push(tag);
    });
    if (maleTagsFound.length > 0) errors.push('女性キャラに男性タグ: ' + maleTagsFound.join(', '));
    if (!promptLower.includes('1girl') && !promptLower.includes('girl')) warnings.push('女性タグ(1girl)が見つかりません');
  }
  if (isMale) {
    if (promptLower.includes('1girl')) errors.push('男性キャラに女性タグ: 1girl');
  }
  return { warnings: warnings, errors: errors, isValid: errors.length === 0 };
}

function buildGeminiPromptJapanese() {
  var parts = [];
  var style = state.situation.how.base.artStyle || 'アニメイラスト風、高品質';
  parts.push(style);
  parts.push('全体構図（シーン全体を捉える）');

  var where = state.situation.where;
  var placeName = where.recent.name || where.base.name;
  var placeDesc = where.recent.description || where.base.description;
  var lightingVal = where.recent.lighting || where.base.lighting;
  if (placeName || placeDesc) {
    var locationPart = '【場所】';
    if (placeName) locationPart += placeName;
    if (placeDesc) locationPart += '、' + placeDesc;
    if (lightingVal) locationPart += '、照明: ' + lightingVal;
    parts.push(locationPart);
  }

  var when = state.situation.when;
  var timeOfDay = when.recent.timeOfDay || when.base.timeOfDay;
  var weather = when.recent.weather || when.base.weather;
  if (timeOfDay || weather) {
    parts.push('【時間】' + [timeOfDay, weather].filter(Boolean).join('、'));
  }

  var activeChars = state.situation.who.filter(function(c) { return c.active && c.base.name; });
  if (activeChars.length > 0) {
    var charDescriptions = activeChars.map(function(c) {
      var charParts = [];
      var charName = c.base.name;
      var poseFromTag = getPoseRecordByName ? getPoseRecordByName(charName) : null;
      var appearance = [];
      if (c.base.hairColor) appearance.push(c.base.hairColor + 'の髪');
      if (c.base.eyeColor) appearance.push(c.base.eyeColor + 'の瞳');
      if (c.base.species) appearance.push(c.base.species);
      if (c.base.ears) appearance.push(c.base.ears);
      charParts.push(charName);
      if (appearance.length > 0) charParts.push('（' + appearance.join('、') + '）');
      if (poseFromTag) {
        charParts.push('のポーズ: ' + poseFromTag);
      } else if (c.recent.currentPose) {
        charParts.push('のポーズ: ' + c.recent.currentPose);
      }
      if (c.recent.currentExpression) charParts.push('、表情: ' + c.recent.currentExpression);
      if (c.recent.currentAction) charParts.push('、行動: ' + c.recent.currentAction);
      return charParts.join('');
    });
    parts.push('【登場人物】\n' + charDescriptions.join('\n'));
  }

  var action = state.situation.what.recent.mainEvent || state.situation.what.base.mainEvent;
  if (action) parts.push('【出来事】' + action);
  var mood = state.situation.how.recent.mood || state.situation.how.base.mood;
  if (mood) parts.push('【雰囲気】' + mood);

  return parts.join('\n\n');
}
