// ============================================================
// 前後端共用的資料型別與 Socket.IO 事件定義
// ============================================================

/**
 * 座位：1v1 用 0、1；2v2 用 0~3。
 * 隊伍 = 座位 % 2（0、2 一隊在左邊；1、3 一隊在右邊），出手順序就是 0 → 1 → 2 → 3。
 */
export type Seat = 0 | 1 | 2 | 3;
export type Team = 0 | 1;
/** duel = 1v1，team = 2v2 組隊 */
export type GameMode = 'duel' | 'team';

export const teamOf = (seat: Seat): Team => (seat % 2) as Team;
/** 面向：左隊往右（1），右隊往左（-1） */
export const sideDir = (seat: Seat): 1 | -1 => (seat % 2 === 0 ? 1 : -1);
export const seatCountOf = (mode: GameMode): number => (mode === 'team' ? 4 : 2);
export const seatsOf = (mode: GameMode): Seat[] => (mode === 'team' ? [0, 1, 2, 3] : [0, 1]);
/** 顯示用的玩家編號（2v2：1、2 一隊，3、4 一隊） */
export const playerNo = (seat: Seat, mode: GameMode): number => (mode === 'team' ? [1, 3, 2, 4][seat] : seat + 1);

export type RoomStatus = 'waiting' | 'characterSelect' | 'battle' | 'gameOver';

/**
 * 回合內的階段
 *  turnStart  回合開始結算（中毒、防禦到期），不計時
 *  draw       老虎機轉動中，等待按空白鍵（第一階段計時）
 *  choose     已停止，二選一（仍在第一階段計時）
 *  aimAngle   投擲：選角度（第二階段計時）
 *  aimPower   投擲：選力道（第二階段計時）
 *  place      防禦：選位置（第二階段計時）
 *  target     功能：選目標/發動（第二階段計時）
 *  resolving  動畫與傷害結算，不計時、不能操作
 */
export type TurnPhase =
  | 'turnStart'
  | 'draw'
  | 'choose'
  | 'aimAngle'
  | 'aimPower'
  | 'place'
  | 'target'
  | 'resolving';

export interface StatusView {
  statusId: string;
  remainingTurns: number;
  /** 可累加的狀態（例如香菸）目前疊了幾層 */
  stacks?: number;
  /** 效果強度倍率（竹竿用絲襪 ×1.5：每層 ×1.2 → ×1.3） */
  strength?: number;
}

export interface PlayerView {
  seat: Seat;
  name: string;
  connected: boolean;
  characterId: string | null;
  confirmed: boolean;
  hp: number;
  maxHp: number;
  statuses: StatusView[];
  /** 角色腳底目前的 x（會被擊退而改變） */
  x: number;
  /** 黏在身上的東西（poopoo恩），純裝飾 */
  stuck?: StuckItem[];
  /** 護盾剩多少（潘柏翰的兵役） */
  shield?: number;
  /** 竹竿：目前連續直接命中幾次、胡了沒、憤怒加成（傷害 +） */
  streak?: number;
  huReady?: boolean;
  rage?: number;
  /** 電腦玩家的難度（真人沒有） */
  bot?: AiDifficulty;
}

/**
 * 黏在角色身上的東西：位置以「站姿」為準，相對腳底。
 * x = 往面向對手那側的距離（右方玩家會鏡像），y = 離地高度（正 = 往上），rot = 角度
 */
export interface StuckItem {
  itemId: string;
  x: number;
  y: number;
  rot: number;
  /** 大小倍率（連恩丟的 poopoo恩 2.5 倍） */
  scale?: number;
}

/** 電腦玩家難度：弱 / 中 / 強 / 夢魘 */
export type AiDifficulty = 'easy' | 'normal' | 'hard' | 'nightmare';

