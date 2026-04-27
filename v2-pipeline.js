// ============================================================
// v2-pipeline.js — Step 0-3 生成パイプライン
// ============================================================

// ============================================================
// メインエントリポイント
// ============================================================

async function generateStory() {
  if (!isTextReady() || state.pipeline.phase !== 'idle') return;
  try {
    // Step 0: コンテキスト収集
    state.pipeline.phase = 'step0';
    updatePipelineUI();
    addLog('📋 Step 0: コンテキスト収集...', 'info');
    const context = await collectContext();

    // Step 1: 骨組み生成
    state.pipeline.phase = 'step1';
    updatePipelineUI();
    addLog('🦴 Step 1: 骨組み生成...', 'info');
    const skeletonResult = await generateSkeleton(context);

    // プレイヤー入力待ちなら中断
    if (skeletonResult === 'waiting') {
      addLog('🎮 プレイヤー入力待ち', 'info');
      return;
    }

    // Step 2: キャラクター本文生成
    state.pipeline.phase = 'step2';
    updatePipelineUI();
    addLog('📝 Step 2: 本文生成...', 'info');
    await generateAllCharacterTexts(context);

    // Step 3: 後処理
    state.pipeline.phase = 'step3';
    updatePipelineUI();
    addLog('⚙️ Step 3: 後処理...', 'info');
    await postProcess();

    addLog('✅ 生成完了', 'success');
    showMessage('生成完了', 'success');
  } catch (e) {
    addLog('❌ Error: ' + e.message, 'error');
    showMessage('Error: ' + e.message, 'error');
  } finally {
    state.pipeline.phase = 'idle';
    updatePipelineUI();
  }
}

// ============================================================
// Step 0: コンテキスト収集
// ============================================================

async function collectContext() {
  const context = {
    characters: {},
    currentScene: { ...state.currentScene },
    recentText: '',
    grepResults: { skeletonEvents: {}, sourceOriginals: {} },
    situation5w1h: render5W1HText({ scope: 'merged', includeGlossary: true, includeSpeechPattern: true })
  };

  // 各アクティブキャラの情報収集
  state.situation.who.forEach(char => {
    if (!char.active) return;
    const name = char.base.name;
    if (!name) return;
    context.characters[name] = {
      base: { ...char.base },
      recent: { ...char.recent },
      writerMode: char.writerMode || 'ai',
      objectiveMemories: (char.memories || []).map(m => ({
        summary: m.summary,
        source: m.source || [],
        scene: m.scene || ''
      })),
      subjectiveMemories: []
    };
  });

  // 直近テキスト取得
  context.recentText = await getRecentTextFromDB(3000);

  // 記憶選別
  if (context.recentText || Object.keys(context.characters).length > 0) {
    const selectedTags = await selectRelevantMemories(context.recentText);
    if (selectedTags.length > 0) {
      // 骨組みgrep
      context.grepResults.skeletonEvents = await grepSkeletonByTags(selectedTags);
      // キャラ本文grep（主観記憶）
      context.grepResults.sourceOriginals = await grepCharacterTextByTags(selectedTags);

      // 主観記憶をcontextに反映
      for (const [tag, para] of Object.entries(context.grepResults.sourceOriginals)) {
        const r = resolveTag(tag);
        if (r && context.characters[r.entity]) {
          context.characters[r.entity].subjectiveMemories.push({
            source: tag,
            text: para.text || ''
          });
        }
      }
    }
  }

  state.pipeline.pendingContext = context;
  return context;
}

// ============================================================
// Step 1: 骨組み生成
// ============================================================

