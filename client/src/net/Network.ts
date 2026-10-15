// 網路層：包裝 Socket.IO、儲存重連用的 session、把 ack 轉成 Promise。

import { io, type Socket } from 'socket.io-client';
import type {
  BattleEvent,
  ClientToServerEvents,
  ErrorCode,
  JoinResult,
  RoomSnapshot,
  ServerToClientEvents,
} from '../../../shared/types.js';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface Session {
  code: string;
  token: string;
  seat: 0 | 1;
}

const SESSION_KEY = 'hillduel.session';
const NAME_KEY = 'hillduel.name';

export type AckResult<T = {}> = ({ ok: true } & T) | { ok: false; error: ErrorCode | 'TIMEOUT' | 'OFFLINE' };

type Listener<T> = (v: T) => void;

export class Network {
  readonly socket: GameSocket;
  session: Session | null = loadSession();
  private stateListeners = new Set<Listener<RoomSnapshot>>();
  private eventListeners = new Set<Listener<BattleEvent>>();
  private statusListeners = new Set<Listener<{ connected: boolean; resumeFailed?: ErrorCode }>>();
  private closedListeners = new Set<Listener<string>>();

  constructor() {
    // 開發時透過 Vite proxy、正式時同一個網址；若前後端分開部署，可用 VITE_SERVER_URL 指定
    const url = (import.meta as any).env?.VITE_SERVER_URL as string | undefined;
    this.socket = url ? io(url, { transports: ['websocket', 'polling'] }) : io({ transports: ['websocket', 'polling'] });

    this.socket.on('connect', async () => {
      if (this.session) {
        const res = await this.call<JoinResult>('room:resume', { code: this.session.code, token: this.session.token });
        if (!res.ok) {
          this.clearSession();
          this.statusListeners.forEach((l) => l({ connected: true, resumeFailed: res.error as ErrorCode }));
          return;
        }
      }
      this.statusListeners.forEach((l) => l({ connected: true }));
    });
    this.socket.on('disconnect', () => this.statusListeners.forEach((l) => l({ connected: false })));
    this.socket.on('room:state', (s) => this.stateListeners.forEach((l) => l(s)));
    this.socket.on('game:event', (e) => this.eventListeners.forEach((l) => l(e)));
    this.socket.on('room:closed', ({ reason }) => {
      this.clearSession();
      this.closedListeners.forEach((l) => l(reason));
    });
  }

  onState(l: Listener<RoomSnapshot>) {
    this.stateListeners.add(l);
    return () => this.stateListeners.delete(l);
  }
  onEvent(l: Listener<BattleEvent>) {
    this.eventListeners.add(l);
    return () => this.eventListeners.delete(l);
  }
  onStatus(l: Listener<{ connected: boolean; resumeFailed?: ErrorCode }>) {
    this.statusListeners.add(l);
    return () => this.statusListeners.delete(l);
  }
  onClosed(l: Listener<string>) {
    this.closedListeners.add(l);
    return () => this.closedListeners.delete(l);
  }

  /** 發送事件並等待伺服器 ack（逾時 6 秒） */
  call<T = {}>(event: keyof ClientToServerEvents, ...args: unknown[]): Promise<AckResult<T>> {
    return new Promise((resolve) => {
      if (!this.socket.connected) return resolve({ ok: false, error: 'OFFLINE' });
      let done = false;
      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          resolve({ ok: false, error: 'TIMEOUT' });
        }
      }, 6000);
      (this.socket.emit as any)(event, ...args, (res: AckResult<T>) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(res);
      });
    });
  }

  emit(event: keyof ClientToServerEvents, payload: unknown): void {
    (this.socket.emit as any)(event, payload);
  }

  async createRoom(name: string) {
    saveName(name);
    const res = await this.call<JoinResult>('room:create', { name });
    if (res.ok) this.setSession(res);
    return res;
  }

  async joinRoom(code: string, name: string) {
    saveName(name);
    const res = await this.call<JoinResult>('room:join', { code, name });
    if (res.ok) this.setSession(res);
    return res;
  }

  leaveRoom() {
    this.emit('room:leave', undefined);
    this.clearSession();
  }

  private setSession(r: JoinResult) {
    this.session = { code: r.code, token: r.token, seat: r.seat };
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(this.session));
    } catch {
      /* 無痕模式等情況可忽略，只是重新整理後無法自動重連 */
    }
  }

  clearSession() {
    this.session = null;
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }
}

function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}
function saveName(n: string) {
  try {
    localStorage.setItem(NAME_KEY, n);
  } catch {
    /* ignore */
  }
}