export interface DefenseView {
  uid: string;
  itemId: string;
  owner: Seat;
  /** 中心點座標 */
  x: number;
  y: number;
  w: number;
  h: number;
  durability: number | null;
  maxDurability: number | null;
  hits: number;
  maxHits: number | null;
  /** 還剩幾個放置者回合；null = 不限 */
  remainingTurns: number | null;
  /** 旋轉角度（弧度），物理堆疊後可能是歪的 */
  angle: number;
}

/**
 * 物理動畫影格：伺服器算好每一格的位置，客戶端照著播放。
 *  p   投擲物 [x, y, 角度]（沒有投擲物時省略）
 *  d   每個防禦道具 uid → [x, y, 角度][]（只有會動的才會出現）
 *  gone 某個防禦道具在第幾格消失（被打壞或掉出場外）
 */
export interface PhysicsFrames {
  sampleMs: number;
  count: number;
  p?: [number, number, number][];
  d: Record<string, [number, number, number][]>;
  gone: Record<string, number>;
  /** 被擊退的角色：座位 → [腳底x, 腳底y-地面, 傾斜角, 身體翻面(1~-1), 連續動作圖(0=一般, 1~5)][]（只有會動的才會出現） */
  c?: Partial<Record<string, [number, number, number, number, number][]>>;
}

export interface TimerView {
  /** 收到快照當下剩餘毫秒數（客戶端自行往下倒數） */
  remainingMs: number;
  totalMs: number;
  /** 'draw' = 第一階段，'use' = 第二階段 */
  stage: 'draw' | 'use';
}

export interface TurnView {
  turnId: number;
  activeSeat: Seat;
  phase: TurnPhase;
  /** 老虎機停止後「可以選」的選項（道具 id） */
  options: string[] | null;
  /** 被冷氣卡藏起來的選項數量（看不到內容、不能選） */
  hiddenSlots: number;
  chosenItemId: string | null;
  angle: number | null;
  timer: TimerView | null;
}

export interface RoomSnapshot {
  code: string;
  status: RoomStatus;
  mode: GameMode;
  /** 依座位排（1v1 兩個、2v2 四個） */
  players: (PlayerView | null)[];
  defenses: DefenseView[];
  turn: TurnView | null;
  /** 獲勝的隊伍（1v1 時就是獲勝者的座位） */
  winnerSeat: Seat | null;
  winnerTeam: Team | null;
  endReason: 'hp' | 'forfeit' | null;
  /** 這場用哪張地圖（shared/config/maps.ts） */
  mapId?: string;
  /** 結算畫面按了「再來一局」的座位 */
  rematch?: Seat[];
}

export interface DamageEntry {
  seat: Seat;
  amount: number;
  hpAfter: number;
  /** 'direct' 直擊, 'splash' 波及, 'status' 狀態, 'functional' 功能道具, 'crush' 被倒下的道具壓到 */
  source: 'direct' | 'splash' | 'status' | 'functional' | 'crush';
  /** 在投擲動畫的第幾格顯示（被倒下的防禦道具壓到）；沒有 = 命中當下 */
  frame?: number;
  /** source = 'status' 時是哪個狀態造成的 */
  statusId?: string;
  /** 打到頭（傷害 ×1.5） */
  headshot?: boolean;
  /** 先在地上彈了幾次才打到（每次傷害減半） */
  bounces?: number;
  /** 角色技能的爆擊（捲毛的快煮鍋） */
  crit?: boolean;
  /** 護盾吸收了多少（潘柏翰的兵役） */
  shielded?: number;
  /** 顯示用的標籤（例如「年邁」） */
  label?: string;
  /** 觸發鎖血（葉柄承：第一次歸零固定在 1 血） */
  survived?: boolean;
  /** 自己丟的東西打到自己 */
  self?: boolean;
  /** 打到隊友 */
  ally?: boolean;
  /** 羈絆：這次傷害有一部分轉給隊友（連恩 → 鄭霖澤） */
  shareTo?: { seat: Seat; amount: number; hpAfter: number };
}

