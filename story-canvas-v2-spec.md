# Story Canvas v2 実装仕様書

## 設計思想

現行v5.6の「単一テキスト生成 → 4観点レビュー修繕」方式を廃止し、
**骨組み駆動・キャラクター視点分離・二層記憶**方式に移行する。

### 中核原則

1. **骨組みが唯一の正規座標** — 段落タグは骨組みで確定し、全データがそれを参照する
2. **主観記憶 / 客観記憶の二層構造** — エピソード記憶と意味記憶の分離
3. **タグ = アドレス** — `[A-003-ルミア]` だけでファイル・シーン・段落・キャラを一意特定
4. **骨組みは全変化を網羅** — 行動・心象変化・台詞（口調完全版）・環境変化・因果構造
5. **Step 2は骨組みの翻訳** — 新しい事象を創造しない。主観的肉付けに徹する
6. **プレイヤー介入はシステムの第一級市民** — キャラ操作・展開指示・環境更新を統合入力

---

## 1. タグシステム

### 1.1 段落タグ形式

```
[シーン英字-枝番-キャラクター名]

例:
  [A-003-ルミア]    Scene A, 3番目のイベント, ルミアの視点
  [A-003-エルザ]    Scene A, 3番目のイベント, エルザの視点（同時発生）
  [A-003-環境]      Scene A, 3番目のイベント, 環境変化
```

### 1.2 タグからの自動解決

```javascript
function resolveTag(tag) {
  // "[A-003-ルミア]" → { scene: "A", num: "003", entity: "ルミア" }
  const m = tag.match(/^([A-Z]{1,2})-(\d{3})-(.+)$/);
  return { scene: m[1], num: m[2], entity: m[3] };
}

function tagToFilePath(tag) {
  const { scene, entity } = resolveTag(tag);
  // → "scenes/A/A_ルミア.json"
  return `scenes/${scene}/${scene}_${entity}.json`;
}
```

### 1.3 番号ルール

- 前回生成の最終段落番号 + 1 から開始
- 因果の順にインクリメント
- 同一原因から同時に発生する変化は同じ番号（1対多の並列）
- 環境変化は `環境` エンティティ名で同番号に含める

### 1.4 シーンタグ

```
--- Scene: A / 王城・談話室 / ルミア,エルザ,グレシア,シグニッド ---
```

形式は現行互換。骨組み生成時にシーン冒頭で出力。

### 1.5 ポーズタグ

```
[ルミア:正面、直立、両腕を組む、視線は正面、冷徹]
```

Step 2のキャラ本文内に埋め込む（現行と同一形式）。

---

## 2. ファイル構造

### 2.1 プロジェクトディレクトリ

```
project_root/
├── project.json                 ← 5W1H・キャラ設定（現行互換）
├── scenes/
│   ├── A/
│   │   ├── A_skeleton.json      ← Scene Aの骨組み履歴
│   │   ├── A_ルミア.json        ← ルミアの主観テキスト
│   │   ├── A_エルザ.json        ← エルザの主観テキスト
│   │   ├── A_グレシア.json
│   │   └── A_シグニッド.json
│   ├── B/
│   │   ├── B_skeleton.json
│   │   ├── B_ルミア.json
│   │   └── ...
│   └── ...
└── memories/
    ├── ルミア_objective.json    ← 客観記憶（5W1H要約）
    ├── ルミア_subjective.json   ← 主観記憶インデックス（本体はシーンファイル内）
    ├── エルザ_objective.json
    └── ...
```

### 2.2 骨組み履歴ファイル（`A_skeleton.json`）

