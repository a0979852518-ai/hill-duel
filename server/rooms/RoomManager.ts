// 房間管理：產生房號、建立/加入/重連，以及把 socket 事件分派到對應房間。

import type { Ack, AiDifficulty, ErrorCode, GameMode, JoinResult, Seat } from '../../shared/types.js';
import { Room, type GameSocket, type IO } from './Room.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉容易看錯的 0/O/1/I
const CODE_LENGTH = 6;

export class RoomManager {
  private rooms = new Map<string, Room>();
  /** 隨機匹配的等待隊伍（先到先配） */
  private queue: { socket: GameSocket; name: string }[] = [];
  /** 2v2 的等待隊伍（湊滿 4 人開打） */
  private teamQueue: { socket: GameSocket; name: string }[] = [];

  constructor(private readonly io: IO) {}

  get roomCount(): number {
    return this.rooms.size;
  }

  private generateCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!this.rooms.has(code)) return code;
    }
  }

  private dequeue(socketId: string): void {
    this.queue = this.queue.filter((q) => q.socket.id !== socketId);
    const before = this.teamQueue.length;
    this.teamQueue = this.teamQueue.filter((q) => q.socket.id !== socketId);
    if (this.teamQueue.length !== before) this.notifyTeamQueue();
  }

  private notifyTeamQueue(): void {
    for (const q of this.teamQueue) q.socket.emit('match:queue', { queued: this.teamQueue.length });
  }

  private newRoom(mode: GameMode = 'duel'): Room {
    const code = this.generateCode();
    const room = new Room(code, this.io, (c) => this.rooms.delete(c), mode);
    this.rooms.set(code, room);
    return room;
  }

  /** 2v2：把排隊的人放進同一個房間（不足 4 人用電腦補） */
  private startTeamMatch(entries: { socket: GameSocket; name: string }[]): void {
    const room = this.newRoom('team');
    for (const e of entries) {
      const r = room.addPlayer(e.name, e.socket);
      e.socket.emit('match:found', { code: room.code, seat: r.seat, token: r.token });
    }
    room.fillBots('normal');
  }

  /** 目前排隊人數（健康檢查用） */
  get queueLength(): number {
    return this.queue.length;
  }

  private roomOf(socket: GameSocket): Room | null {
    const code = socket.data.code;
    return code ? this.rooms.get(code) ?? null : null;
  }

  /** 已在其他房間的 socket 先離開，避免一個連線同時佔兩個房間 */
  private leaveCurrent(socket: GameSocket): void {
    this.dequeue(socket.id);
    const room = this.roomOf(socket);
    if (room && socket.data.seat !== undefined) room.leave(socket.data.seat, socket);
  }

  bind(socket: GameSocket): void {
    const fail = (ack: Ack<any> | undefined, error: ErrorCode) => typeof ack === 'function' && ack({ ok: false, error });

    socket.on('room:create', (p, ack) => {
      this.leaveCurrent(socket);
      const room = this.newRoom(p?.mode === 'team' ? 'team' : 'duel');
      const { seat, token } = room.addPlayer(cleanName(p?.name), socket);
      ack?.({ ok: true, code: room.code, seat, token } satisfies { ok: true } & JoinResult);
    });

    // ------------------------------------------------------------ 隨機匹配
    socket.on('match:join', (p, ack) => {
      this.leaveCurrent(socket);
      this.dequeue(socket.id);
      if (p?.mode === 'team') {
        this.teamQueue = this.teamQueue.filter((q) => q.socket.connected);
        this.teamQueue.push({ socket, name: cleanName(p?.name) });
        if (this.teamQueue.length >= 4) {
          const four = this.teamQueue.splice(0, 4);
          ack?.({ ok: true, queued: 0 });
          this.startTeamMatch(four);
          this.notifyTeamQueue();
          return;
        }
        ack?.({ ok: true, queued: this.teamQueue.length });
        this.notifyTeamQueue();
        return;
      }
      // 找一個還連著的對手（斷線的順便清掉）
      this.queue = this.queue.filter((q) => q.socket.connected);
      const other = this.queue.shift();
      if (!other) {
        this.queue.push({ socket, name: cleanName(p?.name) });
        ack?.({ ok: true, queued: this.queue.length });
        return;
      }
      ack?.({ ok: true, queued: 0 });
      const room = this.newRoom();
      const code = room.code;
      // 先排隊的人當 1 號位（左邊）
      const a = room.addPlayer(other.name, other.socket);
      const b = room.addPlayer(cleanName(p?.name), socket);
      other.socket.emit('match:found', { code, seat: a.seat, token: a.token });
      socket.emit('match:found', { code, seat: b.seat, token: b.token });
    });
    socket.on('match:cancel', () => this.dequeue(socket.id));
    // 2v2 等太久：目前排隊的人（最多 4 個）一起開打，不足的用電腦補
    socket.on('match:fillAi', (ack) => {
      this.teamQueue = this.teamQueue.filter((q) => q.socket.connected);
      const i = this.teamQueue.findIndex((q) => q.socket.id === socket.id);
      if (i < 0) return fail(ack, 'NOT_IN_ROOM');
      // 自己一定在裡面，其他人按排隊順序補
      const me = this.teamQueue.splice(i, 1)[0];
      const others = this.teamQueue.splice(0, 3);
      this.startTeamMatch([me, ...others]);
      this.notifyTeamQueue();
      if (typeof ack === 'function') ack({ ok: true });
    });

    socket.on('room:createAi', (p, ack) => {
      const diffs: AiDifficulty[] = ['easy', 'normal', 'hard', 'nightmare'];
      const difficulty = diffs.includes(p?.difficulty) ? p.difficulty : 'normal';
      this.leaveCurrent(socket);
      const room = this.newRoom(p?.mode === 'team' ? 'team' : 'duel');
      const { seat, token } = room.addPlayer(cleanName(p?.name), socket);
      room.fillBots(difficulty);
      ack?.({ ok: true, code: room.code, seat, token });
    });

    socket.on('room:join', (p, ack) => {
      const code = String(p?.code ?? '').trim().toUpperCase();
      const room = this.rooms.get(code);
      if (!room) return fail(ack, 'ROOM_NOT_FOUND');
      const err = room.canJoin();
      if (err) return fail(ack, err);
      this.leaveCurrent(socket);
      const { seat, token } = room.addPlayer(cleanName(p?.name), socket);
      ack?.({ ok: true, code, seat, token });
    });

    socket.on('room:resume', (p, ack) => {
      const code = String(p?.code ?? '').trim().toUpperCase();
      const room = this.rooms.get(code);
      if (!room) return fail(ack, 'ROOM_NOT_FOUND');
      const seat = room.findSeatByToken(String(p?.token ?? ''));
      if (seat === null) return fail(ack, 'BAD_SESSION');
      room.attach(seat, socket);
      ack?.({ ok: true, code, seat, token: String(p.token) });
    });

    socket.on('room:leave', () => this.leaveCurrent(socket));

    // 以下操作都需要已經在房間內
    const withRoom =
      <A extends unknown[]>(fn: (room: Room, seat: Seat, ...args: A) => ErrorCode | null) =>
      (...args: [...A, Ack]) => {
        const ack = args[args.length - 1] as Ack;
        const room = this.roomOf(socket);
        const seat = socket.data.seat;
        if (!room || seat === undefined) return fail(ack, 'NOT_IN_ROOM');
        try {
          const err = fn(room, seat, ...(args.slice(0, -1) as A));
          if (typeof ack === 'function') ack(err ? { ok: false, error: err } : { ok: true });
        } catch (e) {
          console.error('[handler error]', e);
          fail(ack, 'INVALID_INPUT');
        }
      };

    const battleOf = (room: Room) => (room.status === 'battle' ? room.battle : null);
    // 注意：成功時 Battle 回傳 null，不能用 `?? 'WRONG_PHASE'`（null 也會被換成錯誤）
    const withBattle = (room: Room, fn: (b: NonNullable<ReturnType<typeof battleOf>>) => ErrorCode | null): ErrorCode | null => {
      const b = battleOf(room);
      return b ? fn(b) : 'WRONG_PHASE';
    };

    socket.on(
      'room:fillAi',
      withRoom((room, _seat, p: { difficulty: AiDifficulty }) => {
        const diffs: AiDifficulty[] = ['easy', 'normal', 'hard', 'nightmare'];
        return room.fillBots(diffs.includes(p?.difficulty) ? p.difficulty : 'normal');
      }),
    );
    socket.on('room:seat', withRoom((room, seat, p: { seat: Seat }) => room.changeSeat(seat, Number(p?.seat) as Seat, socket)));
    socket.on('char:select', withRoom((room, seat, p: { characterId: string }) => room.selectCharacter(seat, String(p?.characterId))));
    socket.on('char:confirm', withRoom((room, seat) => room.confirmCharacter(seat)));
    socket.on('turn:stopSlot', withRoom((room, seat, p: { turnId: number }) => withBattle(room, (b) => b.stopSlot(seat, Number(p?.turnId)))));
    socket.on(
      'turn:choose',
      withRoom((room, seat, p: { turnId: number; itemId: string }) =>
        withBattle(room, (b) => b.choose(seat, Number(p?.turnId), String(p?.itemId))),
      ),
    );
    socket.on(
      'turn:angle',
      withRoom((room, seat, p: { turnId: number; angle: number }) =>
        withBattle(room, (b) => b.confirmAngle(seat, Number(p?.turnId), Number(p?.angle))),
      ),
    );
    socket.on(
      'turn:power',
      withRoom((room, seat, p: { turnId: number; power: number }) =>
        withBattle(room, (b) => b.confirmPower(seat, Number(p?.turnId), Number(p?.power))),
      ),
    );
    socket.on(
      'turn:throw',
      withRoom((room, seat, p: { turnId: number; angle: number; power: number }) =>
        withBattle(room, (b) => b.throwAt(seat, Number(p?.turnId), Number(p?.angle), Number(p?.power))),
      ),
    );
    socket.on(
      'turn:place',
      withRoom((room, seat, p: { turnId: number; x: number; y: number }) =>
        withBattle(room, (b) => b.placeDefense(seat, Number(p?.turnId), Number(p?.x), Number(p?.y))),
      ),
    );
    socket.on(
      'turn:functional',
      withRoom((room, seat, p: { turnId: number; targetUid?: string; targetSeat?: Seat }) =>
        withBattle(room, (b) =>
          b.useFunctional(
            seat,
            Number(p?.turnId),
            p?.targetUid ? String(p.targetUid) : undefined,
            p?.targetSeat !== undefined && p?.targetSeat !== null ? (Number(p.targetSeat) as Seat) : undefined,
          ),
        ),
      ),
    );

    // 瞄準預覽：只轉發給對手，不改狀態、不回 ack
    socket.on('turn:aimPreview', (p) => {
      const room = this.roomOf(socket);
      const seat = socket.data.seat;
      const battle = room ? battleOf(room) : null;
      if (!room || seat === undefined || !battle) return;
      if (!battle.canPreviewAim(seat, Number(p?.turnId))) return;
      const angle = typeof p.angle === 'number' && Number.isFinite(p.angle) ? p.angle : undefined;
      const power = typeof p.power === 'number' && Number.isFinite(p.power) ? p.power : undefined;
      socket.to(room.code).emit('game:event', { type: 'aimPreview', seat, angle, power });
    });

    socket.on('disconnect', () => {
      this.dequeue(socket.id);
      const room = this.roomOf(socket);
      room?.handleDisconnect(socket.id);
    });
  }
}

function cleanName(name: unknown): string {
  const s = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 12);
  return s || `玩家${Math.floor(Math.random() * 900 + 100)}`;
}
