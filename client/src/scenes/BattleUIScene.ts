// 戰鬥畫面的「螢幕層」：HUD、老虎機、卡片、橫幅、提示文字、速度線、畫面外角色指示。
// 獨立成一個疊在上面的 Scene，戰場鏡頭怎麼縮放/移動都不會影響這一層。

import * as Phaser from 'phaser';
import { ARENA } from '../../../shared/config/game.js';
import { FONT } from './battle/effects.js';

export class BattleUIScene extends Phaser.Scene {
  constructor() {
    super('BattleUI');
  }

  create(): void {
    // 實際的內容由 BattleScene 在 CREATE 事件後建立
  }
}

// ------------------------------------------------------------ 速度線

interface Streak {
  x: number;
  y: number;
  len: number;
  life: number;
  max: number;
  w: number;
}

/**
 * 投擲物飛行時，畫面上往反方向流過的白色線條。
 * 鏡頭跟著投擲物，所以線條代表「背景往後退」的速度感。
 */
export class SpeedLines {
  private g: Phaser.GameObjects.Graphics;
  private streaks: Streak[] = [];
  private dirX = 1;
  private dirY = 0;
  private intensity = 0;
  private acc = 0;

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(5);
  }

  /** speed：世界座標 px/s；0 = 停止產生新線條 */
  set(vx: number, vy: number, speed: number): void {
    const len = Math.hypot(vx, vy);
    if (len > 1) {
      this.dirX = vx / len;
      this.dirY = vy / len;
    }
    this.intensity = Phaser.Math.Clamp((speed - 350) / 1500, 0, 1);
  }

  stop(): void {
    this.intensity = 0;
  }

  update(dtMs: number): void {
    const dt = Math.min(dtMs, 50) / 1000;
    const W = ARENA.width,
      H = ARENA.height;
    // 產生
    this.acc += dt * 90 * this.intensity;
    while (this.acc >= 1) {
      this.acc -= 1;
      // 從畫面四周（偏向前進方向的那一側）產生，越靠中央越少，避免擋住投擲物
      const side = Math.random();
      let x: number, y: number;
      if (side < 0.5) {
        x = Math.random() * W;
        y = Math.random() < 0.5 ? Math.random() * H * 0.3 : H - Math.random() * H * 0.3;
      } else {
        x = Math.random() < 0.5 ? Math.random() * W * 0.28 : W - Math.random() * W * 0.28;
        y = Math.random() * H;
      }
      const max = 0.18 + Math.random() * 0.14;
      this.streaks.push({ x, y, len: 80 + Math.random() * 180 * (0.5 + this.intensity), life: max, max, w: 1.5 + Math.random() * 2.5 });
    }
    // 移動與繪製
    const g = this.g;
    g.clear();
    const flow = 2600 * (0.4 + this.intensity);
    this.streaks = this.streaks.filter((s) => {
      s.life -= dt;
      s.x -= this.dirX * flow * dt;
      s.y -= this.dirY * flow * dt;
      if (s.life <= 0) return false;
      const a = Math.sin((s.life / s.max) * Math.PI) * 0.75;
      g.lineStyle(s.w, 0xffffff, a);
      g.lineBetween(s.x, s.y, s.x + this.dirX * s.len, s.y + this.dirY * s.len);
      return true;
    });
  }
}

// ------------------------------------------------------------ 畫面外的角色指示

/** 角色不在畫面內時，在畫面邊緣顯示箭頭＋名字＋距離 */
export class OffscreenMarkers {
  private items: { root: Phaser.GameObjects.Container; arrow: Phaser.GameObjects.Triangle; label: Phaser.GameObjects.Text }[] = [];

  constructor(scene: Phaser.Scene) {
    for (const color of [0x3d7bd8, 0xd8463d, 0x5aa0f0, 0xf07a5a]) {
      const root = scene.add.container(0, 0).setDepth(6).setVisible(false);
      const arrow = scene.add.triangle(0, 0, 0, -16, 26, 0, 0, 16, color).setStrokeStyle(3, 0x2b2118);
      const label = scene.add
        .text(0, 0, '', { fontFamily: FONT, fontSize: '15px', fontStyle: '900', color: '#ffffff', stroke: '#2b2118', strokeThickness: 5, align: 'center' })
        .setOrigin(0.5);
      root.add([arrow, label]);
      this.items.push({ root, arrow, label });
    }
  }

  hide(i: number): void {
    this.items[i]?.root.setVisible(false);
  }

  /** screen：角色在螢幕上的位置；dist：和自己的距離（null = 不顯示距離） */
  update(i: number, screenX: number, screenY: number, name: string, dist: number | null, yOffset = 0): void {
    const m = this.items[i];
    const W = ARENA.width,
      H = ARENA.height;
    const margin = 40;
    const off = screenX < -10 || screenX > W + 10 || screenY < 120 || screenY > H + 10;
    m.root.setVisible(off);
    if (!off) return;
    const x = Phaser.Math.Clamp(screenX, margin, W - margin);
    // 2v2 同一邊兩個人：後排的往下錯開，標籤才不會疊在一起
    const y = Phaser.Math.Clamp(screenY, 170, H - 70 - yOffset) + yOffset;
    const ang = Math.atan2(screenY - y, screenX - x);
    m.root.setPosition(x, y);
    m.arrow.setRotation(ang);
    m.arrow.setPosition(Math.cos(ang) * 6, Math.sin(ang) * 6);
    m.label.setText(dist !== null ? `${name}\n${Math.round(dist / 10)} m` : name);
    m.label.setPosition(-Math.cos(ang) * 46, -Math.sin(ang) * 30);
  }
}
