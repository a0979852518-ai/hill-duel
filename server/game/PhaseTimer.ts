// 單一階段倒數計時器（由伺服器統一管理）。
// 第一階段（抽取/選擇）與第二階段（使用道具）各自 new 一次，彼此完全獨立。

import { GAME_CONFIG } from '../../shared/config/game.js';
import type { TimerView } from '../../shared/types.js';

export class PhaseTimer {
  private handle: NodeJS.Timeout | null = null;
  private deadline = 0;
  private total = 0;
  private stage: 'draw' | 'use' = 'draw';

  start(totalMs: number, stage: 'draw' | 'use', onExpire: () => void): void {
    this.stop();
    this.total = totalMs;
    this.stage = stage;
    this.deadline = Date.now() + totalMs;
    // 實際判定逾時會多給一點寬限，吸收網路延遲
    this.handle = setTimeout(() => {
      this.handle = null;
      onExpire();
    }, totalMs + GAME_CONFIG.latencyGraceMs);
  }

  stop(): void {
    if (this.handle) clearTimeout(this.handle);
    this.handle = null;
  }

  get running(): boolean {
    return this.handle !== null;
  }

  view(): TimerView | null {
    if (!this.running) return null;
    return {
      remainingMs: Math.max(0, this.deadline - Date.now()),
      totalMs: this.total,
      stage: this.stage,
    };
  }
}
