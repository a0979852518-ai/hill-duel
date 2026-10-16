// ============================================================
// 道具設定檔
// ------------------------------------------------------------
// 三大類：
//   throwable  投擲型攻擊道具（角度＋力道，拋物線飛行）
//   defense    防禦道具（放在自己角色前方的區域）
//   functional 功能型道具（不走拋物線，由 server/game/functional/ 的 handler 處理；role 分攻擊/防禦）
//
// 新增道具：在 ITEMS 加一筆即可。圖示放 client/public/assets/items/，
// 沒有圖片時會用 placeholder 畫幾何圖形。
// enabled: false 可以暫時把道具移出抽取池；weight 是抽取權重（預設 1，全部相同機率）。
// ============================================================

export type ItemKind = 'throwable' | 'defense' | 'functional';

export interface ItemPlaceholder {
  shape: 'circle' | 'rect' | 'diamond' | 'bolt' | 'hammer';
  color: number;
  /** 半透明能量風格（護盾類） */
  translucent?: boolean;
}

interface ItemBase {
  id: string;
  name: string;
  description: string;
  kind: ItemKind;
  /** 道具圖示（老虎機與選擇卡片用），相對 client/public */
  icon?: string;
  placeholder: ItemPlaceholder;
  /** 抽取權重，預設 1 */
  weight?: number;
  /** 設為 false 就不會被抽到 */
  enabled?: boolean;
}

/** 命中時附加的狀態效果 */
export interface StatusApply {
  statusId: string;
  turns: number;
}

export interface ThrowableDef extends ItemBase {
  kind: 'throwable';
  /** 飛行中的投擲物圖片（不填就用 placeholder 畫圓形） */
  sprite?: string;
  /** 標籤：防禦道具用它判斷能不能擋 */
  tags: string[];
  /** 直接命中角色的傷害 */
  damage: number;
  /** 對防禦道具耐久度造成的傷害（不填 = damage） */
  structureDamage?: number;
  /** 力道 0% / 100% 對應的初速（像素/秒）；重力是 ARENA.gravity × gravityScale */
  minSpeed: number;
  maxSpeed: number;
  /** 重力倍率：越大掉越快 */
  gravityScale: number;
  /** 投擲物本身的碰撞半徑 */
  radius: number;
  /** 爆炸半徑（0 = 不爆炸，只有直擊才有傷害） */
  explosionRadius: number;
  /** 爆炸波及（非直擊）時傷害倍率，會再依距離衰減 */
  splashMultiplier: number;
  /** 命中角色（直擊或波及）時附加狀態 */
  onHitStatus?: StatusApply;
}

/**
 * 防禦道具的物理外型（碰撞箱）
 *  box     實心長方形（大小 = size）
 *  helmet  倒 U 形外殼：上蓋＋兩側，下方是凹槽，可以卡在頭上
 */
export type DefenseBody = { kind: 'box' } | { kind: 'helmet'; wall: number; cap: number };

export interface DefenseDef extends ItemBase {
  kind: 'defense';
  /** 放在場上時的圖片（會被拉伸成 size 大小；不填就用 placeholder 顏色畫方塊） */
  sprite?: string;
  size: { w: number; h: number };
  /** 碰撞外型，預設 box */
  body?: DefenseBody;
  /** 密度（越大越重、越不容易被撞倒），預設看 PHYSICS.defense.density */
  density?: number;
  /** 摩擦力（越大越不會滑），預設 PHYSICS.defense.friction */
  friction?: number;
  /** 耐久度；null = 不看耐久，只看 maxHits */
  durability: number | null;
  /** 最多可承受幾次攻擊；null = 不限 */
  maxHits: number | null;
  /** 擋下攻擊時，爆炸波及到主人的傷害減免比例（0~1，1 = 完全無傷） */
  damageReduction: number;
  /** 最多存在幾個「放置者自己的回合」；null = 不限 */
  durationTurns: number | null;
  /** 能阻擋哪些投擲物：'all' 或 tag 清單 */
  blocks: 'all' | string[];
  /** 同一玩家場上最多同時存在幾個（不填 = 不限） */
  maxPerPlayer?: number;
}

