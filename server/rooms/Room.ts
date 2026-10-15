// 房間：玩家席位、角色選擇、斷線重連、把 Battle 的結果廣播給雙方。

import { randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { getCharacter } from '../../shared/config/characters.js';
import { GAME_CONFIG } from '../../shared/config/game.js';
import type {
  ClientToServerEvents,
  ErrorCode,
  PlayerView,
  RoomSnapshot,
  RoomStatus,
  Seat,
  ServerToClientEvents,
} from '../../shared/types.js';
import { Battle } from '../game/Battle.js';

export type IO = Server<ClientToServerEvents, ServerToClientEvents>;
export type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;
export interface SocketData {
  code?: string;
  seat?: Seat;
}

interface RoomPlayer {
  seat: Seat;
  name: string;
  token: string;
  socketId: string | null;
  connected: boolean;
  characterId: string | null;
  confirmed: boolean;
  dropTimer: NodeJS.Timeout | null;
}

export class Room {
  status: RoomStatus = 'waiting';
  players: [RoomPlayer | null, RoomPlayer | null] = [null, null];
  battle: Battle | null = null;
  winnerSeat: Seat | null = null;
  endReason: 'hp' | 'forfeit' | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(
    readonly code: string,
    private readonly io: IO,
    private readonly onDestroy: (code: string) => void,
  ) {}

  // ------------------------------------------------------------ 進出房間

  canJoin(): ErrorCode | null {
    if (this.status !== 'waiting' && this.status !== 'characterSelect') return 'GAME_STARTED';
    if (this.players[0] && this.players[1]) return 'ROOM_FULL';
    return null;
  }

  addPlayer(name: string, socket: GameSocket): { seat: Seat; token: string } {
    const seat: Seat = this.players[0] ? 1 : 0;
    const player: RoomPlayer = {
      seat,
      name,
      token: randomUUID(),
      socketId: null,
      connected: false,
      characterId: null,
      confirmed: false,
      dropTimer: null,
    };
    this.players[seat] = player;
    this.attach(seat, socket);
    if (this.players[0] && this.players[1] && this.status === 'waiting') this.status = 'characterSelect';
    this.broadcast();
    return { seat, token: player.token };
  }

  findSeatByToken(token: string): Seat | null {
    for (const p of this.players) if (p && p.token === token) return p.seat;
    return null;
  }

  /** 把 socket 綁到席位（首次加入或重新連線） */
  attach(seat: Seat, socket: GameSocket): void {
    const p = this.players[seat];
    if (!p) return;
    if (p.socketId && p.socketId !== socket.id) {
      // 同一個玩家從新分頁/新連線回來，舊連線踢掉
      this.io.sockets.sockets.get(p.socketId)?.disconnect(true);
    }
    if (p.dropTimer) clearTimeout(p.dropTimer);
    p.dropTimer = null;
    p.socketId = socket.id;
    p.connected = true;
    socket.data.code = this.code;
    socket.data.seat = seat;
    socket.join(this.code);
    this.cancelCleanup();
    this.broadcast();
  }

  /** socket 斷線：保留席位一段時間等待重連 */
  handleDisconnect(socketId: string): void {
    const p = this.players.find((x) => x?.socketId === socketId);
    if (!p) return;
    p.connected = false;
    p.socketId = null;
    p.dropTimer = setTimeout(() => this.dropPlayer(p.seat), GAME_CONFIG.reconnectGraceMs);
    this.broadcast();
    this.scheduleCleanupIfEmpty();
  }

  /** 主動離開 */
  leave(seat: Seat, socket: GameSocket): void {
    socket.leave(this.code);
    socket.data.code = undefined;
    socket.data.seat = undefined;
    this.dropPlayer(seat);
  }

  private dropPlayer(seat: Seat): void {
    const p = this.players[seat];
    if (!p) return;
    if (p.dropTimer) clearTimeout(p.dropTimer);
    p.dropTimer = null;
    if (this.status === 'battle' && this.battle) {
      // 戰鬥中離開或斷線太久 → 判負，但保留席位資料讓結算畫面顯示名字
      p.connected = false;
      p.socketId = null;
      this.battle.forfeit(seat);
    } else {
      this.players[seat] = null;
      if (this.status === 'characterSelect') {
        this.status = 'waiting';
        for (const other of this.players) if (other) other.confirmed = false;
      }
    }
    this.broadcast();
    this.scheduleCleanupIfEmpty();
  }

  // ------------------------------------------------------------ 角色選擇

  selectCharacter(seat: Seat, characterId: string): ErrorCode | null {
    if (this.status !== 'characterSelect') return 'WRONG_PHASE';
    const p = this.players[seat];
    if (!p) return 'NOT_IN_ROOM';
    if (p.confirmed) return 'WRONG_PHASE';
    const c = getCharacter(characterId);
    if (!c || c.enabled === false) return 'INVALID_INPUT';
    p.characterId = characterId;
    this.broadcast();
    return null;
  }

  confirmCharacter(seat: Seat): ErrorCode | null {
    if (this.status !== 'characterSelect') return 'WRONG_PHASE';
    const p = this.players[seat];
    if (!p) return 'NOT_IN_ROOM';
    if (!p.characterId) return 'INVALID_INPUT';
    if (p.confirmed) return 'WRONG_PHASE';
    p.confirmed = true;
    if (this.players[0]?.confirmed && this.players[1]?.confirmed) this.startBattle();
    else this.broadcast();
    return null;
  }

  private startBattle(): void {
    const [a, b] = this.players;
    if (!a || !b) return;
    const hpA = getCharacter(a.characterId!)!.maxHp;
    const hpB = getCharacter(b.characterId!)!.maxHp;
    this.status = 'battle';
    this.battle = new Battle([hpA, hpB], {
      onChange: () => this.broadcast(),
      onEvent: (e) => this.io.to(this.code).emit('game:event', e),
      onGameOver: (winner, reason) => {
        this.status = 'gameOver';
        this.winnerSeat = winner;
        this.endReason = reason;
        this.broadcast();
        this.scheduleCleanup(5 * 60_000);
      },
    });
    const first: Seat = GAME_CONFIG.firstTurn === 'host' ? 0 : Math.random() < 0.5 ? 0 : 1;
    this.broadcast();
    this.battle.start(first);
  }

  // ------------------------------------------------------------ 同步

  snapshot(): RoomSnapshot {
    const players = this.players.map((p): PlayerView | null => {
      if (!p) return null;
      const f = this.battle?.state.fighters[p.seat];
      const maxHp = f?.maxHp ?? (p.characterId ? getCharacter(p.characterId)?.maxHp ?? 0 : 0);
      return {
        seat: p.seat,
        name: p.name,
        connected: p.connected,
        characterId: p.characterId,
        confirmed: p.confirmed,
        hp: f?.hp ?? maxHp,
        maxHp,
        statuses: f ? f.statuses.map((s) => ({ ...s })) : [],
      };
    }) as RoomSnapshot['players'];
    return {
      code: this.code,
      status: this.status,
      players,
      defenses: this.battle?.state.defenseViews() ?? [],
      turn: this.battle && this.status === 'battle' ? this.battle.turnView() : null,
      winnerSeat: this.winnerSeat,
      endReason: this.endReason,
    };
  }

  broadcast(): void {
    this.io.to(this.code).emit('room:state', this.snapshot());
  }

  // ------------------------------------------------------------ 清理

  private scheduleCleanupIfEmpty(): void {
    const anyone = this.players.some((p) => p && (p.connected || p.dropTimer));
    if (!anyone) this.scheduleCleanup(0);
  }

  private scheduleCleanup(ms: number): void {
    this.cancelCleanup();
    this.cleanupTimer = setTimeout(() => this.destroy(), ms);
  }

  private cancelCleanup(): void {
    if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
    this.cleanupTimer = null;
  }

  destroy(): void {
    this.cancelCleanup();
    this.battle?.dispose();
    for (const p of this.players) if (p?.dropTimer) clearTimeout(p.dropTimer);
    this.io.to(this.code).emit('room:closed', { reason: '房間已關閉' });
    this.io.in(this.code).socketsLeave(this.code);
    this.onDestroy(this.code);
  }
}
