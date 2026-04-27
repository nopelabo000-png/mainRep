// ============================================================
// v2-image-gen.js — 画像生成バックエンド (Gemini / OpenRouter / SD WebUI / RunPod ComfyUI)
// ============================================================

// ============================================================
// OpenRouter 画像生成 (OpenAI互換 Chat Completions + image modality)
// ============================================================

async function generateWithOpenRouter(prompt, mi) {
  if (!state.openrouterReady) throw new Error('OpenRouter APIキーが未設定です');

  var refs = collectActiveReferenceImages();
  var maxRef = mi.maxReferenceImages || 3;
  var contentParts = [];

  if (refs.length && mi.supportsReference) {
    var charSet = new Set();
    var charNames = [];
    refs.slice(0, maxRef).forEach(function(entry) {
      if (entry.name && !charSet.has(entry.name)) { charSet.add(entry.name); charNames.push(entry.name); }
      var im = entry.image.match(/^data:image\/\w+;base64,/);
      if (im) {
        contentParts.push({ type: 'image_url', image_url: { url: entry.image } });
      }
    });
    var labelText = '上記の参考画像（' + charNames.join('、') + '）の外見を維持しながら、以下の場面を描いてください: ' + prompt;
    contentParts.push({ type: 'text', text: labelText });
  } else {
    contentParts.push({ type: 'text', text: 'Generate an image: ' + prompt });
  }

  var requestBody = {
    model: mi.endpoint,
    messages: [{ role: 'user', content: contentParts }],
    modalities: ['image', 'text']
  };

  addLog('🌐 OpenRouter Image: ' + mi.endpoint + ' (refs=' + Math.min(refs.length, maxRef) + ')', 'info');

  var maxRetries = 3;
  var lastError = null;
  for (var attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      var waitSec = Math.min(5 * Math.pow(2, attempt - 1), 30);
      addLog('🔄 OpenRouter Image リトライ ' + attempt + '/' + (maxRetries - 1) + '（' + waitSec + '秒後）', 'info');
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
        body: JSON.stringify(requestBody)
      });
      if (res.status === 429 || res.status === 503) {
        var errText = await res.text().catch(function() { return ''; });
        addLog('⚠️ OpenRouter Image HTTP ' + res.status + ': ' + errText.substring(0, 120), 'warning');
        lastError = new Error('OpenRouter Image HTTP ' + res.status);
        continue;
      }
      if (!res.ok) {
        var et = await res.text().catch(function() { return ''; });
        throw new Error('OpenRouter Image API Error: ' + res.status + ' - ' + et.substring(0, 200));
      }
      var data = await res.json();
      if (data.error) throw new Error('OpenRouter Error: ' + (data.error.message || JSON.stringify(data.error)));

      var choice = data.choices && data.choices[0];
      var msg = choice && choice.message;
      // 画像レスポンスは message.images[].image_url.url に格納される
      if (msg && Array.isArray(msg.images) && msg.images.length > 0) {
        var imgUrl = msg.images[0].image_url && msg.images[0].image_url.url;
        if (imgUrl && imgUrl.startsWith('data:image/')) {
          addLog('✅ OpenRouter Image 生成完了', 'success');
          return imgUrl;
        }
      }
      // フォールバック: contentに画像が埋め込まれているケース
      if (msg && Array.isArray(msg.content)) {
        for (var i = 0; i < msg.content.length; i++) {
          var part = msg.content[i];
          if (part.type === 'image_url' && part.image_url && part.image_url.url && part.image_url.url.startsWith('data:image/')) {
            addLog('✅ OpenRouter Image 生成完了 (content)', 'success');
            return part.image_url.url;
          }
        }
      }
      throw new Error('OpenRouter: 画像が返されませんでした');
    } catch (e) {
      if (e.message.includes('HTTP 429') || e.message.includes('HTTP 503')) {
        lastError = e; continue;
      }
      throw e;
    }
  }
  throw lastError || new Error('OpenRouter Image 全リトライ失敗');
}

// ============================================================
// Gemini 画像生成
// ============================================================

async function generateWithGemini(prompt, mi) {
  var refs = collectActiveReferenceImages();
  var contents;
  if (refs.length && mi.supportsReference) {
    var parts = buildReferenceImageParts(refs, mi.maxReferenceImages || 1);
    var charList = refs.slice(0, mi.maxReferenceImages || 1).map(function(e) { return e.name; }).join(', ');
    parts.push({ text: 'Using the reference images (' + charList + ') for character consistency. Generate: ' + prompt });
    contents = [{ parts: parts }];
  } else {
    contents = [{ parts: [{ text: 'Generate an image: ' + prompt }] }];
  }
  var res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + mi.endpoint + ':generateContent?key=' + state.apiKey, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: contents,
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      safetySettings: SAFETY_OFF
    })
  });
  if (!res.ok) throw new Error('Image API Error');
  var data = await res.json();
  var resParts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts || [];
  for (var i = 0; i < resParts.length; i++) {
    if (resParts[i].inlineData) return 'data:' + (resParts[i].inlineData.mimeType || 'image/png') + ';base64,' + resParts[i].inlineData.data;
  }
  throw new Error('画像生成失敗');
}

// ============================================================
// F5: 全体画像撮影（Gemini）
// ============================================================