async function generateSkeleton(context) {
  // キャラ情報テキスト構築
  let charInfoText = '';
  const aiChars = [];
  const playerChars = [];
  for (const [name, info] of Object.entries(context.characters)) {
    charInfoText += '【' + name + '】\n';
    charInfoText += '種族: ' + (info.base.species || '不明') + '\n';
    charInfoText += '性格: ' + (info.base.traits || '不明') + '\n';
    charInfoText += '口調: ' + (info.base.speechPattern || '不明') + '\n';
    charInfoText += '価値観: ' + (info.base.values || '不明') + '\n';
    charInfoText += '人間関係: ' + (info.base.relationships || '不明') + '\n';
    charInfoText += '種族生態: ' + (info.base.speciesBiology || '不明') + '\n';
    charInfoText += '精神状態: ' + (info.base.mentalState || '不明') + '\n';
    charInfoText += '動作特徴: ' + (info.base.movement || '不明') + '\n';
    charInfoText += '癖: ' + (info.base.habits || '不明') + '\n\n';
    if (info.writerMode === 'player') playerChars.push(name);
    else aiChars.push(name);
  }

  // 過去のイベントテキスト
  let pastEventsText = '';
  for (const [eid, ev] of Object.entries(context.grepResults.skeletonEvents)) {
    pastEventsText += eid + ': ';
    for (const [ch, desc] of Object.entries(ev.chains || {})) {
      pastEventsText += ch + '→' + desc + ' / ';
    }
    pastEventsText += '\n';
  }

  const writerModeText = 'AI執筆: ' + (aiChars.join(', ') || 'なし') + '\nプレイヤー執筆: ' + (playerChars.join(', ') || 'なし');

  const systemPrompt = `あなたは物語の構造設計AIです。キャラクター設定・世界設定・過去の記憶に基づき、
次の場面で起こる出来事の骨組みを連鎖反応形式で生成してください。

【登録キャラクター】
${charInfoText}

【各キャラの執筆モード】
${writerModeText}

【現在の状況（5W1H）】
${context.situation5w1h}

【関連する過去のイベント】
${pastEventsText || '（なし — 初回生成）'}

【直近の物語】
${context.recentText || '（なし — 初回生成）'}

【骨組み生成ルール】

＜段落タグ形式＞
[シーン英字-枝番-キャラクター名] または [シーン英字-枝番-環境]
開始番号: ${context.currentScene.lastEventNum + 1}

＜連鎖反応の記述＞
・因果の順にイベントを記述する
・1つの原因から複数の変化が同時に起こる場合は同じ番号を使う
・行動・心象変化・台詞の全てを網羅する
・台詞はキャラクターのspeechPatternに完全準拠し、口調・語尾を省略しない
・環境変化は「環境」エンティティで記述する

＜空段落ルール＞
シーン内に居るが当該イベントで変化が無いキャラは empty に列挙する。
空になる条件: 不在、不知覚、不感動のいずれかに限る。

＜プレイヤーキャラの扱い＞
プレイヤー執筆キャラの行動が連鎖反応に因果的に必要になった場合:
1. そのイベント番号で該当キャラのエントリに "PLAYER_INPUT_REQUIRED" と記述
2. 同番号の他キャラおよび後続イベントは生成しない
3. 生成をそこで停止する

＜粗筋の品質要件＞
各 chains エントリは以下を含む1-2文で記述:
- 具体的な行動または心象変化
- 台詞がある場合は口調完全版で収録
- 感情語（安堵、屈辱、怒り、動揺等）

＜5W1Hスナップショット＞
各イベントに当時の5W1H状態を付記する。

【出力形式】JSONのみ。説明文不要。
{
  "sceneTag": "--- Scene: X / 場所 / キャラ名リスト ---",
  "events": {
    "X-NNN": {
      "causedBy": "X-MMM" or null,
      "chains": { "キャラ名": "粗筋" },
      "empty": ["変化なしキャラ名"],
      "5w1h": { "where":"", "when":"", "weather":"", "lighting":"", "mood":"" }
    }
  },
  "stopped": false,
  "stopReason": null,
  "recentUpdate": {
    "where": {"name":"", "description":"", "lighting":""},
    "when": {"timeOfDay":"", "weather":""},
    "who": [{"name":"", "currentPose":"", "currentExpression":"", "currentAction":""}],
    "what": {"mainEvent":""},
    "how": {"mood":""}
  }
}`;

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: '上記の設定と状況に基づき、物語の骨組みを連鎖反応形式で生成してください。' }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 8192, responseMimeType: 'application/json' },
    safetySettings: SAFETY_OFF
  };

  dbg('dbgSkeletonInput', systemPrompt);
  const data = await textApiFetch(body, 'S1 骨組み生成');
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  dbg('dbgSkeletonOutput', text);

  const result = safeParseJSON(text, 'S1 骨組み');
  return await postProcessSkeleton(result, context);
}

