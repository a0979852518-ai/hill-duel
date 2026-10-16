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
    description: '戴眼鏡的冷靜投手。物理系。',
    traits: { headshotMultiplier: 2, incomingByItem: { ricecooker: 0.5 } },
    skills: ['物理系：爆頭傷害 ×2（一般是 ×1.5）', '跟捲毛長期相處：被快煮鍋打到只受 0.5 倍傷害', '專屬卡牌「排球」：投擲攻擊，傷害 45'],
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
    description: '身手靈活的投擲好手。',
    traits: { outgoingMultiplier: 1.5, incomingByItem: { mutualBomb: 1.5 }, statusDamageMultiplier: { smoke: 3 }, stuckRegen: 1 },
    skills: [
      '初始血量 120',
      '造成的傷害 ×1.5',
      '弱點：老師的奶照對他的傷害 ×1.5',
      '弱點：大哥的香菸命中後的二手菸，每回合扣血 ×3',
      '身上黏著 poopoo恩 時，每回合回復 1 血',
    ],
    portrait: 'assets/characters/zhenglinze/portrait.png',
    poses: {
      idle: 'assets/characters/zhenglinze/idle.png',
      throw: 'assets/characters/zhenglinze/throw.png',
      // hurt: 'assets/characters/zhenglinze/hurt.png',
      dead: 'assets/characters/zhenglinze/dead.png',
    },
    knockFrames: [1, 2, 3, 4, 5].map((i) => `assets/characters/zhenglinze/knock${i}.png`),
    placeholder: { color: 0xbdb6aa, accent: 0xf1d3b8 },
  },
  {
    id: 'yebingcheng',
    name: '葉柄承',
    maxHp: 65,
    description: '架式十足的投擲新秀。',
    traits: { outgoingMultiplier: 0.8 },
    skills: ['初始血量只有 65', '造成的傷害只有 0.8 倍', '專屬卡牌「住院」：回復 50 血', '專屬卡牌「獸控」：使用後，下一個自己的回合造成的傷害 ×2'],
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

export function traitsOf(id: string | null | undefined): CharacterTraits {
  return (id && getCharacter(id)?.traits) || {};
}

/** 防禦道具依放置者的角色調整大小（捲毛的回收紙箱比較大） */
export function scaledDefenseSize(size: { w: number; h: number }, itemId: string, characterId: string | null | undefined): { w: number; h: number } {
  const s = traitsOf(characterId).defenseScale?.[itemId] ?? 1;
  return s === 1 ? size : { w: Math.round(size.w * s), h: Math.round(size.h * s) };
}