async function generateOverviewImage() {
  var rendered5W1H = render5W1HText({ scope: 'merged', sanitize: true, includeRecent: true, includeMemories: false });
  var recentText = typeof getRecentParagraphs === 'function' ? getRecentParagraphs(500) : '';
  var m = MODELS.image[state.selectedImageModel];

  var refEntries = collectActiveReferenceImages();
  var maxRefF5 = Math.min(refEntries.length, m.maxReferenceImages || 3);

  var prompt = '';
  if (refEntries.length > 0) {
    var charList = [];
    var charSet = new Set();
    refEntries.slice(0, maxRefF5).forEach(function(e) { if (!charSet.has(e.name)) { charSet.add(e.name); charList.push(e.name); } });
    prompt = '上記の参考画像（' + charList.join('、') + '）のキャラクターの外見を正確に維持しながら、以下の場面を描いてください。\n' +
      '各キャラクターは参考画像の髪色・髪型・目の色・体型・服装を厳密に反映すること。\n\n' +
      '【全体画像生成指示】\n物語の場面全体を表現する完成度の高いアニメイラスト風のシーン画像を生成してください。\n' +
      '背景は物語の場所・時間を正確に反映し、キャラクターの配置やポーズも忠実に再現してください。\n\n' +
      rendered5W1H + '\n\n【直前の物語】\n' + recentText;
  } else {
    prompt = '以下の指示に従い、アニメイラスト風の画像を生成してください：\n\n' +
      '【全体画像生成指示】\n物語の場面全体を表現する完成度の高いシーン画像を生成してください。\n' +
      '背景は物語の場所・時間を正確に反映し、キャラクターの配置やポーズも忠実に再現してください。\n\n' +
      rendered5W1H + '\n\n【直前の物語】\n' + recentText;
  }

  // OpenRouter経由の画像生成
  if (m && m.provider === 'openrouter') {
    addLog('📸 F5 全体画像生成（OpenRouter, 参考画像 ' + maxRefF5 + '/' + refEntries.length + '枚送信）', 'info');
    return await generateWithOpenRouter(prompt, m);
  }

  var imageParts = buildReferenceImageParts(refEntries, maxRefF5);
  var parts = imageParts.concat([{ text: prompt }]);
  addLog('📸 F5 全体画像生成（参考画像 ' + maxRefF5 + '/' + refEntries.length + '枚送信）', 'info');

  var f5Body = {
    contents: [{ parts: parts }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'], temperature: 0.8 },
    safetySettings: SAFETY_OFF
  };

  var data = null;
  for (var attempt = 0; attempt < 3; attempt++) {
    var apiKey = (attempt > 0 && state.apiKeys && state.apiKeys.length > 1)
      ? (state.apiKeys[attempt % state.apiKeys.length] || state.apiKey) : state.apiKey;
    if (attempt > 0) {
      var waitSec = Math.min(5 * Math.pow(2, attempt - 1), 20);
      addLog('🔄 F5 リトライ ' + attempt + '/2（' + waitSec + '秒後）', 'info');
      await new Promise(function(r) { setTimeout(r, waitSec * 1000); });
    }
    var res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + m.endpoint + ':generateContent?key=' + apiKey, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(f5Body)
    });
    if (res.status === 503 || res.status === 429) { addLog('⚠️ F5 HTTP ' + res.status, 'warning'); continue; }
    if (!res.ok) throw new Error('F5 API Error: ' + res.status);
    data = await res.json();
    break;
  }
  if (!data) throw new Error('F5: 全リトライ失敗 (503/429)');
  var candidate = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts || [];
  var imgPart = candidate.find(function(p) { return p.inlineData; });
  if (!imgPart) throw new Error('F5: 画像が返されませんでした');
  return 'data:' + imgPart.inlineData.mimeType + ';base64,' + imgPart.inlineData.data;
}

// ============================================================
// F4: ポーズ画像生成（Gemini + リトライ戦略）
// ============================================================

