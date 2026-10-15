// 場景背景與平台繪製。若 client/public/assets/backgrounds/arena.png 存在就用圖片當背景。

import * as Phaser from 'phaser';
import { ARENA } from '../../../shared/config/game.js';

export const BACKGROUND_KEY = 'bg:arena';
export const BACKGROUND_PATH = 'assets/backgrounds/arena.png';

export function queueBackground(scene: Phaser.Scene): void {
  scene.load.image(BACKGROUND_KEY, BACKGROUND_PATH);
}

export function drawArena(scene: Phaser.Scene): Phaser.GameObjects.Container {
  const root = scene.add.container(0, 0);
  const { width: W, height: H } = ARENA;

  if (scene.textures.exists(BACKGROUND_KEY)) {
    root.add(scene.add.image(W / 2, H / 2, BACKGROUND_KEY).setDisplaySize(W, H));
  } else {
    const g = scene.add.graphics();
    // 天空漸層
    g.fillGradientStyle(0x7ec8ef, 0x7ec8ef, 0xffe3b0, 0xffe3b0, 1);
    g.fillRect(0, 0, W, H);
    // 太陽
    g.fillStyle(0xfff3c4, 0.9).fillCircle(W / 2, 170, 70);
    g.fillStyle(0xffffff, 0.25).fillCircle(W / 2, 170, 100);
    // 遠山
    g.fillStyle(0x9cc5a1, 1);
    g.beginPath();
    g.moveTo(0, 560);
    const hills = [0, 470, 160, 400, 330, 460, 520, 380, 700, 450, 880, 390, 1060, 455, 1280, 410];
    for (let i = 0; i < hills.length; i += 2) g.lineTo(hills[i], hills[i + 1]);
    g.lineTo(W, 560);
    g.closePath();
    g.fillPath();
    // 雲
    g.fillStyle(0xffffff, 0.85);
    for (const [x, y, s] of [[180, 110, 1], [980, 80, 1.3], [620, 260, 0.8]] as const) {
      g.fillEllipse(x, y, 110 * s, 34 * s).fillEllipse(x + 30 * s, y - 14 * s, 70 * s, 40 * s);
    }
    // 中間的深谷
    g.fillStyle(0x4b6b5a, 1).fillRect(0, 600, W, H - 600);
    g.fillStyle(0x3a5547, 1).fillRect(0, 660, W, H - 660);
    root.add(g);
  }

  // 平台
  const p = scene.add.graphics();
  for (const plat of ARENA.platforms) {
    p.fillStyle(0x2b2118).fillRoundedRect(plat.x - 3, plat.y - 3, plat.w + 6, plat.h + 6, 10);
    p.fillStyle(0x9a6b43).fillRoundedRect(plat.x, plat.y, plat.w, plat.h, 8);
    p.fillStyle(0x7a5233);
    for (let i = 0; i < 6; i++) p.fillCircle(plat.x + 30 + i * 52, plat.y + 60 + (i % 2) * 40, 7);
    p.fillStyle(0x6fbf4a).fillRoundedRect(plat.x, plat.y, plat.w, 16, { tl: 8, tr: 8, bl: 0, br: 0 });
    p.fillStyle(0x5aa53a).fillRect(plat.x, plat.y + 12, plat.w, 5);
  }
  root.add(p);
  return root;
}
