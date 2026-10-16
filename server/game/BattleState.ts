// 戰鬥中的權威資料：血量、狀態、場上防禦道具。
// 傷害、防禦耐久、狀態全部只在這裡改，避免各模組各算各的。

import { ARENA } from '../../shared/config/game.js';
import { getStatus, PERMANENT_TURNS, type DefenseDef } from '../../shared/config/items.js';
import type { DamageEntry, DefenseUpdate, DefenseView, HealEntry, Seat, StatusView } from '../../shared/types.js';
import { PhysicsWorld } from './PhysicsWorld.js';

export interface FighterState {
  seat: Seat;
  hp: number;
  maxHp: number;
  statuses: StatusView[];
  /** 腳底 x（被擊退會改變） */
  x: number;
}

export interface DefenseState extends DefenseView {
  blocks: DefenseDef['blocks'];
  damageReduction: number;
}

export class BattleState {
  fighters: [FighterState, FighterState];
  defenses: DefenseState[] = [];
  /** 防禦道具的真實物理（位置、角度、堆疊） */
  readonly physics = new PhysicsWorld();
  private uidCounter = 0;

  constructor(maxHp: [number, number]) {
    this.fighters = [
      { seat: 0, hp: maxHp[0], maxHp: maxHp[0], statuses: [], x: ARENA.characterStartX[0] },
      { seat: 1, hp: maxHp[1], maxHp: maxHp[1], statuses: [], x: ARENA.characterStartX[1] },
    ];
  }

  nextUid(prefix: string): string {
    this.uidCounter += 1;
    return `${prefix}${this.uidCounter}`;
  }

  /** 某玩家目前所有狀態的倍率相乘 */
  private multiplier(seat: Seat, key: 'incomingMultiplier' | 'outgoingMultiplier'): number {
    let m = 1;
    for (const s of this.fighters[seat].statuses) m *= getStatus(s.statusId)?.[key] ?? 1;
    return m;
  }

  /**
   * 造成傷害。attacker 有填時會套用攻擊者的「造成傷害倍率」（噁心、蛋白質），
   * 一律套用受害者的「受到傷害倍率」（精神傷害）。
   */
  dealDamage(seat: Seat, amount: number, source: DamageEntry['source'], attacker?: Seat, statusId?: string): DamageEntry | null {
    let raw = amount * this.multiplier(seat, 'incomingMultiplier');
    if (attacker !== undefined) raw *= this.multiplier(attacker, 'outgoingMultiplier');
    const dmg = Math.max(0, Math.round(raw));
    if (dmg <= 0) return null;
    const f = this.fighters[seat];
    f.hp = Math.max(0, f.hp - dmg);
    return { seat, amount: dmg, hpAfter: f.hp, source, ...(statusId ? { statusId } : {}) };
  }

  heal(seat: Seat, amount: number): HealEntry | null {
    const f = this.fighters[seat];
    if (f.hp <= 0) return null;
    const before = f.hp;
    f.hp = Math.min(f.maxHp, f.hp + Math.round(amount));
    return { seat, amount: f.hp - before, hpAfter: f.hp };
  }

  hasStatus(seat: Seat, statusId: string): boolean {
    return this.fighters[seat].statuses.some((s) => s.statusId === statusId);
  }

  /** 抽道具時要藏起幾個選項 */
  hiddenDrawCount(seat: Seat): number {
    return this.fighters[seat].statuses.reduce((n, s) => n + (getStatus(s.statusId)?.hideDrawOptions ?? 0), 0);
  }

  applyStatus(seat: Seat, statusId: string, turns: number): void {
    if (!getStatus(statusId)) return;
    const f = this.fighters[seat];
    const def = getStatus(statusId)!;
    const existing = f.statuses.find((s) => s.statusId === statusId);
    if (existing) {
      // 可累加的（香菸）層數 +1；其他的不疊加，刷新為較長的回合數
      if (def.stackable) existing.stacks = (existing.stacks ?? 1) + 1;
      existing.remainingTurns = Math.max(existing.remainingTurns, turns);
    } else f.statuses.push(def.stackable ? { statusId, remainingTurns: turns, stacks: 1 } : { statusId, remainingTurns: turns });
  }

