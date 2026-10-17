// 戰鬥中的權威資料：血量、狀態、場上防禦道具。
// 傷害、防禦耐久、狀態全部只在這裡改，避免各模組各算各的。

import { ARENA } from '../../shared/config/game.js';
import { bodyScaleOf, inBond, traitsOf, type BondId, type CharacterTraits } from '../../shared/config/characters.js';
import { BOND_CARRY, getItem, getStatus, PERMANENT_TURNS, type DefenseDef } from '../../shared/config/items.js';
import { seatsOf, sideDir, teamOf, type DamageEntry, type DefenseUpdate, type DefenseView, type GameMode, type HealEntry, type Seat, type StatusView, type StuckItem, type Team } from '../../shared/types.js';
import { startXOf } from '../../shared/physics.js';
import { PhysicsWorld } from './PhysicsWorld.js';

export interface FighterState {
  seat: Seat;
  hp: number;
  maxHp: number;
  statuses: StatusView[];
  /** 腳底 x（被擊退會改變） */
  x: number;
  /** 黏在身上的便便（純裝飾） */
  stuck: StuckItem[];
  /** 鎖血技能已經用掉了 */
  survivedOnce?: boolean;
  /** 竹竿：投擲連續直接命中次數、胡了（下次抽牌必出麻將）、手辦被毀的憤怒加成 */
  hitStreak?: number;
  /** 護盾（先擋傷害） */
  shield?: number;
  huReady?: boolean;
  rage?: number;
}

export interface DefenseState extends DefenseView {
  blocks: DefenseDef['blocks'];
  damageReduction: number;
}

export class BattleState {
  fighters: FighterState[];
  defenses: DefenseState[] = [];
  /** 防禦道具的真實物理（位置、角度、堆疊） */
  readonly physics: PhysicsWorld;
  private uidCounter = 0;

  /** 每個座位的角色 id（決定被動技能） */
  readonly characterIds: (string | null)[];
  readonly mode: GameMode;
  readonly seats: Seat[];

  constructor(maxHp: number[], characterIds: (string | null)[] = maxHp.map(() => null), mode: GameMode = maxHp.length > 2 ? 'team' : 'duel') {
    this.mode = mode;
    this.seats = seatsOf(mode);
    this.characterIds = characterIds;
    this.physics = new PhysicsWorld(
      this.seats.map((s) => startXOf(s, mode)),
      this.seats.map((s) => bodyScaleOf(characterIds[s] ?? null)),
    );
    // 竹竿倒地後多睡一下
    for (const s of this.seats) this.physics.setExtraLie(s, traitsOf(characterIds[s] ?? null).extraLieMs ?? 0);
    this.fighters = this.seats.map((seat) => ({ seat, hp: maxHp[seat], maxHp: maxHp[seat], statuses: [], x: startXOf(seat, mode), stuck: [] }));
  }

  /** 敵隊的座位 */
  enemiesOf(seat: Seat): Seat[] {
    return this.seats.filter((s) => teamOf(s) !== teamOf(seat));
  }

  /** 還活著的敵人 */
  aliveEnemiesOf(seat: Seat): Seat[] {
    return this.enemiesOf(seat).filter((s) => this.fighters[s].hp > 0);
  }

  /**
   * 羈絆：2v2 時鄭霖澤和連恩同隊而且都活著。
   * team 有給的話只看那一隊。
   */
  bond(team?: Team): { thrower: Seat; carried: Seat } | null {
    if (this.mode !== 'team') return null;
    for (const t of [0, 1] as Team[]) {
      if (team !== undefined && t !== team) continue;
      const mates = this.seats.filter((s) => teamOf(s) === t && this.fighters[s].hp > 0);
      const thrower = mates.find((s) => this.characterIds[s] === BOND_CARRY.thrower);
      const carried = mates.find((s) => this.characterIds[s] === BOND_CARRY.carried);
      if (thrower !== undefined && carried !== undefined) return { thrower, carried };
    }
    return null;
  }

  /** 這個座位有沒有這組羈絆 */
  inBond(bond: BondId, seat: Seat): boolean {
    return inBond(bond, seat, this.mode, this.characterIds, this.fighters.map((f) => f.hp > 0));
  }

  /** 隊伍是否全滅 */
  teamDead(team: Team): boolean {
    return this.seats.filter((s) => teamOf(s) === team).every((s) => this.fighters[s].hp <= 0);
  }

  nextUid(prefix: string): string {
    this.uidCounter += 1;
    return `${prefix}${this.uidCounter}`;
  }

