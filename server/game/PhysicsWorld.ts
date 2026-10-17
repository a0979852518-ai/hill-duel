// ============================================================
// 物理世界（Matter.js，只在伺服器上跑）
// ------------------------------------------------------------
// - 地面是固定的；角色平常固定，被打中時變成會翻滾彈跳的剛體被打飛，停下後站起來；
//   防禦道具是會掉落、堆疊、被撞歪的剛體。
// - 每次有東西動（放置、投擲、道具被移除）就在伺服器模擬到靜止，
//   把每一格的位置記下來（PhysicsFrames）傳給雙方播放，所以兩邊畫面一定一致。
// - 世界在整場戰鬥中持續存在，防禦道具的位置與角度會一直保留。
// ============================================================

import Matter from 'matter-js';
import { ARENA, DEFENSE_HIT, KNOCKBACK, PHYSICS } from '../../shared/config/game.js';
import type { DefenseDef, ThrowableDef } from '../../shared/config/items.js';
import { launchPoint } from '../../shared/physics.js';
import { sideDir, teamOf, type ImpactKind, type PhysicsFrames, type Seat } from '../../shared/types.js';
import { xRangeOf } from '../../shared/physics.js';

const { Engine, Bodies, Body, Bounds, Composite, Events, Query, Sleeping } = Matter;

// 碰撞分類（bit）：讓投擲物不會撞到「自己隊伍」的防禦道具、出手瞬間不會撞到自己
const CAT = {
  world: 0x0001,
  proj: 0x0020,
  /** 被打飛、翻滾中的角色 */
  tumble: 0x0040,
  /** 只擋翻滾角色的隱形邊界 */
  bound: 0x0080,
} as const;
/** 角色（座位 0~3）：0x0100、0x0200、0x0400、0x0800 */
const charCat = (seat: number) => 0x0100 << seat;
/** 防禦道具（依隊伍）：0x0002、0x0004 */
const defCat = (team: number) => 0x0002 << team;
const ALL_CHARS = 0x0f00;

/** 翻滾身體：寬 × 高（膠囊形，圓角讓它會滾） */
const TUMBLE = { w: 44, h: 150, r: 20 };

const STEP_MS = ARENA.physicsStep * 1000;
const r1 = (n: number) => Math.round(n * 10) / 10;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

interface DefenseBodyInfo {
  body: any;
  owner: Seat;
  /** 穿戴型（鋼盔）：不被額外推、不壓人、不跟著被打飛 */
  wearable: boolean;
  /** 圖片中心相對剛體質心的偏移（剛體角度為 0 時） */
  offset: { x: number; y: number };
  def: DefenseDef;
}

/**
 * 擊退中的角色：
 *  tumble 剛體被打飛、在空中翻、落地彈跳（Matter 模擬）
 *  roll   躺在地上往被推的方向滾幾個半圈（側面看＝身體翻面），最後趴著
 *  lie    趴著停一下
 *  getup  撐起來站好
 */
/** [腳底x, 腳底y-地面, 角度, 身體翻面(1~-1), 連續動作第幾張(0 = 一般姿勢, 1~5 = 被打飛的圖)] */
type Pose5 = [number, number, number, number, number];

/**
 * 被打飛連續動作圖的大小（相對站姿高度）與頭的位置（相對圖片框，往左被打飛的方向；往右時左右鏡像），
 * 用來讓頭上的鋼盔跟著頭走。
 */
const KNOCK_FRAMES: Record<number, { w: number; h: number; hx: number; hy: number; ha: number }> = {
  1: { w: 0.64, h: 1, hx: 0.15, hy: 0.1, ha: 0 },
  2: { w: 0.8, h: 0.85, hx: 0.13, hy: 0.13, ha: -0.3 },
  3: { w: 0.55, h: 0.74, hx: 0.38, hy: 0.86, ha: Math.PI },
  4: { w: 0.5, h: 0.66, hx: 0.16, hy: 0.77, ha: Math.PI },
  5: { w: 0.83, h: 0.44, hx: 0.12, hy: 0.48, ha: -Math.PI / 2 },
};
const STAND_H = 150;
interface KnockState {
  seat: Seat;
  body: any;
  phase: 'tumble' | 'roll' | 'lie' | 'getup';
  t: number;
  restSteps: number;
  /** 往哪邊被推（-1 / 1） */
  away: number;
  /** 往前飛（打到自己）：動作圖要左右鏡像 */
  rev: boolean;
  /** 「移動」：直立跳過去，落地就站好 */
  leap: boolean;
  /** 擊退初速（決定在地上滾幾圈） */
  speed: number;
  /** 翻滾結束時身體中心 */
  com: { x: number; y: number };
  /** 翻滾結束時的角度（已換成 -π~π）與躺平的目標角度 */
  angle0: number;
  lieAngle: number;
  /** 在地上滾幾個半圈 */
  halfRolls: number;
  /** 進入起身階段時的姿勢 */
  from: Pose5;
  /** 站起來的腳底 x */
  endX: number;
  /** 被打死了就不起來 */
  stayDown: boolean;
  done: boolean;
  /** 曾經離開地面 */
  airborne: boolean;
  /** 戴在頭上的穿戴型道具（鋼盔）：跟著身體一起翻滾，最後還戴在頭上 */
  worn: { body: any; rx: number; ry: number; a0: number }[];
  /** 每格 [腳底x, 腳底y-地面, 角度, 身體左右翻面(1 ~ -1)] */
  frames: Pose5[];
  /** 開始躺 / 睡飽要起來時是第幾格（竹竿睡覺回血） */
  sleepFrame?: number;
  wakeFrame?: number;
}

/** 擊退參數（由 Combat 依打點與投擲物算出） */
export interface KnockRequest {
  seat: Seat;
  /** 初速（像素/秒） */
  vx: number;
  vy: number;
  /** 角速度（弧度/秒，正 = 順時針） */
  omega: number;
  stayDown: boolean;
  /** 擊退初速大小（像素/秒） */
  speed: number;
  /** 往哪邊飛（-1 / 1）；沒給就是往自己身後（打到自己時可能往前飛） */
  away?: number;
  /** 「移動」道具：自己跳出去，身體保持直立、落地就站好 */
  leap?: boolean;
}

export interface ThrowImpact {
  kind: ImpactKind;
  x: number;
  y: number;
  defenseUid?: string;
  hitSeat?: Seat;
  /** 命中前在地上彈了幾次（每彈一次傷害減半） */
  bounces?: number;
}