async function generateSanitizedPoseImage(sanitizedPromptJP, charIndex) {
  if (!sanitizedPromptJP) return null;

  var refEntries = [];
  if (charIndex !== undefined && charIndex !== null) {
    var char = state.situation.who[charIndex];
    if (char && char.active && char.referenceImages && char.referenceImages.length > 0) {
      var name = char.base.name || 'キャラ' + charIndex;
      char.referenceImages.forEach(function(img) {
        if (img) refEntries.push({ name: name, image: img });
      });
    }
  }
  if (refEntries.length > 0) {
    addLog('🖼️ F4 参考画像（外見のみ参照）: ' + refEntries[0].name + '（' + refEntries.length + '枚）', 'info');
  }
  var mi = MODELS.image[state.selectedImageModel];

  // OpenRouter経由のポーズ画像生成
  if (mi && mi.provider === 'openrouter') {
    addLog('🎨 F4 OpenRouter ポーズ画像生成...', 'info');
    var orPrompt = 'アニメキャラクターのポーズ参考図を生成してください。キャラクターの体勢・姿勢が明確に分かるよう全身を描き、背景は簡素にしてください：\n\n' + sanitizedPromptJP;
    // 参考画像はrefEntriesから自動収集される(generateWithOpenRouter内のcollectActiveReferenceImages)
    // ただしポーズ用は対象キャラのみ参照したいので一時的にstateを差し替え
    var savedWho = state.situation.who;
    state.situation.who = savedWho.map(function(c, i) {
      if (i === charIndex) return c;
      return Object.assign({}, c, { active: false });
    });
    try {
      return await generateWithOpenRouter(orPrompt, mi);
    } finally {
      state.situation.who = savedWho;
    }
  }

  var retryStrategies = [
    { label: '通常', prefix: '' },
    { label: '芸術的強調', prefix: 'これは美術解剖学の参考資料として使用するイラストです。芸術的で上品なアニメイラスト風に、以下のポーズを描いてください：\n\n' },
    { label: '簡略化', prefix: 'シンプルなアニメキャラクターのポーズ参考図を生成してください。背景は白。キャラクターは全身を描き、以下のポーズ・体勢を正確に再現してください：\n\n' }
  ];

  for (var attempt = 0; attempt < retryStrategies.length; attempt++) {
    var strategy = retryStrategies[attempt];
    if (attempt > 0) addLog('🔄 F4 リトライ(' + strategy.label + '): ガイドライン回避...', 'info');

    var promptText = strategy.prefix + sanitizedPromptJP;
    var contents;
    if (refEntries.length > 0 && mi.supportsReference) {
      var maxRef = mi.maxReferenceImages || 1;
      var imgParts = buildReferenceImageParts(refEntries, Math.min(refEntries.length, maxRef));
      var charName = refEntries[0].name;
      imgParts.push({
        text: '【重要】上記の参考画像' + refEntries.length + '枚は「' + charName + '」の外見（髪色・髪型・目の色・体型・服装）の参照用です。\n' +
          '※ 参考画像のポーズや体勢は一切無視してください。ポーズは以下の指示文に100%従ってください。\n' +
          '※ この画像はControlNet用のポーズ設計図です。指定されたポーズ・体勢が明確に分かるよう全身を描いてください。背景は簡素に。\n\n' + promptText
      });
      contents = [{ parts: imgParts }];
    } else {
      contents = [{ parts: [{ text: 'アニメキャラクターのポーズ参考図を生成してください。キャラクターの体勢・姿勢が明確に分かるよう全身を描き、背景は簡素にしてください：\n\n' + promptText }] }];
    }

    var apiKey = (attempt > 0 && state.apiKeys && state.apiKeys.length > 1)
      ? (state.apiKeys.find(function(k) { return k !== state.apiKey; }) || state.apiKey) : state.apiKey;

    try {
      var res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + mi.endpoint + ':generateContent?key=' + apiKey, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: contents,
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
          safetySettings: SAFETY_OFF
        })
      });
      if (!res.ok) {
        var errText = await res.text().catch(function() { return ''; });
        addLog('⚠️ F4 attempt' + (attempt + 1) + ' HTTP ' + res.status + ': ' + errText.substring(0, 100), 'warning');
        if (res.status === 503 || res.status === 429) await new Promise(function(r) { setTimeout(r, 5000); });
        continue;
      }
      var data = await res.json();
      if (data.promptFeedback && data.promptFeedback.blockReason) {
        addLog('⚠️ F4 attempt' + (attempt + 1) + ' PromptBlocked: ' + data.promptFeedback.blockReason + ' → リトライ', 'warning');
        continue;
      }
      var cand = data.candidates && data.candidates[0];
      if (!cand) { addLog('⚠️ F4 attempt' + (attempt + 1) + ' No candidates → リトライ', 'warning'); continue; }
      if (cand.finishReason === 'SAFETY') {
        var blocked = (cand.safetyRatings || []).filter(function(r) { return r.blocked; }).map(function(r) { return r.category; }).join(', ');
        addLog('⚠️ F4 attempt' + (attempt + 1) + ' SafetyBlocked: ' + blocked + ' → リトライ', 'warning');
        continue;
      }
      if (cand.finishReason === 'PROHIBITED_CONTENT') {
        addLog('⚠️ F4 attempt' + (attempt + 1) + ' PROHIBITED_CONTENT → リトライ', 'warning');
        continue;
      }
      var resParts = cand.content && cand.content.parts || [];
      for (var p = 0; p < resParts.length; p++) {
        if (resParts[p].inlineData) {
          if (attempt > 0) addLog('✅ F4 リトライ成功(' + strategy.label + ')', 'success');
          return 'data:' + (resParts[p].inlineData.mimeType || 'image/png') + ';base64,' + resParts[p].inlineData.data;
        }
      }
      addLog('⚠️ F4 attempt' + (attempt + 1) + ' 画像なし(テキストのみ) → リトライ', 'warning');
    } catch (e) {
      addLog('⚠️ F4 attempt' + (attempt + 1) + ' Error: ' + e.message, 'warning');
    }
  }
  throw new Error('F4 全リトライ失敗（ガイドライン違反回避不可）');
}

// ============================================================
// SD WebUI 画像生成
// ============================================================

