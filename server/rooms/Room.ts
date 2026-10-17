// 房間：玩家席位、角色選擇、斷線重連、把 Battle 的結果廣播給雙方。

import { randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { getCharacter } from '../../shared/config/characters.js';
import { ARENA, GAME_CONFIG } from '../../shared/config/game.js';
import {
  seatCountOf,
  type AiDifficulty,
  type ClientToServerEvents,
  type ErrorCode,
  type GameMode,
  type PlayerView,
  type RoomSnapshot,
  type RoomStatus,
  type Seat,
  type ServerToClientEvents,
  type Team,
} from '../../shared/types.js';
import { startXOf } from '../../shared/physics.js';
import { AiPlayer, AI_PROFILES } from '../game/AiPlayer.js';
import { Battle } from '../game/Battle.js';
import { randomMapId } from '../../shared/config/maps.js';
import { CHARACTERS } from '../../shared/config/characters.js';

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
  /** 電腦玩家 */
  bot?: AiDifficulty;
}

export class Room {
  status: RoomStatus = 'waiting';
  players: (RoomPlayer | null)[];
  battle: Battle | null = null;
  winnerTeam: Team | null = null;
  endReason: 'hp' | 'forfeit' | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private ais: AiPlayer[] = [];
  /** 結算畫面按了「再來一局」的座位 */
  private rematchVotes = new Set<Seat>();
  /** 這場的地圖（開打時隨機挑） */
  mapId: string | null = null;

  constructor(
    readonly code: string,
    private readonly io: IO,
    private readonly onDestroy: (code: string) => void,
    readonly mode: GameMode = 'duel',
  ) {
    this.players = Array.from({ length: seatCountOf(mode) }, () => null);
  }

  // ------------------------------------------------------------ 進出房間

  private get full(): boolean {
    return this.players.every((p) => p);
  }

  private freeSeat(): Seat | null {
    const i = this.players.findIndex((p) => !p);
    return i < 0 ? null : (i as Seat);
  }

  /** 人到齊了就進入選角 */
  private checkFull(): void {
    if (this.full && this.status === 'waiting') this.status = 'characterSelect';
  }

  canJoin(): ErrorCode | null {
    if (this.status !== 'waiting' && this.status !== 'characterSelect') return 'GAME_STARTED';
    if (this.full) return 'ROOM_FULL';
    return null;
  }

  /** 房間裡還有沒有真人 */
  get humans(): number {
    return this.players.filter((p) => p && !p.bot).length;
  }

  addPlayer(name: string, socket: GameSocket): { seat: Seat; token: string } {
    const seat = this.freeSeat() ?? 0;
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
    this.checkFull();
    this.broadcast();
    return { seat, token: player.token };
  }

  /** 等待中換到另一個空位（換隊） */
  changeSeat(from: Seat, to: Seat, socket: GameSocket): ErrorCode | null {
    if (this.status !== 'waiting') return 'WRONG_PHASE';
    if (!Number.isInteger(to) || to < 0 || to >= this.players.length) return 'INVALID_INPUT';
    const p = this.players[from];
    if (!p || this.players[to]) return 'INVALID_POSITION';
    this.players[from] = null;
    p.seat = to;
    this.players[to] = p;
    socket.data.seat = to;
    this.broadcast();
    return null;
  }

  /** 空位全部用電腦補滿 */
  fillBots(difficulty: AiDifficulty): ErrorCode | null {
    if (this.status !== 'waiting') return 'WRONG_PHASE';
    while (this.freeSeat() !== null) this.addBot(difficulty);
    return null;
  }