export class PhysicsWorld {
  private engine: any;
  private defs = new Map<string, DefenseBodyInfo>();

  private chars: any[] = [];
  /** 角色腳底 x（依座位） */
  private charX: number[];

  /** 角色身體大小倍率（連恩 2/3） */
  private readonly cs: number[];
  /** 陣亡、已經從場上移除的角色（2v2） */
  private gone: boolean[];

  constructor(startX: number[] = [ARENA.characterStartX[0], ARENA.characterStartX[1]], charScale: number[] = startX.map(() => 1)) {
    this.charX = [...startX];
    this.cs = [...charScale];
    this.gone = startX.map(() => false);
    this.extraLie = startX.map(() => 0);
    this.engine = Engine.create({
      gravity: { x: 0, y: 1, scale: ARENA.gravity / 1e6 },
      enableSleeping: true,
      positionIterations: 8,
      velocityIterations: 6,
    });
    const W = ARENA.world.width;
    const G = ARENA.groundY;
    const worldOpts = {
      isStatic: true,
      friction: PHYSICS.ground.friction,
      restitution: PHYSICS.ground.restitution,
      collisionFilter: { category: CAT.world, mask: 0xffff },
    };
    const statics: any[] = [
      // 地面往兩邊延伸很遠：沒有地圖邊界，東西不會掉下去
      Bodies.rectangle(W / 2, G + 100, 60000, 200, { ...worldOpts, label: 'ground' }),
      // 隱形邊界：只擋翻滾中的角色（投擲物、道具都會穿過去）
      ...[ARENA.characterXRange[0][0] - 220, ARENA.characterXRange[1][1] + 220].map((bx) =>
        Bodies.rectangle(bx, G - 1500, 40, 3000, { isStatic: true, label: 'bound', friction: 0.1, restitution: 0, collisionFilter: { category: CAT.bound, mask: CAT.tumble } }),
      ),
    ];
    for (const seat of this.seats()) {
      const x = this.charX[seat];
      const cb = ARENA.characterBody;
      const s = this.cs[seat];
      const torso = Bodies.rectangle(x, G - (cb.torsoH * s) / 2, cb.torsoW * s, cb.torsoH * s, { label: `char${seat}` });
      const head = Bodies.circle(x, G + cb.headY * s, cb.headR * s, { label: `char${seat}` });
      const body = Body.create({
        parts: [torso, head],
        isStatic: true,
        label: `char${seat}`,
        friction: 0.9,
        collisionFilter: { category: charCat(seat), mask: 0xffff & ~CAT.bound },
      });
      this.chars[seat] = body;
      statics.push(body);
    }
    Composite.add(this.engine.world, statics);
  }

  /**
   * 複製一份目前的物理世界（角色位置＋所有防禦道具的位置與角度），
   * 給 AI 試算投擲用，不會影響真正的戰場。
   */
  clone(): PhysicsWorld {
    const w = new PhysicsWorld(this.charX, this.cs);
    w.extraLie = [...this.extraLie];
    for (const s of this.seats()) if (this.gone[s]) w.removeChar(s);
    for (const [uid, info] of this.defs) {
      w.addDefense(uid, info.def, info.owner, info.body.position.x + info.offset.x, info.body.position.y + info.offset.y);
      const nb = w.defs.get(uid)!.body;
      Body.setPosition(nb, { x: info.body.position.x, y: info.body.position.y }, false);
      Body.setAngle(nb, info.body.angle, false);
      Sleeping.set(nb, true);
    }
    return w;
  }

  /** 所有座位 */
  seats(): Seat[] {
    return this.charX.map((_, i) => i as Seat);
  }

  /** 陣亡的角色從物理世界移除（之後東西不會撞到他） */
  removeChar(seat: Seat): void {
    if (this.gone[seat]) return;
    this.gone[seat] = true;
    Composite.remove(this.engine.world, this.chars[seat]);
    this.wakeDefenses();
  }

  isGone(seat: Seat): boolean {
    return this.gone[seat];
  }

  /** 倒地後多躺幾毫秒（竹竿睡覺） */
  private extraLie: number[];
  setExtraLie(seat: Seat, ms: number): void {
    this.extraLie[seat] = ms;
  }

  getCharScale(seat: Seat): number {
    return this.cs[seat];
  }

  getCharX(seat: Seat): number {
    return this.charX[seat];
  }

  private wakeDefenses(): void {
    // 叫醒道具，讓被角色推到或頭上頂著的東西有反應
    for (const info of this.defs.values()) Sleeping.set(info.body, false);
  }

  // ------------------------------------------------------------ 防禦道具

  private buildDefenseBody(def: DefenseDef, owner: Seat, x: number, y: number): DefenseBodyInfo {
    const { w, h } = def.size;
    const opts = {
      friction: def.friction ?? PHYSICS.defense.friction,
      // 靜摩擦低一點：疊起來被撞時容易滑開、垮掉
      frictionStatic: def.wearable ? 0.8 : PHYSICS.defense.frictionStatic,
      restitution: PHYSICS.defense.restitution,
      // 穿戴型維持比較穩的舊物理（空氣阻力大一點，戴在頭上不容易晃掉）
      frictionAir: def.wearable ? 0.01 : PHYSICS.defense.frictionAir,
      density: def.density ?? PHYSICS.defense.density,
      collisionFilter: { category: defCat(teamOf(owner)), mask: 0xffff },
    };
    let body: any;
    if (def.body?.kind === 'helmet') {
      // 倒 U 形：上蓋＋左右兩側，中間下方是空的凹槽
      const { wall, cap } = def.body;
      const top = y - h / 2;
      const capPart = Bodies.rectangle(x, top + cap / 2, w * 0.86, cap, { chamfer: { radius: [cap / 2, cap / 2, 0, 0] } });
      const wallH = h - cap / 2;
      const wallY = top + cap / 2 + wallH / 2;
      const left = Bodies.rectangle(x - w / 2 + wall / 2, wallY, wall, wallH);
      const right = Bodies.rectangle(x + w / 2 - wall / 2, wallY, wall, wallH);
      body = Body.create({ parts: [capPart, left, right], ...opts });
    } else {
      // 圓角大一點：底部接觸面小，疊起來比較會晃、容易倒
      body = Bodies.rectangle(x, y, w, h, { ...opts, chamfer: { radius: Math.min(w, h) * PHYSICS.defense.cornerRound } });
    }
    // 圖片中心（x,y）相對質心的偏移
    const offset = { x: x - body.position.x, y: y - body.position.y };
    return { body, owner, offset, wearable: !!def.wearable, def };
  }

