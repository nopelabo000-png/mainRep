// ============================================================
// v2-image-scene.js — シーン画像撮影オーケストレーション + ポーズ管理
// ============================================================

// ============================================================
// ポーズタグ抽出・管理
// ============================================================

function extractPoseTagsFromStory(text) {
  if (!text) return {};
  var poseTagRegex = /\[([^:\]]+):([^\]]+)\]/g;
  var match;
  var newRecords = {};
  while ((match = poseTagRegex.exec(text)) !== null) {
    var charName = match[1].trim();
    var poseDetail = match[2].trim();
    if (!charName || !poseDetail || poseDetail.length < 5) continue;
    newRecords[charName] = poseDetail;
  }
  if (!state.poseRecords) state.poseRecords = {};
  Object.assign(state.poseRecords, newRecords);
  var count = Object.keys(newRecords).length;
  if (count > 0) {
    addLog('📍 ポーズタグ抽出: ' + count + '件 (' + Object.keys(newRecords).join(', ') + ')', 'info');
  }
  return newRecords;
}

function getPoseRecordByName(charName) {
  if (!charName || !state.poseRecords) return null;
  return state.poseRecords[charName] || null;
}

// ============================================================
// 単体ポーズ画像生成 (F3→F4)
// ============================================================

async function generateSingleCharPoseImage(charIndex) {
  var char = state.situation.who[charIndex];
  if (!char || !char.active) {
    addLog('⚠️ キャラ' + charIndex + ' は無効', 'warning');
    return null;
  }
  var charName = char.base.name || 'キャラ' + charIndex;
  addLog('🦴 ' + charName + ' ポーズ画像生成開始 (F3→F4)...', 'info');

  try {
    addLog('📝 F3: ' + charName + ' ポーズ指示文...', 'info');
    var singleCam = [{ type: 'character', charIndex: charIndex }];
    var posePromptJP = await generateSanitizedPosePrompt(singleCam);
    if (!posePromptJP) {
      addLog('⚠️ F3 指示文生成失敗', 'warning');
      return null;
    }
    addLog('📝 F3完了: ' + posePromptJP.substring(0, 50) + '...', 'info');

    addLog('🎨 F4: ' + charName + ' 画像生成...', 'info');
    var image = await generateSanitizedPoseImage(posePromptJP, charIndex);
    if (image) {
      if (!state.poseImagesByChar) state.poseImagesByChar = {};
      state.poseImagesByChar[charIndex] = {
        image: image,
        prompt: posePromptJP,
        timestamp: new Date().toLocaleTimeString('ja-JP')
      };
      state.lastSanitizedPoseImage = image;
      renderPoseImagePanel();
      addLog('✅ ' + charName + ' ポーズ画像生成完了', 'success');
      return image;
    }
  } catch (e) {
    addLog('❌ ' + charName + ' ポーズ画像生成失敗: ' + e.message, 'error');
  }
  return null;
}

// ============================================================
// ポーズ画像パネルUI
// ============================================================

