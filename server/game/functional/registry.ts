// ============================================================
// 功能型攻擊道具 handler 註冊表
// ------------------------------------------------------------
// 新增一種功能道具的步驟：
//   1. 在這裡寫一個 FunctionalHandler 並註冊名稱
//   2. 在 shared/config/items.ts 新增道具，handler 填這個名稱
//   3. （選擇性）在 client/src/scenes/battle/effects.ts 加對應的動畫，沒加會用預設閃光
// ============================================================

import type { FunctionalDef } from '../../../shared/config/items.js';
import type { DamageEntry, DefenseUpdate, ErrorCode, HealEntry, Seat } from '../../../shared/types.js';
import type { BattleState } from '../BattleState.js';

export interface FunctionalContext {
  state: BattleState;
  seat: Seat;
  enemy: Seat;
  item: FunctionalDef;
  targetUid?: string;
}

export interface FunctionalResult {
  damages: DamageEntry[];
  heals?: HealEntry[];
  defenseUpdates: DefenseUpdate[];
  statusApplied?: { seat: Seat; statusId: string; turns: number; immune?: boolean }[];
}

export interface FunctionalHandler {
  /** 這個道具現在能不能被抽到（例如沒有敵方防禦時，拆除錘就不出現） */
  canDraw?(state: BattleState, seat: Seat, item: FunctionalDef): boolean;
  /** 發動前檢查（目標是否合法） */
  validate?(ctx: FunctionalContext): ErrorCode | null;
  execute(ctx: FunctionalContext): FunctionalResult;
}

const handlers: Record<string, FunctionalHandler> = {
  /** 直接傷害，無視防禦。params.damage */
  directDamage: {
    execute({ state, seat, enemy, item }) {
      const d = state.dealDamage(enemy, Number(item.params.damage ?? 10), 'functional', seat);
      return { damages: d ? [d] : [], defenseUpdates: [] };
    },
  },

  /** 自己和對手都受到傷害。params.damage */
  damageBoth: {
    execute({ state, seat, enemy, item }) {
      const amount = Number(item.params.damage ?? 50);
      // 自己那一下不套用自己的增傷（乳清）
      const damages = [
        state.dealDamage(enemy, amount, 'functional', seat, undefined, item.id),
        state.dealDamage(seat, amount, 'functional', undefined, undefined, item.id),
      ].filter(
        (d): d is DamageEntry => d !== null,
      );
      return { damages, defenseUpdates: [] };
    },
  },

  /** 附加狀態。params.statusId、params.turns、params.target = 'enemy' | 'self' */
  applyStatus: {
    execute({ state, seat, enemy, item }) {
      const target: Seat = item.params.target === 'self' ? seat : enemy;
      const statusId = String(item.params.statusId);
      const turns = Number(item.params.turns ?? 1);
      const applied = state.applyStatus(target, statusId, turns, seat);
      return { damages: [], defenseUpdates: [], statusApplied: [{ seat: target, statusId, turns: applied || turns, ...(applied ? {} : { immune: true }) }] };
    },
  },

  /** 回血。params.amount */
  heal: {
    execute({ state, seat, item }) {
      const h = state.heal(seat, Number(item.params.amount ?? 20));
      return { damages: [], heals: h ? [h] : [], defenseUpdates: [] };
    },
  },

  /** 摧毀指定的敵方防禦道具 */
  destroyDefense: {
    canDraw(state, seat) {
      return state.defenses.some((d) => d.owner !== seat);
    },
    validate({ state, enemy, targetUid }) {
      if (!targetUid) return 'INVALID_INPUT';
      const d = state.getDefense(targetUid);
      if (!d || d.owner !== enemy) return 'INVALID_INPUT';
      return null;
    },
    execute({ state, targetUid }) {
      const upd = targetUid ? state.destroyDefense(targetUid) : null;
      return { damages: [], defenseUpdates: upd ? [upd] : [] };
    },
  },
};

export function getHandler(name: string): FunctionalHandler | undefined {
  return handlers[name];
}