  /** 這個位置放得下嗎（不能跟現有的東西重疊） */
  canPlace(def: DefenseDef, owner: Seat, x: number, y: number): boolean {
    const info = this.buildDefenseBody(def, owner, x, y);
    const others = Composite.allBodies(this.engine.world);
    return Query.collides(info.body, others).length === 0;
  }

  addDefense(uid: string, def: DefenseDef, owner: Seat, x: number, y: number): void {
    const info = this.buildDefenseBody(def, owner, x, y);
    info.body.label = `def:${uid}`;
    this.defs.set(uid, info);
    Composite.add(this.engine.world, info.body);
  }

  removeDefense(uid: string): void {
    const info = this.defs.get(uid);
    if (!info) return;
    Composite.remove(this.engine.world, info.body);
    this.defs.delete(uid);
    // 叫醒其他東西，讓上面的東西會掉下來
    for (const other of this.defs.values()) Sleeping.set(other.body, false);
  }

  /** 防禦道具目前的圖片中心與角度 */
  pose(uid: string): { x: number; y: number; angle: number } | null {
    const info = this.defs.get(uid);
    if (!info) return null;
    const b = info.body;
    const c = Math.cos(b.angle),
      s = Math.sin(b.angle);
    return {
      x: r1(b.position.x + info.offset.x * c - info.offset.y * s),
      y: r1(b.position.y + info.offset.x * s + info.offset.y * c),
      angle: r3(b.angle),
    };
  }

  // ------------------------------------------------------------ 擊退

  /** 把固定的角色身體藏到地底（翻滾期間由翻滾身體取代；頭上的東西會掉下來） */
  private hideChar(seat: Seat, hidden: boolean): void {
    const body = this.chars[seat];
    const dy = hidden ? 4000 : -4000;
    // 不要帶速度：固定物體瞬移 4000px 如果算成速度，碰到的東西會被彈飛
    Body.setPosition(body, { x: body.position.x, y: body.position.y + dy }, false);
    Body.setVelocity(body, { x: 0, y: 0 });
    this.wakeDefenses();
  }

  private startKnock(req: KnockRequest, frames: PhysicsFrames): KnockState {
    const { seat } = req;
    const x = this.charX[seat];
    const G = ARENA.groundY;
    // 戴在頭上的鋼盔：先從物理世界拿出來，翻滾時跟著頭走
    const worn: KnockState['worn'] = [];
    for (const info of this.defs.values()) {
      const p = info.body.position;
      const s = this.cs[seat];
      if (info.wearable && Math.abs(p.x - x) < 55 * s && p.y < G - 105 * s && p.y > G - 240 * s) {
        worn.push({ body: info.body, rx: p.x - x, ry: p.y - G, a0: info.body.angle });
        Composite.remove(this.engine.world, info.body);
      }
    }
    this.hideChar(seat, true);
    // 戴在頭上/靠在身上的東西跟著被打飛（自己跳開的話就不會）
    for (const info of req.leap ? [] : this.defs.values()) {
      const p = info.body.position;
      if (!info.wearable && Math.abs(p.x - x) < 70 && p.y < G - 20 && p.y > G - 260 * this.cs[seat]) {
        Body.setVelocity(info.body, { x: (req.vx * 0.7) / 60, y: (req.vy * 0.6 - 180) / 60 });
        Body.setAngularVelocity(info.body, (req.omega * 0.8 + (req.vx > 0 ? 3 : -3)) / 60);
      }
    }
    const ts = this.tumbleSize(seat);
    const body = Bodies.rectangle(x, G - ts.h / 2 - 0.5, ts.w, ts.h, {
      chamfer: { radius: ts.r },
      label: `tumble${seat}`,
      friction: KNOCKBACK.friction,
      frictionStatic: KNOCKBACK.friction * 1.3,
      restitution: KNOCKBACK.restitution,
      density: KNOCKBACK.density,
      frictionAir: 0.004,
      // 被打飛的人會撞到敵隊的人（不會撞到隊友，免得卡在隊友身上）
      collisionFilter: { category: CAT.tumble, mask: CAT.world | CAT.bound | this.enemyChars(seat) },
    });
    if (req.leap) {
      // 跳躍：不會轉，撞得到其他人（落在別人身上）
      Body.setInertia(body, Infinity);
      body.collisionFilter.mask = CAT.world | CAT.bound | (ALL_CHARS & ~charCat(seat));
    }
    Body.setVelocity(body, { x: req.vx / 60, y: req.vy / 60 });
    Body.setAngularVelocity(body, req.omega / 60);
    Composite.add(this.engine.world, body);
    const k: KnockState = {
      seat,
      body,
      phase: 'tumble',
      t: 0,
      restSteps: 0,
      away: req.away ?? -sideDir(seat),
      rev: !req.leap && (req.away ?? -sideDir(seat)) !== -sideDir(seat),
      leap: !!req.leap,
      speed: req.speed,
      com: { x, y: G - ts.h / 2 },
      angle0: 0,
      lieAngle: 0,
      halfRolls: 0,
      from: [x, 0, 0, 1, 0],
      endX: x,
      stayDown: req.stayDown,
      done: false,
      airborne: false,
      worn,
      // 補齊命中前的影格（站著不動）
      frames: Array.from({ length: frames.count }, () => [x, 0, 0, 1, 0] as Pose5),
    };
    frames.c ??= {};
    frames.c[String(seat) as '0' | '1'] = k.frames;
    return k;
  }

  /** 敵隊所有角色的碰撞分類 */
  private enemyChars(seat: Seat): number {
    let m = 0;
    for (const s of this.seats()) if (teamOf(s) !== teamOf(seat)) m |= charCat(s);
    return m;
  }

  /** 翻滾身體大小（矮的角色比較小） */
  private tumbleSize(seat: Seat): { w: number; h: number; r: number } {
    const s = this.cs[seat];
    return { w: TUMBLE.w * s, h: TUMBLE.h * s, r: TUMBLE.r * s };
  }

  /** 由身體中心、角度換算成 [腳底x, 腳底y-地面, 角度, 翻面] */
  private poseFromCom(cx: number, cy: number, a: number, flip: number, frame = 0, half = TUMBLE.h / 2): Pose5 {
    return [cx - Math.sin(a) * half, cy + Math.cos(a) * half - ARENA.groundY, a, flip, frame];
  }

  private stepKnock(k: KnockState, dt: number): void {
    if (k.done) return;
    this.stepKnockInner(k, dt);
    this.updateWorn(k);
    if (k.done) this.releaseWorn(k);
  }