  /**
   * 該玩家回合開始時：結算持續傷害、判斷是否被跳過回合、遞減 decrementAt='start' 的狀態。
   */
  tickStatusesStart(seat: Seat): { damage: DamageEntry[]; skip: boolean } {
    const f = this.fighters[seat];
    const damage: DamageEntry[] = [];
    let skip = false;
    for (const s of [...f.statuses]) {
      const def = getStatus(s.statusId);
      if (!def) continue;
      if (def.damagePerTurn && def.damagePerTurn > 0) {
        const d = this.dealDamage(seat, def.damagePerTurn * (s.stacks ?? 1), 'status', undefined, def.id);
        if (d) damage.push(d);
      }
      if (def.skipTurn) skip = true;
    }
    this.decrement(seat, 'start');
    return { damage, skip };
  }

  /** 該玩家回合結束時：遞減 decrementAt='end' 的狀態 */
  tickStatusesEnd(seat: Seat): void {
    this.decrement(seat, 'end');
  }

  private decrement(seat: Seat, at: 'start' | 'end'): void {
    const f = this.fighters[seat];
    for (const s of f.statuses) {
      if (getStatus(s.statusId)?.decrementAt === at && s.remainingTurns < PERMANENT_TURNS) s.remainingTurns -= 1;
    }
    f.statuses = f.statuses.filter((s) => s.remainingTurns > 0);
  }

  getDefense(uid: string): DefenseState | undefined {
    return this.defenses.find((d) => d.uid === uid);
  }

  /** 防禦道具被攻擊一次 */
  hitDefense(uid: string, structureDamage: number): DefenseUpdate | null {
    const d = this.getDefense(uid);
    if (!d) return null;
    d.hits += 1;
    if (d.durability !== null) d.durability = Math.max(0, d.durability - Math.round(structureDamage));
    const destroyed =
      (d.durability !== null && d.durability <= 0) || (d.maxHits !== null && d.hits >= d.maxHits);
    if (destroyed) this.removeDefense(uid);
    return { uid, durability: d.durability, hits: d.hits, destroyed, reason: destroyed ? 'hit' : undefined };
  }

  destroyDefense(uid: string): DefenseUpdate | null {
    const d = this.getDefense(uid);
    if (!d) return null;
    this.removeDefense(uid);
    return { uid, durability: 0, hits: d.hits, destroyed: true, reason: 'removed' };
  }

  removeDefense(uid: string): void {
    this.defenses = this.defenses.filter((d) => d.uid !== uid);
    this.physics.removeDefense(uid);
  }

  /** 擊退後把角色位置寫回 */
  syncCharacters(): void {
    for (const f of this.fighters) f.x = Math.round(this.physics.getCharX(f.seat) * 10) / 10;
  }

  /** 物理模擬後，把每個防禦道具的新位置/角度寫回 */
  syncPoses(): void {
    for (const d of this.defenses) {
      const p = this.physics.pose(d.uid);
      if (p) {
        d.x = p.x;
        d.y = p.y;
        d.angle = p.angle;
      }
    }
  }

  /** 物理世界裡已經掉出場外的道具 → 從資料中移除，回傳更新 */
  dropFallen(uids: string[]): DefenseUpdate[] {
    const out: DefenseUpdate[] = [];
    for (const uid of uids) {
      const d = this.getDefense(uid);
      if (!d) continue;
      this.defenses = this.defenses.filter((x) => x.uid !== uid);
      out.push({ uid, durability: d.durability, hits: d.hits, destroyed: true, reason: 'fell' });
    }
    return out;
  }

  /**
   * 放置者回合開始時遞減持續回合，歸零就移除。
   * 放置當下那個回合不扣（因為放置發生在回合中段，這裡只在之後的回合開始時扣）。
   */
  tickDefenses(owner: Seat): string[] {
    const expired: string[] = [];
    for (const d of this.defenses) {
      if (d.owner !== owner || d.remainingTurns === null) continue;
      d.remainingTurns -= 1;
      if (d.remainingTurns <= 0) expired.push(d.uid);
    }
    for (const uid of expired) this.removeDefense(uid);
    return expired;
  }

  defenseViews(): DefenseView[] {
    return this.defenses.map(({ blocks: _b, damageReduction: _r, ...view }) => ({ ...view }));
  }

  deadSeats(): Seat[] {
    return this.fighters.filter((f) => f.hp <= 0).map((f) => f.seat);
  }
}
