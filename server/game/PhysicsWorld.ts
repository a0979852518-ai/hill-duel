// ============================================================
// 物理世界（Matter.js，只在伺服器上跑）
// ------------------------------------------------------------
// - 地面、牆是固定的；角色平常固定，被打中時會依擊退力道滑退；
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
} as const;

const STEP_MS = ARENA.physicsStep * 1000;
const r1 = (n: number) => Math.round(n * 10) / 10;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

interface DefenseBodyInfo {
  body: any;
  owner: Seat;
  /** 圖片中心相對剛體質心的偏移（剛體角度為 0 時） */
  offset: { x: number; y: number };
}

/** 擊退中的角色（運動學：滑行＋小跳＋傾斜，最後站起來） */
interface KnockState {
  seat: Seat;
  dir: number;
  v: number;
  v0: number;
  vy0: number;
  t: number;
  x: number;
  yOff: number;
  tilt: number;
  knockdown: boolean;
  phase: 'slide' | 'getup';
  getupT: number;
  done: boolean;
  frames: [number, number, number][];
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
      Bodies.rectangle(-20, G - ARENA.wallHeight / 2, 40, ARENA.wallHeight, { ...worldOpts, label: 'wall' }),
      Bodies.rectangle(W + 20, G - ARENA.wallHeight / 2, 40, ARENA.wallHeight, { ...worldOpts, label: 'wall' }),
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
        collisionFilter: { category: seat === 0 ? CAT.char0 : CAT.char1, mask: 0xffff },
      });
      this.chars[seat] = body;
      statics.push(body);
    }
    Composite.add(this.engine.world, statics);
  }

  getCharX(seat: Seat): number {
    return this.charX[seat];
  }

  /** 把角色移到腳底 x（固定物體直接搬移；會順便推動碰到的道具） */
  private moveChar(seat: Seat, x: number): void {
    const body = this.chars[seat];
    const dx = x - this.charX[seat];
    if (dx === 0) return;
    Body.setPosition(body, { x: body.position.x + dx, y: body.position.y }, true);
    this.charX[seat] = x;
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

  private startKnock(seat: Seat, speed: number, frames: PhysicsFrames): KnockState {
    const v0 = Math.min(KNOCKBACK.maxSpeed, speed);
    const x = this.charX[seat];
    const k: KnockState = {
      seat,
      dir: seat === 0 ? -1 : 1, // 往自己身後退
      v: v0,
      v0,
      vy0: v0 * KNOCKBACK.lift,
      t: 0,
      x,
      yOff: 0,
      tilt: 0,
      knockdown: v0 >= KNOCKBACK.knockdownSpeed,
      phase: 'slide',
      getupT: 0,
      done: false,
      // 補齊命中前的影格（站著不動）
      frames: Array.from({ length: frames.count }, () => [x, 0, 0] as [number, number, number]),
    };
    frames.c ??= {};
    frames.c[String(seat) as '0' | '1'] = k.frames;
    return k;
  }

  private stepKnock(k: KnockState, dt: number): void {
    if (k.done) return;
    const g = ARENA.gravity;
    const decel = PHYSICS.ground.friction * g;
    const range = ARENA.characterXRange[k.seat];
    if (k.phase === 'slide') {
      k.t += dt;
      k.v = Math.max(0, k.v - decel * dt);
      let nx = k.x + k.dir * k.v * dt;
      if (nx < range[0] || nx > range[1]) {
        nx = Math.min(range[1], Math.max(range[0], nx));
        k.v = 0;
      }
      k.x = nx;
      k.yOff = Math.max(0, k.vy0 * k.t - 0.5 * g * k.t * k.t);
      // 被打得往後仰（頭往被推的方向），被打倒的話幾乎躺平
      const maxTilt = k.knockdown ? 1.35 : 0.35;
      k.tilt = k.dir * maxTilt * Math.min(1, k.t / 0.18);
      this.moveChar(k.seat, k.x);
      if (k.v === 0 && k.yOff === 0) {
        k.phase = 'getup';
        k.getupT = 0;
      }
    } else {
      k.getupT += dt;
      const dur = k.knockdown ? 0.75 : 0.3;
      const wait = k.knockdown ? 0.35 : 0; // 躺一下再起來
      const f = Math.min(1, Math.max(0, (k.getupT - wait) / dur));
      const maxTilt = k.knockdown ? 1.35 : 0.35;
      k.tilt = k.dir * maxTilt * (1 - f * f * (3 - 2 * f));
      if (f >= 1) {
        k.tilt = 0;
        k.done = true;
      }
    }
  }

  private recordKnock(k: KnockState, frames: PhysicsFrames): void {
    // record() 已經把 frames.count +1，這裡補上同一格
    while (k.frames.length < frames.count) k.frames.push([r1(k.x), r1(-k.yOff), r3(k.tilt)]);
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
    onImpact: (impact: ThrowImpact, impactSpeed: number) => { remove: string[]; knock?: { seat: Seat; speed: number } },
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
    let knock: KnockState | null = null;
    try {
      while (step < maxFlight + afterSteps + settleSteps) {
        if (!projGone && extraG !== 0) Body.applyForce(proj, proj.position, { x: 0, y: proj.mass * extraG });
        if (!projGone && !impact) lastSpeed = Body.getSpeed(proj) * 60;
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
          const res = onImpact(impact, impactSpeed);
          if (res.knock && res.knock.speed > 1) knock = this.startKnock(res.knock.seat, res.knock.speed, frames);
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
      this.moveChar(knock.seat, knock.x);
      knock.done = true;
    }
    fell.push(...this.removeFallen(frames));
    if (impactFrame < 0) impactFrame = Math.max(0, frames.count - 1);
    return { frames, impactFrame, impact: impact ?? { kind: 'out', x: 0, y: 0 }, fell, impactSpeed };
  }
}