  /** 鋼盔跟著頭：腳底位置＋身體旋轉後的相對位置 */
  private updateWorn(k: KnockState): void {
    if (!k.worn.length) return;
    const pose: Pose5 = k.done ? [k.endX, 0, 0, 1, 0] : this.knockPose(k);
    const head = this.headOf(k, pose);
    if (head) {
      // 縮成一團滾 / 躺著：鋼盔貼在頭上
      for (const w of k.worn) {
        Body.setPosition(w.body, { x: head[0], y: head[1] }, false);
        Body.setAngle(w.body, head[2], false);
      }
      return;
    }
    const [fx, fy, a] = pose;
    const c = Math.cos(a),
      sn = Math.sin(a);
    for (const w of k.worn) {
      Body.setPosition(w.body, { x: fx + w.rx * c - w.ry * sn, y: ARENA.groundY + fy + w.rx * sn + w.ry * c }, false);
      Body.setAngle(w.body, w.a0 + a, false);
    }
  }

  /** 結束後把鋼盔放回物理世界（站起來了就還戴在頭上） */
  private releaseWorn(k: KnockState): void {
    if (!k.worn.length) return;
    this.updateWorn(k);
    for (const w of k.worn) {
      Body.setVelocity(w.body, { x: 0, y: 0 });
      Body.setAngularVelocity(w.body, 0);
      Composite.add(this.engine.world, w.body);
    }
    k.worn = [];
  }

  private stepKnockInner(k: KnockState, dt: number): void {
    k.t += dt;
    const range = xRangeOf(k.seat);
    if (k.leap) {
      const b = k.body;
      // 快到可移動範圍的邊緣就煞車（跟被打飛一樣）
      const edge = b.velocity.x < 0 ? range[0] : range[1];
      const dirX = Math.sign(b.velocity.x);
      const toEdge = (edge - b.position.x) * dirX;
      if (dirX !== 0 && toEdge < 200) Body.setVelocity(b, { x: (Math.max(0, toEdge * 3) / 60) * dirX, y: b.velocity.y });
      const ts = this.tumbleSize(k.seat);
      const lowest = b.position.y + ts.h / 2;
      if (lowest < ARENA.groundY - 6) k.airborne = true;
      const landed = k.airborne && lowest >= ARENA.groundY - 3 && b.velocity.y >= -0.2;
      if (landed || (!k.airborne && k.t > 0.35) || k.t > 3) {
        k.endX = Math.min(range[1], Math.max(range[0], b.position.x));
        Composite.remove(this.engine.world, b);
        this.moveCharHidden(k.seat, k.endX);
        this.hideChar(k.seat, false);
        k.done = true;
      }
      return;
    }
    if (k.phase === 'tumble') {
      const b = k.body;
      // 快到可移動範圍的邊緣：往外的速度慢慢被吃掉（像地面變黏），不會撞到隱形牆
      const edge = k.away < 0 ? range[0] : range[1];
      const toEdge = (edge - b.position.x) * k.away;
      if (toEdge < 400 && b.velocity.x * k.away > 0) {
        // 越接近邊緣，往外的速度上限越低（距離 × 3 像素/秒），一定在邊緣前停下，不會撞牆彈回來
        const vmax = Math.max(0, toEdge * 3) / 60;
        const vx = Math.min(Math.abs(b.velocity.x), vmax) * k.away;
        Body.setVelocity(b, { x: vx, y: b.velocity.y });
      }
      const slow = b.speed < 0.08 && Math.abs(b.angularVelocity) < 0.004;
      k.restSteps = slow || b.isSleeping ? k.restSteps + 1 : 0;
      // 身體最低點離地多高（直立時是腳、躺著時是背）
      const ts = this.tumbleSize(k.seat);
      const lowest = b.position.y + Math.abs(Math.cos(b.angle)) * (ts.h / 2) + Math.abs(Math.sin(b.angle)) * (ts.w / 2);
      if (lowest < ARENA.groundY - 10) k.airborne = true;
      const landed = k.airborne && lowest >= ARENA.groundY - 4 && b.velocity.y >= -0.5;
      // 落地那一刻就接著在地上滾（不要先在地上慢慢滑到停才開始滾）；
      // 沒被打離地的話，倒下去（傾斜超過 60°）就開始滾
      const fallen = !k.airborne && (Math.abs(Math.sin(b.angle)) > 0.85 || k.t > 0.45);
      if (landed || fallen || k.restSteps > 12 || k.t * 1000 > KNOCKBACK.maxTumbleMs) {
        // 落地時還剩多少水平速度 → 決定滾幾圈
        k.speed = Math.max(k.speed * 0.45, Math.abs(b.velocity.x) * 60);
        k.com = { x: b.position.x, y: b.position.y };
        k.angle0 = Math.atan2(Math.sin(b.angle), Math.cos(b.angle));
        Composite.remove(this.engine.world, b);
        // 躺平的角度：往哪邊倒比較近就倒哪邊（±90°）
        k.lieAngle = k.angle0 >= 0 ? Math.PI / 2 : -Math.PI / 2;
        // 力道越大在地上滾越多圈（每個半圈會彈一下）
        let n = k.speed > 700 ? 6 : k.speed > 500 ? 5 : k.speed > 320 ? 4 : 3;
        // 滾不出可移動範圍
        const maxRoll = k.away < 0 ? k.com.x - range[0] : range[1] - k.com.x;
        while (n > 0 && n * this.rollStep() > maxRoll) n--;
        k.halfRolls = n;
        k.phase = 'roll';
        k.t = 0;
      }
      return;
    }
    if (k.phase === 'roll') {
      if (k.t * 1000 >= this.rollMs(k)) {
        k.from = this.knockPose(k);
        k.endX = Math.min(range[1], Math.max(range[0], k.com.x + k.away * k.halfRolls * this.rollStep()));
        k.from = [k.endX, 0, 0, 1, 5];
        k.phase = 'lie';
        k.t = 0;
      }
      return;
    }
    if (k.phase === 'lie') {
      if (k.sleepFrame === undefined) k.sleepFrame = k.frames.length;
      if (k.stayDown) {
        // 被打倒（血量歸零）就趴著
        this.moveCharHidden(k.seat, k.endX);
        k.done = true;
        return;
      }
      if (k.t * 1000 >= KNOCKBACK.lieMs + this.extraLie[k.seat]) {
        if (this.extraLie[k.seat] > 0) k.wakeFrame = k.frames.length;
        k.phase = 'getup';
        k.t = 0;
      }
      return;
    }
    if (k.t * 1000 >= KNOCKBACK.getupMs) {
      this.moveCharHidden(k.seat, k.endX);
      this.hideChar(k.seat, false);
      k.done = true;
    }
  }

