// 攻擊結算：用物理世界模擬投擲 → 判斷命中 → 計算傷害 → 更新防禦與狀態。
// 全部在伺服器上計算，客戶端只負責播放結果。

import type { ThrowableDef } from '../../shared/config/items.js';
import { ARENA, DEFENSE_HIT, KNOCKBACK } from '../../shared/config/game.js';
import type { KnockRequest } from './PhysicsWorld.js';
import { characterHitbox, distPointRect, headLineY } from '../../shared/physics.js';
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

  const sim = state.physics.throwProjectile(seat, item, angle, power, (impact, impactSpeed, impactVel) => {
    const destroyedNow: string[] = [];
    let knock: KnockRequest | undefined;
    let knockSeat: Seat | null = null;
    let knockSpeed = 0;

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
      let bounces = 0;
      if (impact.kind === 'character' && impact.hitSeat === target) {
        amount = item.damage;
        source = 'direct';
        // 先在地上彈過再打到：每彈一次傷害減半
        bounces = impact.bounces ?? 0;
        amount *= Math.pow(0.5, bounces);
        // 打到頭（身體上緣以上）傷害 ×1.5，可再和其他倍率（精神傷害、乳清…）相乘
        if (impact.y < headLineY()) {
          amount *= HEADSHOT_MULTIPLIER;
          headshot = true;
        }
        // 擊退：越重、越快的東西推得越遠
        knockSpeed = Math.min(KNOCKBACK.maxSpeed, (item.knockScale ?? 1) * KNOCKBACK.k * Math.sqrt(item.weightKg ?? 0.5) * (impactSpeed / 1500) * (headshot ? KNOCKBACK.headshotBonus : 1));
        knockSeat = target;
      } else if (item.explosionRadius > 0 && impact.kind !== 'out') {
        const dist = distPointRect(impact.x, impact.y, characterHitbox(state.physics.getCharX(target)));
        if (dist <= item.explosionRadius) {
          const falloff = 1 - (dist / item.explosionRadius) * 0.5; // 越靠近爆心越痛：邊緣剩 50%
          amount = item.damage * item.splashMultiplier * falloff;
        }
      }
      if (amount <= 0) continue;
      if (reductionFor === target) amount *= 1 - reduction;
      const entry = state.dealDamage(target, amount, source, seat);
      if (entry && headshot) entry.headshot = true;
      if (entry && bounces > 0) entry.bounces = bounces;
      if (entry) {
        damages.push(entry);
        hitSeats.push(target);
      }
    }

    // 擊退（傷害算完才知道會不會被打死 → 打死就躺著不起來）
    if (knockSeat !== null && knockSpeed >= KNOCKBACK.minSpeed) {
      knock = knockRequest(knockSeat, knockSpeed, impact.y, impactVel, state.fighters[knockSeat].hp <= 0, item.weightKg ?? 0.5);
    }

    // 3) 附加狀態（只附加給敵人）
    if (item.onHitStatus && hitSeats.includes(enemy)) {
      state.applyStatus(enemy, item.onHitStatus.statusId, item.onHitStatus.turns);
      statusApplied = { seat: enemy, statusId: item.onHitStatus.statusId, turns: item.onHitStatus.turns };
    }
    return { remove: destroyedNow, knock };
  });
  state.syncCharacters();

  // 被打倒的防禦道具壓到人
  for (const c of sim.crushes) {
    if (state.fighters[c.seat].hp <= 0) continue;
    const entry = state.dealDamage(c.seat, DEFENSE_HIT.crushDamage, 'crush');
    if (entry) {
      entry.frame = c.frame;
      damages.push(entry);
    }
  }

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
    bounceFrames: sim.bounceFrames,
  };
}

/** 播放這次投擲需要多久（毫秒） */
export function throwDurationMs(ev: ThrowEvent): number {
  return ev.frames.count * ev.frames.sampleMs;
}

/**
 * 依打點算出擊退：把角色當成一根直立的棒子，
 *  打點在身體中心以上 → 頭被往後推，往後仰倒並翻滾；
 *  打在中心附近 → 幾乎不轉，整個人被推最遠；
 *  打在中心以下 → 腳被掃開，上半身往前（朝出手方向）撲倒、彈得比較高。
 */
export function knockRequest(seat: Seat, speed: number, hitY: number, vel: { x: number; y: number }, stayDown: boolean, weightKg = 0.5): KnockRequest {
  // 重量決定擊退「樣式」：中等重量 → 被推開、跌坐滑行；很重 → 整個人被打飛、在空中翻滾、落地彈好幾下
  const heavy = Math.max(0, Math.min(1, (weightKg - 0.3) / 1));
  const liftMul = 0.55 + 0.9 * heavy;
  const spinMul = 0.6 + 0.8 * heavy;
  const half = ARENA.characterBody.torsoH / 2 + 16; // 身體中心到頭頂/腳底約 75px
  const comY = ARENA.groundY - 75;
  const rel = Math.max(-1, Math.min(1, (hitY - comY) / half)); // -1 頭頂、0 中心、+1 腳底
  const away = seat === 0 ? -1 : 1; // 被打的人往自己身後飛
  // 投擲物是往下砸的話，往後推的比例小一點（力量被地面吃掉）
  const len = Math.hypot(vel.x, vel.y) || 1;
  const horiz = Math.max(0.55, Math.abs(vel.x) / len);
  const linear = speed * (1 - KNOCKBACK.offCenterLoss * Math.abs(rel));
  const vx = away * linear * horiz;
  // 打腳 → 腳被掃起來彈比較高；打頭 → 主要是往後仰，不太會離地
  const vy = -speed * liftMul * (KNOCKBACK.lift * (1 + 0.6 * Math.min(0, rel)) + KNOCKBACK.sweepLift * Math.max(0, rel)) * (vel.y > 0 ? 0.8 : 1);
  // 力矩 = 打點相對中心的高度 × 推力；打在上面 → 頭往被推的方向轉
  // 加一點固定的往後倒旋轉，打在正中間也會翻倒
  const omega = away * (-rel * KNOCKBACK.spin + KNOCKBACK.baseSpin) * speed * spinMul;
  return { seat, vx, vy, omega, stayDown, speed };
}