// ============================================================
// Step 1: 骨組み後処理
// ============================================================

async function postProcessSkeleton(result, context) {
  const events = result.events || {};
  const sceneTag = result.sceneTag || '';
  const recentUpdate = result.recentUpdate || null;
  const stopped = result.stopped || false;

  // 現在のシーンのキャラ一覧を更新
  const chars = new Set(state.currentScene.characters);
  for (const ev of Object.values(events)) {
    for (const ch of Object.keys(ev.chains || {})) {
      if (ch !== '環境') chars.add(ch);
    }
    (ev.empty || []).forEach(ch => chars.add(ch));
  }
  state.currentScene.characters = [...chars];

  // 骨組み履歴に追記
  await appendSkeletonEvents(state.currentScene.key, events, sceneTag, state.currentScene.characters);

  // lastEventNum更新
  for (const eventId of Object.keys(events)) {
    const numStr = eventId.split('-')[1];
    const num = parseInt(numStr, 10);
    if (num > state.currentScene.lastEventNum) state.currentScene.lastEventNum = num;
  }

  // 客観記憶の即時登録
  for (const [eventId, event] of Object.entries(events)) {
    for (const [charName, summary] of Object.entries(event.chains || {})) {
      if (charName === '環境') continue;
      if (summary === 'PLAYER_INPUT_REQUIRED') continue;
      const tag = eventId + '-' + charName;
      await registerObjectiveMemory(charName, {
        summary: summary,
        source: [tag],
        scene: state.currentScene.location || '',
        timestamp: Date.now()
      });
    }
  }

  // 5W1H直近状態を更新
  if (recentUpdate) {
    updateRecentSettings(recentUpdate);
  }

  // パイプラインバッファに追加
  state.pipeline.currentSkeletonEvents = { ...state.pipeline.currentSkeletonEvents, ...events };
  state.pipeline.skeletonBuffer.push(...Object.keys(events));

  // UI更新
  renderSkeletonViewer();
  saveToStorage();

  // プレイヤー入力待ち
  if (stopped) {
    state.pipeline.phase = 'step1_waiting';
    updatePipelineUI();
    showPlayerInputUI(events);
    return 'waiting';
  }

  return 'complete';
}

// ============================================================
// プレイヤー入力 (idle状態 = プロローグ / フリー入力)
// ============================================================

