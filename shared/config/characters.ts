// ============================================================
// 角色設定檔
// ------------------------------------------------------------
// 新增角色：複製一筆，改 id / 名稱 / HP / 圖片路徑即可。
// 圖片放在 client/public/assets/characters/<角色id>/ 底下，路徑填相對於 client/public。
//
// 每個角色可以有這些圖（都要「面向右邊」、透明背景 PNG；右方玩家會自動左右翻轉）：
//   portrait  選角畫面用（正面照）
//   idle      戰場上待機
//   throw     輪到自己瞄準（角度/力道）時、以及出手瞬間
//   hurt      受到傷害時短暫顯示
//   dead      生命歸零（躺下）
// 缺哪張就自動用 idle 代替；連 idle 都沒有就畫臨時圖形，不會壞掉。
// 有白底照片可以用 tools/cutout.py 去背（用法見 README）。
// ============================================================

export type Pose = 'idle' | 'throw' | 'hurt' | 'dead';

/**
 * 角色被動技能（數值都是倍率，不填 = 1 / 沒有）。
 * 伺服器結算傷害時套用；文字說明寫在 skills 給選角畫面和戰鬥中按 Q 看。
 */
export interface CharacterTraits {
  /** 自己造成的所有傷害倍率 */
  outgoingMultiplier?: number;
  /** 自己丟的東西爆頭時的倍率（預設 1.5） */
  headshotMultiplier?: number;
  /** 自己丟的這些道具「直接命中（沒彈地）」時爆擊倍率 */
  critItems?: Record<string, number>;
  /** 被這些道具打到（直擊、波及、功能道具）時受到的傷害倍率 */
  incomingByItem?: Record<string, number>;
  /** 這些狀態造成的持續傷害倍率（例如二手菸） */
  statusDamageMultiplier?: Record<string, number>;
  /** 免疫的狀態 */
  immuneStatuses?: string[];
  /** 這些道具彈地後打到自己，特殊效果照樣觸發 */
  bounceTriggers?: string[];
  /** 自己放的這些防禦道具尺寸倍率（長寬各乘這個數） */
  defenseScale?: Record<string, number>;
  /** 身上黏著東西（poopoo恩）時，每回合開始回復幾血 */
  stuckRegen?: number;
  /** 自己用這些道具造成的傷害倍率（連恩的 Maya ×4、poopoo恩 ×3） */
  ownItemMultiplier?: Record<string, number>;
  /** 對上特定角色時，取代 outgoingMultiplier 的傷害倍率（角色 id → 倍率） */
  outgoingVsChar?: Record<string, number>;
  /** 被特定角色打到時受到的傷害倍率（角色 id → 倍率） */
  incomingFromChar?: Record<string, number>;
  /** 負面狀態持續回合倍率（狀態 id → 倍率），永久狀態不適用 */
  statusDurationMultiplier?: Record<string, number>;
  /** 負面狀態強度倍率：效果 (倍率-1) 乘上這個數，例如精神傷害 ×1.2 → ×1.4 */
  statusStrengthMultiplier?: Record<string, number>;
  /** 自己丟出去的這些道具變大幾倍（碰撞範圍一起變大） */
  ownItemScale?: Record<string, number>;
  /** 抽卡權重倍率（道具 id → 倍率），例如連恩抽到 poopoo恩 的機率 ×1.5 */
  drawWeight?: Record<string, number>;
  /** 自己附加給別人的狀態效果強度倍率（竹竿用絲襪 ×1.5） */
  statusApplyStrength?: Record<string, number>;
  /** 被打飛倒地後多躺幾毫秒才起來（竹竿：睡覺） */
  extraLieMs?: number;
  /** 多躺的那段時間睡飽後回幾血 */
  sleepHeal?: number;
  /** 投擲連續命中對手 hits 次 → 下次抽牌必出 itemId（竹竿：胡了就出麻將） */
  streakReward?: { hits: number; itemId: string };
  /** 受到的單次傷害超過 at 的部分乘 factor（李信安：學分混子，超過 16 的部分減半） */
  damageSoftCap?: { at: number; factor: number };
  /** 第一次血量歸零時鎖血，固定在 1（一場只有一次） */
  surviveOnce?: boolean;
}

