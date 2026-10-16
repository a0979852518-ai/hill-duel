// 攻擊結算：用物理世界模擬投擲 → 判斷命中 → 計算傷害 → 更新防禦與狀態。
// 全部在伺服器上計算，客戶端只負責播放結果。

import type { ThrowableDef } from '../../shared/config/items.js';
import { ARENA } from '../../shared/config/game.js';
import { characterHitbox, distPointRect } from '../../shared/physics.js';
import type { BattleEvent, DamageEntry, DefenseUpdate, Seat } from '../../shared/types.js';
import type { BattleState } from './BattleState.js';

export type ThrowEvent = Extract<BattleEvent, { type: 'throw' }>;

/** 爆頭傷害倍率 */
export const HEADSHOT_MULTIPLIER = 1.5;

export function resolveThrow(state: BattleState, seat: Seat, item: ThrowableDef, angle: number, power: number): ThrowEvent {
  const damages: DamageEntry[] = [];
  const defenseUpdates: DefenseUpdate[] = [];
  let statusApplied: ThrowEvent['statusApplied'] = null;
  const enemy: Seat = seat === 0 ? 1 : 0;

  const sim = state.physics.throwProjectile(seat, item, angle, power, (impact) => {
    const destroyedNow: string[] = [];

    // 1) 撞到防禦道具：扣耐久/次數，記下減傷比例
    let reductionFor: Seat | null = null;
    let reduction = 0;
    if (impact.kind === 'defense' && impact.defenseUid) {
      const d = state.getDefense(impact.defenseUid);
      if (d) {
        reductionFor = d.owner;
        reduction = d.damageReduction;
        const upd = state.hitDefense(d.uid, item.structureDamage ?? item.damage);
        if (upd) {
          defenseUpdates.push(upd);
          if (upd.destroyed) destroyedNow.push(upd.uid);
        }
      }
    }

    // 2) 角色傷害：直擊 or 爆炸波及（自己的爆炸也可能炸到自己）
    const hitSeats: Seat[] = [];
    for (const target of [0, 1] as Seat[]) {
      let amount = 0;
      let source: DamageEntry['source'] = 'splash';
      let headshot = false;
      if (impact.kind === 'character' && impact.hitSeat === target) {
        amount = item.damage;
        source = 'direct';
        // 打到頭（身體上緣以上）傷害 ×1.5，可再和其他倍率（精神傷害、乳清…）相乘
        const torsoTop = ARENA.characterFeet[target].y - ARENA.characterBody.torsoH;
        if (impact.y < torsoTop) {
          amount *= HEADSHOT_MULTIPLIER;
          headshot = true;
        }
      } else if (item.explosionRadius > 0 && impact.kind !== 'out') {
        const dist = distPointRect(impact.x, impact.y, characterHitbox(target));
        if (dist <= item.explosionRadius) {
          const falloff = 1 - (dist / item.explosionRadius) * 0.5; // 越靠近爆心越痛：邊緣剩 50%
          amount = item.damage * item.splashMultiplier * falloff;
        }
      }
      if (amount <= 0) continue;
      if (reductionFor === target) amount *= 1 - reduction;
      const entry = state.dealDamage(target, amount, source, seat);
      if (entry && headshot) entry.headshot = true;
      if (entry) {
        damages.push(entry);
        hitSeats.push(target);
      }
    }

    // 3) 附加狀態（只附加給敵人）
    if (item.onHitStatus && hitSeats.includes(enemy)) {
      state.applyStatus(enemy, item.onHitStatus.statusId, item.onHitStatus.turns);
      statusApplied = { seat: enemy, statusId: item.onHitStatus.statusId, turns: item.onHitStatus.turns };
    }
    return destroyedNow;
  });

  // 被撞下平台的防禦道具
  defenseUpdates.push(...state.dropFallen(sim.fell));
  state.syncPoses();

  return {
    type: 'throw',
    seat,
    itemId: item.id,
    angle,
    power,
    frames: sim.frames,
    impactFrame: sim.impactFrame,
    impact: { x: sim.impact.x, y: sim.impact.y, kind: sim.impact.kind, defenseUid: sim.impact.defenseUid },
    explosionRadius: item.explosionRadius,
    damages,
    defenseUpdates,
    statusApplied,
  };
}

/** 播放這次投擲需要多久（毫秒） */
export function throwDurationMs(ev: ThrowEvent): number {
  return ev.frames.count * ev.frames.sampleMs;
}