async function generateWithSDWebUI(scenePrompt, referenceImage, poseImage, f6Negative) {
  referenceImage = referenceImage || null;
  poseImage = poseImage || null;
  f6Negative = f6Negative || '';

  var loraPart = state.sdSettings.lora ? state.sdSettings.lora.trim() : '';
  if (state.autoDetectedLora) {
    loraPart = loraPart ? loraPart + ', ' + state.autoDetectedLora : state.autoDetectedLora;
  }
  if (loraPart) loraPart += ', ';

  var hasF6Tags = scenePrompt.includes('score_9');
  var fullPrompt;
  if (hasF6Tags) {
    var userPrefix = state.sdSettings.promptPrefix || '';
    userPrefix = userPrefix
      .replace(/\bscore_\d+(?:_up)?\b/gi, '')
      .replace(/\bsource_\w+\b/gi, '')
      .replace(/\brating_\w+\b/gi, '')
      .replace(/\bmasterpiece\b/gi, '')
      .replace(/\bbest quality\b/gi, '')
      .replace(/,\s*,/g, ',')
      .replace(/^[\s,]+|[\s,]+$/g, '');
    var basePrompt = scenePrompt;
    if (!basePrompt.includes('rating_')) basePrompt += ', rating_safe';
    fullPrompt = loraPart + basePrompt + (userPrefix ? ', ' + userPrefix : '');
  } else {
    var ponyPrefix = 'score_9, score_8_up, score_7_up, score_6_up, score_5_up, score_4_up, source_anime, rating_safe';
    fullPrompt = loraPart + ponyPrefix + ', ' + scenePrompt;
  }

  var hasReference = state.sdSettings.useImg2Img && referenceImage;
  var hasPoseImage = !!poseImage;

  var baseNeg = state.sdSettings.negativePrompt || SD_DEFAULTS.negativePrompt;
  var fullNegative;
  if (f6Negative && f6Negative.trim()) {
    var f6Tags = f6Negative.split(',').map(function(t) { return t.trim().toLowerCase(); }).filter(Boolean);
    var baseTags = baseNeg.split(',').map(function(t) { return t.trim(); }).filter(Boolean);
    var seen = new Set(f6Tags);
    var extra = baseTags.filter(function(t) { return !seen.has(t.toLowerCase()); });
    fullNegative = f6Negative.trim() + (extra.length ? ', ' + extra.join(', ') : '');
  } else {
    fullNegative = baseNeg;
  }

  var payload = {
    prompt: fullPrompt,
    negative_prompt: fullNegative,
    sampler_name: state.sdSettings.sampler,
    steps: parseInt(state.sdSettings.steps),
    cfg_scale: parseFloat(state.sdSettings.cfg),
    width: parseInt(state.sdSettings.width),
    height: parseInt(state.sdSettings.height),
    seed: -1
  };

  if (hasReference) {
    var base64Match = referenceImage.match(/^data:image\/\w+;base64,(.+)$/);
    if (base64Match) {
      payload.init_images = [base64Match[1]];
      payload.denoising_strength = parseFloat(state.sdSettings.denoising) || 0.6;
      payload.resize_mode = parseInt(state.sdSettings.resizeMode) || 0;
    }
  }

  if (hasPoseImage) {
    var poseBase64Match = poseImage.match(/^data:image\/\w+;base64,(.+)$/);
    if (poseBase64Match) {
      var preprocessor = state.sdSettings.controlNetPreprocessor || 'openpose_full';
      payload.alwayson_scripts = {
        controlnet: {
          args: [{
            input_image: poseBase64Match[1],
            module: preprocessor !== 'none' ? 'openpose_full' : 'none',
            model: state.sdSettings.controlNetModel || 'control_v11p_sd15_openpose [cab727d4]',
            weight: 0.85,
            guidance_start: 0.0,
            guidance_end: 0.4,
            control_mode: 0,
            resize_mode: 1
          }]
        }
      };
      addLog('🦴 SD ControlNet: 設計図→ポーズ制御 (前処理: ' + preprocessor + ')', 'info');
    }
  }

  var endpoint = hasReference ? '/sdapi/v1/img2img' : '/sdapi/v1/txt2img';
  var mode = hasReference ? 'img2img' : 'txt2img';
  addLog('🔧 SD ' + mode +
    (hasReference ? ' (参照画像→キャラ一貫性)' : '') +
    (hasPoseImage ? ' + ControlNet (設計図→ポーズ)' : ''), 'info');
  if (loraPart) addLog('🎭 LoRA: ' + loraPart, 'info');

  var res = await fetch(state.sdWebuiUrl + endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('SD WebUI生成失敗: ' + res.status);
  var data = await res.json();
  if (data.images && data.images.length > 0) return 'data:image/png;base64,' + data.images[0];
  throw new Error('画像生成失敗');
}

// ============================================================
// RunPod ComfyUI 画像生成
// ============================================================

async function generateWithRunPodComfyUI(prompt, referenceImage, controlNetImage, f6Negative) {
  referenceImage = referenceImage || null;
  controlNetImage = controlNetImage || null;
  f6Negative = f6Negative || '';

  if (!state.runpodConnected) throw new Error('RunPodに接続してください');

  var loraConfig = (state.sdSettings.lora || '').trim();
  if (state.autoDetectedLora && state.autoDetectedLora.trim()) {
    var autoLora = state.autoDetectedLora.trim();
    loraConfig = loraConfig ? loraConfig + ', ' + autoLora : autoLora;
  }

  var genWidth = parseInt(state.sdSettings.width) || SD_DEFAULTS.width;
  var genHeight = parseInt(state.sdSettings.height) || SD_DEFAULTS.height;
  var genSteps = parseInt(state.sdSettings.steps) || SD_DEFAULTS.steps;
  var genCfg = parseFloat(state.sdSettings.cfg) || SD_DEFAULTS.cfg;
  addLog('📐 生成設定: ' + genWidth + 'x' + genHeight + ' steps=' + genSteps + ' cfg=' + genCfg +
    (state.sdSettings.hiresFixEnabled ? ' HiRes=' + (state.sdSettings.hiresFixUpscale || 1.25) + 'x' : ' HiRes=OFF'), 'info');

  var workflow = buildPonyWorkflow(prompt, {
    width: genWidth, height: genHeight, steps: genSteps, cfg: genCfg,
    seed: Math.floor(Math.random() * 999999999),
    lora: loraConfig, controlNetImage: controlNetImage,
    referenceImage: referenceImage, negativePromptOverride: f6Negative
  });

  var requestData = { input: { workflow: workflow } };
  var images = [];

  // 参照画像 (IP-Adapter用)
  if (referenceImage) {
    var base64Match = referenceImage.match(/^data:image\/(\w+);base64,(.+)$/);
    if (base64Match) {
      var origSizeKB = Math.round(base64Match[2].length * 3 / 4 / 1024);
      addLog('📏 参照画像 元サイズ: ' + origSizeKB + 'KB', 'info');
      try {
        var refMaxW = genWidth || 832;
        var refMaxH = genHeight || 1216;
        var compressed = await resizeBase64Image(referenceImage, refMaxW, refMaxH, null, 'png');
        var compMatch = compressed.match(/^data:image\/(\w+);base64,(.+)$/);
        var compSizeKB = compMatch ? Math.round(compMatch[2].length * 3 / 4 / 1024) : 0;
        addLog('📐 参照画像 PNG: ' + compSizeKB + 'KB (' + refMaxW + 'x' + refMaxH + '以内)', 'info');
        if (compSizeKB > 3000) {
          var jpgFallback = await resizeBase64Image(referenceImage, refMaxW, refMaxH, 0.95);
          var jpgMatch = jpgFallback.match(/^data:image\/(\w+);base64,(.+)$/);
          var jpgSizeKB = jpgMatch ? Math.round(jpgMatch[2].length * 3 / 4 / 1024) : 0;
          addLog('📐 参照画像 PNG大きすぎ→JPEG95: ' + jpgSizeKB + 'KB', 'info');
          if (workflow['20']) workflow['20'].inputs.image = 'input_image.jpg';
          images.push({ name: 'input_image.jpg', image: jpgFallback });
        } else {
          images.push({ name: 'input_image.png', image: compressed });
        }
      } catch (e) {
        addLog('⚠️ 参照画像の処理失敗、元画像を使用: ' + e.message, 'warning');
        images.push({ name: 'input_image.png', image: referenceImage });
      }
    }
  }

  // ControlNet用ポーズ画像
  if (controlNetImage) {
    var poseMatch = controlNetImage.match(/^data:image\/(\w+);base64,(.+)$/);
    if (poseMatch) {
      var poseOrigKB = Math.round(poseMatch[2].length * 3 / 4 / 1024);
      addLog('📏 ポーズ画像 元サイズ: ' + poseOrigKB + 'KB', 'info');
      try {
        var poseCompressed = await resizeBase64Image(controlNetImage, genWidth || 1024, genHeight || 1024, 0.92);
        var poseCompMatch = poseCompressed.match(/^data:image\/(\w+);base64,(.+)$/);
        var poseCompKB = poseCompMatch ? Math.round(poseCompMatch[2].length * 3 / 4 / 1024) : 0;
        addLog('📐 ポーズ画像 圧縮後: ' + poseCompKB + 'KB', 'info');
        images.push({ name: 'pose_reference.jpg', image: poseCompressed });
      } catch (e) {
        addLog('⚠️ ポーズ画像の圧縮失敗: ' + e.message, 'warning');
        images.push({ name: 'pose_reference.jpg', image: controlNetImage });
      }
    }
  }

  if (images.length > 0) {
    var totalSizeKB = images.reduce(function(sum, img) {
      var m = img.image.match(/^data:image\/(\w+);base64,(.+)$/);
      return sum + (m ? Math.round(m[2].length * 3 / 4 / 1024) : 0);
    }, 0);
    addLog('📦 画像合計サイズ: ' + totalSizeKB + 'KB (' + images.length + '枚)', 'info');
    if (totalSizeKB > 8000) addLog('⚠️ 画像サイズが大きい: RunPod 10MiB制限に近い可能性', 'warning');
    requestData.input.images = images;
  }

  addLog('🚀 RunPod ComfyUI生成開始' +
    (controlNetImage ? ' (ControlNet有効)' : '') +
    (referenceImage && state.sdSettings.ipAdapterEnabled !== false ? ' (IP-Adapter有効)' : '') + '...', 'info');

  var wfNodes = Object.keys(workflow).sort(function(a, b) { return parseInt(a) - parseInt(b); });
  var wfSummary = wfNodes.map(function(k) { return k + ':' + workflow[k].class_type; }).join(' → ');
  addLog('🔧 ワークフロー構造: ' + wfSummary, 'info');

  // Submit + poll
  var retryCount = 0;
  var maxRetries = 3;

  while (retryCount <= maxRetries) {
    var runRes = await fetch('https://api.runpod.ai/v2/' + state.runpodEndpointId + '/run', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + state.runpodApiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestData)
    });
    if (!runRes.ok) { var errText = await runRes.text(); throw new Error('RunPod API Error: ' + runRes.status + ' - ' + errText); }

    var job = await runRes.json();
    var jobId = job.id;
    addLog('📋 Job ID: ' + jobId + (retryCount > 0 ? ' (リトライ ' + retryCount + ')' : ''), 'info');

    var attempts = 0;
    var maxAttempts = 300;
    var shouldRetry = false;
    var lastStatus = '';
    var queueStartTime = Date.now();

    while (attempts < maxAttempts) {
      await new Promise(function(resolve) { setTimeout(resolve, 2000); });
      var statusRes = await fetch('https://api.runpod.ai/v2/' + state.runpodEndpointId + '/status/' + jobId, {
        headers: { 'Authorization': 'Bearer ' + state.runpodApiKey }
      });
      if (!statusRes.ok) throw new Error('Status check failed: ' + statusRes.status);
      var status = await statusRes.json();

      if (status.status !== lastStatus) {
        addLog('⏳ Status: ' + lastStatus + ' → ' + status.status, 'info');
        lastStatus = status.status;
      }

      if (status.status === 'COMPLETED') {
        var elapsed = Math.round((Date.now() - queueStartTime) / 1000);
        if (status.output && status.output.images && status.output.images.length > 0) {
          var img = status.output.images[0];
          addLog('✅ RunPod ComfyUI生成完了! (' + elapsed + '秒)', 'success');
          if (img.type === 'base64') return 'data:image/png;base64,' + img.data;
          else if (img.type === 's3_url') return img.data;
        }
        if (status.output && status.output.message) return status.output.message;
        throw new Error('No image in response: ' + JSON.stringify(status.output));
      } else if (status.status === 'FAILED') {
        var errMsg = status.error || 'Unknown error';
        addLog('❌ RunPod FAILED: ' + errMsg, 'error');
        if (errMsg.includes('does not exist') && retryCount < maxRetries) {
          addLog('⚠️ コールドスタート中: 30秒後にリトライ...', 'warning');
          shouldRetry = true;
          break;
        }
        var failOutput = status.output ? (typeof status.output === 'string' ? status.output : JSON.stringify(status.output)) : '';
        if ((failOutput.includes('IPAdapter model not found') || failOutput.includes('IPAdapter')) && referenceImage) {
          addLog('⚠️ IP-Adapterモデル未検出: IP-Adapterなしでリトライ', 'warning');
          return generateWithRunPodComfyUI(prompt, null, controlNetImage, f6Negative);
        }
        throw new Error('Generation failed: ' + errMsg);
      } else if (status.status === 'IN_QUEUE' && attempts % 15 === 0 && attempts > 0) {
        addLog('⏳ キュー待機中... ' + Math.round((Date.now() - queueStartTime) / 1000) + '秒経過', 'info');
      } else if (status.status === 'IN_PROGRESS' && attempts % 10 === 0 && attempts > 0) {
        addLog('⏳ 生成中... ' + Math.round((Date.now() - queueStartTime) / 1000) + '秒経過', 'info');
      }
      attempts++;
    }

    if (shouldRetry) {
      retryCount++;
      await new Promise(function(resolve) { setTimeout(resolve, 30000); });
      addLog('🔄 リトライ ' + retryCount + '/' + maxRetries, 'info');
      continue;
    }
    throw new Error('Timeout: >' + (maxAttempts * 2) + '秒 (last: ' + lastStatus + ')');
  }
  throw new Error('コールドスタートリトライ上限到達');
}