function renderPoseImagePanel() {
  var gallery = document.getElementById('poseImageGallery');
  var btnContainer = document.getElementById('poseGenButtons');
  var countBadge = document.getElementById('poseImageCount');
  if (!gallery) return;

  var activeChars = state.situation.who
    .map(function(c, i) { return { char: c, index: i }; })
    .filter(function(x) { return x.char.active; });

  if (!state.poseImagesByChar) state.poseImagesByChar = {};
  var poseCount = Object.keys(state.poseImagesByChar).length;
  if (countBadge) countBadge.textContent = poseCount + '枚';

  if (activeChars.length === 0) {
    gallery.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:1rem;color:var(--text-muted);font-size:0.75rem;">アクティブなキャラクターがいません</div>';
  } else {
    gallery.innerHTML = activeChars.map(function(x) {
      var cached = state.poseImagesByChar[x.index];
      var charName = x.char.base.name || 'キャラ' + x.index;
      if (cached && cached.image) {
        return '<div style="position:relative;background:rgba(0,0,0,0.3);border-radius:6px;overflow:hidden;border:1px solid var(--border);">' +
          '<div style="padding:0.2rem 0.4rem;font-size:0.6rem;color:var(--text-secondary);background:rgba(0,0,0,0.4);display:flex;justify-content:space-between;align-items:center;">' +
          '<span>🦴 ' + charName + '</span>' +
          '<span style="font-size:0.55rem;color:var(--text-muted);">' + (cached.timestamp || '') + '</span></div>' +
          '<img src="' + cached.image + '" style="width:100%;display:block;" />' +
          '<div style="display:flex;gap:2px;padding:0.2rem;">' +
          '<button onclick="window._genSinglePose(' + x.index + ')" style="flex:1;font-size:0.55rem;padding:0.15rem;border:none;border-radius:3px;cursor:pointer;background:var(--primary);color:white;">🔄 再生成</button></div></div>';
      } else {
        return '<div style="background:rgba(0,0,0,0.3);border-radius:6px;border:1px solid var(--border);padding:0.5rem;text-align:center;">' +
          '<div style="font-size:0.65rem;color:var(--text-secondary);margin-bottom:0.3rem;">🦴 ' + charName + '</div>' +
          '<div style="font-size:0.6rem;color:var(--text-muted);margin-bottom:0.3rem;">未生成</div>' +
          '<button onclick="window._genSinglePose(' + x.index + ')" style="font-size:0.6rem;padding:0.2rem 0.5rem;border:none;border-radius:4px;cursor:pointer;background:var(--primary);color:white;">🦴 生成</button></div>';
      }
    }).join('');
  }

  if (btnContainer) {
    btnContainer.innerHTML = (activeChars.length > 1
      ? '<button onclick="window._genAllPoses()" style="font-size:0.65rem;padding:0.3rem 0.6rem;border:none;border-radius:4px;cursor:pointer;background:var(--accent);color:white;">🦴 全キャラ一括生成</button>' : '') +
      '<button onclick="window._clearPoseImages()" style="font-size:0.65rem;padding:0.3rem 0.6rem;border:none;border-radius:4px;cursor:pointer;background:rgba(255,255,255,0.1);color:var(--text-secondary);">🗑️ クリア</button>';
  }
}

// グローバル公開（onclick用）
window._genSinglePose = async function(charIndex) {
  var btn = event && event.target;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 生成中...'; }
  try { await generateSingleCharPoseImage(charIndex); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '🔄 再生成'; } }
};
window._genAllPoses = async function() {
  var activeIndices = state.situation.who
    .map(function(c, i) { return { c: c, i: i }; })
    .filter(function(x) { return x.c.active; })
    .map(function(x) { return x.i; });
  for (var j = 0; j < activeIndices.length; j++) {
    await generateSingleCharPoseImage(activeIndices[j]);
  }
};
window._clearPoseImages = function() {
  state.poseImagesByChar = {};
  renderPoseImagePanel();
  addLog('🗑️ ポーズ画像をクリア', 'info');
};
window._showPoseDetail = function(charIndex) {
  var cached = state.poseImagesByChar && state.poseImagesByChar[charIndex];
  if (!cached) return;
  var charName = (state.situation.who[charIndex] && state.situation.who[charIndex].base.name) || 'キャラ' + charIndex;
  var modal = document.getElementById('imageModal');
  var modalImg = document.getElementById('modalImage');
  var modalTitle = document.getElementById('modalTitle');
  var modalPrompt = document.getElementById('modalPrompt');
  if (modal && modalImg) {
    modalImg.src = cached.image;
    if (modalTitle) modalTitle.textContent = '🦴 ' + charName + ' ポーズ画像';
    if (modalPrompt) modalPrompt.textContent = cached.prompt || '';
    modal.classList.add('active');
  }
};

// ============================================================
// SDプロンプトプレビュー
// ============================================================

function updateSDPreviewCharSelect() {
  if (!els.sdPreviewCharSelect) return;
  var activeChars = state.situation.who.filter(function(c) { return c.active && c.base.name; });
  var html = '<option value="-1">-- キャラ選択 --</option>';
  activeChars.forEach(function(c) {
    var realIdx = state.situation.who.indexOf(c);
    var emoji = getCharacterEmoji(c);
    html += '<option value="' + realIdx + '">' + emoji + ' ' + c.base.name + '</option>';
  });
  els.sdPreviewCharSelect.innerHTML = html;
}

