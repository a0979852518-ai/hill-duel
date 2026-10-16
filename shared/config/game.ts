// ============================================================
// 遊戲全域設定：計時、場地尺寸、物理參數。
// 想調整平衡或場地，改這裡就好，前後端會共用同一份。
// ============================================================

export const GAME_CONFIG = {
  /** 第一階段：抽取＋選擇道具的時間（毫秒） */
  drawPhaseMs: 30_000,
  /** 第二階段：使用道具的時間（毫秒），與第一階段完全獨立 */
  usePhaseMs: 30_000,
  /**
   * 網路延遲寬限：伺服器實際判定逾時會比畫面上的 0 秒再晚這麼多，
   * 避免玩家在最後一刻按下、封包還在路上就被判逾時。
   */
  latencyGraceMs: 400,
  /** 玩家放棄（逾時）後，切換回合前的提示停留時間 */
  skipTurnDelayMs: 1_200,
  /** 投擲物落地/命中後，等待爆炸動畫的時間 */
  impactSettleMs: 1_100,
  /** 防禦道具放置、功能道具動畫的停留時間 */
  effectSettleMs: 1_200,
  /** 回合開始時處理持續傷害等狀態的動畫時間 */
  turnStartEffectMs: 900,
  /** 斷線後保留位置多久（毫秒）；超過則判對方勝利 / 移除玩家 */
  reconnectGraceMs: 60_000,
  /** 第一回合由誰先：'host' 房主先，'random' 隨機 */
  firstTurn: 'random' as 'host' | 'random',
  /** 每次從道具池抽幾個 */
  drawCount: 2,
} as const;

/**
 * 場地設定
 *  width/height   畫面（鏡頭）大小，會依視窗等比縮放
 *  world          整個戰場的大小，比畫面大，鏡頭會移動與縮放
 */
export const ARENA = {
  width: 1280,
  height: 720,
  world: { width: 2600, height: 1100 },
  /** 地面高度（角色腳底的 y） */
  groundY: 980,
  /** 重力（像素/秒²），各投擲物還會再乘上自己的 gravityScale。數字越大東西越「重」 */
  gravity: 1150,
  /** 物理模擬的固定步長（秒）；用 120Hz 避免高速物體穿透薄的東西 */
  physicsStep: 1 / 120,
  /** 每幾個物理步記錄一格動畫（4 步 = 每 33ms 一格） */
  frameEvery: 4,
  /** 單次投擲最多模擬幾秒，避免無限飛行 */
  maxFlightSeconds: 8,
  /** 超出這個範圍就算飛出場外 */
  outOfBounds: { minX: -250, maxX: 2850, maxY: 1180 },
  /** 兩側邊界的矮牆高度（擋住滑動的人與道具，高飛的投擲物會飛出去） */
  wallHeight: 260,
  /** 角色起始位置（腳底 x） */
  characterStartX: [400, 2200],
  /** 角色被擊退時，腳底 x 允許的範圍（不會被推到對方那半邊或場外） */
  characterXRange: [
    [120, 1100],
    [1500, 2480],
  ],
  /** 角色受擊判定框大小（以腳底中心為基準往上；配合 150px 高的真人站姿） */
  characterHitbox: { w: 56, h: 150 },
  /** 角色的物理外型（東西可以疊在頭上）：身體長方形＋頭部圓形，相對腳底中心 */
  characterBody: { torsoW: 34, torsoH: 118, headR: 14, headY: -134 },
  /** 投擲出手點：相對腳底中心的偏移（右側玩家 x 會自動鏡像） */
  launchOffset: { x: 30, y: -135 },
  /**
   * 防禦道具「放手位置」可選的區域，相對角色腳底：
   * back = 往身後多少、front = 往對手方向多少、top = 往上多高。
   * 包含自己頭頂上方，所以鋼盔可以直接戴到頭上。
   */
  placementZone: { back: 90, front: 330, top: 340 },
} as const;

/** 擊退：角色被打中後依投擲物重量與速度滑退 */
export const KNOCKBACK = {
  /** 擊退初速 = k × √(重量kg) × (命中速度 / 1500) */
  k: 420,
  /** 擊退初速上限（像素/秒） */
  maxSpeed: 650,
  /** 爆頭額外倍率 */
  headshotBonus: 1.25,
  /** 往上彈的比例 */
  lift: 0.35,
  /** 擊退超過這個初速才會「被打倒再站起來」，否則只是踉蹌 */
  knockdownSpeed: 450,
} as const;

/** 鏡頭 */
export const CAMERA = {
  /** 輪到某人時對準他的縮放（1 = 原尺寸） */
  followZoom: 0.8,
  /** 跟隨投擲物時的縮放 */
  throwZoom: 0.72,
  /** 開場遠景停留時間（毫秒） */
  introHoldMs: 1600,
} as const;

/** 投擲操作：滑鼠/手指決定方向，按住蓄力，放開投出 */
export const AIM_CONFIG = {
  /** 可瞄準的角度範圍（0 = 水平，90 = 正上方） */
  minAngle: -10,
  maxAngle: 88,
  minPower: 0.05,
  maxPower: 1,
  /** 從 0 蓄滿需要幾秒 */
  chargeSeconds: 1.15,
} as const;

/** 物理材質（Matter.js） */
export const PHYSICS = {
  projectile: { friction: 0.35, restitution: 0.32, frictionAir: 0, density: 0.004 },
  defense: { friction: 0.7, restitution: 0.05, frictionAir: 0.01, density: 0.002 },
  ground: { friction: 0.8, restitution: 0.1 },
  /** 命中後投擲物繼續彈跳/滾動的展示時間（毫秒） */
  afterImpactMs: 1100,
  /** 堆疊最多模擬多久等它停下來（毫秒） */
  settleMaxMs: 3500,
  /** 掉到這個高度以下的防禦道具算掉出場外 */
  killY: 1200,
} as const;
