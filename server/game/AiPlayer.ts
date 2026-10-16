// ============================================================
// 電腦玩家（AI）
// ------------------------------------------------------------
// 跟真人一樣透過 Battle 的公開操作（停老虎機、選道具、投擲、放置、發動）來玩，
// 不會偷看或修改任何狀態以外的東西。
// 瞄準：複製一份目前的物理世界，實際試丟很多次找出能打中的角度與力道，
// 再依難度加上誤差。難度越高：試算越多組、誤差越小、選道具越聰明。
// ============================================================

import { ARENA } from '../../shared/config/game.js';
import { getItem, type DefenseDef, type ItemDef, type ThrowableDef } from '../../shared/config/items.js';
import { headLineY } from '../../shared/physics.js';
import type { AiDifficulty, Seat } from '../../shared/types.js';
import type { Battle } from './Battle.js';
import { validatePlacement } from './DefenseSystem.js';

interface DifficultyProfile {
  label: string;
  /** 試算幾種角度 */
  angles: number;
  /** 每個角度二分搜尋力道幾次 */
  steps: number;
  /** 出手誤差（角度：度、力道：比例），常態分布的標準差 */
  angleErr: number;
  powerErr: number;
  /** 選道具：0 = 亂選，1 = 最聰明 */
  smart: number;
  /** 想事情的時間倍率（越強越果斷） */
  think: number;
  /** 會不會刻意瞄頭 */
  aimHead: boolean;
}

export const AI_PROFILES: Record<AiDifficulty, DifficultyProfile> = {
  // 誤差是用模擬調出來的：沒有防禦道具時，命中率大約 弱 23%、中 40%、強 74%、夢魘 ~100%
  easy: { label: '弱', angles: 5, steps: 7, angleErr: 13, powerErr: 0.22, smart: 0, think: 1.3, aimHead: false },
  normal: { label: '中', angles: 8, steps: 8, angleErr: 6, powerErr: 0.1, smart: 0.5, think: 1.1, aimHead: false },
  hard: { label: '強', angles: 12, steps: 9, angleErr: 3, powerErr: 0.05, smart: 0.85, think: 0.9, aimHead: false },
  nightmare: { label: '夢魘', angles: 18, steps: 11, angleErr: 0.3, powerErr: 0.004, smart: 1, think: 0.7, aimHead: true },
};

