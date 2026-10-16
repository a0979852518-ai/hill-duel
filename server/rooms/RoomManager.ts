// 房間管理：產生房號、建立/加入/重連，以及把 socket 事件分派到對應房間。

import type { Ack, ErrorCode, JoinResult } from '../../shared/types.js';
import { Room, type GameSocket, type IO } from './Room.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉容易看錯的 0/O/1/I
const CODE_LENGTH = 6;

export class RoomManager {
  private rooms = new Map<string, Room>();

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

  private roomOf(socket: GameSocket): Room | null {
    const code = socket.data.code;
    return code ? this.rooms.get(code) ?? null : null;
  }

  /** 已在其他房間的 socket 先離開，避免一個連線同時佔兩個房間 */
  private leaveCurrent(socket: GameSocket): void {
    const room = this.roomOf(socket);
    if (room && socket.data.seat !== undefined) room.leave(socket.data.seat, socket);
  }

  bind(socket: GameSocket): void {
    const fail = (ack: Ack<any> | undefined, error: ErrorCode) => typeof ack === 'function' && ack({ ok: false, error });

    socket.on('room:create', (p, ack) => {
      this.leaveCurrent(socket);
      const code = this.generateCode();
      const room = new Room(code, this.io, (c) => this.rooms.delete(c));
      this.rooms.set(code, room);
      const { seat, token } = room.addPlayer(cleanName(p?.name), socket);
      ack?.({ ok: true, code, seat, token } satisfies { ok: true } & JoinResult);
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
      <A extends unknown[]>(fn: (room: Room, seat: 0 | 1, ...args: A) => ErrorCode | null) =>
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

    socket.on('char:select', withRoom((room, seat, p: { characterId: string }) => room.selectCharacter(seat, String(p?.characterId))));
    socket.on('char:confirm', withRoom((room, seat) => room.confirmCharacter(seat)));
    socket.on('turn:stopSlot', withRoom((room, seat, p: { turnId: number }) => battleOf(room)?.stopSlot(seat, Number(p?.turnId)) ?? 'WRONG_PHASE'));
    socket.on(
      'turn:choose',
      withRoom((room, seat, p: { turnId: number; itemId: string }) =>
        battleOf(room)?.choose(seat, Number(p?.turnId), String(p?.itemId)) ?? 'WRONG_PHASE',
      ),
    );
    socket.on(
      'turn:angle',
      withRoom((room, seat, p: { turnId: number; angle: number }) =>
        battleOf(room)?.confirmAngle(seat, Number(p?.turnId), Number(p?.angle)) ?? 'WRONG_PHASE',
      ),
    );
    socket.on(
      'turn:power',
      withRoom((room, seat, p: { turnId: number; power: number }) =>
        battleOf(room)?.confirmPower(seat, Number(p?.turnId), Number(p?.power)) ?? 'WRONG_PHASE',
      ),
    );
    socket.on(
      'turn:throw',
      withRoom((room, seat, p: { turnId: number; angle: number; power: number }) =>
        battleOf(room)?.throwAt(seat, Number(p?.turnId), Number(p?.angle), Number(p?.power)) ?? 'WRONG_PHASE',
      ),
    );
    socket.on(
      'turn:place',
      withRoom((room, seat, p: { turnId: number; x: number; y: number }) =>
        battleOf(room)?.placeDefense(seat, Number(p?.turnId), Number(p?.x), Number(p?.y)) ?? 'WRONG_PHASE',
      ),
    );
    socket.on(
      'turn:functional',
      withRoom((room, seat, p: { turnId: number; targetUid?: string }) =>
        battleOf(room)?.useFunctional(seat, Number(p?.turnId), p?.targetUid ? String(p.targetUid) : undefined) ?? 'WRONG_PHASE',
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
      const room = this.roomOf(socket);
      room?.handleDisconnect(socket.id);
    });
  }
}

function cleanName(name: unknown): string {
  const s = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 12);
  return s || `玩家${Math.floor(Math.random() * 900 + 100)}`;
}
