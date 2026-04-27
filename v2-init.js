// ============================================================
// v2-init.js — 初期化 + イベントリスナー設定
// ============================================================

function init() {
  state.isGenerating = false;
  state.isGeneratingImages = false;

  // DOM要素キャッシュ
  cacheElements();

  // ストレージ復元
  loadFromStorage();

  // v5.6からの移行チェック
  if (!localStorage.getItem('storyCanvasV2') && localStorage.getItem('storyCanvas')) {
    migrateFromV56();
    addLog('📦 v5.6データを移行しました', 'info');
  }

  // IndexedDB初期化
  openDB().then(function() {
    addLog('💾 IndexedDB v3 初期化完了', 'info');
    // 参照画像復元
    loadImagesFromDB().then(function(images) {
      if (images && images.length > 0) {
        images.forEach(function(img) {
          var matchNew = img.id.match(/^char_(\d+)_(\d+)$/);
          var matchOld = img.id.match(/^char_(\d+)$/);
          if (matchNew) {
            var idx = parseInt(matchNew[1]);
            var imgIdx = parseInt(matchNew[2]);
            if (state.situation.who[idx]) {
              if (!state.situation.who[idx].referenceImages) state.situation.who[idx].referenceImages = [];
              state.situation.who[idx].referenceImages[imgIdx] = img.data;
            }
          } else if (matchOld) {
            var idx2 = parseInt(matchOld[1]);
            if (state.situation.who[idx2]) {
              if (!state.situation.who[idx2].referenceImages) state.situation.who[idx2].referenceImages = [];
              if (state.situation.who[idx2].referenceImages.length === 0) {
                state.situation.who[idx2].referenceImages[0] = img.data;
              }
            }
          }
        });
        state.situation.who.forEach(function(char) {
          if (char.referenceImages) char.referenceImages = char.referenceImages.filter(Boolean);
        });
        renderCharacters();
        var totalImgs = state.situation.who.reduce(function(s, c) { return s + (c.referenceImages ? c.referenceImages.length : 0); }, 0);
        addLog('📷 参考画像を復元 (' + totalImgs + '枚)', 'info');
      }
    }).catch(function(e) { console.error('Failed to load images:', e); });
  }).catch(function(e) { console.error('IndexedDB init failed:', e); });

  // イベントリスナー
  setupEventListeners();

  // UI描画
  renderAllSections();
  renderCharacters();
  updateAPIStatus();

  // パイプラインUI初期化
  if (typeof updatePipelineUI === 'function') updatePipelineUI();

  // プロンプトプレビュー
  if (typeof updateAllPromptPreviews === 'function') updateAllPromptPreviews();
  if (typeof updateClearCharSelect === 'function') updateClearCharSelect();

  // 直近設定削除用キャラセレクト
  if (typeof updateSDPreviewCharSelect === 'function') updateSDPreviewCharSelect();

  // ポーズパネル初期化
  if (typeof renderPoseImagePanel === 'function') renderPoseImagePanel();

  // ボタン状態リセット
  if (els.generateBtn) els.generateBtn.disabled = false;
  if (els.generateImagesBtn) els.generateImagesBtn.disabled = false;

  // 健全化JB初期化
  if (els.sanitizeJbPromptText) {
    els.sanitizeJbPromptText.value = state.sanitizeJailbreakPrompt || JAILBREAK_SANITIZE_PROMPT;
  }

  // JB状態確認
  if (state.jailbreakEnabled && state.jailbreakPrompt) {
    var jbPreview = state.jailbreakPrompt.substring(0, 50);
    if (jbPreview.includes('商業出版経験') || jbPreview.includes('ライトノベル作家') ||
      jbPreview.includes('文芸賞受賞歴') || jbPreview.includes('純文学作家') ||
      jbPreview.includes('TRPGのベテラン') || jbPreview.includes('ゲームマスター')) {
      addLog('🔓 JB設定OK: ' + jbPreview.substring(0, 30) + '...', 'success');
    } else {
      addLog('⚠️ JB設定（カスタム?）: ' + jbPreview.substring(0, 30) + '...', 'warning');
    }
  }

  addLog('🚀 Story Canvas v2 初期化完了', 'info');
}

// ============================================================
// イベントリスナー設定
// ============================================================