async function submitPlayerInputFromIdle(inputText) {
  try {
    state.pipeline.playerInputHistory.push(inputText);
    els.playerInputText.value = '';

    // Step 0: コンテキスト収集
    state.pipeline.phase = 'step0';
    updatePipelineUI();
    addLog('📋 Step 0: コンテキスト収集...', 'info');
    const context = await collectContext();

    // Step 1: プレイヤー入力を起点に骨組み生成
    state.pipeline.phase = 'step1';
    updatePipelineUI();
    addLog('🎮 プレイヤー入力を起点に骨組み生成...', 'info');

    const aiChars = [];
    const playerChars = [];
    let charInfoText = '';
    for (const [name, info] of Object.entries(context.characters)) {
      charInfoText += '【' + name + '】\n種族: ' + (info.base.species || '') + '\n性格: ' + (info.base.traits || '') + '\n口調: ' + (info.base.speechPattern || '') + '\n\n';
      if (info.writerMode === 'player') playerChars.push(name);
      else aiChars.push(name);
    }
    const writerModeText = 'AI執筆: ' + (aiChars.join(', ') || 'なし') + '\nプレイヤー執筆: ' + (playerChars.join(', ') || 'なし');

    // 直近骨組みテキスト
    let recentSkeletonText = '';
    const skeleton = await loadSkeletonFromDB(state.currentScene.key);
    if (skeleton && skeleton.events) {
      const entries = Object.entries(skeleton.events);
      const recent = entries.slice(-5);
      for (const [eid, ev] of recent) {
        recentSkeletonText += eid + ': ';
        for (const [ch, desc] of Object.entries(ev.chains || {})) {
          recentSkeletonText += ch + '→' + desc + ' / ';
        }
        recentSkeletonText += '\n';
      }
    }

    const isFirstScene = !recentSkeletonText && state.currentScene.lastEventNum === 0;

    const systemPrompt = `あなたは物語の構造設計AIです。${isFirstScene ? 'プレイヤーの入力を起点にプロローグの骨組みを生成してください。' : 'プレイヤーの入力を起点に、連鎖反応の続きを生成してください。'}

【登録キャラクター】
${charInfoText || '（未登録）'}

【各キャラの執筆モード】
${writerModeText}

【現在の状況（5W1H）】
${context.situation5w1h}

${recentSkeletonText ? '【直近の骨組みイベント】\n' + recentSkeletonText : '【直近の骨組みイベント】\n（なし — 初回生成）'}

【直近の物語】
${context.recentText || '（なし — 初回生成）'}

【プレイヤー入力】
${inputText}

【プレイヤー入力の解釈ルール】
入力テキストから以下を識別し骨組みに統合せよ:
1. プレイヤーキャラの行動・台詞 → キャラタグ付きイベント
2. 環境変化（天候、照明、時間経過等）→ 環境タグ付きイベント + 5W1H更新
3. 展開指示（「～させたい」「～が起こる」等）→ 後続連鎖の方向性
4. シーン移動指示 → 新シーンタグ挿入
識別できない場合はプレイヤーキャラの行動として扱う。

【骨組み生成ルール】

＜段落タグ形式＞
[シーン英字-枝番-キャラクター名] または [シーン英字-枝番-環境]
開始番号: ${state.currentScene.lastEventNum + 1}

＜連鎖反応の記述＞
・因果の順にイベントを記述する
・1つの原因から複数の変化が同時に起こる場合は同じ番号を使う
・行動・心象変化・台詞の全てを網羅する
・台詞はキャラクターのspeechPatternに完全準拠し、口調・語尾を省略しない
・環境変化は「環境」エンティティで記述する

＜空段落ルール＞
シーン内に居るが当該イベントで変化が無いキャラは empty に列挙する。

＜プレイヤーキャラの扱い＞
プレイヤー執筆キャラの行動が連鎖反応に因果的に必要になった場合:
1. そのイベント番号で該当キャラのエントリに "PLAYER_INPUT_REQUIRED" と記述
2. 同番号の他キャラおよび後続イベントは生成しない
3. 生成をそこで停止する

＜粗筋の品質要件＞
各 chains エントリは以下を含む1-2文で記述:
- 具体的な行動または心象変化
- 台詞がある場合は口調完全版で収録
- 感情語（安堵、屈辱、怒り、動揺等）

＜5W1Hスナップショット＞
各イベントに当時の5W1H状態を付記する。

【出力形式】JSONのみ。説明文不要。
{
  "sceneTag": "--- Scene: X / 場所 / キャラ名リスト ---",
  "events": {
    "X-NNN": {
      "causedBy": "X-MMM" or null,
      "chains": { "キャラ名": "粗筋" },
      "empty": ["変化なしキャラ名"],
      "5w1h": { "where":"", "when":"", "weather":"", "lighting":"", "mood":"" }
    }
  },
  "stopped": false,
  "stopReason": null,
  "recentUpdate": {
    "where": {"name":"", "description":"", "lighting":""},
    "when": {"timeOfDay":"", "weather":""},
    "who": [{"name":"", "currentPose":"", "currentExpression":"", "currentAction":""}],
    "what": {"mainEvent":""},
    "how": {"mood":""}
  }
}`;

    const body = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: isFirstScene ? 'プレイヤーの入力を起点にプロローグの骨組みを生成してください。' : 'プレイヤーの入力を起点に、骨組みの続きを生成してください。' }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 8192, responseMimeType: 'application/json' },
      safetySettings: SAFETY_OFF
    };

    dbg('dbgSkeletonInput', systemPrompt);
    const data = await textApiFetch(body, 'S1 骨組み(プレイヤー起点)');
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    dbg('dbgSkeletonOutput', text);

    const result = safeParseJSON(text, 'S1 骨組み');
    const status = await postProcessSkeleton(result, context);

    if (status === 'waiting') return;

    // Step 2
    state.pipeline.phase = 'step2';
    updatePipelineUI();
    addLog('📝 Step 2: 本文生成...', 'info');
    await generateAllCharacterTexts(context);

    // Step 3
    state.pipeline.phase = 'step3';
    updatePipelineUI();
    addLog('⚙️ Step 3: 後処理...', 'info');
    await postProcess();

    addLog('✅ 生成完了', 'success');
    showMessage('生成完了', 'success');
  } catch (e) {
    addLog('❌ Error: ' + e.message, 'error');
    showMessage('Error: ' + e.message, 'error');
  } finally {
    state.pipeline.phase = 'idle';
    updatePipelineUI();
  }
}

