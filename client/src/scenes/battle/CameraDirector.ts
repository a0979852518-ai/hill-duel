// 戰場鏡頭：開場遠景 → 拉近自己 → 輪到誰就移到誰 → 投擲時跟著投擲物 → 命中時頓一下、拉近一點。
// 每幀把目前鏡頭平滑地往「目標鏡位」靠近（指數趨近，跟幀率無關）。

import * as Phaser from 'phaser';
import { ARENA, CAMERA } from '../../../../shared/config/game.js';
import { sideDir, type Seat } from '../../../../shared/types.js';

interface Shot {
  x: number;
  y: number;
  zoom: number;
  /** 每秒靠近的速率（越大越快） */
  rate: number;
}

/** 讓地面固定在畫面下緣附近：給定縮放，回傳鏡頭中心的 y */
function centerYFor(zoom: number, groundMargin = 150): number {
  return ARENA.groundY + groundMargin - ARENA.height / 2 / zoom;
}

export class CameraDirector {
  private cur: Shot;
  private target: Shot;
  private punchZoom = 0;
  private followPt: { x: number; y: number; vx: number; vy: number } | null = null;

  constructor(private cam: Phaser.Cameras.Scene2D.Camera) {
    this.cur = { x: ARENA.world.width / 2, y: centerYFor(0.5), zoom: 0.5, rate: 3 };
    this.target = { ...this.cur };
  }

  /** 所有人都在畫面內的遠景 */
  wideShot(xs: number[], rate = 2.4): Shot {
    const lo = Math.min(...xs),
      hi = Math.max(...xs);
    const span = hi - lo + 640;
    const zoom = Phaser.Math.Clamp(ARENA.width / span, 0.34, CAMERA.followZoom);
    return { x: (lo + hi) / 2, y: centerYFor(zoom, 170), zoom, rate };
  }

  /** 對準某個角色，鏡頭稍微往對手方向偏，前方留比較多空間 */
  seatShot(seat: Seat, x: number, rate = 2.6): Shot {
    const zoom = CAMERA.followZoom;
    const dir = sideDir(seat);
    return { x: x + dir * 430, y: centerYFor(zoom), zoom, rate };
  }

  /** 這個縮放下，地面在畫面下緣附近時的鏡頭中心 y */
  restY(zoom: number): number {
    return centerYFor(zoom);
  }

  set(shot: Shot, snap = false): void {
    this.followPt = null;
    this.target = { ...shot };
    if (snap) this.cur = { ...shot };
  }

  /** 開始跟隨一個移動中的點（投擲物） */
  follow(x: number, y: number, vx = 0, vy = 0): void {
    this.followPt = { x, y, vx, vy };
  }

  stopFollow(): void {
    this.followPt = null;
  }

  /** 命中時鏡頭往內一推 */
  punch(amount: number): void {
    this.punchZoom = Math.max(this.punchZoom, amount);
  }

  get zoom(): number {
    return this.cam.zoom;
  }

  update(dtMs: number): void {
    const dt = Math.min(dtMs, 100) / 1000;
    if (this.followPt) {
      const p = this.followPt;
      const zoom = CAMERA.throwZoom;
      // 往飛行方向多看一點；高空時跟上去，低空時保持地面在畫面內
      const lead = Phaser.Math.Clamp(p.vx * 0.18, -260, 260);
      this.target = { x: p.x + lead, y: Math.min(p.y + 60, centerYFor(zoom)), zoom, rate: 7 };
    }
    const t = this.target;
    const k = 1 - Math.exp(-t.rate * dt);
    this.cur.x += (t.x - this.cur.x) * k;
    this.cur.y += (t.y - this.cur.y) * k;
    this.cur.zoom += (t.zoom - this.cur.zoom) * k;
    this.punchZoom *= Math.exp(-7 * dt);
    if (this.punchZoom < 0.002) this.punchZoom = 0;
    this.cam.setZoom(this.cur.zoom * (1 + this.punchZoom));
    this.cam.centerOn(this.cur.x, this.cur.y);
  }

  /** 鏡頭是否已經大致到位 */
  settled(): boolean {
    const t = this.target;
    return Math.abs(t.x - this.cur.x) < 12 && Math.abs(t.y - this.cur.y) < 12 && Math.abs(t.zoom - this.cur.zoom) < 0.01;
  }
}
