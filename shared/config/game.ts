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

/** 場地座標（邏輯座標，畫面會依視窗等比縮放） */
export const ARENA = {
  width: 1280,
  height: 720,
  /** 重力（像素/秒²），各投擲物還會再乘上自己的 gravityScale */
  gravity: 600,
  /** 物理模擬的固定步長（秒）— 伺服器用它計算整條拋物線 */
  physicsStep: 1 / 60,
  /** 單次投擲最多模擬幾秒，避免無限飛行 */
  maxFlightSeconds: 8,
  /** 超出這個範圍就算飛出場外 */
  outOfBounds: { minX: -300, maxX: 1580, maxY: 760 },
  platforms: [
    { x: 40, y: 520, w: 330, h: 200 }, // 玩家一（左）
    { x: 910, y: 520, w: 330, h: 200 }, // 玩家二（右）
  ],
  /** 角色腳底中心位置 */
  characterFeet: [
    { x: 150, y: 520 },
    { x: 1130, y: 520 },
  ],
  /** 角色受擊判定框大小（以腳底中心為基準往上；配合 150px 高的真人站姿） */
  characterHitbox: { w: 56, h: 150 },
  /** 投擲出手點：相對腳底中心的偏移（右側玩家 x 會自動鏡像） */
  launchOffset: { x: 30, y: -135 },
  /**
   * 防禦道具可放置區域（矩形）。
   * index 0 = 左方玩家，1 = 右方玩家。道具整個外框必須落在區域內。
   */
  placementZones: [
    { x: 200, y: 300, w: 200, h: 220 },
    { x: 880, y: 300, w: 200, h: 220 },
  ],
} as const;

/** 角度 / 力道控制條的擺動設定 */
export const AIM_CONFIG = {
  minAngle: 5,
  maxAngle: 85,
  /** 角度每秒擺動幾度 */
  angleSpeed: 70,
  minPower: 0.05,
  maxPower: 1,
  /** 力道每秒擺動多少（0~1） */
  powerSpeed: 0.9,
} as const;