// ============================================================
// Step 1: プレイヤー入力後の継続 (step1_waiting状態)
// ============================================================

async function submitPlayerInput() {
  const inputText = els.playerInputText.value.trim();
  if (!inputText) { showMessage('入力してください', 'warning'); return; }
  if (!isTextReady()) { showMessage('APIキーを設定してください（選択中のモデルに対応するキー）', 'error'); return; }

  // idle状態からの送信 = プロローグ / フリー入力
  if (state.pipeline.phase === 'idle') {
    return submitPlayerInputFromIdle(inputText);
  }

  state.pipeline.playerInputHistory.push(inputText);
  if (typeof hidePlayerInputWaiting === 'function') hidePlayerInputWaiting();

  state.pipeline.phase = 'step1';
  updatePipelineUI();
  addLog('🎮 プレイヤー入力受理、骨組み継続...', 'info');

  const context = state.pipeline.pendingContext;

  // 直近の骨組みイベントテキスト
  let recentSkeletonText = '';
  const skeleton = await loadSkeletonFromDB(state.currentScene.key);
  if (skeleton && skeleton.events) {
    const entries = Object.entries(skeleton.events);
    const recent = entries.slice(-5);
    for (const [eid, ev] of recent) {
      recentSkeletonText += eid + ': ';
      for (const [ch, desc] of Object.entries(ev.chains || {})) {
        recentSkeletonText += ch + '→' + desc + ' / ';
      }
      recentSkeletonText += '\n';
    }
  }

  const aiChars = [];
  const playerChars = [];
  let charInfoText = '';
  for (const [name, info] of Object.entries(context.characters)) {
    charInfoText += '【' + name + '】\n種族: ' + (info.base.species || '') + '\n口調: ' + (info.base.speechPattern || '') + '\n\n';
    if (info.writerMode === 'player') playerChars.push(name);
    else aiChars.push(name);
  }

  const writerModeText = 'AI執筆: ' + (aiChars.join(', ') || 'なし') + '\nプレイヤー執筆: ' + (playerChars.join(', ') || 'なし');

  const systemPrompt = `あなたは物語の構造設計AIです。プレイヤーの入力を起点に、連鎖反応の続きを生成してください。

【登録キャラクター】
${charInfoText}

【各キャラの執筆モード】
${writerModeText}

【現在の状況（5W1H）】
${context.situation5w1h}

【直近の骨組みイベント】
${recentSkeletonText}

【プレイヤー入力】
${inputText}

【プレイヤー入力の解釈ルール】
入力テキストから以下を識別し骨組みに統合せよ:
1. プレイヤーキャラの行動・台詞 → キャラタグ付きイベント
2. 環境変化（天候、照明、時間経過等）→ 環境タグ付きイベント + 5W1H更新
3. 展開指示（「～させたい」「～が起こる」等）→ 後続連鎖の方向性
4. シーン移動指示 → 新シーンタグ挿入
識別できない場合はプレイヤーキャラの行動として扱う。

【生成ルール】
（Round 1と同一の連鎖反応・空段落・プレイヤーキャラルールを適用）
開始番号: ${state.currentScene.lastEventNum + 1}

【出力形式】Round 1と同一のJSON形式。`;

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: 'プレイヤーの入力を起点に、骨組みの続きを生成してください。' }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 8192, responseMimeType: 'application/json' },
    safetySettings: SAFETY_OFF
  };

  try {
    dbg('dbgSkeletonInput', systemPrompt);
    const data = await textApiFetch(body, 'S1 骨組み継続');
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    dbg('dbgSkeletonOutput', text);

    const result = safeParseJSON(text, 'S1 骨組み継続');
    const status = await postProcessSkeleton(result, context);

    if (status === 'waiting') return; // 再度プレイヤー入力待ち

    // Step 2-3 に進む
    state.pipeline.phase = 'step2';
    updatePipelineUI();
    addLog('📝 Step 2: 本文生成...', 'info');
    await generateAllCharacterTexts(context);

    state.pipeline.phase = 'step3';
    updatePipelineUI();
    addLog('⚙️ Step 3: 後処理...', 'info');
    await postProcess();

    addLog('✅ 生成完了', 'success');
    showMessage('生成完了', 'success');
  } catch (e) {
    addLog('❌ Error: ' + e.message, 'error');
    showMessage('Error: ' + e.message, 'error');
  } finally {
    state.pipeline.phase = 'idle';
    updatePipelineUI();
  }
}