function setupEventListeners() {
  // API設定
  if (els.saveApiKeyBtn) els.saveApiKeyBtn.addEventListener('click', saveApiKey);
  if (els.saveOpenrouterKeyBtn) els.saveOpenrouterKeyBtn.addEventListener('click', saveOpenrouterKey);
  if (els.textModel) els.textModel.addEventListener('change', function(e) { state.selectedTextModel = e.target.value; saveToStorage(); });
  if (els.imageModel) els.imageModel.addEventListener('change', function(e) { state.selectedImageModel = e.target.value; saveToStorage(); });
  if (els.ttsModel) els.ttsModel.addEventListener('change', function(e) { state.selectedTTSModel = e.target.value; saveToStorage(); });
  if (els.embeddingModel) els.embeddingModel.addEventListener('change', function(e) { state.selectedEmbeddingModel = e.target.value; saveToStorage(); });
  if (els.connectSDBtn) els.connectSDBtn.addEventListener('click', connectToSDWebUI);
  if (els.connectRunpodBtn) els.connectRunpodBtn.addEventListener('click', connectToRunPod);

  // JailBreak
  if (els.jbToggle) els.jbToggle.addEventListener('click', function() {
    state.jailbreakEnabled = !state.jailbreakEnabled;
    els.jbToggle.classList.toggle('active', state.jailbreakEnabled);
    saveToStorage();
  });
  if (els.jbPreset) els.jbPreset.addEventListener('change', function(e) {
    if (e.target.value !== 'custom') {
      state.jailbreakPrompt = JB_PRESETS[e.target.value] || '';
      if (els.jbPromptText) els.jbPromptText.value = state.jailbreakPrompt;
      saveToStorage();
    }
  });
  if (els.jbPromptText) els.jbPromptText.addEventListener('input', function() {
    state.jailbreakPrompt = els.jbPromptText.value;
    if (els.jbPreset) els.jbPreset.value = 'custom';
    saveToStorage();
  });

  // SD Settings
  var sdBindings = [
    ['sdLora', 'lora', 'input', 'string'],
    ['sdPromptPrefix', 'promptPrefix', 'input', 'string'],
    ['sdNegativePrompt', 'negativePrompt', 'input', 'string'],
    ['sdSteps', 'steps', 'change', 'string'],
    ['sdCfg', 'cfg', 'change', 'string'],
    ['sdWidth', 'width', 'change', 'string'],
    ['sdHeight', 'height', 'change', 'string'],
    ['sdSampler', 'sampler', 'change', 'string']
  ];
  sdBindings.forEach(function(b) {
    if (els[b[0]]) els[b[0]].addEventListener(b[1] === 'input' ? 'input' : 'change', function() {
      state.sdSettings[b[1]] = els[b[0]].value;
      saveToStorage();
    });
  });

  // img2img
  if (els.sdUseImg2Img) els.sdUseImg2Img.addEventListener('change', function() { state.sdSettings.useImg2Img = els.sdUseImg2Img.checked; saveToStorage(); });
  if (els.sdDenoising) els.sdDenoising.addEventListener('change', function() { state.sdSettings.denoising = parseFloat(els.sdDenoising.value); saveToStorage(); });
  if (els.sdResizeMode) els.sdResizeMode.addEventListener('change', function() { state.sdSettings.resizeMode = parseInt(els.sdResizeMode.value); saveToStorage(); });

  // IP-Adapter & ControlNet
  var floatBindings = [
    ['sdIpAdapterEnabled', 'ipAdapterEnabled', 'checked'],
    ['sdIpAdapterModel', 'ipAdapterModel', 'value'],
    ['sdClipVisionModel', 'clipVisionModel', 'value'],
    ['sdIpAdapterWeight', 'ipAdapterWeight', 'float'],
    ['sdIpAdapterStartAt', 'ipAdapterStartAt', 'float'],
    ['sdIpAdapterEndAt', 'ipAdapterEndAt', 'float'],
    ['sdControlNetPreprocessor', 'controlNetPreprocessor', 'value'],
    ['sdControlNetWeight', 'controlNetWeight', 'float'],
    ['sdControlNetStartPercent', 'controlNetStartPercent', 'float'],
    ['sdControlNetEndPercent', 'controlNetEndPercent', 'float'],
    ['sdLoraStrengthModel', 'loraStrengthModel', 'float'],
    ['sdLoraStrengthClip', 'loraStrengthClip', 'float'],
    ['sdHiresFixEnabled', 'hiresFixEnabled', 'checked'],
    ['sdHiresFixDenoise', 'hiresFixDenoise', 'float'],
    ['sdHiresFixUpscale', 'hiresFixUpscale', 'float'],
    ['sdHiresFixSteps', 'hiresFixSteps', 'int']
  ];
  floatBindings.forEach(function(b) {
    if (!els[b[0]]) return;
    var eventType = b[2] === 'checked' ? 'change' : (b[2] === 'value' ? 'input' : 'change');
    els[b[0]].addEventListener(eventType, function() {
      if (b[2] === 'checked') state.sdSettings[b[1]] = els[b[0]].checked;
      else if (b[2] === 'float') state.sdSettings[b[1]] = parseFloat(els[b[0]].value);
      else if (b[2] === 'int') state.sdSettings[b[1]] = parseInt(els[b[0]].value);
      else state.sdSettings[b[1]] = els[b[0]].value;
      saveToStorage();
    });
  });

  // 直近設定クリア
  var clearAllBtn = document.getElementById('clearAllRecentBtn');
  if (clearAllBtn) clearAllBtn.addEventListener('click', clearAllRecent);
  var clearAllCharBtn = document.getElementById('clearAllCharRecentBtn');
  if (clearAllCharBtn) clearAllCharBtn.addEventListener('click', clearAllCharRecent);
  var clearCharBtn = document.getElementById('clearCharRecentBtn');
  if (clearCharBtn) clearCharBtn.addEventListener('click', function() {
    var sel = document.getElementById('clearCharSelect');
    var idx = sel ? parseInt(sel.value) : -1;
    if (idx < 0) { showMessage('キャラクターを選択してください', 'error'); return; }
    clearCharRecent(idx);
  });

  // 健全化JB
  if (els.sanitizeJbPromptText) {
    els.sanitizeJbPromptText.addEventListener('input', function() {
      state.sanitizeJailbreakPrompt = els.sanitizeJbPromptText.value;
      saveToStorage();
    });
  }
  var resetSanitizeBtn = document.getElementById('resetSanitizeJbBtn');
  if (resetSanitizeBtn) resetSanitizeBtn.addEventListener('click', function() {
    state.sanitizeJailbreakPrompt = JAILBREAK_SANITIZE_PROMPT;
    if (els.sanitizeJbPromptText) els.sanitizeJbPromptText.value = JAILBREAK_SANITIZE_PROMPT;
    saveToStorage();
    addLog('🔄 健全化JBをリセット', 'info');
  });

  // JB設定タブ切り替え
  document.querySelectorAll('.jb-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.jb-tab').forEach(function(t) {
        t.classList.remove('active');
        t.style.background = 'transparent';
        t.style.color = 'var(--text-secondary)';
      });
      tab.classList.add('active');
      tab.style.background = 'var(--primary)';
      tab.style.color = 'white';
      document.querySelectorAll('.jb-tab-content').forEach(function(c) { c.style.display = 'none'; });
      var content = document.querySelector('.jb-tab-content[data-jb-content="' + tab.dataset.jbTab + '"]');
      if (content) content.style.display = 'block';
    });
  });

  // v2パイプライン: 物語生成ボタン
  if (els.generateBtn) els.generateBtn.addEventListener('click', function() {
    if (typeof generateStory === 'function') generateStory();
  });

  // 画像撮影ボタン
  if (els.generateImagesBtn) els.generateImagesBtn.addEventListener('click', function() {
    if (typeof generateSceneImages === 'function') generateSceneImages();
  });

  // キャラ追加ボタン
  var addCharBtn = document.getElementById('addCharBtn');
  if (addCharBtn) addCharBtn.addEventListener('click', addCharacter);

  // RunPod診断ボタン
  var diagnoseBtn = document.getElementById('diagnoseRunPodBtn');
  if (diagnoseBtn) diagnoseBtn.addEventListener('click', function() {
    if (typeof diagnoseRunPodNodes === 'function') diagnoseRunPodNodes();
  });

  // 画像モーダル
  var closeModalBtn = document.getElementById('closeModal');
  if (closeModalBtn) closeModalBtn.addEventListener('click', closeImageModal);
  var setRefBtn = document.getElementById('setRefBtn');
  if (setRefBtn) setRefBtn.addEventListener('click', function() {
    if (typeof setAsReference === 'function') setAsReference();
  });
  var downloadBtn = document.getElementById('downloadBtn');
  if (downloadBtn) downloadBtn.addEventListener('click', downloadImage);
  var imageModal = document.getElementById('imageModal');
  if (imageModal) imageModal.addEventListener('click', function(e) {
    if (e.target === imageModal) closeImageModal();
  });

  // SDプレビューキャラ選択
  if (els.sdPreviewCharSelect) {
    els.sdPreviewCharSelect.addEventListener('change', function() {
      if (typeof updateSDPromptPreview === 'function') updateSDPromptPreview();
    });
  }

  // セクション折りたたみ（静的HTMLセクション）
  var staticSections = [
    'jailbreakSection', 'sdSettingsSection', 'characterSection',
    'classifySection', 'skeletonSection', 'charTextSection',
    'requestPromptSection', 'poseImageGallerySection', 'debugApiSection'
  ];
  staticSections.forEach(function(secId) {
    var sec = document.getElementById(secId);
    if (!sec) return;
    var header = sec.querySelector('.section-header');
    if (!header) return;
    header.addEventListener('click', function(e) {
      if (e.target.closest('.toggle-switch')) return;
      var body = sec.querySelector('.section-body');
      var icon = header.querySelector('.collapse-icon');
      if (!body) return;
      body.classList.toggle('collapsed');
      if (icon) icon.textContent = body.classList.contains('collapsed') ? '▶' : '▼';
    });
  });

  // デバッグタブ切り替え
  document.querySelectorAll('.dbg-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.dbg-tab').forEach(function(t) {
        t.classList.remove('active');
        t.style.background = 'transparent';
        t.style.color = 'var(--text-secondary)';
      });
      tab.classList.add('active');
      tab.style.background = 'var(--primary)';
      tab.style.color = 'white';
      document.querySelectorAll('.dbg-content').forEach(function(c) { c.style.display = 'none'; });
      var content = document.querySelector('.dbg-content[data-dbg-content="' + tab.dataset.dbgTab + '"]');
      if (content) content.style.display = 'block';
    });
  });

  // 要求プロンプトタブ切り替え
  document.querySelectorAll('.req-prompt-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.req-prompt-tab').forEach(function(t) {
        t.classList.remove('active');
        t.style.background = 'transparent';
        t.style.color = 'var(--text-secondary)';
      });
      tab.classList.add('active');
      tab.style.background = 'var(--primary)';
      tab.style.color = 'white';
      document.querySelectorAll('.req-prompt-content').forEach(function(c) { c.style.display = 'none'; });
      var content = document.querySelector('.req-prompt-content[data-req-content="' + tab.dataset.reqTab + '"]');
      if (content) content.style.display = 'block';
    });
  });

  // 文章→直近設定
  var convertBtn = document.getElementById('convertToPromptBtn');
  if (convertBtn) convertBtn.addEventListener('click', function() {
    if (typeof convertStoryToPrompt === 'function') convertStoryToPrompt();
  });

  // F8 参考文章→設定追記
  if (els.classifyBtn) els.classifyBtn.addEventListener('click', function() {
    if (typeof classifyReferenceText === 'function') classifyReferenceText();
  });

  // 設定エクスポート
  if (els.exportSettingsBtn) els.exportSettingsBtn.addEventListener('click', function() {
    if (typeof exportBaseSettings === 'function') exportBaseSettings();
  });

  // 基本設定クリア
  if (els.clearBaseBtn) els.clearBaseBtn.addEventListener('click', function() {
    if (typeof clearBaseSettings === 'function') clearBaseSettings(true);
  });

  // シーン選択ボタン（既存のdata-scene付きボタン）
  document.querySelectorAll('#sceneSelector button[data-scene]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var selector = document.getElementById('sceneSelector');
      if (selector) selector.querySelectorAll('button[data-scene]').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      state.currentScene.key = btn.dataset.scene;
      saveToStorage();
      addLog('📍 シーン ' + btn.dataset.scene + ' に切替', 'info');
    });
  });

  // 新シーン
  var newSceneBtn = document.getElementById('newSceneBtn');
  if (newSceneBtn) newSceneBtn.addEventListener('click', function() {
    var selector = document.getElementById('sceneSelector');
    if (!selector) return;
    var existing = selector.querySelectorAll('button[data-scene]');
    var nextKey = String.fromCharCode(65 + existing.length); // A=65, B=66...
    if (existing.length >= 26) { showMessage('シーン上限(26)に達しました', 'error'); return; }

    // ボタンを追加
    var btn = document.createElement('button');
    btn.dataset.scene = nextKey;
    btn.textContent = nextKey;
    newSceneBtn.parentNode.insertBefore(btn, newSceneBtn);

    // クリックで切り替え
    btn.addEventListener('click', function() {
      selector.querySelectorAll('button[data-scene]').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      state.currentScene.key = nextKey;
      state.currentScene.lastEventNum = 0;
      saveToStorage();
      addLog('📍 シーン ' + nextKey + ' に切替', 'info');
    });

    // 自動切り替え
    btn.click();
    addLog('📍 新シーン ' + nextKey + ' を追加', 'success');
  });

  // シーン削除
  var deleteSceneBtn = document.getElementById('deleteSceneBtn');
  if (deleteSceneBtn) deleteSceneBtn.addEventListener('click', function() {
    var selector = document.getElementById('sceneSelector');
    if (!selector) return;
    var sceneBtns = selector.querySelectorAll('button[data-scene]');
    if (sceneBtns.length <= 1) { showMessage('最後のシーンは削除できません', 'error'); return; }
    var targetKey = state.currentScene.key;
    if (!confirm('シーン ' + targetKey + ' を削除しますか？\n骨組み・本文データも削除されます。')) return;

    // 削除対象のボタンを探して除去
    var targetBtn = selector.querySelector('button[data-scene="' + targetKey + '"]');
    if (targetBtn) targetBtn.remove();

    // IndexedDBからシーンデータ削除
    if (typeof _dbDelete === 'function') {
      _dbDelete('skeletons', targetKey).catch(function(e) { console.error('skeleton delete:', e); });
      // characterTexts はシーン別インデックスから取得して削除
      if (typeof loadCharTextsByScene === 'function') {
        loadCharTextsByScene(targetKey).then(function(docs) {
          if (docs) docs.forEach(function(doc) {
            _dbDelete('characterTexts', doc.id).catch(function(e) { console.error('charText delete:', e); });
          });
        }).catch(function(e) { console.error('charText load:', e); });
      }
    }

    // 別のシーンに切り替え
    var remaining = selector.querySelectorAll('button[data-scene]');
    if (remaining.length > 0) {
      remaining[0].click();
    }

    // 骨組みビューアとキャラ本文をクリア
    if (els.skeletonViewer) {
      els.skeletonViewer.innerHTML = '<p style="font-size:0.75rem;color:var(--text-muted);text-align:center;padding:1rem;">生成するとここに骨組みが表示されます</p>';
    }
    if (els.charTextContents) els.charTextContents.innerHTML = '';
    if (els.charTextTabs) {
      els.charTextTabs.innerHTML = '<span style="font-size:0.7rem;color:var(--text-muted);padding:0.3rem;">キャラクターなし</span>';
    }

    saveToStorage();
    addLog('🗑️ シーン ' + targetKey + ' を削除', 'info');
  });

  // プレイヤー入力送信
  var playerSubmitBtn = document.getElementById('playerSubmitBtn');
  if (playerSubmitBtn) playerSubmitBtn.addEventListener('click', function() {
    if (typeof submitPlayerInput === 'function') submitPlayerInput();
  });

  // プレイヤー本文承認・再生成
  // ※ showPlayerEditUIAsync() がPromise内でリスナーを付け外しするため、ここでは登録しない

  // プロンプトプレビュー更新・コピー
  var refreshStoryGenBtn = document.getElementById('refreshStoryGenPromptBtn');
  if (refreshStoryGenBtn) refreshStoryGenBtn.addEventListener('click', function() {
    if (typeof updateAllPromptPreviews === 'function') updateAllPromptPreviews();
    addLog('🔄 物語生成プロンプト更新', 'info');
  });
  var copyStoryGenBtn = document.getElementById('copyStoryGenPromptBtn');
  if (copyStoryGenBtn) copyStoryGenBtn.addEventListener('click', function() {
    var text = document.getElementById('reqPromptStoryGen');
    if (text && text.value) {
      navigator.clipboard.writeText(text.value).then(function() { showMessage('📋 コピーしました', 'success'); });
    }
  });
  var refreshSanitizeBtn = document.getElementById('refreshSanitizePromptBtn');
  if (refreshSanitizeBtn) refreshSanitizeBtn.addEventListener('click', function() {
    addLog('🔄 健全化プロンプト更新', 'info');
  });
  var copySanitizeBtn = document.getElementById('copySanitizePromptBtn');
  if (copySanitizeBtn) copySanitizeBtn.addEventListener('click', function() {
    var text = document.getElementById('reqPromptSanitize');
    if (text && text.value) {
      navigator.clipboard.writeText(text.value).then(function() { showMessage('📋 コピーしました', 'success'); });
    }
  });

  // ヘッダー折りたたみ
  var headerToggle = document.getElementById('headerToggleBtn');
  var appHeader = document.getElementById('appHeader');
  var mainEl = document.getElementById('storyCanvasMain');
  if (headerToggle && appHeader) {
    headerToggle.addEventListener('click', function(e) {
      e.stopPropagation();
      var isHidden = appHeader.classList.toggle('hidden');
      if (mainEl) mainEl.classList.toggle('header-collapsed', isHidden);
      headerToggle.textContent = isHidden ? '▼' : '▲';
      headerToggle.title = isHidden ? 'ヘッダーを表示' : 'ヘッダーを隠す';
    });
  }
}

// ============================================================
// DOMContentLoaded
// ============================================================

document.addEventListener('DOMContentLoaded', init);