```json
{
  "scene": "A",
  "sceneTag": "--- Scene: A / 王城・談話室 / ルミア,エルザ,グレシア,シグニッド ---",
  "characters": ["ルミア", "エルザ", "グレシア", "シグニッド"],
  "lastEventNum": 8,
  "events": {
    "A-006": {
      "causedBy": "A-005",
      "chains": {
        "グレシア": "エルザの肩を押す。『邪魔だ、退け！』"
      },
      "empty": ["ルミア", "エルザ", "シグニッド"],
      "5w1h": {
        "where": "王城・談話室",
        "when": "夕方",
        "weather": "晴れ（夕陽）",
        "lighting": "窓からの斜光",
        "mood": "緊迫"
      }
    },
    "A-007": {
      "causedBy": "A-006",
      "chains": {
        "エルザ": "倒れると同時に食器をひっくり返す",
        "シグニッド": "『グレシア！ 何をしている、席に戻れ！』と鋭く叱責"
      },
      "empty": ["ルミア", "グレシア"],
      "5w1h": {
        "where": "王城・談話室",
        "when": "夕方",
        "weather": "晴れ",
        "lighting": "窓からの斜光",
        "mood": "混乱"
      }
    },
    "A-008": {
      "causedBy": "A-007",
      "chains": {
        "グレシア": "食器の落下音とシグニッドの声にたじろぐ。『……ち、違う、こいつが先に——』と言い淀む",
        "シグニッド": "エルザに手を差し伸べ『立てるか？ 怪我は』と低い声で確認",
        "エルザ": "シグニッドの手を取り身体を起こされる。声が出ない",
        "ルミア": "千里眼で全員の動態を観察し、グレシアの動揺を冷徹に記録"
      },
      "empty": [],
      "5w1h": {
        "where": "王城・談話室",
        "when": "夕方",
        "weather": "晴れ",
        "lighting": "窓からの斜光",
        "mood": "混乱→収束"
      }
    }
  }
}
```

### 2.3 キャラクター本文ファイル（`A_ルミア.json`）

```json
{
  "scene": "A",
  "character": "ルミア",
  "paragraphs": {
    "A-008-ルミア": {
      "text": "グレシアの右腕が弛緩する瞬間を、吾輩の千里眼は捉えていた。三角筋の緊張が抜け、指先が微かに震えている——あの程度の叱責で揺らぐとは。シグニッドの声帯が刻む周波数は平時より0.3音高い。怒りではない、失望だ。エルザの膝が絨毯に沈む角度、掌が食器を掴み損ねた軌道、全てが吾輩の黄金の瞳に焼き付く。\n[ルミア:室内奥の壁際に直立、背筋を伸ばし両腕を胸の前で組む、首をわずかに傾け視線は倒れたエルザからグレシアへ移動、口角がかすかに持ち上がる、冷徹な観察者]",
      "skeleton_ref": "千里眼で全員の動態を観察し、グレシアの動揺を冷徹に記録",
      "generated_at": 1773988702448
    }
  }
}
```

### 2.4 客観記憶ファイル（`ルミア_objective.json`）

```json
{
  "character": "ルミア",
  "memories": [
    {
      "id": "mem_a008_lumia",
      "summary": "夕方の王城談話室で、グレシアがエルザを突き飛ばし食器を散乱させた一連の騒動を千里眼で全て観察し、グレシアの動揺とシグニッドの失望を冷徹に記録した。",
      "source": ["A-008-ルミア"],
      "scene": "王城・談話室",
      "timestamp": 1773988702448
    }
  ]
}
```

### 2.5 主観記憶インデックス（`ルミア_subjective.json`）

```json
{
  "character": "ルミア",
  "entries": [
    {
      "source": "A-008-ルミア",
      "scene": "A",
      "file": "scenes/A/A_ルミア.json",
      "timestamp": 1773988702448
    }
  ]
}
```

主観記憶の本体はキャラ本文ファイル内。インデックスは検索用ポインタのみ。

---

## 3. ストレージ設計

### 3.1 ストレージ層の分担