// ============================================================
// Pony Diffusion V6 XL ComfyUI ワークフロー構築
// ============================================================

function buildPonyWorkflow(prompt, options) {
  var width = options.width, height = options.height, steps = options.steps;
  var cfg = options.cfg, seed = options.seed, lora = options.lora;
  var controlNetImage = options.controlNetImage, referenceImage = options.referenceImage;
  var negativePromptOverride = options.negativePromptOverride;

  // サンプラー変換
  var sdSampler = state.sdSettings.sampler || 'DPM++ 2M Karras';
  var comfySampler = 'euler_ancestral';
  var comfyScheduler = 'normal';
  var samplerLower = sdSampler.toLowerCase();
  if (samplerLower.includes('dpmpp_2m') || samplerLower.includes('dpm++ 2m')) comfySampler = 'dpmpp_2m';
  else if (samplerLower.includes('dpmpp_sde') || samplerLower.includes('dpm++ sde')) comfySampler = 'dpmpp_sde';
  else if (samplerLower.includes('dpmpp_2s') || samplerLower.includes('dpm++ 2s')) comfySampler = 'dpmpp_2s_ancestral';
  else if (samplerLower.includes('euler_a') || samplerLower.includes('euler a')) comfySampler = 'euler_ancestral';
  else if (samplerLower.includes('euler')) comfySampler = 'euler';
  else if (samplerLower.includes('ddim')) comfySampler = 'ddim';
  else if (samplerLower.includes('uni_pc') || samplerLower.includes('unipc')) comfySampler = 'uni_pc';
  if (samplerLower.includes('karras')) comfyScheduler = 'karras';
  else if (samplerLower.includes('exponential')) comfyScheduler = 'exponential';

  // プロンプト構築
  var ponyScoreTags = 'score_9, score_8_up, score_7_up, score_6_up, score_5_up, score_4_up, source_anime';
  var hasF6Scores = prompt.includes('score_9');
  var ponyPrompt;
  if (hasF6Scores) {
    var userPrefix = state.sdSettings.promptPrefix || '';
    userPrefix = userPrefix
      .replace(/\bscore_\d+(?:_up)?\b/gi, '').replace(/\bsource_\w+\b/gi, '')
      .replace(/\brating_\w+\b/gi, '').replace(/\bmasterpiece\b/gi, '')
      .replace(/\bbest quality\b/gi, '').replace(/,\s*,/g, ',').replace(/^[\s,]+|[\s,]+$/g, '');
    ponyPrompt = prompt.includes('rating_') ? prompt : prompt + ', rating_safe';
    if (userPrefix) ponyPrompt += ', ' + userPrefix;
  } else {
    ponyPrompt = ponyScoreTags + ', rating_safe, ' + prompt;
  }

  // Negative構築
  var baseNeg = state.sdSettings.negativePrompt || SD_DEFAULTS.negativePrompt;
  var negativePrompt;
  if (negativePromptOverride && negativePromptOverride.trim()) {
    var f6Tags = negativePromptOverride.split(',').map(function(t) { return t.trim().toLowerCase(); }).filter(Boolean);
    var baseTags = baseNeg.split(',').map(function(t) { return t.trim(); }).filter(Boolean);
    var seen = new Set(f6Tags);
    var extra = baseTags.filter(function(t) { return !seen.has(t.toLowerCase()); });
    negativePrompt = negativePromptOverride.trim() + (extra.length ? ', ' + extra.join(', ') : '');
  } else {
    negativePrompt = baseNeg;
  }

  var workflow = {
    "3": {
      "inputs": {
        "seed": seed, "steps": steps, "cfg": cfg,
        "sampler_name": comfySampler, "scheduler": comfyScheduler, "denoise": 1,
        "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0]
      },
      "class_type": "KSampler", "_meta": { "title": "KSampler" }
    },
    "4": {
      "inputs": { "ckpt_name": state.sdSettings.ponyModel || SD_DEFAULTS.ponyModel },
      "class_type": "CheckpointLoaderSimple", "_meta": { "title": "Load Checkpoint" }
    },
    "5": {
      "inputs": {
        "width": state.sdSettings.hiresFixEnabled ? Math.round(width / (state.sdSettings.hiresFixUpscale || 1.5) / 8) * 8 : width,
        "height": state.sdSettings.hiresFixEnabled ? Math.round(height / (state.sdSettings.hiresFixUpscale || 1.5) / 8) * 8 : height,
        "batch_size": 1
      },
      "class_type": "EmptyLatentImage", "_meta": { "title": "Empty Latent Image" }
    },
    "6": { "inputs": { "text": ponyPrompt, "clip": ["4", 1] }, "class_type": "CLIPTextEncode", "_meta": { "title": "CLIP Text Encode (Positive)" } },
    "7": { "inputs": { "text": negativePrompt, "clip": ["4", 1] }, "class_type": "CLIPTextEncode", "_meta": { "title": "CLIP Text Encode (Negative)" } },
    "8": { "inputs": { "samples": ["3", 0], "vae": ["4", 2] }, "class_type": "VAEDecode", "_meta": { "title": "VAE Decode" } },
    "9": { "inputs": { "filename_prefix": "Pony", "images": ["8", 0] }, "class_type": "SaveImage", "_meta": { "title": "Save Image" } }
  };

  var currentModelNode = "4", currentModelOutput = 0;
  var currentClipNode = "4", currentClipOutput = 1;

  // LoRA
  var loraRaw = lora ? lora.trim() : '';
  var loraVal = loraRaw.split(/[\s,]+/)[0] || '';
  var isValidLora = loraVal.length > 0 && loraVal !== '.safetensors' && /^[a-zA-Z0-9_\-]+/.test(loraVal);
  if (isValidLora) {
    var loraName = loraVal.endsWith('.safetensors') ? loraVal : loraVal + '.safetensors';
    addLog('🎭 LoRA: ' + loraName, 'info');
    workflow["10"] = {
      "inputs": {
        "lora_name": loraName,
        "strength_model": state.sdSettings.loraStrengthModel != null ? state.sdSettings.loraStrengthModel : 0.8,
        "strength_clip": state.sdSettings.loraStrengthClip != null ? state.sdSettings.loraStrengthClip : 0.8,
        "model": [currentModelNode, currentModelOutput], "clip": [currentClipNode, currentClipOutput]
      },
      "class_type": "LoraLoader", "_meta": { "title": "Load LoRA" }
    };
    currentModelNode = "10"; currentModelOutput = 0;
    currentClipNode = "10"; currentClipOutput = 1;
  }

  // IP-Adapter
  if (referenceImage && state.sdSettings.ipAdapterEnabled !== false) {
    addLog('🖼️ IP-Adapter: 参照画像でキャラクター一貫性を確保', 'info');
    var ipWeight = parseFloat(state.sdSettings.ipAdapterWeight) || 0.6;
    var ipStartAt = parseFloat(state.sdSettings.ipAdapterStartAt) || 0.0;
    var ipEndAt = parseFloat(state.sdSettings.ipAdapterEndAt) || 0.85;
    var ipModel = state.sdSettings.ipAdapterModel || SD_DEFAULTS.ipAdapterModel;

    var ipPreset = 'PLUS (high strength)';
    var modelLower = ipModel.toLowerCase();
    if (modelLower.includes('plus-face') || modelLower.includes('plus_face')) ipPreset = 'PLUS FACE (portraits)';
    else if (modelLower.includes('full-face') || modelLower.includes('full_face')) ipPreset = 'FULL FACE - SD1.5 only (portraits stronger)';
    else if (modelLower.includes('plus')) ipPreset = 'PLUS (high strength)';
    else if (modelLower.includes('vit-g') || modelLower.includes('vit_g')) ipPreset = 'VIT-G (medium strength)';
    else if (modelLower.includes('light')) ipPreset = 'LIGHT - SD1.5 only (low strength)';

    workflow["20"] = { "inputs": { "image": "input_image.png", "upload": "image" }, "class_type": "LoadImage", "_meta": { "title": "Load Reference Image (IP-Adapter)" } };
    workflow["21"] = { "inputs": { "preset": ipPreset, "model": [currentModelNode, currentModelOutput] }, "class_type": "IPAdapterUnifiedLoader", "_meta": { "title": "Load IPAdapter Model (Unified)" } };
    workflow["24"] = {
      "inputs": {
        "weight": ipWeight, "weight_type": "strong style transfer",
        "combine_embeds": "concat", "embeds_scaling": "K+V",
        "start_at": ipStartAt, "end_at": ipEndAt,
        "model": ["21", 0], "ipadapter": ["21", 1], "image": ["20", 0]
      },
      "class_type": "IPAdapterAdvanced", "_meta": { "title": "IP-Adapter Advanced" }
    };
    currentModelNode = "24"; currentModelOutput = 0;
  }

  // ControlNet
  if (controlNetImage) {
    workflow["11"] = { "inputs": { "image": "pose_reference.jpg", "upload": "image" }, "class_type": "LoadImage", "_meta": { "title": "Load Gemini Design (Pose)" } };

    var cnPreprocessor = state.sdSettings.controlNetPreprocessor || SD_DEFAULTS.controlNetPreprocessor;
    var controlNetImageSource = ["11", 0];
    if (cnPreprocessor && cnPreprocessor !== 'none') {
      addLog('🦴 前処理: ' + cnPreprocessor, 'info');
      workflow["14"] = {
        "inputs": { "image": ["11", 0], "detect_hand": "enable", "detect_body": "enable", "detect_face": "enable", "resolution": Math.min(width, height, 1024) },
        "class_type": cnPreprocessor, "_meta": { "title": "Pose Preprocessor" }
      };
      controlNetImageSource = ["14", 0];
    }
    workflow["12"] = { "inputs": { "control_net_name": state.sdSettings.controlNetModel || SD_DEFAULTS.controlNetModel }, "class_type": "ControlNetLoader", "_meta": { "title": "Load ControlNet" } };
    workflow["13"] = {
      "inputs": {
        "strength": state.sdSettings.controlNetWeight != null ? state.sdSettings.controlNetWeight : SD_DEFAULTS.controlNetWeight,
        "start_percent": state.sdSettings.controlNetStartPercent != null ? state.sdSettings.controlNetStartPercent : SD_DEFAULTS.controlNetStartPercent,
        "end_percent": state.sdSettings.controlNetEndPercent != null ? state.sdSettings.controlNetEndPercent : SD_DEFAULTS.controlNetEndPercent,
        "positive": ["6", 0], "negative": ["7", 0], "control_net": ["12", 0], "image": controlNetImageSource
      },
      "class_type": "ControlNetApplyAdvanced", "_meta": { "title": "ControlNet (Pose Control)" }
    };
    workflow["3"].inputs.positive = ["13", 0];
    workflow["3"].inputs.negative = ["13", 1];
  }

  // 最終配線
  workflow["3"].inputs.model = [currentModelNode, currentModelOutput];
  workflow["6"].inputs.clip = [currentClipNode, currentClipOutput];
  workflow["7"].inputs.clip = [currentClipNode, currentClipOutput];

  // HiRes Fix
  if (state.sdSettings.hiresFixEnabled) {
    var hiresDenoise = state.sdSettings.hiresFixDenoise != null ? state.sdSettings.hiresFixDenoise : 0.5;
    var hiresSteps = state.sdSettings.hiresFixSteps != null ? state.sdSettings.hiresFixSteps : 15;
    addLog('✨ HiRes Fix: upscale=' + (state.sdSettings.hiresFixUpscale || 1.5) + 'x denoise=' + hiresDenoise + ' steps=' + hiresSteps, 'info');
    workflow["15"] = {
      "inputs": { "upscale_method": "bislerp", "width": width, "height": height, "crop": "disabled", "samples": ["3", 0] },
      "class_type": "LatentUpscale", "_meta": { "title": "Latent Upscale (HiRes Fix)" }
    };
    workflow["16"] = {
      "inputs": {
        "seed": seed + 1, "steps": hiresSteps, "cfg": cfg,
        "sampler_name": comfySampler, "scheduler": comfyScheduler, "denoise": hiresDenoise,
        "model": [currentModelNode, currentModelOutput],
        "positive": workflow["3"].inputs.positive, "negative": workflow["3"].inputs.negative,
        "latent_image": ["15", 0]
      },
      "class_type": "KSampler", "_meta": { "title": "KSampler (HiRes Fix 2nd Pass)" }
    };
    workflow["8"].inputs.samples = ["16", 0];
  }

  return workflow;
}

