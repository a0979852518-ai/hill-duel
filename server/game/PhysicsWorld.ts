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
import { ARENA, KNOCKBACK, PHYSICS } from '../../shared/config/game.js';
import type { DefenseDef, ThrowableDef } from '../../shared/config/items.js';
import { launchPoint } from '../../shared/physics.js';
import type { ImpactKind, PhysicsFrames, Seat } from '../../shared/types.js';

const { Engine, Bodies, Body, Composite, Events, Query, Sleeping } = Matter;

// 碰撞分類（bit）：讓投擲物不會撞到「自己」的角色與防禦道具
const CAT = {
  world: 0x0001,
  char0: 0x0002,
  char1: 0x0004,
  def0: 0x0008,
  def1: 0x0010,
  proj: 0x0020,
  /** 被打飛、翻滾中的角色 */
  tumble: 0x0040,
  /** 只擋翻滾角色的隱形邊界 */
  bound: 0x0080,
} as const;

/** 翻滾身體：寬 × 高（膠囊形，圓角讓它會滾） */
const TUMBLE = { w: 44, h: 150, r: 20 };

const STEP_MS = ARENA.physicsStep * 1000;
const r1 = (n: number) => Math.round(n * 10) / 10;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

interface DefenseBodyInfo {
  body: any;
  owner: Seat;
  /** 圖片中心相對剛體質心的偏移（剛體角度為 0 時） */
  offset: { x: number; y: number };
}

/** 擊退中的角色：Matter 剛體翻滾 → 躺一下 → 起身 */
interface KnockState {
  seat: Seat;
  body: any;
  phase: 'tumble' | 'lie' | 'getup' | 'walk';
  t: number;
  restSteps: number;
  /** 進入躺/起身階段時的姿勢 [腳底x, 腳底y-地面, 角度] */
  from: [number, number, number];
  /** 站起來的腳底 x */
  endX: number;
  /** 最後回到的腳底 x（走回原位） */
  homeX: number;
  /** 被打死了就不起來 */
  stayDown: boolean;
  done: boolean;
  frames: [number, number, number][];
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
}

export interface ThrowImpact {
  kind: ImpactKind;
  x: number;
  y: number;
  defenseUid?: string;
  hitSeat?: Seat;
}

export class PhysicsWorld {
  private engine: any;
  private defs = new Map<string, DefenseBodyInfo>();

  private chars: any[] = [];
  /** 角色腳底 x */
  private charX: [number, number];

  constructor(startX: [number, number] = [ARENA.characterStartX[0], ARENA.characterStartX[1]]) {
    this.charX = [...startX] as [number, number];
    this.engine = Engine.create({
      gravity: { x: 0, y: 1, scale: ARENA.gravity / 1e6 },
      enableSleeping: true,
      positionIterations: 10,
      velocityIterations: 8,
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
      Bodies.rectangle(W / 2, G + 100, W + 800, 200, { ...worldOpts, label: 'ground' }),
      // 隱形邊界：只擋翻滾中的角色（投擲物、道具都會穿過去）
      ...[ARENA.characterXRange[0][0] - 40, ARENA.characterXRange[1][1] + 40].map((bx) =>
        Bodies.rectangle(bx, G - 500, 40, 1000, { isStatic: true, label: 'bound', friction: 0.1, collisionFilter: { category: CAT.bound, mask: CAT.tumble } }),
      ),
    ];
    for (const seat of [0, 1] as Seat[]) {
      const x = this.charX[seat];
      const cb = ARENA.characterBody;
      const torso = Bodies.rectangle(x, G - cb.torsoH / 2, cb.torsoW, cb.torsoH, { label: `char${seat}` });
      const head = Bodies.circle(x, G + cb.headY, cb.headR, { label: `char${seat}` });
      const body = Body.create({
        parts: [torso, head],
        isStatic: true,
        label: `char${seat}`,
        friction: 0.9,
        collisionFilter: { category: seat === 0 ? CAT.char0 : CAT.char1, mask: 0xffff & ~CAT.bound },
      });
      this.chars[seat] = body;
      statics.push(body);
    }
    Composite.add(this.engine.world, statics);
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
      restitution: PHYSICS.defense.restitution,
      frictionAir: PHYSICS.defense.frictionAir,
      density: def.density ?? PHYSICS.defense.density,
      collisionFilter: { category: owner === 0 ? CAT.def0 : CAT.def1, mask: 0xffff },
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
      body = Bodies.rectangle(x, y, w, h, { ...opts, chamfer: { radius: Math.min(w, h) * 0.08 } });
    }
    // 圖片中心（x,y）相對質心的偏移
    const offset = { x: x - body.position.x, y: y - body.position.y };
    return { body, owner, offset };
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
    Body.setPosition(body, { x: body.position.x, y: body.position.y + dy }, true);
    this.wakeDefenses();
  }