const gauss = () => {
  // Box-Muller
  const u = 1 - Math.random(),
    v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

export class AiPlayer {
  private lastKey = '';
  private timers = new Set<NodeJS.Timeout>();
  private readonly profile: DifficultyProfile;

  constructor(
    private readonly battle: Battle,
    readonly seat: Seat,
    readonly difficulty: AiDifficulty,
    /** 把瞄準過程即時顯示給對手看 */
    private readonly preview: (angle: number, power?: number) => void,
  ) {
    this.profile = AI_PROFILES[difficulty];
  }

  dispose(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  private later(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms * this.profile.think);
    this.timers.add(t);
  }

  /** 每次狀態改變時呼叫：輪到自己的新階段就安排下一步 */
  poke(): void {
    if (this.battle.isFinished) return;
    const t = this.battle.turnView();
    if (t.activeSeat !== this.seat) return;
    const key = `${t.turnId}:${t.phase}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const still = () => {
      const now = this.battle.turnView();
      return !this.battle.isFinished && now.turnId === t.turnId && now.phase === t.phase;
    };
    switch (t.phase) {
      case 'draw':
        this.later(1100 + Math.random() * 900, () => still() && this.battle.stopSlot(this.seat, t.turnId));
        break;
      case 'choose':
        this.later(1600 + Math.random() * 1000, () => {
          if (!still()) return;
          const pick = this.pickItem(this.battle.turnView().options ?? []);
          if (pick) this.battle.choose(this.seat, t.turnId, pick);
        });
        break;
      case 'aimAngle':
      case 'aimPower':
        // 等選卡特效播完再開始瞄準
        this.later(1300, () => still() && this.doThrow(t.turnId));
        break;
      case 'place':
        this.later(1500 + Math.random() * 800, () => still() && this.doPlace(t.turnId));
        break;
      case 'target':
        this.later(1400 + Math.random() * 600, () => still() && this.battle.useFunctional(this.seat, t.turnId));
        break;
    }
  }

  // ------------------------------------------------------------ 選道具

  private pickItem(options: string[]): string | null {
    if (options.length === 0) return null;
    if (Math.random() >= this.profile.smart) return options[Math.floor(Math.random() * options.length)];
    let best = options[0],
      bestScore = -Infinity;
    for (const id of options) {
      const item = getItem(id);
      if (!item) continue;
      const s = this.scoreItem(item) + Math.random() * 3 * (1 - this.profile.smart);
      if (s > bestScore) {
        bestScore = s;
        best = id;
      }
    }
    return best;
  }

  /** 粗略估計這個道具現在用起來值多少（大約等於「造成的血量差」） */
  private scoreItem(item: ItemDef): number {
    const st = this.battle.state;
    const me = st.fighters[this.seat],
      foe = st.fighters[this.seat === 0 ? 1 : 0];
    const hitRate = this.difficulty === 'nightmare' ? 0.9 : this.difficulty === 'hard' ? 0.6 : 0.35;
    if (item.kind === 'throwable') {
      let v = item.damage * hitRate;
      const status = item.onHitStatus?.statusId;
      if (status === 'smoke') v += 3 * hitRate; // 之後每回合扣血
      if (status === 'stun') v += 6 * hitRate; // 對手跳過一回合
      if (status === 'blind' || status === 'disgust') v += 2 * hitRate;
      if (foe.hp <= item.damage) v += 20 * hitRate; // 有機會直接打死
      return v;
    }
    if (item.kind === 'defense') {
      const mine = st.defenses.filter((d) => d.owner === this.seat).length;
      return 4 - mine * 2;
    }
    // 功能道具
    switch (item.handler) {
      case 'heal': {
        const missing = me.maxHp - me.hp;
        return Math.min(Number(item.params.amount ?? 15), missing) * 0.9;
      }
      case 'damageBoth': {
        const dmg = Number(item.params.damage ?? 25);
        if (foe.hp <= dmg && me.hp > dmg) return 100; // 打死對手、自己活著
        if (me.hp <= dmg) return -100; // 會先把自己炸死
        return me.hp - foe.hp > dmg ? 6 : -5;
      }
      case 'applyStatus': {
        const statusId = String(item.params.statusId);
        const target: Seat = item.params.target === 'self' ? this.seat : this.seat === 0 ? 1 : 0;
        // 對方免疫（捲毛不吃絲襪）→ 用了等於白費
        if (st.traits(target).immuneStatuses?.includes(statusId)) return -10;
        // 獸控：下回合傷害 ×2，約等於多打一發的期望傷害
        if (statusId === 'beast') return 12 * hitRate;
        // 永久 ×1.2：越早用越划算
        return 5 + (foe.hp / foe.maxHp) * 4;
      }
      default:
        return 3;
    }
  }

  // ------------------------------------------------------------ 投擲

  private doThrow(turnId: number): void {
    const item = getItem(this.battle.turnView().chosenItemId ?? '') as ThrowableDef | undefined;
    if (!item || item.kind !== 'throwable') return;
    const best = this.solve(item);
    const p = this.profile;
    const angle = Math.max(-10, Math.min(88, best.angle + gauss() * p.angleErr));
    const power = Math.max(0.05, Math.min(1, best.power + gauss() * p.powerErr));
    // 給對手看的瞄準動作：先慢慢轉到角度，再蓄力到力道，然後出手
    const steps = 8;
    for (let i = 1; i <= steps; i++) this.later(i * 90, () => this.preview(35 + ((angle - 35) * i) / steps));
    const chargeMs = power * 1150;
    for (let i = 1; i <= 6; i++) this.later(steps * 90 + 150 + (chargeMs * i) / 6, () => this.preview(angle, (power * i) / 6));
    this.later(steps * 90 + 300 + chargeMs, () => {
      const t = this.battle.turnView();
      if (t.turnId === turnId && (t.phase === 'aimAngle' || t.phase === 'aimPower')) this.battle.throwAt(this.seat, turnId, round(angle, 1), round(power, 3));
    });
  }

  /**
   * 在複製的物理世界裡試丟：每個角度用二分搜尋找出剛好落在對手位置的力道，
   * 再從所有結果裡挑最好的（打中頭 > 打中身體 > 彈地打中 > 打到防禦 > 離對手最近）。
   */
  solve(item: ThrowableDef): { angle: number; power: number; score: number } {
    const st = this.battle.state;
    const foe: Seat = this.seat === 0 ? 1 : 0;
    const dir = this.seat === 0 ? 1 : -1;
    const foeX = st.physics.getCharX(foe);
    const p = this.profile;
    let best = { angle: 40, power: 0.85, score: -Infinity };
    /** 每個角度找到的命中力道 */
    const hits: { angle: number; power: number; direct: boolean }[] = [];
    const lo = 12,
      hi = 62;
    for (let i = 0; i < p.angles; i++) {
      const angle = p.angles === 1 ? 40 : lo + ((hi - lo) * i) / (p.angles - 1);
      let a = 0.05,
        b = 1,
        found = false;
      for (let k = 0; k < p.steps; k++) {
        const power = (a + b) / 2;
        const r = this.trial(item, angle, power);
        const score = this.scoreTrial(r, foe, foeX);
        if (score > best.score) best = { angle, power, score };
        // 每個角度記一個命中力道（有直接命中就換掉彈地命中）
        if (score >= 500 && (!found || (score >= 900 && !hits[hits.length - 1].direct))) {
          if (found) hits.pop();
          found = true;
          hits.push({ angle, power, direct: score >= 900 });
        }
        // 落點在對手前面（或撞到防禦）→ 要更大力；過頭 → 小力一點
        const short = r.kind === 'out' ? false : (r.x - foeX) * dir < 0;
        if (short) a = power;
        else b = power;
      }
    }
    // 打得中的角度裡，挑「力道容許誤差最大」的，並瞄在命中範圍的正中間（比較穩）
    let bestWidth = -1;
    // 有直接命中的就不考慮彈地命中（彈一次傷害減半）
    const direct = hits.filter((h) => h.direct);
    const pool = direct.length ? direct : hits;
    const thr = direct.length ? 900 : 400;
    // 候選太多時平均挑幾個就好（省運算）
    const pick = pool.length > 6 ? pool.filter((_, i) => i % Math.ceil(pool.length / 6) === 0) : pool;
    for (const h of pick) {
      const step = 0.004;
      let lo2 = h.power,
        hi2 = h.power;
      let headHits = 0;
      for (let q = h.power - step; q > h.power - 0.08; q -= step) {
        const r = this.trial(item, h.angle, q);
        if (this.scoreTrial(r, foe, foeX) < thr) break;
        if (r.y < headLineY()) headHits++;
        lo2 = q;
      }
      for (let q = h.power + step; q < h.power + 0.08 && q <= 1; q += step) {
        const r = this.trial(item, h.angle, q);
        if (this.scoreTrial(r, foe, foeX) < thr) break;
        if (r.y < headLineY()) headHits++;
        hi2 = q;
      }
      // 夢魘：寬度一樣時偏好會打到頭的
      const width = hi2 - lo2 + (p.aimHead ? headHits * 0.002 : 0);
      if (width > bestWidth) {
        bestWidth = width;
        best = { angle: h.angle, power: (lo2 + hi2) / 2, score: 1000 };
      }
    }
    return best;
  }

  private trial(item: ThrowableDef, angle: number, power: number) {
    const w = this.battle.state.physics.clone();
    const res = w.throwProjectile(this.seat, item, angle, power, () => ({ remove: [] }), { stopAtImpact: true });
    return res.impact;
  }

  private scoreTrial(r: { kind: string; x: number; y: number; hitSeat?: Seat; bounces?: number }, foe: Seat, foeX: number): number {
    if (r.kind === 'character' && r.hitSeat === foe) {
      const head = r.y < headLineY();
      const bounce = Math.pow(0.5, r.bounces ?? 0);
      return 1000 * bounce + (head ? (this.profile.aimHead ? 500 : 50) : 0);
    }
    if (r.kind === 'character') return -2000; // 打到自己
    if (r.kind === 'out') return -1500;
    return -Math.abs(r.x - foeX) - (r.kind === 'defense' ? 0 : 50);
  }

  // ------------------------------------------------------------ 放防禦道具

  private doPlace(turnId: number): void {
    const def = getItem(this.battle.turnView().chosenItemId ?? '') as DefenseDef | undefined;
    if (!def || def.kind !== 'defense') return;
    const st = this.battle.state;
    const x0 = st.physics.getCharX(this.seat);
    const dir = this.seat === 0 ? 1 : -1;
    const G = ARENA.groundY;
    const cands: [number, number][] = [];
    if (def.wearable) cands.push([x0, G - 150 - def.size.h / 2 - 8]); // 鋼盔戴頭上
    // 擋在自己前面（往對手方向），太近被打倒會壓到自己，所以放遠一點
    const near = this.profile.smart >= 0.85 ? [170, 210, 250, 140, 290] : [120 + Math.random() * 200, 160, 220, 260];
    for (const dx of near) cands.push([x0 + dir * dx, G - def.size.h / 2 - 2]);
    // 疊在現有道具上面
    for (const d of st.defenses.filter((x) => x.owner === this.seat)) cands.push([d.x, d.y - d.h / 2 - def.size.h / 2 - 4]);
    for (const [x, y] of cands) {
      if (!validatePlacement(st, this.seat, def, Math.round(x), Math.round(y))) {
        this.battle.placeDefense(this.seat, turnId, Math.round(x), Math.round(y));
        return;
      }
    }
  }
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