  /** 場上自己的防禦道具帶來的增傷（獸控還在 → ×2） */
  defenseBoost(seat: Seat): number {
    let m = 1;
    for (const d of this.defenses) {
      if (d.owner !== seat) continue;
      const def = getItem(d.itemId);
      if (def?.kind === 'defense' && def.ownerOutgoingMultiplier) m *= def.ownerOutgoingMultiplier;
    }
    return m;
  }

  /** 場上自己的防禦道具指定的基本傷害倍率（連恩的鄭霖澤保鑣） */
  defenseOverride(seat: Seat): number | undefined {
    for (const d of this.defenses) {
      if (d.owner !== seat) continue;
      const def = getItem(d.itemId);
      if (def?.kind === 'defense' && def.ownerOutgoingOverride !== undefined) return def.ownerOutgoingOverride;
    }
    return undefined;
  }

  traits(seat: Seat): CharacterTraits {
    return traitsOf(this.characterIds[seat] ?? null);
  }

  /** 某玩家目前所有狀態的倍率相乘 */
  private multiplier(seat: Seat, key: 'incomingMultiplier' | 'outgoingMultiplier'): number {
    let m = 1;
    // 可累加的狀態：每一層都再乘一次（例如 1.2 疊 3 層 = 1.2³）
    const strength = this.traits(seat).statusStrengthMultiplier ?? {};
    for (const s of this.fighters[seat].statuses) {
      let v = getStatus(s.statusId)?.[key] ?? 1;
      // 鄭霖澤：負面效果加倍（精神傷害 ×1.2 → ×1.4）
      const k = (strength[s.statusId] ?? 1) * (s.strength ?? 1);
      if (k !== 1) v = 1 + (v - 1) * k;
      m *= Math.pow(v, s.stacks ?? 1);
    }
    return m;
  }

  /**
   * 造成傷害。attacker 有填時會套用攻擊者的「造成傷害倍率」（噁心、蛋白質），
   * 一律套用受害者的「受到傷害倍率」（精神傷害）。
   */
  dealDamage(seat: Seat, amount: number, source: DamageEntry['source'], attacker?: Seat, statusId?: string, itemId?: string): DamageEntry | null {
    let raw = amount * this.multiplier(seat, 'incomingMultiplier');
    const t = this.traits(seat);
    // 角色弱點/抗性：被特定道具打、特定狀態的持續傷害
    if (itemId) raw *= t.incomingByItem?.[itemId] ?? 1;
    if (statusId) raw *= t.statusDamageMultiplier?.[statusId] ?? 1;
    if (attacker !== undefined) {
      const ta = this.traits(attacker);
      // 角色基本傷害倍率（連恩對鄭霖澤改用另一個倍率）
      const vs = ta.outgoingVsChar?.[this.characterIds[seat] ?? ''];
      // 基本倍率：場上有保鑣時改用保鑣的倍率（連恩 0.5 → 0.8）；再加上手辦憤怒 / 喪偶這類永久加減
      const base = this.defenseOverride(attacker) ?? vs ?? ta.outgoingMultiplier ?? 1;
      raw *= this.multiplier(attacker, 'outgoingMultiplier') * Math.max(0, base + (this.fighters[attacker].rage ?? 0)) * this.defenseBoost(attacker);
      // 自己用某些道具特別痛（連恩的 Maya、poopoo恩）
      if (itemId) raw *= ta.ownItemMultiplier?.[itemId] ?? 1;
      // 被特定角色打（鄭霖澤打連恩 ×0.5）
      raw *= t.incomingFromChar?.[this.characterIds[attacker] ?? ''] ?? 1;
    }
    // 李信安（學分混子）：單次傷害超過 16 的部分減半
    const cap = t.damageSoftCap;
    if (cap && raw > cap.at) raw = cap.at + (raw - cap.at) * cap.factor;
    let dmg = Math.max(0, Math.round(raw));
    if (dmg <= 0) return null;
    // 羈絆（連恩）：受到的傷害一半轉給同隊的鄭霖澤，轉過去的再減半
    let shareTo: DamageEntry['shareTo'];
    const b = this.characterIds[seat] === BOND_CARRY.carried ? this.bond(teamOf(seat)) : null;
    if (b && b.carried === seat) {
      const half = Math.floor(dmg / 2);
      dmg -= half;
      const z = Math.round(half / 2);
      if (z > 0) {
        const r = this.applyRaw(b.thrower, z);
        shareTo = { seat: b.thrower, amount: r.amount, hpAfter: r.hpAfter };
      }
    }
    const f = this.fighters[seat];
    // 護盾先吸收
    let shielded = 0;
    if (f.shield && f.shield > 0) {
      shielded = Math.min(f.shield, dmg);
      f.shield -= shielded;
      dmg -= shielded;
    }
    f.hp = Math.max(0, f.hp - dmg);
    // 葉柄承：第一次歸零鎖血在 1
    let survived = false;
    if (f.hp <= 0 && t.surviveOnce && !f.survivedOnce) {
      f.hp = 1;
      f.survivedOnce = true;
      survived = true;
    }
    return {
      seat,
      amount: dmg,
      hpAfter: f.hp,
      source,
      ...(statusId ? { statusId } : {}),
      ...(survived ? { survived } : {}),
      ...(shielded ? { shielded } : {}),
      ...(shareTo ? { shareTo } : {}),
    };
  }

