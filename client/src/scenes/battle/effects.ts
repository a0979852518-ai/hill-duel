// 視覺特效：爆炸、傷害數字、回合橫幅、功能道具動畫。
// 新增功能道具的專屬動畫：在 FUNCTIONAL_EFFECTS 加一個同 handler 名稱的函式。

import * as Phaser from 'phaser';
import { ARENA } from '../../../../shared/config/game.js';
import { characterHitbox, defenseRect } from '../../../../shared/physics.js';
import type { DefenseView, Seat } from '../../../../shared/types.js';

export const FONT = '"PingFang TC","Microsoft JhengHei","Noto Sans TC",system-ui,sans-serif';
export const wait = (scene: Phaser.Scene, ms: number) => new Promise<void>((r) => scene.time.delayedCall(ms, () => r()));

export function explosion(scene: Phaser.Scene, x: number, y: number, radius: number): Promise<void> {
  const r = Math.max(18, radius);
  const ring = scene.add.circle(x, y, r, 0xffb74d, 0.85).setDepth(50).setScale(0.1);
  const core = scene.add.circle(x, y, r * 0.55, 0xfff3c4, 1).setDepth(51).setScale(0.1);
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI * 2 * i) / 10 + Math.random() * 0.4;
    const p = scene.add.circle(x, y, 3 + Math.random() * 4, 0x5d4037).setDepth(52);
    scene.tweens.add({
      targets: p,
      x: x + Math.cos(a) * r * (0.9 + Math.random() * 0.6),
      y: y + Math.sin(a) * r * (0.9 + Math.random() * 0.6) - 10,
      alpha: 0,
      duration: 550,
      ease: 'Quad.easeOut',
      onComplete: () => p.destroy(),
    });
  }
  if (radius >= 60) scene.cameras.main.shake(220, 0.008);
  return new Promise((resolve) => {
    scene.tweens.add({ targets: [ring, core], scale: 1, duration: 180, ease: 'Back.easeOut' });
    scene.tweens.add({
      targets: [ring, core],
      alpha: 0,
      delay: 200,
      duration: 380,
      onComplete: () => {
        ring.destroy();
        core.destroy();
        resolve();
      },
    });
  });
}

export function puff(scene: Phaser.Scene, x: number, y: number): void {
  for (let i = 0; i < 6; i++) {
    const c = scene.add.circle(x, y, 6, 0xffffff, 0.8).setDepth(50);
    scene.tweens.add({
      targets: c,
      x: x + Phaser.Math.Between(-26, 26),
      y: y - Phaser.Math.Between(4, 28),
      scale: 2,
      alpha: 0,
      duration: 420,
      onComplete: () => c.destroy(),
    });
  }
}

export function damageNumber(scene: Phaser.Scene, seat: Seat, amount: number, color = '#ffffff', label?: string, sign = '-'): void {
  const box = characterHitbox(seat);
  const x = box.x + box.w / 2 + Phaser.Math.Between(-14, 14);
  const t = scene.add
    .text(x, box.y - 6, label ? `${label} ${sign}${amount}` : `${sign}${amount}`, {
      fontFamily: FONT,
      fontSize: '34px',
      fontStyle: '900',
      color,
      stroke: '#2b2118',
      strokeThickness: 7,
    })
    .setOrigin(0.5)
    .setDepth(80)
    .setScale(0.4);
  scene.tweens.add({ targets: t, scale: 1, duration: 160, ease: 'Back.easeOut' });
  scene.tweens.add({ targets: t, y: t.y - 70, alpha: 0, delay: 650, duration: 650, onComplete: () => t.destroy() });
}

export function floatingText(scene: Phaser.Scene, x: number, y: number, text: string, color = '#ffffff'): void {
  const t = scene.add
    .text(x, y, text, { fontFamily: FONT, fontSize: '22px', fontStyle: '800', color, stroke: '#2b2118', strokeThickness: 5 })
    .setOrigin(0.5)
    .setDepth(80);
  scene.tweens.add({ targets: t, y: y - 40, alpha: 0, delay: 700, duration: 600, onComplete: () => t.destroy() });
}

export function banner(scene: Phaser.Scene, text: string, color = 0xe8743b, ms = 1100): Promise<void> {
  const W = ARENA.width;
  const bg = scene.add.rectangle(W / 2, 330, W, 84, color, 0.92).setDepth(90).setStrokeStyle(4, 0x2b2118);
  const t = scene.add
    .text(W / 2, 330, text, { fontFamily: FONT, fontSize: '40px', fontStyle: '900', color: '#ffffff', stroke: '#2b2118', strokeThickness: 8 })
    .setOrigin(0.5)
    .setDepth(91);
  bg.scaleY = 0;
  t.x = -400;
  return new Promise((resolve) => {
    scene.tweens.add({ targets: bg, scaleY: 1, duration: 160, ease: 'Quad.easeOut' });
    scene.tweens.add({ targets: t, x: W / 2, duration: 280, ease: 'Back.easeOut' });
    scene.time.delayedCall(ms, () => {
      scene.tweens.add({ targets: t, x: W + 400, duration: 220, ease: 'Quad.easeIn' });
      scene.tweens.add({
        targets: bg,
        scaleY: 0,
        delay: 120,
        duration: 160,
        onComplete: () => {
          bg.destroy();
          t.destroy();
          resolve();
        },
      });
    });
  });
}