// ============================================================
// Step 2: キャラクター本文生成
// ============================================================

async function generateAllCharacterTexts(context) {
  const events = state.pipeline.currentSkeletonEvents;
  if (!events || Object.keys(events).length === 0) {
    addLog('⚠️ 骨組みイベントなし、Step 2スキップ', 'warning');
    return;
  }

  // キャラごとの非空イベントを収集
  const charEvents = {};
  for (const [eventId, event] of Object.entries(events)) {
    for (const [charName, desc] of Object.entries(event.chains || {})) {
      if (charName === '環境') continue;
      if (desc === 'PLAYER_INPUT_REQUIRED') continue;
      if (!charEvents[charName]) charEvents[charName] = {};
      charEvents[charName][eventId] = { desc, fullEvent: event };
    }
  }

  // 各キャラの本文生成（並列）
  const promises = Object.entries(charEvents).map(([charName, evs]) => {
    const charInfo = context.characters[charName];
    if (!charInfo) return Promise.resolve();
    const isPlayer = charInfo.writerMode === 'player';
    return generateCharacterText(charName, charInfo, evs, events, isPlayer);
  });

  await Promise.all(promises);
  renderCharacterTextTabs();
}

async function generateCharacterText(charName, charInfo, charEventsMap, allEvents, isPlayer) {
  // 骨組みエントリテキスト構築
  let skeletonText = '';
  let otherCharsText = '';
  let envText = '';

  for (const [eventId, ev] of Object.entries(charEventsMap)) {
    skeletonText += '[' + eventId + '-' + charName + '] ' + ev.desc + '\n';
    // 同一番号の他キャラ行動
    const fullEvent = ev.fullEvent;
    for (const [ch, desc] of Object.entries(fullEvent.chains || {})) {
      if (ch === charName) continue;
      if (ch === '環境') { envText += '[' + eventId + '-環境] ' + desc + '\n'; continue; }
      otherCharsText += '[' + eventId + '-' + ch + '] ' + desc + '\n';
    }
  }

  // 主観記憶テキスト
  let subjectiveText = '';
  (charInfo.subjectiveMemories || []).slice(-3).forEach(sm => {
    subjectiveText += '[' + sm.source + '] ' + sm.text.substring(0, 300) + '\n\n';
  });

  // 客観記憶テキスト
  let objectiveText = '';
  (charInfo.objectiveMemories || []).slice(-5).forEach(om => {
    objectiveText += '- [' + (om.source || []).join(', ') + '] ' + om.summary + '\n';
  });

  const jbPrompt = state.jailbreakEnabled ? state.jailbreakPrompt : '';

  const systemPrompt = isPlayer
    ? buildPlayerCharPrompt(charName, charInfo, jbPrompt)
    : buildAICharPrompt(charName, charInfo, jbPrompt, subjectiveText, objectiveText);

  const userContent = `以下の骨組みイベントを ${charName} の視点で${isPlayer ? '整形' : '展開'}してください。

【骨組みイベント（${charName}の非空エントリのみ）】
${skeletonText}

【同時に起きた他キャラの行動（外から観察可能な事実）】
${otherCharsText || '（なし）'}

【環境変化】
${envText || '（なし）'}`;

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userContent }] }],
    generationConfig: {
      temperature: isPlayer ? 0.5 : 0.8,
      maxOutputTokens: 8192
    },
    safetySettings: SAFETY_OFF
  };

  dbg('dbgCharTextInput', systemPrompt + '\n\n---USER---\n' + userContent);
  const data = await textApiFetch(body, 'S2 ' + charName);
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  dbg('dbgCharTextOutput', text);

  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  let result;
  try {
    result = safeParseJSON(cleaned, 'S2 ' + charName);
  } catch (e) {
    // テキスト応答の場合、単一段落として扱う
    const firstEventId = Object.keys(charEventsMap)[0];
    const tag = firstEventId + '-' + charName;
    result = { paragraphs: {} };
    result.paragraphs[tag] = { text: text };
  }

  const paragraphs = result.paragraphs || {};

  // プレイヤーキャラ: 編集UIを表示
  if (isPlayer && Object.keys(paragraphs).length > 0) {
    const edited = await showPlayerEditUIAsync(charName, paragraphs, skeletonText);
    Object.assign(paragraphs, edited);
  }

  // キャラ本文DBに保存
  const saveParagraphs = {};
  for (const [tag, para] of Object.entries(paragraphs)) {
    saveParagraphs[tag] = {
      text: typeof para === 'string' ? para : (para.text || ''),
      skeleton_ref: charEventsMap[tag.split('-').slice(0, 2).join('-')]?.desc || '',
      generated_at: Date.now()
    };
  }
  await appendCharacterText(state.currentScene.key, charName, saveParagraphs);

  // ポーズタグ抽出
  for (const [tag, para] of Object.entries(saveParagraphs)) {
    const poseMatch = para.text.match(/\[([^\]:]+):([^\]]+)\]/g);
    if (poseMatch) {
      const last = poseMatch[poseMatch.length - 1];
      const pm = last.match(/\[([^\]:]+):([^\]]+)\]/);
      if (pm) state.poseRecords[pm[1]] = pm[2];
    }
  }

  addLog('📝 ' + charName + ': ' + Object.keys(paragraphs).length + '段落生成', 'success');
}

