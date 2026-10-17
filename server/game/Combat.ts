// 攻擊結算：用物理世界模擬投擲 → 判斷命中 → 計算傷害 → 更新防禦與狀態。
// 全部在伺服器上計算，客戶端只負責播放結果。

import { getItem, type ThrowableDef } from '../../shared/config/items.js';
import { itemScaleFor } from '../../shared/config/characters.js';
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
  let stuck: ThrowEvent['stuck'];
  const enemy: Seat = seat === 0 ? 1 : 0;
  // 連恩丟的 poopoo恩 2.5 倍大：碰撞半徑一起放大
  const projScale = itemScaleFor(state.characterIds[seat], item.id);
  if (projScale !== 1) item = { ...item, radius: item.radius * projScale };

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
        // 連恩的鄭霖澤保鑣：被打中時連恩也痛（這次傷害的 20%）
        const ddef = getItem(d.itemId);
        if (upd && ddef?.kind === 'defense' && ddef.ownerShareDamage && state.fighters[d.owner].hp > 0) {
          const share = Math.round(item.damage * Math.pow(0.5, impact.bounces ?? 0) * ddef.ownerShareDamage);
          const e = share > 0 ? state.dealDamage(d.owner, share, 'status') : null;
          if (e) damages.push({ ...e, label: '心疼保鑣' });
        }
        if (upd) {
          defenseUpdates.push(upd);
          if (upd.destroyed) destroyedNow.push(upd.uid);
        }
      }
    }

    // 2) 角色傷害：直擊 or 爆炸波及（自己的爆炸也可能炸到自己）
    const hitSeats: Seat[] = [];
    // 彈地後才打到：傷害照算（每彈一次減半），但道具的特殊效果不算
    // （例外：角色技能指定的道具彈地照樣觸發，例如機車鎖打捲毛）
    const bounced = (impact.bounces ?? 0) > 0;
    const effectsOn = (target: Seat) => !bounced || !!state.traits(target).bounceTriggers?.includes(item.id);
    let stickAt: { seat: Seat; x: number; y: number; feetX: number } | null = null;
    for (const target of [0, 1] as Seat[]) {
      let amount = 0;
      let source: DamageEntry['source'] = 'splash';
      let headshot = false;
      let bounces = 0;
      let crit = false;
      if (impact.kind === 'character' && impact.hitSeat === target) {
        amount = item.damage;
        source = 'direct';
        // 先在地上彈過再打到：每彈一次傷害減半
        bounces = impact.bounces ?? 0;
        amount *= Math.pow(0.5, bounces);
        // 打到頭（身體上緣以上）傷害 ×1.5，可再和其他倍率（精神傷害、乳清…）相乘
        if (impact.y < headLineY(state.physics.getCharScale(target))) {
          // 李信安（物理系）爆頭 ×2
          amount *= state.traits(seat).headshotMultiplier ?? HEADSHOT_MULTIPLIER;
          headshot = true;
        }
        // 捲毛：自己丟的快煮鍋直接命中（沒彈地）爆擊
        const critMul = state.traits(seat).critItems?.[item.id];
        if (critMul && bounces === 0) {
          amount *= critMul;
          crit = true;
        }
        // 擊退：越重、越快的東西推得越遠
        // 擊退特別強的道具（快煮鍋）上限也跟著放大
        // 彈地後打到：快煮鍋「打飛特別遠」也算特殊效果，不放大
        const knockScale = effectsOn(target) ? item.knockScale ?? 1 : Math.min(1, item.knockScale ?? 1);
        knockSpeed = Math.min(KNOCKBACK.maxSpeed * Math.max(1, knockScale), knockScale * KNOCKBACK.k * Math.sqrt(item.weightKg ?? 0.5) * (impactSpeed / 1500) * (headshot ? KNOCKBACK.headshotBonus : 1));
        knockSeat = target;
        // 黏在身上（poopoo恩）：記下命中點相對腳底的位置
        if (item.sticky && effectsOn(target)) stickAt = { seat: target, x: impact.x, y: impact.y, feetX: state.physics.getCharX(target) };
      } else if (item.explosionRadius > 0 && impact.kind !== 'out') {
        const dist = distPointRect(impact.x, impact.y, characterHitbox(state.physics.getCharX(target), state.physics.getCharScale(target)));
        if (dist <= item.explosionRadius) {
          const falloff = 1 - (dist / item.explosionRadius) * 0.5; // 越靠近爆心越痛：邊緣剩 50%
          amount = item.damage * item.splashMultiplier * falloff;
        }
      }
      if (amount <= 0) continue;
      if (reductionFor === target) amount *= 1 - reduction;
      const entry = state.dealDamage(target, amount, source, seat, undefined, item.id);
      if (entry && headshot) entry.headshot = true;
      if (entry && crit) entry.crit = true;
      if (entry && bounces > 0) entry.bounces = bounces;
      if (entry) {
        damages.push(entry);
        hitSeats.push(target);
      }
    }

    // 被打死的人不用黏了（死掉就會消失）
    if (stickAt && state.fighters[stickAt.seat].hp > 0) {
      stuck = { seat: stickAt.seat, item: state.stick(stickAt.seat, item.id, stickAt.x, stickAt.y, stickAt.feetX, projScale) };
    }

    // 擊退（傷害算完才知道會不會被打死 → 打死就躺著不起來）
    if (knockSeat !== null && knockSpeed >= KNOCKBACK.minSpeed) {
      // 潘柏翰（年邁）：被打飛倒地額外扣血
      const old = state.traits(knockSeat).knockdownDamage;
      if (old && state.fighters[knockSeat].hp > 0) {
        const e = state.dealDamage(knockSeat, old, 'status');
        if (e) damages.push({ ...e, label: '年邁' });
      }
      knock = knockRequest(knockSeat, knockSpeed, impact.y, impactVel, state.fighters[knockSeat].hp <= 0, item.weightKg ?? 0.5, state.physics.getCharScale(knockSeat));
    }

    // 3) 附加狀態（只附加給敵人）
    if (item.onHitStatus && hitSeats.includes(enemy) && effectsOn(enemy)) {
      const applied = state.applyStatus(enemy, item.onHitStatus.statusId, item.onHitStatus.turns, seat);
      statusApplied = { seat: enemy, statusId: item.onHitStatus.statusId, turns: applied || item.onHitStatus.turns, ...(applied ? {} : { immune: true }) };
    }
    return { remove: destroyedNow, knock };
  });
  state.syncCharacters();

  // 被打倒的防禦道具壓到人
  const crushHeals: NonNullable<ThrowEvent['crushHeals']> = [];
  for (const c of sim.crushes) {
    if (state.fighters[c.seat].hp <= 0) continue;
    // 獸控倒下壓到葉柄承：回血，獸控消失
    const owned = state.getDefense(c.uid) ?? state.wasDefense(c.uid);
    const cdef = owned ? getItem(owned.itemId) : undefined;
    if (owned && owned.owner === c.seat && cdef?.kind === 'defense' && cdef.crushHealsOwner) {
      if (crushHeals.some((h) => h.uid === c.uid)) continue;
      const h = state.heal(c.seat, cdef.crushHealsOwner);
      if (h) crushHeals.push({ ...h, frame: c.frame, uid: c.uid });
      const upd = state.destroyDefense(c.uid);
      if (upd) defenseUpdates.push({ ...upd, reason: 'removed' });
      continue;
    }
    const entry = state.dealDamage(c.seat, DEFENSE_HIT.crushDamage, 'crush');
    if (entry) {
      entry.frame = c.frame;
      damages.push(entry);
    }
  }

  // 竹竿：倒地多睡一下，睡飽回血
  const frameHeals: NonNullable<ThrowEvent['frameHeals']> = [];
  const sleepFrames: NonNullable<ThrowEvent['sleepFrames']> = [];
  if (sim.knockSleep) {
    const ks = sim.knockSleep;
    sleepFrames.push({ seat: ks.seat, frame: ks.sleepFrame });
    const amount = state.traits(ks.seat).sleepHeal ?? 0;
    if (amount > 0 && state.fighters[ks.seat].hp > 0) {
      const h = state.heal(ks.seat, amount);
      if (h && h.amount > 0) frameHeals.push({ ...h, frame: ks.wakeFrame, label: '睡飽了' });
    }
  }

  // 竹竿：投擲連續直接命中 3 次 → 胡了，下次抽牌必出麻將
  let hu = false;
  const reward = state.traits(seat).streakReward;
  if (reward) {
    const f = state.fighters[seat];
    const hitEnemy = sim.impact.kind === 'character' && sim.impact.hitSeat === enemy;
    f.hitStreak = hitEnemy ? (f.hitStreak ?? 0) + 1 : 0;
    if (f.hitStreak >= reward.hits) {
      f.hitStreak = 0;
      f.huReady = true;
      hu = true;
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
    ...(projScale !== 1 ? { projScale } : {}),
    ...(crushHeals.length ? { crushHeals } : {}),
    ...(frameHeals.length ? { frameHeals } : {}),
    ...(sleepFrames.length ? { sleepFrames } : {}),
    ...(hu ? { hu } : {}),
    ...(stuck ? { stuck } : {}),
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
export function knockRequest(seat: Seat, speed: number, hitY: number, vel: { x: number; y: number }, stayDown: boolean, weightKg = 0.5, bodyScale = 1): KnockRequest {
  // 重量決定擊退「樣式」：中等重量 → 被推開、跌坐滑行；很重 → 整個人被打飛、在空中翻滾、落地彈好幾下
  const heavy = Math.max(0, Math.min(1, (weightKg - 0.3) / 1));
  const liftMul = 0.55 + 0.9 * heavy;
  const spinMul = 0.6 + 0.8 * heavy;
  const half = (ARENA.characterBody.torsoH / 2 + 16) * bodyScale; // 身體中心到頭頂/腳底約 75px（矮的角色比較短）
  const comY = ARENA.groundY - 75 * bodyScale;
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
  // 一律往後倒（被推的方向），打點離中心越遠轉越快；至少每秒轉 4.5 弧度，不會站著晃半天
  const omega = away * Math.max(4.5, (Math.abs(rel) * KNOCKBACK.spin + KNOCKBACK.baseSpin) * speed * spinMul);
  // 上限：飛太高、轉太快會飛出畫面、看不清楚
  return { seat, vx, vy: Math.max(vy, -KNOCKBACK.maxLift), omega: Math.sign(omega) * Math.min(Math.abs(omega), KNOCKBACK.maxSpin), stayDown, speed };
}