export function lightningStrike(scene: Phaser.Scene, seat: Seat): Promise<void> {
  const box = characterHitbox(seat);
  const x = box.x + box.w / 2;
  const g = scene.add.graphics().setDepth(70);
  const pts: [number, number][] = [[x + Phaser.Math.Between(-40, 40), 0]];
  for (let y = 60; y < box.y + box.h / 2; y += 60) pts.push([x + Phaser.Math.Between(-30, 30), y]);
  pts.push([x, box.y + box.h / 2]);
  const draw = (w: number, c: number) => {
    g.lineStyle(w, c);
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) g.lineTo(p[0], p[1]);
    g.strokePath();
  };
  draw(12, 0xfff59d);
  draw(4, 0xffffff);
  const flash = scene.add.rectangle(ARENA.width / 2, ARENA.height / 2, ARENA.width, ARENA.height, 0xffffff, 0.6).setDepth(69);
  scene.cameras.main.shake(180, 0.006);
  return new Promise((resolve) => {
    scene.tweens.add({ targets: [g, flash], alpha: 0, duration: 450, delay: 120, onComplete: () => (g.destroy(), flash.destroy(), resolve()) });
  });
}

export function hammerSmash(scene: Phaser.Scene, d: DefenseView): Promise<void> {
  const r = defenseRect(d);
  const hammer = scene.add.image(r.x + r.w / 2 + 40, r.y - 90, 'icon:demolish').setDepth(70).setScale(1.2).setAngle(-60);
  return new Promise((resolve) => {
    scene.tweens.add({
      targets: hammer,
      x: r.x + r.w / 2 + 10,
      y: r.y + 10,
      angle: 20,
      duration: 260,
      ease: 'Quad.easeIn',
      onComplete: () => {
        scene.cameras.main.shake(150, 0.006);
        puff(scene, r.x + r.w / 2, r.y + 10);
        scene.tweens.add({ targets: hammer, alpha: 0, duration: 300, onComplete: () => (hammer.destroy(), resolve()) });
      },
    });
  });
}

/** 功能道具專屬動畫：key = handler 名稱 */
export const FUNCTIONAL_EFFECTS: Record<
  string,
  (scene: Phaser.Scene, ctx: { seat: Seat; enemy: Seat; target?: DefenseView; itemId: string }) => Promise<void>
> = {
  directDamage: (scene, { enemy }) => lightningStrike(scene, enemy),
  destroyDefense: (scene, { target }) => (target ? hammerSmash(scene, target) : Promise.resolve()),
  damageBoth: async (scene, { seat, enemy }) => {
    const a = characterHitbox(enemy),
      b = characterHitbox(seat);
    await Promise.all([explosion(scene, a.x + a.w / 2, a.y + a.h / 2, 90), explosion(scene, b.x + b.w / 2, b.y + b.h / 2, 90)]);
  },
  applyStatus: (scene, { seat, enemy, itemId }) => aura(scene, itemId === 'whey' ? seat : enemy, itemId === 'whey' ? 0xff7043 : 0xab47bc),
  heal: (scene, { seat }) => aura(scene, seat, 0x69f0ae),
};

/** 角色周圍冒出一圈光（狀態、回血） */
export function aura(scene: Phaser.Scene, seat: Seat, color: number): Promise<void> {
  const box = characterHitbox(seat);
  const cx = box.x + box.w / 2,
    cy = box.y + box.h / 2;
  for (let i = 0; i < 14; i++) {
    const p = scene.add.circle(cx + Phaser.Math.Between(-36, 36), box.y + box.h, Phaser.Math.Between(4, 8), color, 0.9).setDepth(60);
    scene.tweens.add({ targets: p, y: box.y - 20 - Math.random() * 40, alpha: 0, delay: i * 40, duration: 700, onComplete: () => p.destroy() });
  }
  const ring = scene.add.ellipse(cx, cy, 120, 190, color, 0.25).setDepth(59).setScale(0.3);
  return new Promise((resolve) => {
    scene.tweens.add({ targets: ring, scale: 1, alpha: 0, duration: 800, onComplete: () => (ring.destroy(), resolve()) });
  });
}