export interface HealEntry {
  seat: Seat;
  amount: number;
  hpAfter: number;
}

export interface DefenseUpdate {
  uid: string;
  durability: number | null;
  hits: number;
  destroyed: boolean;
  /** 'hit' 被打壞、'fell' 掉出場外、'removed' 被功能道具移除 */
  reason?: 'hit' | 'fell' | 'removed';
  /** 被打壞後主人的憤怒加成（竹竿的手辦） */
  rage?: { seat: Seat; total: number; delta?: number; label?: string };
}

export type ImpactKind = 'character' | 'defense' | 'platform' | 'out';

export type BattleEvent =
  | { type: 'turnStart'; seat: Seat; turnId: number; statusDamage: DamageEntry[]; expiredDefenses: string[]; heals?: HealEntry[] }
  | { type: 'slotResult'; seat: Seat; options: string[]; hiddenSlots: number }
  | { type: 'itemChosen'; seat: Seat; itemId: string }
  | { type: 'aimPreview'; seat: Seat; angle?: number; power?: number }
  | {
      type: 'throw';
      seat: Seat;
      itemId: string;
      angle: number;
      power: number;
      /** 整段物理動畫（投擲物飛行＋被撞到的防禦道具） */
      frames: PhysicsFrames;
      /** 第幾格命中（傷害在這一格顯示） */
      impactFrame: number;
      impact: { x: number; y: number; kind: ImpactKind; defenseUid?: string };
      explosionRadius: number;
      damages: DamageEntry[];
      defenseUpdates: DefenseUpdate[];
      statusApplied: { seat: Seat; statusId: string; turns: number; immune?: boolean } | null;
      /** 投擲物落地彈跳的格數 */
      bounceFrames?: number[];
      /** 投擲物大小倍率（連恩的 poopoo恩 2.5 倍） */
      projScale?: number;
      /** 播放到第幾格時回血（竹竿睡飽），label 顯示用 */
      frameHeals?: { seat: Seat; amount: number; hpAfter: number; frame: number; label: string }[];
      /** 竹竿開始睡覺的格數（顯示 Zzz） */
      sleepFrames?: { seat: Seat; frame: number }[];
      /** 竹竿連中 3 次，胡了 */
      hu?: boolean;
      /** 防禦道具倒下壓到主人時改成回血（獸控），frame = 第幾格 */
      crushHeals?: { seat: Seat; amount: number; hpAfter: number; frame: number; uid: string }[];
      /** 羈絆：誰把東西丟出去（不是出手的人時才有）、被丟出去的隊友最後站在哪 */
      thrower?: Seat;
      carried?: { seat: Seat; endX: number };
      /** 這次黏到誰身上（poopoo恩） */
      stuck?: { seat: Seat; item: StuckItem };
    }
  | { type: 'defensePlaced'; seat: Seat; defense: DefenseView; frames: PhysicsFrames; fell: DefenseUpdate[] }
  | { type: 'settle'; frames: PhysicsFrames; fell: DefenseUpdate[] }
  | {
      type: 'functional';
      seat: Seat;
      itemId: string;
      handler: string;
      targetUid?: string;
      targetSeat?: Seat;
      damages: DamageEntry[];
      heals: HealEntry[];
      defenseUpdates: DefenseUpdate[];
      statusApplied: { seat: Seat; statusId: string; turns: number; immune?: boolean }[];
    }
  | { type: 'skip'; seat: Seat; reason: 'drawTimeout' | 'useTimeout' | 'stunned' }
  | { type: 'gameOver'; winnerSeat: Seat; winnerTeam: Team; reason: 'hp' | 'forfeit' }
  /** 2v2：有人陣亡（之後的回合跳過） */
  | { type: 'eliminated'; seat: Seat };

export type ErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'GAME_STARTED'
  | 'NOT_IN_ROOM'
  | 'NOT_YOUR_TURN'
  | 'WRONG_PHASE'
  | 'STALE_TURN'
  | 'INVALID_INPUT'
  | 'INVALID_POSITION'
  | 'BAD_SESSION';