// ============================================================
// RunPod ノード診断
// ============================================================

async function diagnoseRunPodNodes() {
  if (!state.runpodConnected) return;
  addLog('🔍 RunPodノード診断開始...', 'info');

  var testNodes = [
    'IPAdapter', 'IPAdapterApply', 'IPAdapterUnifiedLoader', 'IPAdapterModelLoader',
    'CLIPVisionLoader', 'CLIPVisionEncode', 'IPAdapterAdvanced', 'IPAdapterStyleComposition',
    'ControlNetLoader', 'ControlNetApply', 'ControlNetApplyAdvanced',
    'DWPreprocessor', 'OpenposePreprocessor', 'LoraLoader'
  ];

  var results = {};
  for (var i = 0; i < testNodes.length; i++) {
    var nodeType = testNodes[i];
    try {
      var testWorkflow = {};
      testWorkflow["999"] = { "inputs": {}, "class_type": nodeType, "_meta": { "title": "Node Test" } };
      var res = await fetch('https://api.runpod.ai/v2/' + state.runpodEndpointId + '/run', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + state.runpodApiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { workflow: testWorkflow } })
      });
      if (!res.ok) { results[nodeType] = '❓ API Error'; continue; }
      var job = await res.json();
      await new Promise(function(r) { setTimeout(r, 3000); });
      var statusRes = await fetch('https://api.runpod.ai/v2/' + state.runpodEndpointId + '/status/' + job.id, {
        headers: { 'Authorization': 'Bearer ' + state.runpodApiKey }
      });
      if (statusRes.ok) {
        var status = await statusRes.json();
        if (status.status === 'FAILED') {
          var errMsg = status.error || JSON.stringify(status);
          results[nodeType] = errMsg.includes('does not exist') ? '❌ 未インストール' : '✅ 存在';
        } else if (status.status === 'IN_QUEUE' || status.status === 'IN_PROGRESS') {
          results[nodeType] = '✅ 存在（実行中）';
          try { await fetch('https://api.runpod.ai/v2/' + state.runpodEndpointId + '/cancel/' + job.id, { method: 'POST', headers: { 'Authorization': 'Bearer ' + state.runpodApiKey } }); } catch (ce) { /* ignore */ }
        } else {
          results[nodeType] = '✅ 存在';
        }
      }
    } catch (e) {
      results[nodeType] = '❓ ' + e.message;
    }
  }

  addLog('━━━ RunPodノード診断結果 ━━━', 'info');
  Object.entries(results).forEach(function(entry) {
    addLog('  ' + entry[0] + ': ' + entry[1], entry[1].startsWith('✅') ? 'success' : entry[1].startsWith('❌') ? 'error' : 'warning');
  });
  return results;
}