  /** 每滾半圈前進多少（人不是圓柱，比身體厚度的半圓周短一些） */
  private rollStep(): number {
    return KNOCKBACK.rollStep;
  }

  /** 在地上滾的總時間（越滾越慢） */
  private rollMs(k: KnockState): number {
    let ms = 40; // 落地後馬上開始滾
    for (let i = 0; i < k.halfRolls; i++) ms += KNOCKBACK.rollHalfMs * (1 + i * 0.25);
    return ms;
  }

  /** 角色還藏在地底時更新它的 x */
  private moveCharHidden(seat: Seat, x: number): void {
    const body = this.chars[seat];
    Body.setPosition(body, { x: body.position.x + (x - this.charX[seat]), y: body.position.y }, false);
    Body.setVelocity(body, { x: 0, y: 0 });
    this.charX[seat] = x;
  }

  private knockPose(k: KnockState): Pose5 {
    const G = ARENA.groundY;
    if (k.leap) return k.done ? [k.endX, 0, 0, 1, 0] : this.poseFromCom(k.body.position.x, k.body.position.y, 0, 1, 0, this.tumbleSize(k.seat).h / 2);
    if (k.phase === 'tumble') return this.poseFromCom(k.body.position.x, k.body.position.y, k.body.angle, 1, k.t < 0.12 ? 1 : 2, this.tumbleSize(k.seat).h / 2);
    if (k.phase === 'roll') {
      // 縮成一團在地上往後滾（圖 3、4 交替，整團跟著轉），每滾半圈彈一下
      const ms = k.t * 1000;
      let progress = 0; // 已經滾了幾個半圈（含小數）
      let left = ms - 40;
      let hop = 0;
      for (let i = 0; i < k.halfRolls && left > 0; i++) {
        const d = KNOCKBACK.rollHalfMs * (1 + i * 0.25);
        const f = Math.min(1, left / d);
        progress += f;
        if (f < 1) hop = Math.sin(Math.PI * f) * KNOCKBACK.rollHop * (1 - i / (k.halfRolls + 1));
        left -= d;
      }
      const frame = Math.floor(progress) % 2 === 0 ? 3 : 4;
      const half = (KNOCK_FRAMES[frame].h * STAND_H * this.cs[k.seat]) / 2;
      const cx = k.com.x + k.away * progress * this.rollStep();
      const cy = G - half - hop;
      const a = k.away * Math.PI * progress;
      return this.poseFromCom(cx, cy, a, 1, frame, half);
    }
    if (k.phase === 'lie' || k.stayDown || (k.done && k.stayDown)) return k.from;
    if (k.done) return [k.endX, 0, 0, 1, 0];
    // 起身：坐起來（圖 2）→ 搖搖晃晃（圖 1）→ 站好
    const f = Math.min(1, k.t / (KNOCKBACK.getupMs / 1000));
    const frame = f < 0.4 ? 2 : f < 0.75 ? 1 : 0;
    const bob = f < 0.4 ? 0 : -Math.sin(Math.PI * Math.min(1, (f - 0.4) / 0.35)) * 6;
    return [k.endX, bob, 0, 1, frame];
  }

  /** 鋼盔要放在頭的哪裡：[x, y, 角度] */
  private headOf(k: KnockState, p: Pose5): [number, number, number] | null {
    const frame = p[4];
    if (frame < 3) return null; // 站著/往後倒時用一般的頭部位置
    const f = KNOCK_FRAMES[frame];
    const w = f.w * STAND_H * this.cs[k.seat],
      h = f.h * STAND_H * this.cs[k.seat];
    // 圖是「往左被打飛」的方向，往右時鏡像
    const hx = k.away < 0 ? f.hx : 1 - f.hx;
    const lx = (hx - 0.5) * w,
      ly = -(1 - f.hy) * h;
    const c = Math.cos(p[2]),
      s = Math.sin(p[2]);
    return [p[0] + lx * c - ly * s, ARENA.groundY + p[1] + lx * s + ly * c, p[2] + (k.away < 0 ? f.ha : -f.ha)];
  }

  private recordKnock(k: KnockState, frames: PhysicsFrames): void {
    // record() 已經把 frames.count +1，這裡補上同一格
    const p = this.knockPose(k);
    // 往前飛（打到自己）：整個身體左右鏡像，動作圖才會是「往飛的方向倒」
    const flip = k.rev && (!k.done || k.stayDown) ? -1 : 1;
    while (k.frames.length < frames.count) k.frames.push([r1(p[0]), r1(p[1]), r3(p[2]), r3(p[3] * flip), p[4]]);
  }

  // ------------------------------------------------------------ 模擬

  private newFrames(): PhysicsFrames {
    return { sampleMs: Math.round(STEP_MS * ARENA.frameEvery * 100) / 100, count: 0, d: {}, gone: {} };
  }

  /** 記錄一格：只記會動或剛動過的防禦道具 */
  private record(frames: PhysicsFrames, last: Map<string, string>, proj?: any): void {
    const i = frames.count;
    for (const uid of this.defs.keys()) {
      const p = this.pose(uid)!;
      const key = `${p.x},${p.y},${p.angle}`;
      if (!frames.d[uid]) {
        if (last.get(uid) === key) continue;
        // 第一次動：補上前面靜止的格數
        const prev = last.get(uid)?.split(',').map(Number) as [number, number, number] | undefined;
        frames.d[uid] = Array.from({ length: i }, () => prev ?? [p.x, p.y, p.angle]);
      }
      frames.d[uid].push([p.x, p.y, p.angle]);
      last.set(uid, key);
    }
    if (proj) {
      frames.p ??= [];
      frames.p.push([r1(proj.position.x), r1(proj.position.y), r3(proj.angle)]);
    }
    frames.count++;
  }

  private snapshotPoses(): Map<string, string> {
    const m = new Map<string, string>();
    for (const uid of this.defs.keys()) {
      const p = this.pose(uid)!;
      m.set(uid, `${p.x},${p.y},${p.angle}`);
    }
    return m;
  }

  private allAtRest(): boolean {
    for (const info of this.defs.values()) {
      const b = info.body;
      if (b.isSleeping) continue;
      if (b.speed > 0.06 || Math.abs(b.angularSpeed) > 0.004) return false;
    }
    return true;
  }

