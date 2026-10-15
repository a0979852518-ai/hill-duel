// ============================================================
// 前後端共用的資料型別與 Socket.IO 事件定義
// ============================================================

export type Seat = 0 | 1;

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
}

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
  players: [PlayerView | null, PlayerView | null];
  defenses: DefenseView[];
  turn: TurnView | null;
  winnerSeat: Seat | null;
  endReason: 'hp' | 'forfeit' | null;
}

export interface DamageEntry {
  seat: Seat;
  amount: number;
  hpAfter: number;
  /** 'direct' 直擊, 'splash' 波及, 'status' 狀態, 'functional' 功能道具 */
  source: 'direct' | 'splash' | 'status' | 'functional';
  /** source = 'status' 時是哪個狀態造成的 */
  statusId?: string;
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
}

export type ImpactKind = 'character' | 'defense' | 'platform' | 'out';

export type BattleEvent =
  | { type: 'turnStart'; seat: Seat; turnId: number; statusDamage: DamageEntry[]; expiredDefenses: string[] }
  | { type: 'slotResult'; seat: Seat; options: string[]; hiddenSlots: number }
  | { type: 'itemChosen'; seat: Seat; itemId: string }
  | { type: 'aimPreview'; seat: Seat; angle?: number; power?: number }
  | {
      type: 'throw';
      seat: Seat;
      itemId: string;
      angle: number;
      power: number;
      /** 取樣後的飛行路徑 [x, y]，每點間隔 sampleMs */
      path: [number, number][];
      sampleMs: number;
      impact: { x: number; y: number; kind: ImpactKind; defenseUid?: string };
      explosionRadius: number;
      damages: DamageEntry[];
      defenseUpdates: DefenseUpdate[];
      statusApplied: { seat: Seat; statusId: string; turns: number } | null;
    }
  | { type: 'defensePlaced'; seat: Seat; defense: DefenseView }
  | {
      type: 'functional';
      seat: Seat;
      itemId: string;
      handler: string;
      targetUid?: string;
      damages: DamageEntry[];
      heals: HealEntry[];
      defenseUpdates: DefenseUpdate[];
      statusApplied: { seat: Seat; statusId: string; turns: number }[];
    }
  | { type: 'skip'; seat: Seat; reason: 'drawTimeout' | 'useTimeout' | 'stunned' }
  | { type: 'gameOver'; winnerSeat: Seat; reason: 'hp' | 'forfeit' };

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
  ROOM_FULL: '這個房間已經滿了（最多 2 人）。',
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
  'room:create': (p: { name: string }, ack: Ack<JoinResult>) => void;
  'room:join': (p: { code: string; name: string }, ack: Ack<JoinResult>) => void;
  'room:resume': (p: { code: string; token: string }, ack: Ack<JoinResult>) => void;
  'room:leave': () => void;
  'char:select': (p: { characterId: string }, ack: Ack) => void;
  'char:confirm': (ack: Ack) => void;
  'turn:stopSlot': (p: { turnId: number }, ack: Ack) => void;
  'turn:choose': (p: { turnId: number; itemId: string }, ack: Ack) => void;
  'turn:angle': (p: { turnId: number; angle: number }, ack: Ack) => void;
  'turn:power': (p: { turnId: number; power: number }, ack: Ack) => void;
  'turn:place': (p: { turnId: number; x: number; y: number }, ack: Ack) => void;
  'turn:functional': (p: { turnId: number; targetUid?: string }, ack: Ack) => void;
  'turn:aimPreview': (p: { turnId: number; angle?: number; power?: number }) => void;
}

/** 伺服器 → 客戶端 */
export interface ServerToClientEvents {
  'room:state': (s: RoomSnapshot) => void;
  'game:event': (e: BattleEvent) => void;
  'room:closed': (p: { reason: string }) => void;
}