export interface FunctionalDef extends ItemBase {
  kind: 'functional';
  /** 卡片上顯示「功能攻擊」或「功能防禦」 */
  role: 'attack' | 'defense';
  /** 對應 server/game/functional/registry.ts 裡的 handler 名稱 */
  handler: string;
  /** 'none' = 直接發動；'enemyDefense' = 需要點選一個敵方防禦道具 */
  targeting: 'none' | 'enemyDefense';
  /** 交給 handler 的參數 */
  params: Record<string, number | string>;
}

export type ItemDef = ThrowableDef | DefenseDef | FunctionalDef;

/** 投擲物共用手感 */
const STANDARD_THROW = {
  minSpeed: 380,
  maxSpeed: 1380,
  gravityScale: 1,
  radius: 11,
  explosionRadius: 30,
  splashMultiplier: 0.5,
} as const;

export const ITEMS: ItemDef[] = [
  // ================= 目前使用中的道具 =================
  // 投擲物共用同一套手感（初速、重力），只有傷害與效果不同，玩家比較好抓準度。

  // ---------------- 投擲型 ----------------
  {
    id: 'cigarette',
    kind: 'throwable',
    name: '大哥的香菸',
    description: '命中傷害 20，之後對方每回合都扣 1 血（直到遊戲結束）。',
    icon: 'assets/items/cigarette.png',
    placeholder: { shape: 'rect', color: 0xffffff },
    tags: ['light'],
    damage: 20,
    ...STANDARD_THROW,
    onHitStatus: { statusId: 'smoke', turns: 999 },
  },
  {
    id: 'ulock',
    kind: 'throwable',
    name: '機車鎖',
    description: '命中傷害 10，對方被鎖住，下一回合不能行動。',
    icon: 'assets/items/ulock.png',
    placeholder: { shape: 'circle', color: 0x222222 },
    tags: ['heavy'],
    damage: 10,
    ...STANDARD_THROW,
    onHitStatus: { statusId: 'stun', turns: 1 },
  },
  {
    id: 'maya2026',
    kind: 'throwable',
    name: 'Maya 2026',
    description: '純粹的痛苦，命中傷害 30。',
    icon: 'assets/items/maya.png',
    placeholder: { shape: 'rect', color: 0x37a5cc },
    tags: ['heavy'],
    damage: 30,
    ...STANDARD_THROW,
  },
  {
    id: 'acCard',
    kind: 'throwable',
    name: '侯宸宇的冷氣卡',
    description: '命中傷害 10，對方下一回合抽到的兩個道具會被藏起一個，只剩一個能選。',
    icon: 'assets/items/accard.png',
    placeholder: { shape: 'rect', color: 0x6ec1e4 },
    tags: ['light'],
    damage: 10,
    ...STANDARD_THROW,
    onHitStatus: { statusId: 'blind', turns: 1 },
  },
  {
    id: 'expiredJuice',
    kind: 'throwable',
    name: '竹竿的過期果汁',
    description: '命中傷害 10，對方被噁心到，下一回合造成的傷害減半。',
    icon: 'assets/items/juice.png',
    placeholder: { shape: 'diamond', color: 0xe6e05a },
    tags: ['light'],
    damage: 10,
    ...STANDARD_THROW,
    onHitStatus: { statusId: 'disgust', turns: 1 },
  },

  // ---------------- 防禦型 ----------------
  {
    id: 'helmet',
    kind: 'defense',
    name: '得咖咪咪的鋼盔',
    description: '可以擋下 2 次投擲攻擊。有凹槽，可以直接戴到自己頭上。',
    icon: 'assets/items/helmet.png',
    sprite: 'assets/items/helmet.png',
    placeholder: { shape: 'rect', color: 0x5b6b3a },
    size: { w: 84, h: 53 },
    body: { kind: 'helmet', wall: 11, cap: 18 },
    density: 0.004,
    durability: null,
    maxHits: 2,
    damageReduction: 1,
    durationTurns: null,
    blocks: 'all',
  },
  {
    id: 'penguinFridge',
    kind: 'defense',
    name: '企鵝的冰箱',
    description: '可以擋下 1 次投擲攻擊。',
    icon: 'assets/items/fridge.png',
    sprite: 'assets/items/fridge.png',
    placeholder: { shape: 'rect', color: 0xf5f5f5 },
    size: { w: 63, h: 110 },
    density: 0.003,
    friction: 0.6,
    durability: null,
    maxHits: 1,
    damageReduction: 1,
    durationTurns: null,
    blocks: 'all',
  },
  {
    id: 'recyclePile',
    kind: 'defense',
    name: '捲毛的回收堆',
    description: '可以擋下 1 次投擲攻擊。',
    icon: 'assets/items/recycle.png',
    sprite: 'assets/items/recycle.png',
    placeholder: { shape: 'rect', color: 0xb08d57 },
    size: { w: 78, h: 100 },
    density: 0.0012,
    friction: 0.9,
    durability: null,
    maxHits: 1,
    damageReduction: 1,
    durationTurns: null,
    blocks: 'all',
  },

  // ---------------- 功能型 ----------------
  {
    id: 'mutualBomb',
    kind: 'functional',
    role: 'attack',
    name: '同歸於盡炸彈',
    description: '使用後自己和對手都扣 50 血。',
    placeholder: { shape: 'circle', color: 0x2b2b2b },
    handler: 'damageBoth',
    targeting: 'none',
    params: { damage: 50 },
  },
  {
    id: 'stockings',
    kind: 'functional',
    role: 'attack',
    name: '竹竿的絲襪',
    description: '對方受到精神傷害：到你下一次攻擊結束前，對方受到的傷害 ×1.5。',
    icon: 'assets/items/stockings.png',
    placeholder: { shape: 'rect', color: 0x333333 },
    handler: 'applyStatus',
    targeting: 'none',
    params: { statusId: 'mental', turns: 2, target: 'enemy' },
  },
  {
    id: 'whey',
    kind: 'functional',
    role: 'attack',
    name: '乳清蛋白',
    description: '補充蛋白質：你的下一次攻擊傷害 ×1.5。',
    icon: 'assets/items/whey.png',
    placeholder: { shape: 'rect', color: 0x222222 },
    handler: 'applyStatus',
    targeting: 'none',
    params: { statusId: 'buff', turns: 2, target: 'self' },
  },
  {
    id: 'porkChop',
    kind: 'functional',
    role: 'defense',
    name: '正忠排骨',
    description: '吃飽了！回復 30 血（不會超過上限）。',
    icon: 'assets/items/porkchop.png',
    placeholder: { shape: 'rect', color: 0xd7332a },
    handler: 'heal',
    targeting: 'none',
    params: { amount: 30 },
  },

  // ================= 以下是最早的臨時道具（已停用，改 enabled: true 可加回抽取池） =================

  // ---------------- 投擲型 ----------------
  {
    id: 'rock',
    kind: 'throwable',
    enabled: false,
    name: '石頭',
    description: '輕巧好控制，直擊 20 傷害，小範圍爆裂。',
    icon: 'assets/items/rock.png',
    placeholder: { shape: 'circle', color: 0x8d8d8d },
    tags: ['light'],
    damage: 20,
    minSpeed: 320,
    maxSpeed: 980,
    gravityScale: 1,
    radius: 10,
    explosionRadius: 36,
    splashMultiplier: 0.5,
  },
  {
    id: 'bomb',
    kind: 'throwable',
    enabled: false,
    name: '炸彈',
    description: '比較重、掉得快，爆炸範圍大，直擊 30 傷害。可穿透鋼鐵牆。',
    icon: 'assets/items/bomb.png',
    placeholder: { shape: 'circle', color: 0x2b2b2b },
    tags: ['heavy', 'explosive'],
    damage: 30,
    structureDamage: 35,
    minSpeed: 360,
    maxSpeed: 1120,
    gravityScale: 1.3,
    radius: 13,
    explosionRadius: 95,
    splashMultiplier: 0.7,
  },
  {
    id: 'poisonFlask',
    kind: 'throwable',
    enabled: false,
    name: '毒瓶',
    description: '直擊 8 傷害，命中後中毒 3 回合（每回合 6）。',
    icon: 'assets/items/poison.png',
    placeholder: { shape: 'diamond', color: 0x7bc043 },
    tags: ['light'],
    damage: 8,
    minSpeed: 320,
    maxSpeed: 980,
    gravityScale: 1,
    radius: 10,
    explosionRadius: 60,
    splashMultiplier: 0.6,
    onHitStatus: { statusId: 'poison', turns: 3 },
  },

  // ---------------- 防禦型 ----------------
  {
    id: 'woodBarrier',
    kind: 'defense',
    enabled: false,
    name: '木製障礙物',
    description: '耐久 30，不限回合，耐久歸零才會壞。',
    icon: 'assets/items/wood.png',
    placeholder: { shape: 'rect', color: 0xa0703c },
    size: { w: 28, h: 110 },
    durability: 30,
    maxHits: null,
    damageReduction: 0.5,
    durationTurns: null,
    blocks: 'all',
  },
  {
    id: 'energyShield',
    kind: 'defense',
    enabled: false,
    name: '能量護盾',
    description: '完全擋下一次攻擊，最多存在 2 回合，擋完立即消失。',
    icon: 'assets/items/shield.png',
    placeholder: { shape: 'rect', color: 0x4fc3f7, translucent: true },
    size: { w: 22, h: 150 },
    durability: null,
    maxHits: 1,
    damageReduction: 1,
    durationTurns: 2,
    blocks: 'all',
    maxPerPlayer: 1,
  },
  {
    id: 'steelWall',
    kind: 'defense',
    enabled: false,
    name: '強化防護牆',
    description: '耐久 60，最多存在 3 回合；只能擋輕型投擲物，炸彈會穿透。',
    icon: 'assets/items/steel.png',
    placeholder: { shape: 'rect', color: 0x9aa7b4 },
    size: { w: 34, h: 130 },
    durability: 60,
    maxHits: null,
    damageReduction: 0.7,
    durationTurns: 3,
    blocks: ['light'],
  },

  // ---------------- 功能型 ----------------
  {
    id: 'lightning',
    kind: 'functional',
    enabled: false,
    name: '落雷',
    description: '直接對敵人造成 12 傷害，無視防禦。',
    icon: 'assets/items/lightning.png',
    placeholder: { shape: 'bolt', color: 0xffd54f },
    role: 'attack',
    handler: 'directDamage',
    targeting: 'none',
    params: { damage: 12 },
  },
  {
    id: 'demolish',
    kind: 'functional',
    enabled: false,
    name: '拆除錘',
    description: '選擇一個敵方防禦道具，直接摧毀。',
    icon: 'assets/items/hammer.png',
    placeholder: { shape: 'hammer', color: 0xe57373 },
    role: 'attack',
    handler: 'destroyDefense',
    targeting: 'enemyDefense',
    params: {},
  },
];