  /** 掉出場外的防禦道具 → 移除並回傳 uid */
  private removeFallen(frames: PhysicsFrames): string[] {
    const out: string[] = [];
    for (const [uid, info] of this.defs) {
      // 沒有地圖邊界：只有真的掉到地底下（理論上不會）才移除
      if (info.body.position.y > PHYSICS.killY) out.push(uid);
    }
    for (const uid of out) {
      frames.gone[uid] = frames.count;
      this.removeDefense(uid);
    }
    return out;
  }

  /**
   * 讓世界自然落定（放置後、道具被移除後）。
   * @returns 動畫影格與掉出場外的道具
   */
  settle(maxMs: number = PHYSICS.settleMaxMs): { frames: PhysicsFrames; fell: string[] } {
    const frames = this.newFrames();
    const last = this.snapshotPoses();
    const fell: string[] = [];
    let restSteps = 0;
    const maxSteps = Math.ceil(maxMs / STEP_MS);
    for (let step = 1; step <= maxSteps; step++) {
      Engine.update(this.engine, STEP_MS);
      if (step % ARENA.frameEvery === 0) {
        this.record(frames, last);
        fell.push(...this.removeFallen(frames));
      }
      restSteps = this.allAtRest() ? restSteps + 1 : 0;
      if (restSteps > 24) break;
    }
    fell.push(...this.removeFallen(frames));
    return { frames, fell };
  }

