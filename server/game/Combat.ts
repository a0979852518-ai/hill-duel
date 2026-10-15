// 攻擊結算：投擲物模擬 → 判斷命中 → 計算傷害 → 更新防禦與狀態。
// 全部在伺服器上計算，客戶端只負責播放結果。

import type { ThrowableDef } from '../../shared/config/items.js';
import { characterHitbox, distPointRect, simulateThrow } from '../../shared/physics.js';
import type { BattleEvent, DamageEntry, DefenseUpdate, Seat } from '../../shared/types.js';
import type { BattleState } from './BattleState.js';

export type ThrowEvent = Extract<BattleEvent, { type: 'throw' }>;

export function resolveThrow(state: BattleState, seat: Seat, item: ThrowableDef, angle: number, power: number): ThrowEvent {
  const sim = simulateThrow({ seat, item, angle, power, defenses: state.defenses });
  const { impact } = sim;
  const damages: DamageEntry[] = [];
  const defenseUpdates: DefenseUpdate[] = [];
  let statusApplied: ThrowEvent['statusApplied'] = null;

  // 1) 撞到防禦道具：扣耐久，記下減傷比例（擋下的那一方受到的波及會被減免）
  let reductionFor: Seat | null = null;
  let reduction = 0;
  if (impact.kind === 'defense' && impact.defenseUid) {
    const d = state.getDefense(impact.defenseUid);
    if (d) {
      reductionFor = d.owner;
      reduction = d.damageReduction;
      const upd = state.hitDefense(d.uid, item.structureDamage ?? item.damage);
      if (upd) defenseUpdates.push(upd);
    }
  }

  // 2) 角色傷害：直擊 or 爆炸波及（兩個角色都要檢查，自己的爆炸也可能炸到自己）
  const hitSeats: Seat[] = [];
  for (const target of [0, 1] as Seat[]) {
    let amount = 0;
    let source: DamageEntry['source'] = 'splash';
    if (impact.kind === 'character' && impact.hitSeat === target) {
      amount = item.damage;
      source = 'direct';
    } else if (item.explosionRadius > 0) {
      const dist = distPointRect(impact.x, impact.y, characterHitbox(target));
      if (dist <= item.explosionRadius) {
        // 越靠近爆心越痛：邊緣剩 50%
        const falloff = 1 - (dist / item.explosionRadius) * 0.5;
        amount = item.damage * item.splashMultiplier * falloff;
      }
    }
    if (amount <= 0) continue;
    if (reductionFor === target) amount *= 1 - reduction;
    const entry = state.dealDamage(target, amount, source, seat);
    if (entry) {
      damages.push(entry);
      hitSeats.push(target);
    }
  }

  // 3) 附加狀態（只附加給敵人）
  const enemy: Seat = seat === 0 ? 1 : 0;
  if (item.onHitStatus && hitSeats.includes(enemy)) {
    state.applyStatus(enemy, item.onHitStatus.statusId, item.onHitStatus.turns);
    statusApplied = { seat: enemy, statusId: item.onHitStatus.statusId, turns: item.onHitStatus.turns };
  }

  return {
    type: 'throw',
    seat,
    itemId: item.id,
    angle,
    power,
    path: sim.path,
    sampleMs: sim.sampleMs,
    impact: { x: impact.x, y: impact.y, kind: impact.kind, defenseUid: impact.defenseUid },
    explosionRadius: item.explosionRadius,
    damages,
    defenseUpdates,
    statusApplied,
  };
}

/** 播放這次投擲需要多久（毫秒） */
export function throwDurationMs(ev: ThrowEvent): number {
  return Math.max(0, ev.path.length - 1) * ev.sampleMs;
}