  /** 直接扣血（不再套任何倍率）：護盾先擋 */
  private applyRaw(seat: Seat, dmg: number): { amount: number; hpAfter: number } {
    const f = this.fighters[seat];
    if (f.shield && f.shield > 0) {
      const s = Math.min(f.shield, dmg);
      f.shield -= s;
      dmg -= s;
    }
    f.hp = Math.max(0, f.hp - dmg);
    if (f.hp <= 0 && this.traits(seat).surviveOnce && !f.survivedOnce) {
      f.hp = 1;
      f.survivedOnce = true;
    }
    return { amount: dmg, hpAfter: f.hp };
  }

  /**
   * 黏一坨在身上：impactX/Y 是世界座標的命中點，feetX 是被打中當下的腳底位置。
   * 跟已經黏著的便便重疊 → 黏在那坨上面（往外疊出去）。
   */
  stick(seat: Seat, itemId: string, impactX: number, impactY: number, feetX: number, scale = 1): StuckItem {
    const facing = sideDir(seat);
    const bs = this.physics.getCharScale(seat);
    const R = 12 * scale; // 黏著時的半徑（畫面上約 28px 大；連恩丟的大 2.5 倍）
    let x = Math.max(-22 * bs, Math.min(22 * bs, (impactX - feetX) * facing));
    let y = Math.max(8, Math.min(ARENA.characterHitbox.h * bs + 6, ARENA.groundY - impactY));
    let rot = (Math.random() - 0.5) * 0.8;
    const list = this.fighters[seat].stuck;
    // 疊起來：一直往外推，直到不跟任何一坨重疊
    for (let guard = 0; guard < 12; guard++) {
      const hit = list.find((s) => Math.hypot(s.x - x, s.y - y) < (R + 12 * (s.scale ?? 1)) * 0.85);
      if (!hit) break;
      let dx = x - hit.x,
        dy = y - hit.y;
      const len = Math.hypot(dx, dy);
      // 正好疊在同一點：往外（面向對手那側）稍微往上疊
      if (len < 1) {
        dx = 0.8;
        dy = 0.6;
      }
      const l2 = Math.hypot(dx, dy);
      const gap = (R + 12 * (hit.scale ?? 1)) * 0.875;
      x = hit.x + (dx / l2) * gap;
      y = hit.y + (dy / l2) * gap;
      rot = Math.atan2(dx / l2, dy / l2) * 0.6; // 往外歪
    }
    const item: StuckItem = { itemId, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, rot: Math.round(rot * 100) / 100, ...(scale !== 1 ? { scale } : {}) };
    list.push(item);
    return item;
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

  /** 附加狀態；回傳實際附加的回合數，0 = 沒附加上（角色免疫） */
  applyStatus(seat: Seat, statusId: string, turns: number, source?: Seat): number {
    if (!getStatus(statusId)) return 0;
    if (this.traits(seat).immuneStatuses?.includes(statusId)) return 0;
    // 潘柏翰：二手菸變成回血
    const repl = this.traits(seat).statusReplace?.[statusId];
    if (repl) statusId = repl;
    // 鄭霖澤：有回合數的負面效果持續兩倍久
    const dur = this.traits(seat).statusDurationMultiplier?.[statusId];
    if (dur && turns < PERMANENT_TURNS) turns = Math.round(turns * dur);
    const f = this.fighters[seat];
    const def = getStatus(statusId)!;
    const existing = f.statuses.find((s) => s.statusId === statusId);
    if (existing) {
      // 可累加的（香菸、絲襪、乳清）層數 +1；其他的不疊加，刷新為較長的回合數
      if (def.stackable) existing.stacks = (existing.stacks ?? 1) + 1;
      existing.remainingTurns = Math.max(existing.remainingTurns, turns);
    } else f.statuses.push(def.stackable ? { statusId, remainingTurns: turns, stacks: 1 } : { statusId, remainingTurns: turns });
    // 竹竿用絲襪：效果 ×1.5（同一個目標只會被對手附加，記在狀態上）
    const k = source !== undefined ? this.traits(source).statusApplyStrength?.[statusId] : undefined;
    if (k) f.statuses.find((s) => s.statusId === statusId)!.strength = k;
    return turns;
  }

  /**
   * 該玩家回合開始時：結算持續傷害、判斷是否被跳過回合、遞減 decrementAt='start' 的狀態。
   */
  tickStatusesStart(seat: Seat): { damage: DamageEntry[]; skip: boolean; heals: HealEntry[] } {
    const f = this.fighters[seat];
    const damage: DamageEntry[] = [];
    const heals: HealEntry[] = [];
    // 鄭霖澤：身上黏著 poopoo恩 → 每回合回血
    const regen = this.traits(seat).stuckRegen ?? 0;
    if (regen > 0 && f.stuck.length > 0 && f.hp > 0 && f.hp < f.maxHp) {
      const h = this.heal(seat, regen);
      if (h && h.amount > 0) heals.push(h);
    }
    let skip = false;
    for (const s of [...f.statuses]) {
      const def = getStatus(s.statusId);
      if (!def) continue;
      if (def.damagePerTurn && def.damagePerTurn > 0) {
        const d = this.dealDamage(seat, def.damagePerTurn * (s.stacks ?? 1), 'status', undefined, def.id);
        if (d) damage.push(d);
      }
      if (def.healPerTurn && def.healPerTurn > 0) {
        const h = this.heal(seat, def.healPerTurn);
        if (h && h.amount > 0) heals.push(h);
      }
      if (def.skipTurn) skip = true;
    }
    this.decrement(seat, 'start');
    return { damage, skip, heals };
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

  /** 剛被打壞（資料已移除、物理上還在倒）的防禦道具：誰的、什麼道具 */
  private broken = new Map<string, { owner: Seat; itemId: string }>();
  wasDefense(uid: string): { owner: Seat; itemId: string } | undefined {
    return this.broken.get(uid);
  }

  /** 防禦道具被攻擊一次 */
  hitDefense(uid: string, structureDamage: number): DefenseUpdate | null {
    const d = this.getDefense(uid);
    if (!d) return null;
    d.hits += 1;
    if (d.durability !== null) d.durability = Math.max(0, d.durability - Math.round(structureDamage));
    const destroyed =
      (d.durability !== null && d.durability <= 0) || (d.maxHits !== null && d.hits >= d.maxHits);
    // 被打壞：先從資料中移除（不能再擋），物理上的身體由投擲模擬讓它倒完、靜止後才移除
    let rage: DefenseUpdate['rage'];
    if (destroyed) {
      this.defenses = this.defenses.filter((x) => x.uid !== uid);
      this.broken.set(uid, { owner: d.owner, itemId: d.itemId });
      rage = this.rageOnDestroyed(d);
    }
    return { uid, durability: d.durability, hits: d.hits, destroyed, reason: destroyed ? 'hit' : undefined, ...(rage ? { rage } : {}) };
  }

  destroyDefense(uid: string): DefenseUpdate | null {
    const d = this.getDefense(uid);
    if (!d) return null;
    this.removeDefense(uid);
    const rage = this.rageOnDestroyed(d);
    return { uid, durability: 0, hits: d.hits, destroyed: true, reason: 'removed', ...(rage ? { rage } : {}) };
  }

  /** 竹竿的手辦被毀：主人傷害永久 +0.15 */
  private rageOnDestroyed(d: DefenseState): DefenseUpdate['rage'] {
    const def = getItem(d.itemId);
    if (def?.kind !== 'defense' || !def.destroyedOwnerBonus) return undefined;
    const f = this.fighters[d.owner];
    f.rage = Math.round(((f.rage ?? 0) + def.destroyedOwnerBonus) * 100) / 100;
    return { seat: d.owner, total: f.rage, delta: def.destroyedOwnerBonus, ...(def.destroyedLabel ? { label: def.destroyedLabel } : {}) };
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