| データ | localStorage | IndexedDB | File System API |
|---|---|---|---|
| state（API設定、UI状態） | ○ | | |
| キャラ基本設定（base） | ○ | | project.json |
| キャラ直近状態（recent） | ○ | | |
| 客観記憶 | ○（コンパクト） | ○（バックアップ） | memories/*.json |
| 骨組み履歴 | | ○ | scenes/*/skeleton.json |
| キャラ本文（主観記憶） | | ○ | scenes/*/*.json |
| 参照画像 | | ○ | |
| writerModeフラグ | ○ | | |

### 3.2 IndexedDB スキーマ（v3）

```javascript
const DB_NAME = 'StoryCanvasDB';
const DB_VERSION = 3;

// v2 → v3 マイグレーション
upgradeDB(db) {
  // 既存stores維持
  // 'referenceImages' — 既存互換
  // 'chapters' — 廃止予定（v2互換で残す）

  // 新規stores
  if (!db.objectStoreNames.contains('skeletons')) {
    db.createObjectStore('skeletons', { keyPath: 'scene' });
  }
  if (!db.objectStoreNames.contains('characterTexts')) {
    const store = db.createObjectStore('characterTexts', { keyPath: 'id' });
    // id = "A_ルミア" (scene + "_" + character)
    store.createIndex('by_scene', 'scene');
    store.createIndex('by_character', 'character');
  }
  if (!db.objectStoreNames.contains('objectiveMemories')) {
    const store = db.createObjectStore('objectiveMemories', { keyPath: 'id' });
    store.createIndex('by_character', 'character');
    store.createIndex('by_source', 'source', { multiEntry: true });
  }
}
```

### 3.3 サイズ見積もり

```
1シーン・1キャラあたり:
  骨組みエントリ: ~200字 × 10イベント = ~2KB
  キャラ本文: ~500字 × 10段落 = ~5KB
  客観記憶: ~200字 × 10件 = ~2KB

3キャラ × 20シーン:
  骨組み: 20 × 2KB = 40KB
  本文: 3 × 20 × 5KB = 300KB
  客観記憶: 3 × 20 × 2KB = 120KB
  合計: ~460KB

localStorage上限(5MB)内。IndexedDB(数百MB)は余裕。
```

---

## 4. state オブジェクト変更

### 4.1 追加フィールド

```javascript
const state = {
  // ... 既存フィールド維持 ...

  // ★ v2追加
  // キャラごとの執筆モード
  // state.situation.who[i] に追加:
  //   writerMode: "ai" | "player"  (default: "ai")

  // 現在のシーン状態
  currentScene: {
    key: "A",                    // 現在のシーン英字
    lastEventNum: 8,             // 最終イベント番号
    characters: ["ルミア", "エルザ", "グレシア", "シグニッド"],
    location: "王城・談話室",
    pendingPlayerInput: false,   // プレイヤー入力待ち状態
    pendingContext: null         // 中断時のコンテキスト
  },

  // 生成パイプライン状態
  pipeline: {
    phase: "idle",  // "idle" | "step0" | "step1" | "step1_waiting" | "step2" | "step3"
    skeletonBuffer: [],          // 今回のStep1で生成済みイベント
    playerInputHistory: []       // 今回のセッションのプレイヤー入力履歴
  }
};
```

### 4.2 キャラクターオブジェクト拡張

```javascript
// state.situation.who[i]
{
  active: true,
  base: { /* 現行互換 */ },
  recent: { /* 現行互換 */ },
  memories: [ /* 客観記憶: 現行互換フォーマット */ ],
  referenceImages: [ /* 現行互換 */ ],
  // ★ v2追加
  writerMode: "ai",          // "ai" | "player"
  lastMemoryExtractPos: 0    // 廃止（骨組みから自動登録に移行）
}
```

---

## 5. パイプライン詳細仕様

### 5.0 Step 0: コンテキスト収集

```
トリガー: ユーザーが「生成」ボタンを押下

処理:
  1. 各アクティブキャラの base / recent / writerMode を取得
  2. 各キャラの客観記憶一覧を取得
  3. 前回生成の最終テキストを取得（直近シーンの本文ファイルから）
  4. 記憶選別 API呼び出し（1 call）:
     入力: 全キャラ客観記憶要約 + 直近テキスト
     出力: selectedTags（関連記憶のタグ配列）
  5. selectedTags で骨組み履歴ファイルをgrep → 関連イベントの因果構造取得
  6. selectedTags でキャラ本文ファイルをgrep → 主観記憶テキスト取得
  7. 全情報を context オブジェクトに格納

API calls: 1（記憶選別）
```

#### 5.0.1 記憶選別プロンプト

```
system_instruction:
  以下はキャラクターの記憶要約リストです。各記憶には出典タグが付いています。

  {全キャラの客観記憶要約リスト}

  【直近の物語テキスト】
  {直近シーンのキャラ本文から合成したテキスト}

  【タスク】
  直近の展開を読み、次の物語生成に参照すべき過去の記憶を選んでください。

  【選別基準】
  1. 人物の再会・対面（Who一致）
  2. 場所の再訪（Where一致）
  3. 因果関係（動機・原因）
  4. 状況の類似（戦闘・交渉等）
  5. 未解決の伏線

  【出力形式】JSONのみ。
  {"tags": ["A-003-ルミア", "B-012-エルザ", ...]}

contents:
  上記の記憶リストから関連する記憶タグを選別してください。

generationConfig:
  temperature: 0.2
  maxOutputTokens: 1024