function buildAICharPrompt(charName, charInfo, jbPrompt, subjectiveText, objectiveText) {
  return (jbPrompt ? jbPrompt + '\n\n' : '') +
`あなたは物語の本文執筆AIです。
骨組み（事実の台帳）の各エントリを、指定キャラクターの一人称独白調で詳細な文学的テキストに展開してください。

【対象キャラクター】
名前: ${charInfo.base.name || charName}
二つ名: ${charInfo.base.epithet || ''}
種族: ${charInfo.base.species || ''}（${charInfo.base.speciesBiology || ''}）
性格: ${charInfo.base.traits || ''}
価値観: ${charInfo.base.values || ''}
口調: ${charInfo.base.speechPattern || ''}
精神状態: ${charInfo.base.mentalState || ''}
動作特徴: ${charInfo.base.movement || ''}
癖: ${charInfo.base.habits || ''}

【関連する主観記憶（過去の体験）】
${subjectiveText || '（なし）'}

【関連する客観記憶（過去の事実）】
${objectiveText || '（なし）'}

【執筆ルール】
＜文体＞
・${charName}の口調で一人称独白調に書く
・台詞は骨組みの記述をそのまま保持し改変しない
・台詞の前後に知覚・身体反応・内面独白を追加する
＜主観的環境描写＞
・キャラの特性に基づく知覚フィルターを反映する
＜身体描写＞
・感情は直接命名せず身体反応で描く
・骨格・筋肉・重心・関節角度を意識した動作描写
＜ポーズタグ＞
・動作描写の直後に必ず挿入: [キャラ名:構図、姿勢、四肢の位置、関節角度、重心、視線方向、雰囲気]
＜禁止事項＞
・骨組みに無い新しい行動・事象を創造しない
・他キャラの内面を書かない
・メタ的言及・注釈・警告は一切書かない

【出力形式】JSONのみ。
{
  "paragraphs": {
    "X-NNN-キャラ名": { "text": "独白調テキスト（ポーズタグ含む）" }
  }
}`;
}