  private startKnock(req: KnockRequest, frames: PhysicsFrames): KnockState {
    const { seat } = req;
    const x = this.charX[seat];
    const G = ARENA.groundY;
    this.hideChar(seat, true);
    // 戴在頭上/靠在身上的東西跟著被打飛
    for (const info of this.defs.values()) {
      const p = info.body.position;
      if (Math.abs(p.x - x) < 70 && p.y < G - 20 && p.y > G - 260) {
        Body.setVelocity(info.body, { x: (req.vx * 0.7) / 60, y: (req.vy * 0.6 - 180) / 60 });
        Body.setAngularVelocity(info.body, (req.omega * 0.8 + (req.vx > 0 ? 3 : -3)) / 60);
      }
    }
    const body = Bodies.rectangle(x, G - TUMBLE.h / 2 - 0.5, TUMBLE.w, TUMBLE.h, {
      chamfer: { radius: TUMBLE.r },
      label: `tumble${seat}`,
      friction: KNOCKBACK.friction,
      frictionStatic: KNOCKBACK.friction * 1.4,
      restitution: KNOCKBACK.restitution,
      density: KNOCKBACK.density,
      frictionAir: 0.004,
      collisionFilter: { category: CAT.tumble, mask: CAT.world | CAT.bound | (seat === 0 ? CAT.char1 : CAT.char0) },
    });
    Body.setVelocity(body, { x: req.vx / 60, y: req.vy / 60 });
    Body.setAngularVelocity(body, req.omega / 60);
    Composite.add(this.engine.world, body);
    const k: KnockState = {
      seat,
      body,
      phase: 'tumble',
      t: 0,
      restSteps: 0,
      from: [x, 0, 0],
      endX: x,
      homeX: KNOCKBACK.returnHome ? ARENA.characterStartX[seat] : x,
      stayDown: req.stayDown,
      done: false,
      // 補齊命中前的影格（站著不動）
      frames: Array.from({ length: frames.count }, () => [x, 0, 0] as [number, number, number]),
    };
    frames.c ??= {};
    frames.c[String(seat) as '0' | '1'] = k.frames;
    return k;
  }

  /** 翻滾身體目前的 [腳底x, 腳底y-地面, 角度] */
  private tumblePose(k: KnockState): [number, number, number] {
    const b = k.body;
    const a = b.angle;
    const half = TUMBLE.h / 2;
    return [b.position.x - Math.sin(a) * half, b.position.y + Math.cos(a) * half - ARENA.groundY, a];
  }