function updateSDPromptPreview() {
  if (!els.sdPreviewCharSelect || !els.sdPromptPreview) return;
  var idx = parseInt(els.sdPreviewCharSelect.value);
  var validationEl = document.getElementById('sdPromptValidation');

  if (idx < 0 || !state.situation.who[idx]) {
    els.sdPromptPreview.textContent = 'キャラクターを選択してください...';
    if (validationEl) validationEl.innerHTML = '';
    return;
  }

  if (!state.f6ResultsByChar) state.f6ResultsByChar = {};
  var cached = state.f6ResultsByChar[idx];
  if (cached) {
    els.sdPromptPreview.textContent = cached.positive || '(なし)';
    if (validationEl) {
      validationEl.innerHTML =
        '<span style="color:var(--success);font-size:0.6rem;">✅ ' + cached.source + ' (' + cached.timestamp + ')</span>' +
        (cached.negative ? '<div style="color:var(--text-muted);font-size:0.6rem;margin-top:2px;">Neg: ' + cached.negative.substring(0, 80) + '...</div>' : '') +
        (cached.lora ? '<div style="color:var(--text-muted);font-size:0.6rem;">LoRA: ' + cached.lora + '</div>' : '');
    }
  } else {
    var prompt = buildCharacterSDPromptEN(idx);
    els.sdPromptPreview.textContent = prompt || '(キャラ情報なし)';
    if (validationEl) {
      validationEl.innerHTML = '<span style="color:var(--text-muted);font-size:0.6rem;">⚠️ ローカル推定値 — 撮影後にF6実値に更新</span>';
    }
  }
}

function updateLastShotDetails(info) {
  var el = document.getElementById('lastShotDetails');
  if (!el) return;
  var lines = [];
  lines.push('━━━ ' + info.charName + ' (' + info.engine + ') ━━━');
  lines.push('');
  lines.push('【プロンプト生成】' + info.f6Source);
  lines.push('');
  lines.push('【Positive】');
  lines.push(info.positive || '(なし)');
  lines.push('');
  lines.push('【Negative】');
  lines.push(info.negative || '(なし)');
  lines.push('');
  lines.push('【LoRA】');
  lines.push(info.lora || '(なし)');
  lines.push('');
  lines.push('【IP-Adapter】' + (info.hasRefImage ? '✅ 有効' : '❌ 参照画像なし'));
  if (info.ipAdapter) {
    lines.push('  model: ' + info.ipAdapter.model);
    lines.push('  preset: ' + info.ipAdapter.preset);
    lines.push('  weight: ' + info.ipAdapter.weight);
  }
  lines.push('');
  lines.push('【ControlNet】' + (info.hasPoseImage ? '✅ 有効' : '❌ ポーズ画像なし'));
  if (info.controlNet) {
    lines.push('  preprocessor: ' + info.controlNet.preprocessor);
    lines.push('  weight: ' + info.controlNet.weight);
  }
  lines.push('');
  lines.push('【生成設定】');
  lines.push('  解像度: ' + info.resolution);
  lines.push('  steps: ' + info.steps);
  lines.push('  cfg: ' + info.cfg);
  el.textContent = lines.join('\n');
}

// ============================================================
// メイン撮影フロー
// ============================================================

