// 極簡的全域狀態：最新的房間快照與自己的座位。
// 伺服器是唯一權威，這裡只是「最後收到的樣子」。

import type { RoomSnapshot, Seat } from '../../../shared/types.js';
import type { Network } from '../net/Network.js';

export const store = {
  net: null as unknown as Network,
  snapshot: null as RoomSnapshot | null,
  /** 收到快照時的本機時間，用來推算倒數 */
  snapshotAt: 0,
  /** 戰鬥場景的動畫佇列全部播完時 resolve（結算畫面會等它） */
  whenAnimIdle: (): Promise<void> => Promise.resolve(),
  get mySeat(): Seat | null {
    return this.net?.session?.seat ?? null;
  },
};