  private stepKnock(k: KnockState, dt: number): void {
    if (k.done) return;
    k.t += dt;
    if (k.phase === 'tumble') {
      const b = k.body;
      const slow = b.speed < 0.08 && Math.abs(b.angularVelocity) < 0.004;
      k.restSteps = slow || b.isSleeping ? k.restSteps + 1 : 0;
      if (k.restSteps > 20 || k.t * 1000 > KNOCKBACK.maxTumbleMs) {
        k.from = this.tumblePose(k);
        // 角度換成最接近 0 的等價角度，起身時不會多轉好幾圈
        k.from[2] = Math.atan2(Math.sin(k.from[2]), Math.cos(k.from[2]));
        const range = ARENA.characterXRange[k.seat];
        k.endX = Math.min(range[1], Math.max(range[0], b.position.x));
        Composite.remove(this.engine.world, b);
        k.phase = 'lie';
        k.t = 0;
      }
      return;
    }
    if (k.stayDown) {
      // 被打倒（血量歸零）就躺著
      if (k.phase === 'lie') {
        this.moveCharHidden(k.seat, k.endX);
        k.done = true;
      }
      return;
    }
    const lying = Math.abs(k.from[2]) > 0.6;
    if (k.phase === 'lie') {
      if (k.t * 1000 >= (lying ? KNOCKBACK.lieMs : 60)) {
        k.phase = 'getup';
        k.t = 0;
      }
      return;
    }
    if (k.phase === 'getup') {
      if (k.t * 1000 >= KNOCKBACK.getupMs * (lying ? 1 : 0.5)) {
        // 站好了：固定身體回到站起來的位置（頭上的東西、地上的道具又會被擋住）
        this.moveCharHidden(k.seat, k.endX);
        this.hideChar(k.seat, false);
        k.phase = 'walk';
        k.t = 0;
      }
      return;
    }
    // 走回原位：一步一步推過去，地上的道具會被推開而不是突然重疊
    if (!KNOCKBACK.returnHome || k.t >= this.walkSeconds(k)) this.finishKnock(k);
    else this.slideChar(k.seat, this.knockPose(k)[0]);
  }

  /** 移動（沒有藏起來的）固定角色身體，會推動碰到的道具 */
  private slideChar(seat: Seat, x: number): void {
    const body = this.chars[seat];
    Body.setPosition(body, { x: body.position.x + (x - this.charX[seat]), y: body.position.y }, true);
    this.charX[seat] = x;
    this.wakeDefenses();
  }

  private walkSeconds(k: KnockState): number {
    return KNOCKBACK.returnHome ? Math.abs(k.homeX - k.endX) / KNOCKBACK.walkSpeed : 0;
  }

  private finishKnock(k: KnockState): void {
    const x = KNOCKBACK.returnHome ? k.homeX : k.endX;
    if (k.phase === 'walk') {
      this.slideChar(k.seat, x);
      // 移動完把速度歸零（固定物體 setPosition 會留下速度）
      Body.setVelocity(this.chars[k.seat], { x: 0, y: 0 });
    } else {
      this.moveCharHidden(k.seat, x);
      this.hideChar(k.seat, false);
    }
    k.endX = x;
    k.done = true;
  }

  /** 角色還藏在地底時更新它的 x */
  private moveCharHidden(seat: Seat, x: number): void {
    const body = this.chars[seat];
    Body.setPosition(body, { x: body.position.x + (x - this.charX[seat]), y: body.position.y }, true);
    this.charX[seat] = x;
  }

  private knockPose(k: KnockState): [number, number, number] {
    if (k.phase === 'tumble') return this.tumblePose(k);
    if (k.done) return k.stayDown ? k.from : [k.endX, 0, 0];
    if (k.phase === 'lie' || k.stayDown) return k.from;
    if (k.phase === 'walk') {
      const dur = this.walkSeconds(k);
      const f = dur > 0 ? Math.min(1, k.t / dur) : 1;
      const e = f * f * (3 - 2 * f);
      const dir = Math.sign(k.homeX - k.endX);
      // 小跑步：上下彈一點、身體往前傾
      const bob = -Math.abs(Math.sin(k.t * Math.PI * 4.5)) * 5 * (1 - f);
      return [k.endX + (k.homeX - k.endX) * e, bob, dir * 0.08 * Math.sin(Math.PI * f)];
    }
    const lying = Math.abs(k.from[2]) > 0.6;
    const f = Math.min(1, k.t / ((KNOCKBACK.getupMs * (lying ? 1 : 0.5)) / 1000));
    const e = f * f * (3 - 2 * f);
    // 起身：以腳底為軸轉回直立，腳底慢慢移到身體中心的位置；中途稍微頓一下更像撐起來
    return [k.from[0] + (k.endX - k.from[0]) * e, k.from[1] * (1 - e), k.from[2] * (1 - e)];
  }

