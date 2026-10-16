// 場景背景：一大片平地戰場（世界座標 ARENA.world），天空、遠山（視差）、地面與兩端的岩壁。
// 若 client/public/assets/backgrounds/arena.png 存在就用圖片當天空背景。

import * as Phaser from 'phaser';
import { ARENA } from '../../../shared/config/game.js';

export const BACKGROUND_KEY = 'bg:arena';
export const BACKGROUND_PATH = 'assets/backgrounds/arena.png';

export function queueBackground(scene: Phaser.Scene): void {
  scene.load.image(BACKGROUND_KEY, BACKGROUND_PATH);
}

/** 世界外圍多畫一圈，鏡頭拉遠或晃動時不會看到黑邊 */
const PAD_X = 1600;
const TOP = -1600;
const BOTTOM = ARENA.groundY + 900;

/** 固定的偽隨機，雙方畫面一樣 */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/**
 * 把靜態圖層先畫成貼圖（只畫一次），之後每幀只要貼一張圖，比每幀重畫 Graphics 省很多。
 * res < 1 = 用較低解析度畫再放大（遠景本來就不需要很清楚），避免貼圖超過手機的尺寸上限。
 */
function baked(
  scene: Phaser.Scene,
  key: string,
  x0: number,
  y0: number,
  w: number,
  h: number,
  res: number,
  draw: (g: Phaser.GameObjects.Graphics, X: (x: number) => number, Y: (y: number) => number, S: (v: number) => number) => void,
): Phaser.GameObjects.Image {
  if (!scene.textures.exists(key)) {
    const g = scene.make.graphics({}, false);
    draw(g, (x) => (x - x0) * res, (y) => (y - y0) * res, (v) => v * res);
    g.generateTexture(key, Math.ceil(w * res), Math.ceil(h * res));
    g.destroy();
  }
  return scene.add.image(x0, y0, key).setOrigin(0, 0).setScale(1 / res);
}

export function drawArena(scene: Phaser.Scene): Phaser.GameObjects.Container {
  const root = scene.add.container(0, 0).setDepth(-10);
  const W = ARENA.world.width;
  const G = ARENA.groundY;
  const left = -PAD_X,
    right = W + PAD_X,
    span = right - left;

  // 天空（漸層貼圖拉伸）
  if (scene.textures.exists(BACKGROUND_KEY)) {
    const img = scene.add.image(W / 2, G - 200, BACKGROUND_KEY).setOrigin(0.5, 1);
    img.setScale(Math.max(span / img.width, (G - 200 - TOP) / img.height));
    root.add(img);
  } else {
    if (!scene.textures.exists('arena:sky')) {
      const tex = scene.textures.createCanvas('arena:sky', 4, 256)!;
      const ctx = tex.getContext();
      const grad = ctx.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, '#3f8fd0');
      grad.addColorStop(0.55, '#8cc4ea');
      grad.addColorStop(1, '#ffe3b0');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 4, 256);
      tex.refresh();
    }
    root.add(scene.add.image(left, TOP, 'arena:sky').setOrigin(0, 0).setDisplaySize(span, G + 40 - TOP));
  }

  // 太陽與雲（慢速視差）
  const r = rng(7);
  const far = scene.add.graphics().setScrollFactor(0.25, 0.25);
  far.fillStyle(0xffffff, 0.25).fillCircle(W / 2, 260, 130);
  far.fillStyle(0xfff3c4, 0.95).fillCircle(W / 2, 260, 85);
  far.fillStyle(0xffffff, 0.85);
  for (let i = 0; i < 14; i++) {
    const x = left + r() * span,
      y = TOP + 900 + r() * 700,
      s = 0.8 + r() * 1.2;
    far.fillEllipse(x, y, 140 * s, 40 * s).fillEllipse(x + 36 * s, y - 16 * s, 90 * s, 50 * s);
  }
  root.add(far);

  // 遠山（兩層視差）
  const hills = (key: string, seed: number, factor: number, color: number, baseY: number, amp: number, step: number) => {
    const rr = rng(seed);
    const top = baseY - amp;
    const img = baked(scene, key, left, top, span, G + 400 - top, 0.4, (g, X, Y) => {
      g.fillStyle(color, 1);
      g.beginPath();
      g.moveTo(X(left), Y(G + 400));
      for (let x = left; x <= right + step; x += step) g.lineTo(X(x), Y(baseY - amp * (0.4 + rr() * 0.6)));
      g.lineTo(X(right + step), Y(G + 400));
      g.closePath();
      g.fillPath();
    });
    root.add(img.setScrollFactor(factor, factor));
  };
  hills('arena:hills1', 11, 0.45, 0xa9cfae, G - 180, 260, 220);
  hills('arena:hills2', 13, 0.7, 0x86b78c, G - 70, 170, 160);

  // 地面（含草叢、距離木樁）
  const gTop = G - 40;
  root.add(
    baked(scene, 'arena:ground', left, gTop, span, BOTTOM - gTop, 0.5, (g, X, Y, S) => {
      const rr = rng(17);
      g.fillStyle(0x7a5233).fillRect(X(left), Y(G), S(span), S(BOTTOM - G));
      g.fillStyle(0x6a4529).fillRect(X(left), Y(G + 70), S(span), S(BOTTOM - G - 70));
      for (let i = 0; i < 90; i++) g.fillStyle(0x5d3a1f, 0.6).fillCircle(X(left + rr() * span), Y(G + 30 + rr() * 400), S(4 + rr() * 9));
      g.fillStyle(0x6fbf4a).fillRect(X(left), Y(G - 4), S(span), S(22));
      g.fillStyle(0x5aa53a).fillRect(X(left), Y(G + 14), S(span), S(6));
      g.fillStyle(0x5aa53a);
      for (let x = left; x < right; x += 18 + rr() * 30) {
        const h = 6 + rr() * 12;
        g.fillTriangle(X(x), Y(G - 2), X(x + 5), Y(G - 2 - h), X(x + 10), Y(G - 2));
      }
      // 距離標記：每 200px 一根小木樁，方便判斷距離
      for (let x = 200; x < W; x += 200) {
        g.fillStyle(0x2b2118).fillRect(X(x - 4), Y(G - 30), S(8), S(30));
        g.fillStyle(0xd7b98a).fillRect(X(x - 2), Y(G - 28), S(4), S(26));
      }
    }),
  );

  // 兩端的岩壁（物理上也是牆）
  const wall = scene.add.graphics();
  for (const wx of [0, W]) {
    const sign = wx === 0 ? -1 : 1;
    wall.fillStyle(0x2b2118).fillRoundedRect(wx - 40 + sign * 20 - 4, G - ARENA.wallHeight - 4, 88, ARENA.wallHeight + 8, 14);
    wall.fillStyle(0x8d8478).fillRoundedRect(wx - 40 + sign * 20, G - ARENA.wallHeight, 80, ARENA.wallHeight + 4, 12);
    wall.fillStyle(0x6f675d);
    for (let i = 0; i < 6; i++) wall.fillCircle(wx + sign * 20 + (r() - 0.5) * 50, G - 30 - r() * (ARENA.wallHeight - 50), 8 + r() * 10);
  }
  root.add(wall);
  return root;
}

/** 選單背景用：整個戰場縮小置中 */
export function fitArenaCamera(scene: Phaser.Scene): void {
  const cam = scene.cameras.main;
  cam.setZoom(ARENA.width / (ARENA.world.width + 200));
  cam.centerOn(ARENA.world.width / 2, ARENA.groundY - 360);
}
