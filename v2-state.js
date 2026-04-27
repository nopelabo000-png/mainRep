// ============================================================
// v2-state.js — グローバルstate + localStorage保存/復元
// ============================================================

const state = {
  apiKey: '', apiKeys: [],
  isReady: false, isClassifying: false, isConverting: false,
  selectedTextModel: 'gemini-3.1-pro',
  selectedImageModel: 'gemini-3-pro-image-preview',
  selectedTTSModel: 'gemini-2.5-flash-tts',
  selectedEmbeddingModel: 'gemini-embedding-1',
  // OpenRouter
  openrouterApiKey: '', openrouterReady: false,
  // SD WebUI
  sdWebuiUrl: '', sdConnected: false, sdModels: [],
  sdSettings: { ...SD_DEFAULTS, model: '' },
  // RunPod ComfyUI
  runpodApiKey: '', runpodConnected: false,
  runpodEndpointId: 'ya3z093qy44s1x',
  // JailBreak
  jailbreakEnabled: true,
  jailbreakPrompt: JB_PRESETS.standard,
  sanitizeJailbreakPrompt: JAILBREAK_SANITIZE_PROMPT,
  // 5W1H Situation
  situation: {
    where: { active: true, base: { name: '', description: '', lighting: '' }, recent: { name: '', description: '', lighting: '' } },
    when: { active: true, base: { timeOfDay: '', weather: '' }, recent: { timeOfDay: '', weather: '' } },
    who: [],
    what: { active: true, base: { mainEvent: '' }, recent: { mainEvent: '' } },
    why: { active: true, base: { context: '', glossary: '', worldRules: '' }, recent: { context: '' } },
    how: { active: true, base: { mood: '', narrativeStyle: '', artStyle: 'modern anime style, high quality, masterpiece, detailed illustration' }, recent: { mood: '' } }
  },
  // v2 新規: 現在のシーン状態
  currentScene: {
    key: 'A',
    lastEventNum: 0,
    characters: [],
    location: ''
  },
  // v2 新規: パイプライン状態
  pipeline: {
    phase: 'idle', // idle | step0 | step1 | step1_waiting | step2 | step2_editing | step3
    skeletonBuffer: [],
    currentSkeletonEvents: {},
    playerInputHistory: [],
    pendingContext: null
  },
  // 画像関連
  currentImages: [],
  poseRecords: {},
  poseImagesByChar: {},
  autoDetectedLora: '',
  lastSanitizedPoseImage: null,
  lastF6Output: null,
  f6ResultsByChar: {},
  // ログ
  logs: []
};

// ============================================================
// DOM要素キャッシュ
// ============================================================

const els = {};

function cacheElements() {
  const ids = [
    'apiKeyInput', 'saveApiKeyBtn', 'statusDot',
    'textModel', 'imageModel', 'ttsModel', 'embeddingModel',
    'openrouterApiKey', 'saveOpenrouterKeyBtn', 'openrouterStatusDot',
    'sdWebuiUrl', 'connectSDBtn', 'sdStatusDot',
    'runpodApiKey', 'runpodEndpointId', 'connectRunpodBtn', 'runpodStatusDot',
    'appHeader', 'headerToggleBtn', 'storyCanvasMain',
    'jbToggle', 'jbPreset', 'jbPromptText', 'sanitizeJbPromptText', 'resetSanitizeJbBtn',
    'situationSections', 'characterList', 'addCharBtn', 'charBadge',
    'referenceText', 'classifyBtn', 'exportSettingsBtn', 'clearBaseBtn',
    'generateBtn', 'convertToPromptBtn',
    'pipelineStatus', 'sceneSelector', 'newSceneBtn',
    'skeletonViewer', 'charTextTabs', 'charTextContents',
    'playerInputPanel', 'playerContextDisplay', 'playerInputText', 'playerSubmitBtn',
    'playerEditPanel', 'playerEditCharName', 'playerEditSkeleton', 'playerEditText',
    'playerEditApproveBtn', 'playerEditRegenerateBtn',
    'clearAllRecentBtn', 'clearAllCharRecentBtn', 'clearCharSelect', 'clearCharRecentBtn',
    'logContent', 'messageArea',
    'cameraGrid', 'generateImagesBtn',
    'geminiPromptPreview', 'sdPreviewCharSelect', 'sdPromptPreview', 'sdPromptValidation', 'lastShotDetails',
    'imageCount', 'currentSceneImages',
    'reqPromptStoryGen', 'reqPromptSanitize',
    'refreshStoryGenPromptBtn', 'copyStoryGenPromptBtn',
    'refreshSanitizePromptBtn', 'copySanitizePromptBtn',
    'poseImageGallery', 'poseImageCount', 'poseGenButtons',
    'imageModal', 'modalTitle', 'modalImage', 'modalPrompt', 'closeModal',
    'setRefBtn', 'downloadBtn',
    'dbgSkeletonInput', 'dbgSkeletonOutput',
    'dbgCharTextInput', 'dbgCharTextOutput',
    'dbgSanitizeInput', 'dbgSanitizeOutput',
    'dbgClassifyInput', 'dbgClassifyOutput',
    'dbgConvertInput', 'dbgConvertOutput',
    'sdSettingsBody'
  ];
  ids.forEach(id => { els[id] = document.getElementById(id); });
}