  /** 加入電腦玩家（坐第一個空位，隨機角色，直接確認） */
  addBot(difficulty: AiDifficulty): void {
    const seat = this.freeSeat();
    if (seat === null) return;
    const pool = CHARACTERS.filter((c) => c.enabled !== false);
    const c = pool[Math.floor(Math.random() * pool.length)];
    const n = this.players.filter((p) => p?.bot).length;
    this.players[seat] = {
      seat,
      name: `電腦・${AI_PROFILES[difficulty].label}${this.mode === 'team' ? n + 1 : ''}`,
      token: randomUUID(),
      socketId: null,
      connected: true,
      characterId: c.id,
      confirmed: true,
      dropTimer: null,
      bot: difficulty,
    };
    this.checkFull();
    this.broadcast();
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
    this.rematchVotes.delete(seat);
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
        // 跟電腦對戰時真人離開 → 房間直接關掉
        for (const other of this.players) if (other) other.confirmed = false;
      }
    }
    this.broadcast();
    this.scheduleCleanupIfEmpty();
    // 結算畫面有人離開：剩下的人如果都已經按了再來一局，就直接開始
    if (this.status === 'gameOver') this.checkRematch();
  }

  // ------------------------------------------------------------ 再來一局

  voteRematch(seat: Seat): ErrorCode | null {
    if (this.status !== 'gameOver') return 'WRONG_PHASE';
    if (!this.players[seat]) return 'NOT_IN_ROOM';
    this.rematchVotes.add(seat);
    this.broadcast();
    this.checkRematch();
    return null;
  }

  /** 還在房間的真人都按了 → 回到選角（保留角色，電腦自動準備好）；有空位就回到等待 */
  private checkRematch(): void {
    const humans = this.players.filter((p) => p && !p.bot && p.connected) as RoomPlayer[];
    if (humans.length === 0 || !humans.every((p) => this.rematchVotes.has(p.seat))) return;
    this.ais.forEach((a) => a.dispose());
    this.ais = [];
    this.battle?.dispose();
    this.battle = null;
    this.winnerTeam = null;
    this.endReason = null;
    this.mapId = null;
    this.rematchVotes.clear();
    // 斷線中的人（還在等重連）讓出位子
    for (const p of this.players) {
      if (!p) continue;
      if (!p.bot && !p.connected) {
        if (p.dropTimer) clearTimeout(p.dropTimer);
        this.players[p.seat] = null;
        continue;
      }
      p.confirmed = !!p.bot;
    }
    this.cancelCleanup();
    this.status = this.full ? 'characterSelect' : 'waiting';
    this.broadcast();
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
    if (this.players.every((x) => x?.confirmed)) this.startBattle();
    else this.broadcast();
    return null;
  }

  private startBattle(): void {
    if (!this.players.every((p) => p)) return;
    const ps = this.players as RoomPlayer[];
    const hp = ps.map((p) => getCharacter(p.characterId!)!.maxHp);
    this.status = 'battle';
    // 測試用：環境變數 HILLDUEL_MAP=hallway 可以固定地圖
    this.mapId = process.env.HILLDUEL_MAP || randomMapId();
    this.battle = new Battle(
      hp,
      {
      onChange: () => this.broadcast(),
      onEvent: (e) => this.io.to(this.code).emit('game:event', e),
      onGameOver: (winner, reason) => {
        this.status = 'gameOver';
        this.winnerTeam = winner;
        this.endReason = reason;
        this.broadcast();
        this.scheduleCleanup(5 * 60_000);
      },
      },
      Math.random,
      ps.map((p) => p.characterId),
      this.mode,
    );
    // 2v2 固定 1 號先（順序 1 → 3 → 2 → 4）；1v1 隨機
    const first: Seat = GAME_CONFIG.firstTurn === 'host' || this.mode === 'team' ? 0 : Math.random() < 0.5 ? 0 : 1;
    this.ais = [];
    for (const p of ps) {
      if (!p.bot) continue;
      this.ais.push(
        new AiPlayer(this.battle, p.seat, p.bot, (angle, power) =>
          this.io.to(this.code).emit('game:event', { type: 'aimPreview', seat: p.seat, angle, power }),
        ),
      );
    }
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
        x: f?.x ?? startXOf(p.seat, this.mode),
        ...(f && f.stuck.length ? { stuck: f.stuck.map((s) => ({ ...s })) } : {}),
        ...(f?.hitStreak ? { streak: f.hitStreak } : {}),
        ...(f?.huReady ? { huReady: true } : {}),
        ...(f?.rage ? { rage: f.rage } : {}),
        ...(f?.shield ? { shield: f.shield } : {}),
        ...(p.bot ? { bot: p.bot } : {}),
      };
    });
    return {
      code: this.code,
      status: this.status,
      mode: this.mode,
      players,
      defenses: this.battle?.state.defenseViews() ?? [],
      turn: this.battle && this.status === 'battle' ? this.battle.turnView() : null,
      winnerSeat: this.winnerTeam,
      winnerTeam: this.winnerTeam,
      ...(this.status === 'gameOver' && this.rematchVotes.size ? { rematch: [...this.rematchVotes] } : {}),
      endReason: this.endReason,
      ...(this.mapId ? { mapId: this.mapId } : {}),
    };
  }

  broadcast(): void {
    this.io.to(this.code).emit('room:state', this.snapshot());
    // 狀態一改變就讓電腦看看是不是輪到它（setTimeout 0：等目前的操作整個處理完）
    if (this.ais.length) setTimeout(() => this.ais.forEach((a) => a.poke()), 0);
  }

  // ------------------------------------------------------------ 清理

  private scheduleCleanupIfEmpty(): void {
    const anyone = this.players.some((p) => p && !p.bot && (p.connected || p.dropTimer));
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
    this.ais.forEach((a) => a.dispose());
    this.ais = [];
    this.battle?.dispose();
    for (const p of this.players) if (p?.dropTimer) clearTimeout(p.dropTimer);
    this.io.to(this.code).emit('room:closed', { reason: '房間已關閉' });
    this.io.in(this.code).socketsLeave(this.code);
    this.onDestroy(this.code);
  }
}