  private recordKnock(k: KnockState, frames: PhysicsFrames): void {
    // record() 已經把 frames.count +1，這裡補上同一格
    const p = this.knockPose(k);
    while (k.frames.length < frames.count) k.frames.push([r1(p[0]), r1(p[1]), r3(p[2])]);
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
      if (info.body.position.y > PHYSICS.killY || info.body.position.x < -200 || info.body.position.x > ARENA.world.width + 200) out.push(uid);
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
   * @param onImpact 命中當下呼叫，回傳：要立刻移除的防禦道具 uid（被打壞的）、
   *                 以及要被擊退的角色與擊退初速（像素/秒）
   */
  throwProjectile(
    seat: Seat,
    item: ThrowableDef,
    angleDeg: number,
    power: number,
    onImpact: (impact: ThrowImpact, impactSpeed: number, impactVel: { x: number; y: number }) => { remove: string[]; knock?: KnockRequest },
  ): { frames: PhysicsFrames; impactFrame: number; impact: ThrowImpact; fell: string[]; impactSpeed: number } {
    const frames = this.newFrames();
    const last = this.snapshotPoses();
    const dir = seat === 0 ? 1 : -1;
    const lp = launchPoint(seat, this.charX[seat]);
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
        mask: CAT.world | (seat === 0 ? CAT.char1 | CAT.def1 : CAT.char0 | CAT.def0),
      },
    });
    Body.setVelocity(proj, { x: (Math.cos(rad) * speed * dir) / 60, y: (-Math.sin(rad) * speed) / 60 });
    Body.setAngularVelocity(proj, (item.spin ?? 0.25) * dir);
    Composite.add(this.engine.world, proj);

    let impact: ThrowImpact | null = null;
    let impactFrame = -1;
    let impactSpeed = 0;
    const onCollide = (ev: any) => {
      if (impact) return;
      for (const pair of ev.pairs) {
        const a = pair.bodyA.parent,
          b = pair.bodyB.parent;
        const other = a === proj ? b : b === proj ? a : null;
        if (!other) continue;
        const label: string = other.label ?? '';
        const contact = pair.collision?.supports?.[0] ?? proj.position;
        if (label.startsWith('def:')) impact = { kind: 'defense', x: contact.x, y: contact.y, defenseUid: label.slice(4) };
        else if (label.startsWith('char')) impact = { kind: 'character', x: contact.x, y: contact.y, hitSeat: Number(label.slice(4)) as Seat };
        else impact = { kind: 'platform', x: contact.x, y: contact.y };
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
      while (step < maxFlight + afterSteps + settleSteps) {
        if (!projGone && extraG !== 0) Body.applyForce(proj, proj.position, { x: 0, y: proj.mass * extraG });
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
          const res = onImpact(impact, impactSpeed, lastVel);
          if (res.knock) knock = this.startKnock(res.knock, frames);
          for (const uid of res.remove) {
            frames.gone[uid] = frames.count;
            this.removeDefense(uid);
          }
          if (impact.kind === 'out') {
            Composite.remove(this.engine.world, proj);
            projGone = true;
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
          fell.push(...this.removeFallen(frames));
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
      // 安全措施：時間到還沒停就直接站好
      if (knock.phase === 'tumble') {
        knock.endX = Math.min(ARENA.characterXRange[knock.seat][1], Math.max(ARENA.characterXRange[knock.seat][0], knock.body.position.x));
        Composite.remove(this.engine.world, knock.body);
      }
      if (knock.stayDown) {
        this.moveCharHidden(knock.seat, knock.endX);
        knock.done = true;
      } else {
        this.finishKnock(knock);
        const last = knock.frames[knock.frames.length - 1];
        if (last) knock.frames[knock.frames.length - 1] = [knock.endX, 0, 0];
      }
    }
    fell.push(...this.removeFallen(frames));
    if (impactFrame < 0) impactFrame = Math.max(0, frames.count - 1);
    return { frames, impactFrame, impact: impact ?? { kind: 'out', x: 0, y: 0 }, fell, impactSpeed };
  }
}