```

#### 5.0.2 context オブジェクト

```javascript
const context = {
  characters: {
    "ルミア": {
      base: { /* name, species, traits, speechPattern, ... */ },
      recent: { /* currentPose, currentExpression, ... */ },
      writerMode: "ai",
      objectiveMemories: [
        { summary: "...", source: ["A-003-ルミア"], scene: "..." }
      ],
      subjectiveMemories: [
        { source: "A-003-ルミア", text: "吾輩の千里眼が..." }
      ]
    },
    "亮": {
      base: { /* ... */ },
      recent: { /* ... */ },
      writerMode: "player",
      objectiveMemories: [ /* ... */ ],
      subjectiveMemories: [ /* ... */ ]
    }
  },
  currentScene: {
    key: "A",
    lastEventNum: 5,
    location: "王城・談話室",
    characters: ["ルミア", "エルザ", "グレシア", "シグニッド", "亮"]
  },
  recentText: "直近のキャラ本文合成テキスト",
  grepResults: {
    skeletonEvents: [ /* 関連する過去の骨組みイベント */ ],
    sourceOriginals: [ /* 関連する過去の主観テキスト */ ]
  },
  situation5w1h: { /* 現在の5W1H状態 */ }
};
```

---

### 5.1 Step 1: 骨組み生成（インタラクティブループ）

```
処理: Gemini API呼び出し（ラウンドごとに1 call）

入力（Round 1）:
  - context.characters の全キャラ base 情報（speechPattern含む）
  - context.situation5w1h
  - context.grepResults（関連する過去の骨組みイベント）
  - context.recentText（直近テキスト）
  - context.currentScene.lastEventNum（開始番号）
  - プレイヤーキャラの writerMode 情報

入力（Round 2+）:
  - context.characters の全キャラ base 情報
  - context.situation5w1h（環境更新があれば反映済み）
  - 直近の骨組みイベント（骨組み履歴ファイルから直近N件grep）
  - プレイヤー入力内容
  - 必要に応じて過去の骨組みイベントをgrep追加

出力: 骨組みJSON（下記フォーマット）

ループ条件:
  - プレイヤーキャラの介入点を検出 → 中断、プレイヤー入力待ち
  - シーン完了 or 十分なイベント数に到達 → ループ終了