export const ERROR_TEXT: Record<ErrorCode, string> = {
  ROOM_NOT_FOUND: '找不到這個房號，請確認後再試。',
  ROOM_FULL: '這個房間已經滿了。',
  GAME_STARTED: '這個房間的遊戲已經開始，無法加入。',
  NOT_IN_ROOM: '你目前不在房間內。',
  NOT_YOUR_TURN: '現在不是你的回合。',
  WRONG_PHASE: '現在不能做這個操作。',
  STALE_TURN: '這個操作已過期（回合已切換）。',
  INVALID_INPUT: '輸入的資料不正確。',
  INVALID_POSITION: '這個位置不能放置。',
  BAD_SESSION: '連線資訊已失效，請重新加入。',
};

export type Ack<T = {}> = (res: ({ ok: true } & T) | { ok: false; error: ErrorCode }) => void;

export interface JoinResult {
  code: string;
  seat: Seat;
  token: string;
}

/** 客戶端 → 伺服器 */
export interface ClientToServerEvents {
  'room:create': (p: { name: string; mode?: GameMode }, ack: Ack<JoinResult>) => void;
  'room:join': (p: { code: string; name: string }, ack: Ack<JoinResult>) => void;
  /** 隨機匹配：排進隊伍（配到時伺服器送 match:found） */
  'match:join': (p: { name: string; mode?: GameMode }, ack: Ack<{ queued: number }>) => void;
  'match:cancel': () => void;
  /** 2v2 隨機匹配等太久：用目前排隊的人＋電腦補滿開打 */
  'match:fillAi': (ack: Ack) => void;
  /** 單人對戰電腦 */
  'room:createAi': (p: { name: string; difficulty: AiDifficulty; mode?: GameMode }, ack: Ack<JoinResult>) => void;
  /** 房間裡的空位用電腦補滿 */
  'room:fillAi': (p: { difficulty: AiDifficulty }, ack: Ack) => void;
  /** 等待中換到另一個空位（換隊） */
  'room:seat': (p: { seat: Seat }, ack: Ack) => void;
  'room:resume': (p: { code: string; token: string }, ack: Ack<JoinResult>) => void;
  'room:leave': () => void;
  /** 結算畫面：再來一局（同房間的真人都按了就回到選角） */
  'room:rematch': (ack: Ack) => void;
  'char:select': (p: { characterId: string }, ack: Ack) => void;
  'char:confirm': (ack: Ack) => void;
  'turn:stopSlot': (p: { turnId: number }, ack: Ack) => void;
  'turn:choose': (p: { turnId: number; itemId: string }, ack: Ack) => void;
  'turn:angle': (p: { turnId: number; angle: number }, ack: Ack) => void;
  'turn:power': (p: { turnId: number; power: number }, ack: Ack) => void;
  /** 一次送出角度＋力道（拖曳瞄準、按住蓄力、放開投擲） */
  'turn:throw': (p: { turnId: number; angle: number; power: number }, ack: Ack) => void;
  'turn:place': (p: { turnId: number; x: number; y: number }, ack: Ack) => void;
  /** targetSeat：2v2 時要對哪個敵人發動 */
  'turn:functional': (p: { turnId: number; targetUid?: string; targetSeat?: Seat }, ack: Ack) => void;
  'turn:aimPreview': (p: { turnId: number; angle?: number; power?: number }) => void;
}

/** 伺服器 → 客戶端 */
export interface ServerToClientEvents {
  'room:state': (s: RoomSnapshot) => void;
  'game:event': (e: BattleEvent) => void;
  'room:closed': (p: { reason: string }) => void;
  /** 隨機匹配成功：已經被放進新房間 */
  'match:found': (r: JoinResult) => void;
  /** 2v2 排隊中：目前排了幾個人 */
  'match:queue': (p: { queued: number }) => void;
}