export interface CharacterDef {
  id: string;
  name: string;
  /** 初始生命值（每個角色可以不同） */
  maxHp: number;
  description: string;
  /** 設為 false 就不會出現在選角畫面 */
  enabled?: boolean;
  /** 選角畫面的圖 */
  portrait?: string;
  /** 戰鬥中各種姿勢的圖 */
  poses?: Partial<Record<Pose, string>>;
  /**
   * 被打飛的連續動作圖（5 張，面向右、往左邊被打飛）：
   *  1 被打到往後仰  2 往後倒  3、4 在地上往後滾  5 躺平
   * 5 張要用同一個縮放比例存（第 1 張的高度 = 站姿高度）
   */
  knockFrames?: string[];
  /** 站姿在畫面上的高度（像素），其他姿勢依比例換算；預設 150 */
  standHeight?: number;
  /** 身體大小倍率（判定框、頭、出手點、翻滾的身體），預設 1；連恩 = 2/3 */
  bodyScale?: number;
  /** 被動技能 */
  traits?: CharacterTraits;
  /** 技能說明（選角畫面、戰鬥中按 Q） */
  skills?: string[];
  /** 專屬卡牌：只有用這個角色的人抽得到（道具 id） */
  exclusiveItems?: string[];
  /** 沒有圖片時的臨時外觀 */
  placeholder: { color: number; accent: number };
}