```

#### 5.1.1 骨組み生成プロンプト（Round 1）

```
system_instruction:
  あなたは物語の構造設計AIです。キャラクター設定・世界設定・過去の記憶に基づき、
  次の場面で起こる出来事の骨組みを連鎖反応形式で生成してください。

  【登録キャラクター】
  {各キャラのbase情報（name, species, traits, speechPattern, values,
    relationships, speciesBiology, mentalState を含む）}

  【各キャラの執筆モード】
  AI執筆: ルミア, エルザ, グレシア, シグニッド
  プレイヤー執筆: 亮

  【現在の状況（5W1H）】
  {situation5w1h}

  【関連する過去のイベント】
  {grepResults.skeletonEvents}

  【直近の物語】
  {recentText}

  【骨組み生成ルール】

  ＜段落タグ形式＞
  [シーン英字-枝番-キャラクター名] または [シーン英字-枝番-環境]
  開始番号: {lastEventNum + 1}

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
  プレイヤー執筆キャラ（亮）の行動が連鎖反応に因果的に必要になった場合:
  1. そのイベント番号で亮のエントリに "PLAYER_INPUT_REQUIRED" と記述
  2. 同番号の他キャラおよび後続イベントは生成しない
  3. 生成をそこで停止する

  ＜粗筋の品質要件＞
  各 chains エントリは以下を含む1-2文で記述:
  - 具体的な行動または心象変化
  - 台詞がある場合は口調完全版で収録
  - 感情語（安堵、屈辱、怒り、動揺等）

  ＜5W1Hスナップショット＞
  各イベントに当時の5W1H状態を付記する。
  変化があった項目のみ更新、無ければ前イベントを継承。

  【出力形式】JSONのみ。説明文不要。
  {
    "sceneTag": "--- Scene: X / 場所 / キャラ名リスト ---",
    "events": {
      "X-NNN": {
        "causedBy": "X-MMM" or null,
        "chains": {
          "キャラ名": "粗筋（行動+台詞+感情）",
          "環境": "環境変化の記述"
        },
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
  }

  stopped=true, stopReason="player_input_required" の場合、
  最後のイベントの該当キャラに "PLAYER_INPUT_REQUIRED" が入る。

contents:
  上記の設定と状況に基づき、物語の骨組みを連鎖反応形式で生成してください。

generationConfig:
  temperature: 0.3
  maxOutputTokens: 8192
  responseMimeType: 'application/json'
```

#### 5.1.2 骨組み生成プロンプト（Round 2+: プレイヤー入力後の継続）

```
system_instruction:
  あなたは物語の構造設計AIです。プレイヤーの入力を起点に、
  連鎖反応の続きを生成してください。

  【登録キャラクター】
  {各キャラのbase情報}

  【各キャラの執筆モード】
  AI執筆: ルミア, エルザ, グレシア, シグニッド
  プレイヤー執筆: 亮

  【現在の状況（5W1H）】
  {situation5w1h — 環境更新があれば反映済み}

  【直近の骨組みイベント】
  {骨組み履歴ファイルから直近N件をgrep}

  【プレイヤー入力】
  {プレイヤーの自由入力テキスト}

  【プレイヤー入力の解釈ルール】
  入力テキストから以下を識別し骨組みに統合せよ:
  1. プレイヤーキャラの行動・台詞 → キャラタグ付きイベント
  2. 環境変化（天候、照明、時間経過等）→ 環境タグ付きイベント + 5W1H更新
  3. 展開指示（「～させたい」「～が起こる」等）→ 後続連鎖の方向性
  4. シーン移動指示 → 新シーンタグ挿入
  識別できない場合はプレイヤーキャラの行動として扱う。

  【生成ルール】
  （Round 1と同一の連鎖反応・空段落・プレイヤーキャラルールを適用）
  開始番号: {直前の最終番号 + 1}（ただしプレイヤー入力イベント自体の番号を含む）

  【出力形式】Round 1と同一のJSON形式。

contents:
  プレイヤーの入力を起点に、骨組みの続きを生成してください。

generationConfig:
  temperature: 0.3
  maxOutputTokens: 8192
  responseMimeType: 'application/json'
```

#### 5.1.3 骨組み後処理

```javascript
async function postProcessSkeleton(skeletonResult) {
  const { events, recentUpdate, stopped } = skeletonResult;

  // 1. 骨組み履歴ファイルに追記
  await appendToSkeletonHistory(currentScene.key, events);

  // 2. 客観記憶の即時登録
  for (const [eventId, event] of Object.entries(events)) {
    for (const [charName, summary] of Object.entries(event.chains)) {
      if (charName === '環境') continue;
      if (summary === 'PLAYER_INPUT_REQUIRED') continue;

      const tag = `${eventId}-${charName}`;
      registerObjectiveMemory(charName, {
        summary: summary,
        source: [tag],
        scene: state.currentScene.location,
        timestamp: Date.now()
      });
    }
    // 空段落のキャラは登録しない（event.empty に列挙されたキャラ）
  }

  // 3. 5W1H直近状態を最終イベントの5w1hで更新
  if (recentUpdate) {
    updateRecentSettings(recentUpdate);
  }

  // 4. 環境イベントがあれば situation.where/when を更新
  for (const [eventId, event] of Object.entries(events)) {
    if (event.chains['環境']) {
      updateEnvironmentFromEvent(event);
    }
  }

  // 5. プレイヤー入力待ちか確認
  if (stopped) {
    state.pipeline.phase = 'step1_waiting';
    state.pipeline.pendingPlayerInput = true;
    showPlayerInputUI(events);  // UI表示
    return 'waiting';
  }

  return 'complete';
}
```

---

### 5.2 Step 2: キャラクター本文生成

```
処理: キャラ数分の Gemini API 呼び出し（並列）

対象: 骨組みに非空エントリがあるキャラクター
AIキャラ: Gemini が独白調テキスト + ポーズタグを生成
プレイヤーキャラ: Gemini がAI整形 → 編集UI → プレイヤー承認
```

#### 5.2.1 AIキャラ本文生成プロンプト

```
system_instruction:
  あなたは物語の本文執筆AIです。
  骨組み（事実の台帳）の各エントリを、指定キャラクターの
  一人称独白調で詳細な文学的テキストに展開してください。

  【対象キャラクター】
  {charName} の情報:
  名前: {base.name}
  二つ名: {base.epithet}
  種族: {base.species}（{base.speciesBiology}）
  性格: {base.traits}
  価値観: {base.values}
  口調: {base.speechPattern}
  精神状態: {base.mentalState}
  動作特徴: {base.movement}
  癖: {base.habits}

  【関連する主観記憶（過去の体験）】
  {subjectiveMemories — 直近3件 + selectedTagsに対応する記憶}

  【関連する客観記憶（過去の事実）】
  {objectiveMemories — selectedTagsで選別済み}

  【執筆ルール】

  ＜文体＞
  ・{charName}の口調で一人称独白調に書く
  ・台詞は骨組みの記述をそのまま保持し改変しない
  ・台詞の前後に知覚・身体反応・内面独白を追加する

  ＜主観的環境描写＞
  ・「～ように見えた」「～だと思った」等の主観表現で環境を描写してよい
  ・キャラの特性に基づく知覚フィルターを反映する
    例: ルミアの千里眼 → 微細な視覚情報、エルザの敏感な聴覚 → 音の描写

  ＜身体描写＞
  ・感情は直接命名せず身体反応で描く
  ・骨格・筋肉・重心・関節角度を意識した動作描写

  ＜ポーズタグ＞
  ・動作描写の直後に必ず挿入:
    [キャラ名:構図、姿勢、四肢の位置、関節角度、重心、視線方向、雰囲気]

  ＜記憶の活用＞
  ・関連する主観記憶がある場合、過去の知覚体験が現在の感覚を侵食する描写
  ・同一パターンの安易な繰り返しを避け、経験を経た「変化」を描く

  ＜禁止事項＞
  ・骨組みに無い新しい行動・事象を創造しない
  ・他キャラの内面を書かない（外から観察した描写のみ）
  ・メタ的言及・注釈・警告は一切書かない

  【出力形式】JSONのみ。
  {
    "paragraphs": {
      "X-NNN-キャラ名": {
        "text": "独白調テキスト（ポーズタグ含む）"
      }
    }
  }

contents:
  以下の骨組みイベントを {charName} の視点で展開してください。

  【骨組みイベント（{charName}の非空エントリのみ）】
  {対象キャラの骨組みエントリ一覧}

  【同時に起きた他キャラの行動（外から観察可能な事実）】
  {同一番号の他キャラのchainsエントリ}

  【環境変化】
  {環境エンティティのchainsエントリ}

generationConfig:
  temperature: 0.8
  maxOutputTokens: 8192
```

#### 5.2.2 プレイヤーキャラ本文生成プロンプト（B案: AI整形）

```
system_instruction:
  あなたは物語の本文整形AIです。
  骨組みの粗筋を、指定キャラクターの口調・性格に基づいて
  一人称独白調の文学的テキストに整形してください。

  【対象キャラクター】
  {base情報 — AIキャラと同一形式}

  【整形ルール】
  ・キャラの口調で一人称独白調に書く
  ・台詞は骨組みの記述をそのまま保持
  ・身体感覚・環境知覚を追加する
  ・ポーズタグを埋め込む
  ・プレイヤーが後で編集することを前提に、過度に装飾しない

  【出力形式】AIキャラと同一のJSON形式。

contents:
  以下の骨組みイベントを {charName} の視点で整形してください。
  {骨組みエントリ}

generationConfig:
  temperature: 0.5
  maxOutputTokens: 4096
```

#### 5.2.3 Step 2 後処理

```javascript
async function postProcessStep2(charName, result, isPlayerChar) {
  const { paragraphs } = result;

  if (isPlayerChar) {
    // プレイヤーキャラ: 編集UIを表示して承認を待つ
    const edited = await showPlayerEditUI(charName, paragraphs);
    // 承認後のテキストで上書き
    Object.assign(paragraphs, edited);
  }

  // キャラ本文ファイルに保存
  await saveCharacterText(state.currentScene.key, charName, paragraphs);

  // 主観記憶インデックスに追記
  for (const tag of Object.keys(paragraphs)) {
    await addSubjectiveMemoryIndex(charName, tag, state.currentScene.key);
  }

  // ポーズタグ抽出 → poseRecords更新
  for (const [tag, para] of Object.entries(paragraphs)) {
    const poseMatch = para.text.match(/\[([^\]:]+):([^\]]+)\]/g);
    if (poseMatch) {
      // 最後のポーズタグを採用
      const last = poseMatch[poseMatch.length - 1];
      const pm = last.match(/\[([^\]:]+):([^\]]+)\]/);
      if (pm) state.poseRecords[pm[1]] = pm[2];
    }
  }
}
```

---

### 5.3 Step 3: 後処理

```
処理: ローカル処理（API不要）