/** 狀態效果（中毒、燃燒…）設定
 *  decrementAt：在「被附加者」自己的回合開始(start)或結束(end)時扣 1 回合
 *  turns >= 999 視為永久
 */
export interface StatusDef {
  id: string;
  name: string;
  color: number;
  /** 回合開始時扣多少血 */
  damagePerTurn?: number;
  /** 受到傷害倍率（例如 1.5） */
  incomingMultiplier?: number;
  /** 造成傷害倍率（例如 0.5） */
  outgoingMultiplier?: number;
  /** 回合開始時直接跳過這回合（用掉這個狀態） */
  skipTurn?: boolean;
  /** 抽道具時藏起幾個選項 */
  hideDrawOptions?: number;
  decrementAt: 'start' | 'end';
}

export const PERMANENT_TURNS = 999;

export const STATUSES: StatusDef[] = [
  { id: 'poison', name: '中毒', damagePerTurn: 6, color: 0x7bc043, decrementAt: 'start' },
  { id: 'smoke', name: '二手菸', damagePerTurn: 1, color: 0x9e9e9e, decrementAt: 'start' },
  { id: 'stun', name: '被鎖住', skipTurn: true, color: 0x546e7a, decrementAt: 'start' },
  { id: 'blind', name: '冷氣卡封印', hideDrawOptions: 1, color: 0x4fc3f7, decrementAt: 'end' },
  { id: 'disgust', name: '噁心（傷害減半）', outgoingMultiplier: 0.5, color: 0xc0ca33, decrementAt: 'end' },
  { id: 'mental', name: '精神傷害（受傷×1.5）', incomingMultiplier: 1.5, color: 0xab47bc, decrementAt: 'start' },
  { id: 'buff', name: '蛋白質加持（傷害×1.5）', outgoingMultiplier: 1.5, color: 0xff7043, decrementAt: 'end' },
];

export function getItem(id: string): ItemDef | undefined {
  return ITEMS.find((i) => i.id === id);
}
export function getStatus(id: string): StatusDef | undefined {
  return STATUSES.find((s) => s.id === id);
}