export const CHARACTERS: CharacterDef[] = [
  {
    id: 'lixinan',
    name: '李信安',
    maxHp: 100,
    description: '物理系爆頭狙擊手',
    traits: { headshotMultiplier: 2, incomingByItem: { ricecooker: 0.5 }, damageSoftCap: { at: 16, factor: 0.5 } },
    skills: ['物理系：爆頭傷害 ×2（一般是 ×1.5）', '跟捲毛長期相處：被快煮鍋打到只受 0.5 倍傷害', '專屬卡牌「排球」：投擲攻擊，傷害 45', '學分混子：受到的單次傷害超過 16 的部分減半（例如 40 → 28）'],
    exclusiveItems: ['volleyball'],
    portrait: 'assets/characters/lixinan/portrait.png',
    poses: {
      idle: 'assets/characters/lixinan/idle.png',
      throw: 'assets/characters/lixinan/throw.png',
      // hurt: 'assets/characters/lixinan/hurt.png',   ← 有受傷照後取消註解
      dead: 'assets/characters/lixinan/dead.png',
    },
    knockFrames: [1, 2, 3, 4, 5].map((i) => `assets/characters/lixinan/knock${i}.png`),
    placeholder: { color: 0x222222, accent: 0xf1d3b8 },
  },
  {
    id: 'zhenglinze',
    name: '鄭霖澤',
    maxHp: 120,
    description: '沾屎回血的重砲坦克',
    traits: {
      outgoingMultiplier: 1.2,
      incomingByItem: { mutualBomb: 1.5 },
      statusDamageMultiplier: { smoke: 3 },
      stuckRegen: 1,
      // 負面效果兩倍（機車鎖除外）：有回合數的 → 回合數 ×2；永久疊加的絲襪 → 每層 ×1.4
      statusDurationMultiplier: { blind: 2, disgust: 2, poison: 2 },
      statusStrengthMultiplier: { mental: 2 },
    },
    skills: [
      '初始血量 120',
      '造成的傷害 ×1.2',
      '弱點：老師的奶照對他的傷害 ×1.5',
      '弱點：大哥的香菸命中後的二手菸，每回合扣血 ×3',
      '弱點：受到的負面效果兩倍（機車鎖除外）：冷氣卡、過期果汁持續回合 ×2；絲襪每層 ×1.4',
      '身上黏著 poopoo恩 時，每回合回復 1 血',
      '專屬卡牌「連恩」：把連恩丟出去（傷害 25，她會在空中快速旋轉）；對手是連恩時抽不到',
    ],
    portrait: 'assets/characters/zhenglinze/portrait.png',
    poses: {
      idle: 'assets/characters/zhenglinze/idle.png',
      throw: 'assets/characters/zhenglinze/throw.png',
      // hurt: 'assets/characters/zhenglinze/hurt.png',
      dead: 'assets/characters/zhenglinze/dead.png',
    },
    knockFrames: [1, 2, 3, 4, 5].map((i) => `assets/characters/zhenglinze/knock${i}.png`),
    exclusiveItems: ['lianenThrow'],
    placeholder: { color: 0xbdb6aa, accent: 0xf1d3b8 },
  },
  {
    id: 'yebingcheng',
    name: '葉柄承',
    maxHp: 70,
    description: '常駐病房的獸控',
    traits: { outgoingMultiplier: 0.8, surviveOnce: true },
    skills: [
      '初始血量只有 70',
      '造成的傷害只有 0.8 倍',
      '專屬卡牌「住院」：回復 50 血',
      '專屬卡牌「獸控」：跟人一樣高的特殊防禦道具，擋 2 次攻擊；還在場上時造成的傷害 ×2（跟 0.8 倍相乘 = 1.6 倍）；倒下壓到葉柄承會回復 30 血，獸控消失',
      '抽卡機率：獸控比一般道具高一點（1.5 倍），住院比較低（0.75 倍）',
      '鎖血：第一次血量歸零時固定在 1 血（一場一次）',
    ],
    exclusiveItems: ['hospital', 'beastFan'],
    portrait: 'assets/characters/yebingcheng/portrait.png',
    poses: {
      idle: 'assets/characters/yebingcheng/idle.png',
      throw: 'assets/characters/yebingcheng/throw.png',
      hurt: 'assets/characters/yebingcheng/hurt.png',
      dead: 'assets/characters/yebingcheng/dead.png',
    },
    knockFrames: [1, 2, 3, 4, 5].map((i) => `assets/characters/yebingcheng/knock${i}.png`),
    placeholder: { color: 0xe8e6ea, accent: 0xf1d3b8 },
  },
  {
    id: 'juanmao',
    name: '捲毛',
    maxHp: 100,
    description: '回收堆的主人，快煮鍋的愛用者。',
    portrait: 'assets/characters/juanmao/portrait.png',
    poses: {
      idle: 'assets/characters/juanmao/idle.png',
      throw: 'assets/characters/juanmao/throw.png',
      hurt: 'assets/characters/juanmao/hurt.png',
      dead: 'assets/characters/juanmao/dead.png',
    },
    knockFrames: [1, 2, 3, 4, 5].map((i) => `assets/characters/juanmao/knock${i}.png`),
    traits: {
      immuneStatuses: ['mental'],
      critItems: { ricecooker: 1.5 },
      // 面積 1.5 倍 → 長寬各 √1.5 倍
      defenseScale: { recyclePile: Math.sqrt(1.5) },
      bounceTriggers: ['ulock'],
    },
    skills: [
      '免疫竹竿的絲襪（精神傷害）',
      '自己丟的快煮鍋直接命中（沒彈地）會爆擊：傷害 ×1.5',
      '自己放的回收紙箱面積 1.5 倍',
      '弱點：機車鎖彈地後打到他，效果照樣觸發（一般彈地後效果不算）',
    ],
    placeholder: { color: 0xffffff, accent: 0xf1d3b8 },
  },
  {
    id: 'lianen',
    name: '連恩',
    maxHp: 80,
    description: '矮小的 Maya 剋星',
    portrait: 'assets/characters/lianen/portrait.png',
    poses: {
      idle: 'assets/characters/lianen/idle.png',
      throw: 'assets/characters/lianen/throw.png',
      hurt: 'assets/characters/lianen/hurt.png',
      dead: 'assets/characters/lianen/dead.png',
    },
    knockFrames: [1, 2, 3, 4, 5].map((i) => `assets/characters/lianen/knock${i}.png`),
    // 矮小：一般角色 150 → 100
    standHeight: 100,
    bodyScale: 2 / 3,
    traits: {
      outgoingMultiplier: 0.5,
      outgoingVsChar: { zhenglinze: 2 },
      ownItemMultiplier: { maya2026: 4, poopoo: 3 },
      incomingFromChar: { zhenglinze: 0.5 },
      ownItemScale: { poopoo: 2.5 },
      drawWeight: { poopoo: 1.5 },
    },
    skills: [
      '人物矮小：身高只有一般角色的 2/3（比較難打中）',
      '初始血量 80，造成的傷害只有 0.5 倍',
      '對手是鄭霖澤時，傷害倍率改為 2 倍（取代 0.5 倍）',
      '鄭霖澤打中她的傷害只有 0.5 倍',
      '自己丟的 Maya 2026 傷害 ×4',
      '自己丟的 poopoo恩 傷害 ×3，而且是一般的 2.5 倍大',
      '抽到 poopoo恩 的機率 ×1.5',
    ],
    placeholder: { color: 0xf48fb1, accent: 0xf1d3b8 },
  },
  {
    id: 'zhugan',
    name: '竹竿',
    maxHp: 90,
    description: '嗜睡的雀神',
    portrait: 'assets/characters/zhugan/portrait.png',
    poses: {
      idle: 'assets/characters/zhugan/idle.png',
      throw: 'assets/characters/zhugan/throw.png',
      hurt: 'assets/characters/zhugan/hurt.png',
      dead: 'assets/characters/zhugan/dead.png',
    },
    knockFrames: [1, 2, 3, 4, 5].map((i) => `assets/characters/zhugan/knock${i}.png`),
    traits: {
      immuneStatuses: ['mental'],
      statusApplyStrength: { mental: 1.5 },
      extraLieMs: 3000,
      sleepHeal: 5,
      streakReward: { hits: 3, itemId: 'mahjong' },
    },
    skills: [
      '初始血量 90',
      '自己的絲襪：免疫竹竿的絲襪；用絲襪時效果 ×1.5（每層 ×1.2 → ×1.3）',
      '睡眠：被打飛倒地後會多躺 3 秒才爬起來，睡飽回復 5 血',
      '胡牌：投擲連續 3 次打中對手就「胡」，下次抽牌必出專屬武器「麻將」（傷害 69）；丟沒打中連擊就歸零',
      '專屬卡牌「原神 1:1 手辦」：跟人一樣高的掩體，擋 1 次攻擊；每被摧毀一個，竹竿氣到傷害永久 +0.15',
    ],
    exclusiveItems: ['mahjong', 'genshinFigure'],
    placeholder: { color: 0xffffff, accent: 0xf1d3b8 },
  },

  // ---- 以下是最早的臨時角色（沒有照片），先關閉；改成 enabled: true 就會回到選角畫面 ----
  {
    id: 'knight',
    name: '鐵壁騎士',
    maxHp: 120,
    description: '血量較厚，適合打持久戰。',
    enabled: false,
    placeholder: { color: 0x4a78c2, accent: 0xdfe8f5 },
  },
  {
    id: 'ranger',
    name: '疾風遊俠',
    maxHp: 100,
    description: '標準血量的平衡型角色。',
    enabled: false,
    placeholder: { color: 0x3f9e5a, accent: 0xf2e3b3 },
  },
];

export const PLAYABLE_CHARACTERS = CHARACTERS.filter((c) => c.enabled !== false);

export function getCharacter(id: string): CharacterDef | undefined {
  return CHARACTERS.find((c) => c.id === id);
}

export function bodyScaleOf(id: string | null | undefined): number {
  return (id && getCharacter(id)?.bodyScale) || 1;
}

/** 某角色丟出去的道具大小倍率（連恩的 poopoo恩 2.5 倍） */
export function itemScaleFor(characterId: string | null | undefined, itemId: string): number {
  return traitsOf(characterId).ownItemScale?.[itemId] ?? 1;
}

export function traitsOf(id: string | null | undefined): CharacterTraits {
  return (id && getCharacter(id)?.traits) || {};
}

/** 防禦道具依放置者的角色調整大小（捲毛的回收紙箱比較大） */
export function scaledDefenseSize(size: { w: number; h: number }, itemId: string, characterId: string | null | undefined): { w: number; h: number } {
  const s = traitsOf(characterId).defenseScale?.[itemId] ?? 1;
  return s === 1 ? size : { w: Math.round(size.w * s), h: Math.round(size.h * s) };
}