1. 直近状態5W1H更新
   → 骨組みの最終イベントの recentUpdate を反映
   → state.situation の where/when/who/what/how を更新

2. シーン切り替え判定
   → 骨組みにシーンタグが含まれていれば新シーンに移行
   → state.currentScene を更新

3. 客観記憶の最終確定
   → Step 1で仮登録した記憶を確定保存
   → memories/*.json + IndexedDB に永続化

4. 主観記憶保存の確認
   → Step 2で保存したキャラ本文ファイルの整合性チェック
   → 主観記憶インデックスの更新確認

5. 骨組み履歴ファイル最終確定
   → 今回のラウンドで生成した全イベントが記録されているか確認

6. ポーズタグ集約
   → 全キャラの最新ポーズタグを poseRecords に反映
   → renderCameraGrid() でUI更新

7. 画像生成パイプライン起動（オプション）
   → generateSanitizedPosePrompt() — F3
   → generateCharacterSDPromptGemini() — F6
   → 画像生成API呼び出し

8. UI更新
   → renderAllSections()
   → renderCharacters()
   → updateAllPromptPreviews()
   → saveToStorage()
```

---

## 6. UI 設計

### 6.1 プレイヤー入力UI

```html
<!-- 骨組み生成中にプレイヤー介入が必要になった時に表示 -->
<div id="playerInputPanel" class="panel" style="display:none">
  <h3>🎮 プレイヤーの番</h3>

  <!-- 現在の状況表示 -->
  <div id="playerContextDisplay" class="context-display">
    <!-- 直近の骨組みイベントを時系列で表示 -->
  </div>

  <!-- 統合入力欄 -->
  <textarea id="playerInputText" rows="6"
    placeholder="亮の行動・台詞を書いてください。&#10;展開指示（「～させたい」）や環境変更（「雷が鳴る」）も可。"></textarea>

  <div class="player-input-actions">
    <button id="playerSubmitBtn" class="btn-primary">送信 → 連鎖反応を継続</button>
  </div>
</div>
```

### 6.2 プレイヤーキャラ本文編集UI

```html
<!-- Step 2 でプレイヤーキャラの整形結果を編集する -->
<div id="playerEditPanel" class="panel" style="display:none">
  <h3>📝 {charName} の本文を確認・編集</h3>

  <!-- 骨組みの粗筋（参考表示） -->
  <div id="playerEditSkeleton" class="skeleton-ref">
    <!-- 骨組みの該当エントリを表示 -->
  </div>

  <!-- AI整形結果（編集可能） -->
  <textarea id="playerEditText" rows="10"></textarea>

  <div class="player-edit-actions">
    <button id="playerEditApproveBtn" class="btn-primary">承認</button>
    <button id="playerEditRegenerateBtn" class="btn-secondary">再整形</button>
  </div>
</div>
```

### 6.3 キャラクター設定パネルへの追加

```html
<!-- 各キャラクターカードに追加 -->
<div class="writer-mode-toggle">
  <label>執筆モード:</label>
  <select data-char-writer-mode="{idx}">
    <option value="ai">🤖 AI執筆</option>
    <option value="player">🎮 プレイヤー執筆</option>
  </select>
</div>
```

### 6.4 パイプライン進行状況表示

```
生成ボタンの表示状態:
  Step 0: 📋 コンテキスト収集...
  Step 1: 🦴 骨組み生成... (Round N)
  Step 1 待ち: 🎮 プレイヤー入力待ち
  Step 2: 📝 本文生成... (N/M キャラ)
  Step 2 編集: ✏️ プレイヤー編集待ち
  Step 3: ⚙️ 後処理...
```

---

## 7. API 呼び出し集計

### 7.1 1回の生成あたり

```
Step 0: 1 call（記憶選別）
Step 1: 1 call × ラウンド数（プレイヤー介入なければ1回）
Step 2: N calls（AIキャラ数、並列）+ M calls（プレイヤーキャラ整形）
Step 3: 0 calls

最小（2AIキャラ、プレイヤー介入なし）: 1 + 1 + 2 = 4 calls
典型（3AIキャラ + 1プレイヤーキャラ、1回介入）: 1 + 2 + 4 = 7 calls
最大（4AIキャラ + 1プレイヤーキャラ、3回介入）: 1 + 4 + 5 = 10 calls

現行v5.6（レビュー有効時）: 1(MemSelect) + 1(F1) + 4(Reviews) = 6 calls（直列）
新方式: Step 2 が並列なので実効ステップ数は少ない
```

### 7.2 トークン見積もり

```
Step 0 記憶選別:
  入力: ~3,000 tokens（記憶要約+直近テキスト）
  出力: ~100 tokens

Step 1 骨組み:
  入力: ~5,000 tokens（キャラ設定+5W1H+過去イベント+直近テキスト）
  出力: ~2,000 tokens（10イベントの骨組み）

Step 2 キャラ本文（1キャラあたり）:
  入力: ~3,000 tokens（キャラ設定+骨組み+記憶+他キャラ行動）
  出力: ~2,000 tokens（独白テキスト）

合計（3キャラ、1ラウンド）:
  入力: 3,000 + 5,000 + 3,000×3 = ~17,000 tokens
  出力: 100 + 2,000 + 2,000×3 = ~8,100 tokens
```

---

## 8. 既存機能との互換性

### 8.1 維持する機能

| 機能 | 現行 | 新方式での変更 |
|---|---|---|
| F2（文章→直近設定） | textareaから抽出 | キャラ本文ファイルから抽出。互換 |
| F3（ポーズ健全化） | poseRecordsから | poseRecordsから。互換 |
| F5（全体画像） | 5W1H+直近テキスト | 5W1H+キャラ本文合成。互換 |
| F6（SDプロンプト） | キャラ設定→英語タグ | 同一。互換 |
| F8（参考文章→設定） | 参考文章→JSON | 無関係。互換 |
| 参照画像管理 | IndexedDB | 同一。互換 |
| localStorage保存 | state全体 | state拡張（writerMode等追加） |
| JB_PRESETS | F1のsystem_instruction | Step 2のsystem_instructionに移行 |

### 8.2 廃止する機能

| 機能 | 理由 |
|---|---|
| 4観点レビュー（story-review.js） | 骨組み+視点分離で代替 |
| 記憶抽出API（summarizeAndSaveMemory） | 骨組みから自動登録 |
| 一括記憶抽出（bulkExtractMemories） | 骨組み履歴から再構築可能 |
| 本文走査+タグ付け（scanTagAndExtractMemories） | Step 1でタグ確定 |
| autoTagGeneratedText | Step 1でタグ確定 |
| 段落インデックスキャッシュ | タグ→ファイル直接解決 |

### 8.3 移行対象

| 機能 | 移行内容 |
|---|---|
| generateStory() | Step 0-3 パイプラインに分割 |
| convertStoryToPrompt() (F2) | キャラ本文ファイルからポーズ抽出に変更 |
| render5W1HText() | 記憶表示部分を新フォーマット対応 |
| saveToStorage/loadFromStorage | 新state構造対応 |
| renderCharacters() | writerModeトグル追加 |

---

## 9. 実装順序

### Phase 1: 基盤（データ層）
1. 新タグシステム実装（resolveTag, tagToFilePath）
2. IndexedDB v3 マイグレーション
3. 骨組み履歴ファイル CRUD
4. キャラ本文ファイル CRUD
5. 客観記憶ファイル CRUD
6. 主観記憶インデックス CRUD

### Phase 2: パイプライン
7. Step 0: コンテキスト収集（記憶選別を新タグ対応）
8. Step 1 Round 1: 骨組み生成 + 後処理
9. Step 1 Round 2+: プレイヤー入力後の継続
10. Step 2 AIキャラ: 本文生成 + 後処理
11. Step 2 プレイヤーキャラ: AI整形 + 編集UI
12. Step 3: 全後処理

### Phase 3: UI
13. プレイヤー入力パネル
14. プレイヤー本文編集パネル
15. キャラカード writerMode トグル
16. パイプライン進行状況表示
17. 骨組み表示/デバッグUI

### Phase 4: 統合・移行
18. 現行generateStory()を新パイプラインに置換
19. 現行レビューシステムの無効化
20. 現行記憶抽出の無効化
21. F2/F5の入力ソース変更
22. 既存データのマイグレーションツール（v5.6 → v2）
