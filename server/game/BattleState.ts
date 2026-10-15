// 戰鬥中的權威資料：血量、狀態、場上防禦道具。
// 傷害、防禦耐久、狀態全部只在這裡改，避免各模組各算各的。

import { getStatus, PERMANENT_TURNS, type DefenseDef } from '../../shared/config/items.js';
import type { DamageEntry, DefenseUpdate, DefenseView, HealEntry, Seat, StatusView } from '../../shared/types.js';

export interface FighterState {
  seat: Seat;
  hp: number;
  maxHp: number;
  statuses: StatusView[];
}

export interface DefenseState extends DefenseView {
  blocks: DefenseDef['blocks'];
  damageReduction: number;
}

export class BattleState {
  fighters: [FighterState, FighterState];
  defenses: DefenseState[] = [];
  private uidCounter = 0;

  constructor(maxHp: [number, number]) {
    this.fighters = [
      { seat: 0, hp: maxHp[0], maxHp: maxHp[0], statuses: [] },
      { seat: 1, hp: maxHp[1], maxHp: maxHp[1], statuses: [] },
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
    const existing = f.statuses.find((s) => s.statusId === statusId);
    // 同種狀態不疊加，刷新為較長的回合數
    if (existing) existing.remainingTurns = Math.max(existing.remainingTurns, turns);
    else f.statuses.push({ statusId, remainingTurns: turns });
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
        const d = this.dealDamage(seat, def.damagePerTurn, 'status', undefined, def.id);
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
    return { uid, durability: d.durability, hits: d.hits, destroyed };
  }

  destroyDefense(uid: string): DefenseUpdate | null {
    const d = this.getDefense(uid);
    if (!d) return null;
    this.removeDefense(uid);
    return { uid, durability: 0, hits: d.hits, destroyed: true };
  }

  removeDefense(uid: string): void {
    this.defenses = this.defenses.filter((d) => d.uid !== uid);
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