  /**
   * 投擲：投擲物從出手點飛出，第一次碰到東西就算命中，
   * 之後繼續彈跳一下、被撞到的防禦道具繼續倒，直到靜止。
   * @param onImpact 命中當下呼叫，回傳：被打壞的防禦道具 uid（不會立刻消失，
   *                 會繼續倒、等全部靜止才移除）、以及要被擊退的角色
   * @returns crushes：被打倒的防禦道具壓到角色（第幾格、壓到誰）
   */
  throwProjectile(
    seat: Seat,
    item: ThrowableDef,
    angleDeg: number,
    power: number,
    onImpact: (impact: ThrowImpact, impactSpeed: number, impactVel: { x: number; y: number }) => { remove: string[]; knock?: KnockRequest },
    opts: { stopAtImpact?: boolean } = {},
  ): {
    frames: PhysicsFrames;
    impactFrame: number;
    impact: ThrowImpact;
    fell: string[];
    impactSpeed: number;
    crushes: { seat: Seat; uid: string; frame: number }[];
    /** 投擲物在地上彈跳的格數（客戶端冒灰塵） */
    bounceFrames: number[];
    /** 竹竿倒地睡覺：開始躺、睡飽起來的格數 */
    knockSleep?: { seat: Seat; sleepFrame: number; wakeFrame: number };
  } {
    // 落地不算結束：繼續彈跳/滾動，之後打到人或防禦道具仍然算命中（傷害依彈跳次數減半）
    let groundHits = 0;
    let firstGroundStep = -1;
    const bounceFrames: number[] = [];
    const frames = this.newFrames();
    const G = ARENA.groundY;
    // 被打壞、還在倒的防禦道具（全部靜止後才移除）
    const dying = new Set<string>();
    // 一開始就戴在頭上/靠在身上的道具：晃動碰到不算「壓到」
    const wornBy: Set<string>[] = this.seats().map(() => new Set<string>());
    for (const [uid, info] of this.defs) {
      for (const s of this.seats()) {
        const p = info.body.position;
        // 穿戴型道具（鋼盔）永遠不算壓到人
        if (info.wearable || (Math.abs(p.x - this.charX[s]) < 60 && p.y < G - 60 * this.cs[s])) wornBy[s].add(uid);
      }
    }
    const crushes: { seat: Seat; uid: string; frame: number }[] = [];
    const startAngle = new Map<string, number>();
    for (const [uid, info] of this.defs) startAngle.set(uid, info.body.angle);
    const crushed = new Set<string>();
    const last = this.snapshotPoses();
    const dir = sideDir(seat);
    const lp = launchPoint(seat, this.charX[seat], this.cs[seat]);
    const p = Math.min(1, Math.max(0, power));
    const speed = item.minSpeed + (item.maxSpeed - item.minSpeed) * p; // px/s
    const rad = (angleDeg * Math.PI) / 180;
    // 每個投擲物可以有自己的重力倍率：用額外的力模擬
    const extraG = (item.gravityScale - 1) * (ARENA.gravity / 1e6);

    const proj = Bodies.circle(lp.x, lp.y, item.radius, {
      ...PHYSICS.projectile,
      frictionAir: item.frictionAir ?? PHYSICS.projectile.frictionAir,
      label: 'proj',
      collisionFilter: {
        category: CAT.proj,
        // 一開始只撞得到對手（出手點在自己身上）；離開自己的身體後才會打到自己。
        // 自己的防禦道具永遠撞不到。
        // 隊友也打得到；同隊的防禦道具碰不到
        mask: CAT.world | (ALL_CHARS & ~charCat(seat)) | defCat(1 - teamOf(seat)),
      },
    });
    const selfCat = charCat(seat);
    let selfArmed = false;
    Body.setVelocity(proj, { x: (Math.cos(rad) * speed * dir) / 60, y: (-Math.sin(rad) * speed) / 60 });
    Body.setAngularVelocity(proj, (item.spin ?? 0.25) * dir);
    Composite.add(this.engine.world, proj);

    let impact: ThrowImpact | null = null;
    let impactFrame = -1;
    let impactSpeed = 0;
    const onCollide = (ev: any) => {
      for (const pair of ev.pairs) {
        const a = pair.bodyA.parent,
          b = pair.bodyB.parent;
        // 被打倒的防禦道具壓到角色：道具從上方、夠快地撞上身體
        const la: string = a.label ?? '',
          lb: string = b.label ?? '';
        const defB = la.startsWith('def:') ? a : lb.startsWith('def:') ? b : null;
        const charB = /^char\d$/.test(la) ? a : /^char\d$/.test(lb) ? b : null;
        if (impact && defB && charB) {
          const uid = (defB.label as string).slice(4);
          const s = Number((charB.label as string).slice(4)) as Seat;
          const contact = pair.collision?.supports?.[0] ?? defB.position;
          // 接觸點的速度（質心速度＋旋轉造成的速度）：倒下來的道具上端比質心快很多
          const w = defB.angularVelocity * 60;
          const rx = contact.x - defB.position.x,
            ry = contact.y - defB.position.y;
          const pvx = defB.velocity.x * 60 - w * ry,
            pvy = defB.velocity.y * 60 + w * rx;
          const sp = Math.hypot(pvx, pvy);
          const tilted = Math.abs(defB.angle - (startAngle.get(uid) ?? defB.angle)) > 0.2 || pvy > 60;
          const key = `${uid}:${s}`;
          if (!crushed.has(key) && !wornBy[s].has(uid) && tilted && sp >= DEFENSE_HIT.crushSpeed && contact.y < G - 50 * this.cs[s]) {
            crushed.add(key);
            crushes.push({ seat: s, uid, frame: frames.count });
          }
          continue;
        }
        if (impact) continue;
        const other = a === proj ? b : b === proj ? a : null;
        if (!other) continue;
        const label: string = other.label ?? '';
        const contact = pair.collision?.supports?.[0] ?? proj.position;
        if (label.startsWith('def:')) impact = { kind: 'defense', x: contact.x, y: contact.y, defenseUid: label.slice(4), bounces: groundHits };
        else if (label.startsWith('char')) impact = { kind: 'character', x: contact.x, y: contact.y, hitSeat: Number(label.slice(4)) as Seat, bounces: groundHits };
        else {
          // 碰到地面：記一次彈跳，繼續飛
          const vy = Math.abs(proj.velocity.y) * 60;
          if (vy > 60 || groundHits === 0) {
            groundHits++;
            bounceFrames.push(frames.count);
          }
          if (firstGroundStep < 0) {
            firstGroundStep = step;
            // 落地後在地上滾/彈會很快慢下來（草地的阻力）
            proj.frictionAir = Math.max(proj.frictionAir, PHYSICS.groundDrag);
          }
          continue;
        }
        return;
      }
    };
    Events.on(this.engine, 'collisionStart', onCollide);

    const fell: string[] = [];
    const maxFlight = Math.ceil((ARENA.maxFlightSeconds * 1000) / STEP_MS);
    const afterSteps = Math.ceil(PHYSICS.afterImpactMs / STEP_MS);
    const settleSteps = Math.ceil(PHYSICS.settleMaxMs / STEP_MS);
    let step = 0;
    let impactStep = -1;
    let restSteps = 0;
    let projGone = false;
    let lastSpeed = speed;
    let lastVel = { x: 0, y: 0 };
    let knock: KnockState | null = null;
    try {
      const extraSteps = Math.ceil(Math.max(...this.extraLie) / STEP_MS);
      while (step < maxFlight + afterSteps + settleSteps + extraSteps) {
        if (!projGone && extraG !== 0) Body.applyForce(proj, proj.position, { x: 0, y: proj.mass * extraG });
        // 投擲物完全離開自己的身體後，才開放打到自己
        if (!selfArmed && !projGone && !impact && !Bounds.overlaps(proj.bounds, this.chars[seat].bounds)) {
          selfArmed = true;
          proj.collisionFilter.mask |= selfCat;
        }
        if (!projGone && !impact) {
          lastSpeed = Body.getSpeed(proj) * 60;
          lastVel = { x: proj.velocity.x * 60, y: proj.velocity.y * 60 };
        }
        Engine.update(this.engine, STEP_MS);
        step++;
        if (knock) this.stepKnock(knock, STEP_MS / 1000);
        const ob = ARENA.outOfBounds;
        if (!impact && (proj.position.x < ob.minX || proj.position.x > ob.maxX || proj.position.y > ob.maxY)) {
          impact = { kind: 'out', x: proj.position.x, y: proj.position.y };
        }
        if (impact && impactStep < 0) {
          impactStep = step;
          impactSpeed = lastSpeed;
          impactFrame = frames.count; // 下一格就是命中格
          impact = { ...impact, x: r1(impact.x), y: r1(impact.y) };
          // 打中防禦道具：照投擲物的重量與速度額外推一把（打在上半部會讓它往後倒）
          if (impact.kind === 'defense' && impact.defenseUid) this.kickDefense(impact.defenseUid, impact, lastVel, item.weightKg ?? 0.5);
          const res = onImpact(impact, impactSpeed, lastVel);
          if (res.knock) knock = this.startKnock(res.knock, frames);
          for (const uid of res.remove) dying.add(uid);
          if (impact.kind === 'out') {
            Composite.remove(this.engine.world, proj);
            projGone = true;
          }
          // AI 試算用：只要知道打到哪裡，不必模擬後續
          if (opts.stopAtImpact) break;
        }
        // 彈跳/滾動到停下來、彈太多次或滾太久都沒打到東西 → 算落空
        if (!impact && groundHits > 0) {
          const sp = Body.getSpeed(proj) * 60;
          if (sp < 90 || groundHits > PHYSICS.maxBounces || (step - firstGroundStep) * STEP_MS > PHYSICS.maxRollMs) {
            impact = { kind: 'platform', x: proj.position.x, y: proj.position.y };
            continue;
          }
        }
        if (!impact && step >= maxFlight) {
          impact = { kind: 'out', x: proj.position.x, y: proj.position.y };
          continue;
        }
        // 命中後投擲物繼續彈一下，之後消失
        if (!projGone && impactStep > 0 && step - impactStep >= afterSteps) {
          Composite.remove(this.engine.world, proj);
          projGone = true;
        }
        if (step % ARENA.frameEvery === 0) {
          this.record(frames, last, projGone ? undefined : proj);
          if (knock) this.recordKnock(knock, frames);
          for (const uid of this.removeFallen(frames)) {
            if (dying.delete(uid)) continue; // 已經被打壞的，掉出場外就算了
            fell.push(uid);
          }
        }
        if (projGone) {
          restSteps = this.allAtRest() && (!knock || knock.done) ? restSteps + 1 : 0;
          if (restSteps > 24) break;
        }
      }
    } finally {
      Events.off(this.engine, 'collisionStart', onCollide);
      if (!projGone) Composite.remove(this.engine.world, proj);
    }
    if (knock && !knock.done) {
      // 安全措施：時間到還沒結束就直接站好（或趴著）
      if (knock.phase === 'tumble') {
        const range = xRangeOf(knock.seat);
        knock.endX = Math.min(range[1], Math.max(range[0], knock.body.position.x));
        Composite.remove(this.engine.world, knock.body);
      }
      this.moveCharHidden(knock.seat, knock.endX);
      if (!knock.stayDown) {
        this.hideChar(knock.seat, false);
        knock.frames[knock.frames.length - 1] = [knock.endX, 0, 0, 1, 0];
      }
      knock.done = true;
      this.releaseWorn(knock);
    }
    for (const uid of this.removeFallen(frames)) if (!dying.delete(uid)) fell.push(uid);
    // 被打壞的道具倒完、靜止了才消失
    for (const uid of dying) {
      frames.gone[uid] = Math.max(0, frames.count - 1);
      this.removeDefense(uid);
    }
    if (impactFrame < 0) impactFrame = Math.max(0, frames.count - 1);
    const knockSleep =
      knock && knock.wakeFrame !== undefined && !knock.stayDown ? { seat: knock.seat, sleepFrame: knock.sleepFrame ?? 0, wakeFrame: knock.wakeFrame } : undefined;
    return { frames, impactFrame, impact: impact ?? { kind: 'out', x: 0, y: 0 }, fell, impactSpeed, crushes, bounceFrames, knockSleep };
  }