function buildPlayerCharPrompt(charName, charInfo, jbPrompt) {
  return (jbPrompt ? jbPrompt + '\n\n' : '') +
`あなたは物語の本文整形AIです。
骨組みの粗筋を、指定キャラクターの口調・性格に基づいて一人称独白調の文学的テキストに整形してください。

【対象キャラクター】
名前: ${charInfo.base.name || charName}
種族: ${charInfo.base.species || ''}
性格: ${charInfo.base.traits || ''}
口調: ${charInfo.base.speechPattern || ''}

【整形ルール】
・キャラの口調で一人称独白調に書く
・台詞は骨組みの記述をそのまま保持
・身体感覚・環境知覚を追加する
・ポーズタグを埋め込む: [キャラ名:構図、姿勢、四肢、視線、雰囲気]
・プレイヤーが後で編集する前提で、過度に装飾しない

【出力形式】JSONのみ。
{
  "paragraphs": {
    "X-NNN-キャラ名": { "text": "独白調テキスト" }
  }
}`;
}

// ============================================================
// Step 3: 後処理
// ============================================================

async function postProcess() {
  // 5W1H最終更新（骨組みの最終イベントから）
  const skeleton = await loadSkeletonFromDB(state.currentScene.key);
  if (skeleton && skeleton.events) {
    const entries = Object.entries(skeleton.events);
    if (entries.length > 0) {
      const lastEvent = entries[entries.length - 1][1];
      if (lastEvent['5w1h']) {
        const h = lastEvent['5w1h'];
        if (h.where) state.situation.where.recent.name = h.where;
        if (h.lighting) state.situation.where.recent.lighting = h.lighting;
        if (h.when) state.situation.when.recent.timeOfDay = h.when;
        if (h.weather) state.situation.when.recent.weather = h.weather;
        if (h.mood) state.situation.how.recent.mood = h.mood;
      }
    }
  }

  // 客観記憶の永続化確認（既にStep 1で保存済み）

  // ポーズタグ集約 → renderCameraGrid()
  renderCameraGrid();

  // パイプラインバッファクリア
  state.pipeline.skeletonBuffer = [];
  state.pipeline.currentSkeletonEvents = {};
  state.pipeline.playerInputHistory = [];
  state.pipeline.pendingContext = null;

  // UI更新
  renderAllSections();
  renderCharacters();
  renderCharacterTextTabs();
  updateAllPromptPreviews();
  saveToStorage();
}

// ============================================================
// 5W1H更新ヘルパー
// ============================================================

function updateRecentSettings(u) {
  if (!u) return;
  if (u.where) {
    if (u.where.name) state.situation.where.recent.name = u.where.name;
    if (u.where.description) state.situation.where.recent.description = u.where.description;
    if (u.where.lighting) state.situation.where.recent.lighting = u.where.lighting;
    state.currentScene.location = u.where.name || state.currentScene.location;
  }
  if (u.when) {
    if (u.when.timeOfDay) state.situation.when.recent.timeOfDay = u.when.timeOfDay;
    if (u.when.weather) state.situation.when.recent.weather = u.when.weather;
  }
  if (u.who && Array.isArray(u.who)) {
    u.who.forEach(wu => {
      const idx = state.situation.who.findIndex(c => c.base.name === wu.name);
      if (idx >= 0) {
        if (wu.currentPose) state.situation.who[idx].recent.currentPose = wu.currentPose;
        if (wu.currentExpression) state.situation.who[idx].recent.currentExpression = wu.currentExpression;
        if (wu.currentAction) state.situation.who[idx].recent.currentAction = wu.currentAction;
      }
    });
  }
  if (u.what && u.what.mainEvent) state.situation.what.recent.mainEvent = u.what.mainEvent;
  if (u.how && u.how.mood) state.situation.how.recent.mood = u.how.mood;
}