async function generateSceneImages() {
  if (!isTextReady() || state.isGeneratingImages) return;
  var cams = getSelectedCameras();
  if (!cams.length) { showMessage('カメラを選択してください', 'error'); return; }

  var needsSD = cams.some(function(c) { return c.type === 'character'; });
  if (needsSD && !state.sdConnected && !state.runpodConnected) {
    showMessage('RunPod または SD WebUI に接続してください', 'error'); return;
  }

  state.isGeneratingImages = true;
  if (els.generateImagesBtn) {
    els.generateImagesBtn.disabled = true;
    els.generateImagesBtn.innerHTML = '<span class="spinner"></span>';
  }
  state.currentImages = [];

  // 本文からポーズタグ抽出（v2ではDBからテキストを取得する場合もある）
  var storyTextEl = document.getElementById('storyText');
  if (storyTextEl) extractPoseTagsFromStory(storyTextEl.value);

  addLog('📷 撮影フロー開始（' + cams.length + '視点）', 'info');

  try {
    var results = [];
    var hasCharCams = cams.some(function(c) { return c.type === 'character'; });

    // LoRA自動判定
    if (hasCharCams) {
      var autoLora = detectEmotionLoRA();
      state.autoDetectedLora = autoLora || '';
      if (autoLora) addLog('🎭 感情LoRA自動検出: ' + autoLora, 'info');
    }

    if (!state.f6ResultsByChar) state.f6ResultsByChar = {};
    var baseEmotionLora = state.autoDetectedLora || '';

    for (var ci = 0; ci < cams.length; ci++) {
      var cam = cams[ci];
      try {
        var img;
        var usedPrompt;
        var usedEngine;
        var cameraName;
        state.autoDetectedLora = baseEmotionLora;

        if (cam.type === 'overview') {
          cameraName = CAMERA_OVERVIEW.name;
          addLog('🎬 F5: ' + cameraName + ' 全体画像生成...', 'info');
          try {
            img = await generateOverviewImage();
            usedPrompt = '(F5 全体画像)';
            usedEngine = 'Gemini (F5 全体画像)';
            addLog('✅ F5 全体画像生成完了', 'success');
          } catch (e) {
            addLog('⚠️ F5 失敗: ' + e.message + ' → フォールバック', 'warning');
            usedPrompt = buildGeminiPromptJapanese();
            var mi = MODELS.image[state.selectedImageModel];
            if (mi && mi.provider === 'openrouter') {
              img = await generateWithOpenRouter(usedPrompt, mi);
              usedEngine = 'OpenRouter (フォールバック)';
            } else {
              img = await generateWithGemini(usedPrompt, mi);
              usedEngine = 'Gemini (フォールバック)';
            }
          }

        } else if (cam.type === 'character' && cam.charIndex !== null) {
          var char = state.situation.who[cam.charIndex];
          cameraName = char ? char.base.name : 'キャラ' + cam.charIndex;
          addLog('🎬 ' + cameraName + ' 撮影中...', 'info');

          var refImage = (char && char.referenceImages && char.referenceImages.length > 0) ? char.referenceImages[0] : null;

          // F3: ポーズ指示文
          var sanitizedPoseImage = null;
          addLog('📝 F3: ' + cameraName + ' ポーズ画像指示文生成...', 'info');
          var singleCharCam = [{ type: 'character', charIndex: cam.charIndex }];
          var posePromptJP = await generateSanitizedPosePrompt(singleCharCam);

          if (posePromptJP) {
            addLog('📝 F3完了: ' + posePromptJP.substring(0, 60) + '...', 'info');
            // F4: ポーズ画像生成
            addLog('🎨 F4: ' + cameraName + ' ポーズ画像生成...', 'info');
            dbg('dbgPoseInput', posePromptJP);
            try {
              sanitizedPoseImage = await generateSanitizedPoseImage(posePromptJP, cam.charIndex);
              state.lastSanitizedPoseImage = sanitizedPoseImage;
              if (!state.poseImagesByChar) state.poseImagesByChar = {};
              state.poseImagesByChar[cam.charIndex] = {
                image: sanitizedPoseImage,
                prompt: posePromptJP,
                timestamp: new Date().toLocaleTimeString('ja-JP')
              };
              renderPoseImagePanel();
              addLog('✅ F4 ' + cameraName + ' ポーズ画像完了', 'success');
            } catch (e) {
              addLog('⚠️ F4 ' + cameraName + ' スキップ: ' + e.message, 'warning');
            }
          }

          // F6: SDプロンプト生成
          addLog('🎯 F6: ' + cameraName + ' SDプロンプト生成...', 'info');
          var f6Result = await generateCharacterSDPromptGemini(cam.charIndex);
          usedPrompt = (f6Result && f6Result.positive) || buildCharacterSDPromptEN(cam.charIndex);

          state.f6ResultsByChar[cam.charIndex] = {
            positive: usedPrompt,
            negative: (f6Result && f6Result.negative) || '',
            lora: (f6Result && f6Result.lora) || '',
            source: f6Result ? 'Gemini F6' : 'ローカルフォールバック',
            timestamp: new Date().toLocaleTimeString('ja-JP')
          };

          // F6 LoRAマージ
          if (f6Result && f6Result.lora && f6Result.lora.trim()) {
            var f6Lora = f6Result.lora.trim();
            if (state.autoDetectedLora) {
              if (!state.autoDetectedLora.includes(f6Lora.replace(/<lora:|:\d+\.?\d*>/g, ''))) {
                state.autoDetectedLora = state.autoDetectedLora + ', ' + f6Lora;
              }
            } else {
              state.autoDetectedLora = f6Lora;
            }
            addLog('🎭 F6 LoRA適用: ' + f6Lora, 'info');
          }

          var f6Negative = (f6Result && f6Result.negative) || '';

          // F7: 画像生成
          if (state.runpodConnected) {
            addLog('🦄 F7 RunPod Pony: ' + usedPrompt.substring(0, 60) + '...', 'info');
            img = await generateWithRunPodComfyUI(usedPrompt, refImage, sanitizedPoseImage, f6Negative);
            usedEngine = 'RunPod Pony V6' +
              (refImage ? ' +IP-Adapter' : '') +
              (sanitizedPoseImage ? ' +ControlNet' : '');
          } else {
            addLog('🎨 F7 SD WebUI: ' + usedPrompt.substring(0, 60) + '...', 'info');
            img = await generateWithSDWebUI(usedPrompt, refImage, sanitizedPoseImage, f6Negative);
            var hasRef = state.sdSettings.useImg2Img && refImage;
            usedEngine = 'SD ' + (hasRef ? 'img2img' : 'txt2img') +
              (sanitizedPoseImage ? ' +ControlNet' : '');
          }

          // 最終送信詳細
          var actualBaseNeg = state.sdSettings.negativePrompt || SD_DEFAULTS.negativePrompt;
          var actualNegative;
          if (f6Negative && f6Negative.trim()) {
            var f6NegTags = f6Negative.split(',').map(function(t) { return t.trim().toLowerCase(); }).filter(Boolean);
            var baseNegTags = actualBaseNeg.split(',').map(function(t) { return t.trim(); }).filter(Boolean);
            var seenNeg = new Set(f6NegTags);
            var extraNeg = baseNegTags.filter(function(t) { return !seenNeg.has(t.toLowerCase()); });
            actualNegative = f6Negative.trim() + (extraNeg.length ? ', ' + extraNeg.join(', ') : '');
          } else {
            actualNegative = actualBaseNeg;
          }
          updateLastShotDetails({
            charName: cameraName,
            engine: usedEngine || '(不明)',
            f6Source: f6Result ? 'Gemini F6' : 'ローカルフォールバック',
            positive: usedPrompt,
            negative: actualNegative,
            lora: state.autoDetectedLora || state.sdSettings.lora || '(なし)',
            hasRefImage: !!refImage,
            hasPoseImage: !!sanitizedPoseImage,
            ipAdapter: refImage ? {
              weight: state.sdSettings.ipAdapterWeight || 0.75,
              model: state.sdSettings.ipAdapterModel || 'ip-adapter-plus_sdxl_vit-h',
              preset: state.sdSettings.ipAdapterPreset || 'PLUS (high strength)'
            } : null,
            controlNet: sanitizedPoseImage ? {
              weight: state.sdSettings.controlNetWeight || 0.8,
              preprocessor: 'DWPreprocessor'
            } : null,
            resolution: (state.sdSettings.width || 832) + 'x' + (state.sdSettings.height || 1216),
            steps: state.sdSettings.steps || 30,
            cfg: state.sdSettings.cfg || 7
          });
        }

        if (img) {
          results.push({
            camera: cam.id, cameraName: cameraName, prompt: usedPrompt,
            src: img, timestamp: new Date().toLocaleTimeString('ja-JP'), model: usedEngine
          });
          addLog('✅ ' + cameraName + ' 完了 (' + usedEngine + ')', 'success');
        }
      } catch (e) {
        addLog('❌ ' + (cam.id || cam) + ': ' + e.message, 'error');
      }
    }

    state.currentImages = results;
    renderCurrentImages(results);
    if (els.imageCount) els.imageCount.textContent = results.length + ' 枚';
    showMessage('✅ ' + results.length + '枚完了', 'success');
    updateSDPromptPreview();
    saveToStorage();

  } catch (e) {
    addLog('❌ 撮影フローエラー: ' + e.message, 'error');
    showMessage('エラー: ' + e.message, 'error');
  } finally {
    state.isGeneratingImages = false;
    if (els.generateImagesBtn) {
      els.generateImagesBtn.disabled = false;
      els.generateImagesBtn.innerHTML = '🎨 撮影';
    }
  }
}