  /**
   * 「移動」道具：把自己射出去。身體保持直立，落地就站好（不能超出自己的可移動範圍）。
   * 途中撞到其他人 → onHit（回傳要不要把對方推開）。
   */
  leap(
    seat: Seat,
    item: ThrowableDef,
    angleDeg: number,
    power: number,
    onHit: (hitSeat: Seat, vel: { x: number; y: number }, at: { x: number; y: number }) => KnockRequest | undefined,
  ): {
    frames: PhysicsFrames;
    impactFrame: number;
    impact: ThrowImpact;
    fell: string[];
    knockSleep?: { seat: Seat; sleepFrame: number; wakeFrame: number };
  } {
    const frames = this.newFrames();
    const last = this.snapshotPoses();
    const dir = sideDir(seat);
    const p = Math.min(1, Math.max(0, power));
    const speed = item.minSpeed + (item.maxSpeed - item.minSpeed) * p;
    const rad = (angleDeg * Math.PI) / 180;
    const vx = Math.cos(rad) * speed * dir,
      vy = -Math.sin(rad) * speed;
    const self = this.startKnock({ seat, vx, vy, omega: 0, stayDown: false, speed, away: Math.sign(vx) || dir, leap: true }, frames);
    const knocks: KnockState[] = [self];
    let impact: ThrowImpact | null = null;
    let impactFrame = -1;
    const hit = new Set<Seat>();
    const onCollide = (ev: any) => {
      for (const pair of ev.pairs) {
        const a = pair.bodyA.parent,
          b = pair.bodyB.parent;
        const other = a === self.body ? b : b === self.body ? a : null;
        if (!other) continue;
        const m = /^char(\d)$/.exec(other.label ?? '');
        if (!m) continue;
        const s = Number(m[1]) as Seat;
        if (s === seat || hit.has(s)) continue;
        hit.add(s);
        const at = pair.collision?.supports?.[0] ?? self.body.position;
        const v = { x: self.body.velocity.x * 60, y: self.body.velocity.y * 60 };
        if (!impact) {
          impact = { kind: 'character', x: r1(at.x), y: r1(at.y), hitSeat: s, bounces: 0 };
          impactFrame = frames.count;
        }
        const req = onHit(s, v, at);
        if (req) knocks.push(this.startKnock(req, frames));
      }
    };
    Events.on(this.engine, 'collisionStart', onCollide);
    const fell: string[] = [];
    let restSteps = 0;
    try {
      const maxSteps = Math.ceil((KNOCKBACK.maxTumbleMs + 6000 + Math.max(...this.extraLie)) / STEP_MS);
      for (let step = 1; step <= maxSteps; step++) {
        Engine.update(this.engine, STEP_MS);
        for (const k of knocks) this.stepKnock(k, STEP_MS / 1000);
        if (self.done && impactFrame < 0) impactFrame = frames.count;
        if (step % ARENA.frameEvery === 0) {
          this.record(frames, last);
          for (const k of knocks) this.recordKnock(k, frames);
          fell.push(...this.removeFallen(frames));
        }
        restSteps = this.allAtRest() && knocks.every((k) => k.done) ? restSteps + 1 : 0;
        if (restSteps > 24) break;
      }
    } finally {
      Events.off(this.engine, 'collisionStart', onCollide);
    }
    for (const k of knocks) {
      if (k.done) continue;
      if (k.body && Composite.get(this.engine.world, k.body.id, 'body')) Composite.remove(this.engine.world, k.body);
      const range = xRangeOf(k.seat);
      k.endX = Math.min(range[1], Math.max(range[0], k.body?.position.x ?? k.endX));
      this.moveCharHidden(k.seat, k.endX);
      if (!k.stayDown) this.hideChar(k.seat, false);
      k.done = true;
      this.releaseWorn(k);
    }
    // 最後一格補齊
    this.record(frames, last);
    for (const k of knocks) this.recordKnock(k, frames);
    fell.push(...this.removeFallen(frames));
    if (impactFrame < 0) impactFrame = Math.max(0, frames.count - 1);
    const kn = knocks.find((k) => k !== self && k.wakeFrame !== undefined && !k.stayDown);
    return {
      frames,
      impactFrame,
      impact: impact ?? { kind: 'platform', x: r1(self.endX), y: ARENA.groundY },
      fell,
      ...(kn ? { knockSleep: { seat: kn.seat, sleepFrame: kn.sleepFrame ?? 0, wakeFrame: kn.wakeFrame! } } : {}),
    };
  }

  /** 投擲物打中防禦道具時的額外衝量（線速度＋依打點產生的旋轉） */
  private kickDefense(uid: string, at: { x: number; y: number }, vel: { x: number; y: number }, weightKg: number): void {
    const info = this.defs.get(uid);
    if (!info || info.wearable) return;
    const b = info.body;
    // 整堆都叫醒，讓上面/旁邊的東西跟著反應
    this.wakeDefenses();
    // 很輕的東西（香菸、卡片）也至少推得動一點
    weightKg = Math.max(weightKg, DEFENSE_HIT.minKickKg);
    // 衝量（質量單位 × 像素/步）
    const jx = (DEFENSE_HIT.kick * weightKg * vel.x) / 60;
    const jy = (DEFENSE_HIT.kick * weightKg * vel.y * 0.5) / 60;
    const rx = at.x - b.position.x,
      ry = at.y - b.position.y;
    Body.setVelocity(b, { x: b.velocity.x + jx / b.mass, y: b.velocity.y + jy / b.mass });
    // Matter 的轉動慣量放大了 4 倍（比較穩），這裡補回來一些讓它容易被打倒
    Body.setAngularVelocity(b, b.angularVelocity + (rx * jy - ry * jx) * b.inverseInertia * DEFENSE_HIT.spin);
  }
}