// ============================================================
// Save / Load
// ============================================================

function saveToStorage() {
  try {
    const data = {
      apiKey: state.apiKey,
      apiKeys: state.apiKeys,
      selectedTextModel: state.selectedTextModel,
      selectedImageModel: state.selectedImageModel,
      selectedTTSModel: state.selectedTTSModel,
      selectedEmbeddingModel: state.selectedEmbeddingModel,
      openrouterApiKey: state.openrouterApiKey,
      sdWebuiUrl: state.sdWebuiUrl,
      sdSettings: state.sdSettings,
      runpodApiKey: state.runpodApiKey,
      runpodEndpointId: state.runpodEndpointId,
      jailbreakEnabled: state.jailbreakEnabled,
      jailbreakPrompt: state.jailbreakPrompt,
      sanitizeJailbreakPrompt: state.sanitizeJailbreakPrompt,
      situation: state.situation,
      currentScene: state.currentScene,
      poseRecords: state.poseRecords
    };
    localStorage.setItem('storyCanvasV2', JSON.stringify(data));
  } catch (e) {
    console.error('Save error:', e);
  }
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem('storyCanvasV2');
    if (!raw) {
      // v5.6からのマイグレーション試行
      migrateFromV56();
      return;
    }
    const data = JSON.parse(raw);
    if (data.apiKey) state.apiKey = data.apiKey;
    if (data.apiKeys) state.apiKeys = data.apiKeys;
    if (data.selectedTextModel) state.selectedTextModel = data.selectedTextModel;
    if (data.selectedImageModel) state.selectedImageModel = data.selectedImageModel;
    if (data.selectedTTSModel) state.selectedTTSModel = data.selectedTTSModel;
    if (data.selectedEmbeddingModel) state.selectedEmbeddingModel = data.selectedEmbeddingModel;
    if (data.openrouterApiKey) { state.openrouterApiKey = data.openrouterApiKey; state.openrouterReady = true; }
    if (data.sdWebuiUrl) state.sdWebuiUrl = data.sdWebuiUrl;
    if (data.sdSettings) state.sdSettings = { ...SD_DEFAULTS, ...data.sdSettings };
    if (data.runpodApiKey) state.runpodApiKey = data.runpodApiKey;
    if (data.runpodEndpointId) state.runpodEndpointId = data.runpodEndpointId;
    if (data.jailbreakEnabled !== undefined) state.jailbreakEnabled = data.jailbreakEnabled;
    if (data.jailbreakPrompt) state.jailbreakPrompt = data.jailbreakPrompt;
    if (data.sanitizeJailbreakPrompt) state.sanitizeJailbreakPrompt = data.sanitizeJailbreakPrompt;
    if (data.situation) {
      // who配列にwriterMode追加を保証
      if (data.situation.who) {
        data.situation.who.forEach(ch => {
          if (!ch.writerMode) ch.writerMode = 'ai';
        });
      }
      state.situation = data.situation;
    }
    if (data.currentScene) state.currentScene = data.currentScene;
    if (data.poseRecords) state.poseRecords = data.poseRecords;
  } catch (e) {
    console.error('Load error:', e);
  }
}

function migrateFromV56() {
  try {
    const raw = localStorage.getItem('storyCanvas');
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.apiKey) state.apiKey = data.apiKey;
    if (data.selectedTextModel) state.selectedTextModel = data.selectedTextModel;
    if (data.selectedImageModel) state.selectedImageModel = data.selectedImageModel;
    if (data.sdWebuiUrl) state.sdWebuiUrl = data.sdWebuiUrl;
    if (data.sdSettings) state.sdSettings = { ...SD_DEFAULTS, ...data.sdSettings };
    if (data.runpodApiKey) state.runpodApiKey = data.runpodApiKey;
    if (data.runpodEndpointId) state.runpodEndpointId = data.runpodEndpointId;
    if (data.jailbreakEnabled !== undefined) state.jailbreakEnabled = data.jailbreakEnabled;
    if (data.jailbreakPrompt) state.jailbreakPrompt = data.jailbreakPrompt;
    if (data.sanitizeJailbreakPrompt) state.sanitizeJailbreakPrompt = data.sanitizeJailbreakPrompt;
    if (data.situation) {
      if (data.situation.who) {
        data.situation.who.forEach(ch => {
          if (!ch.writerMode) ch.writerMode = 'ai';
        });
      }
      state.situation = data.situation;
    }
    if (data.poseRecords) state.poseRecords = data.poseRecords;
    addLog('📦 v5.6設定をマイグレーションしました', 'info');
    saveToStorage();
  } catch (e) {
    console.error('Migration error:', e);
  }
}
