// 場景背景：一大片平地戰場（世界座標 ARENA.world），天空、遠山（視差）、地面。
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
  // 天空＋太陽＋雲＋遠山 合成一張貼圖、一個視差圖層（以前是 5 層全螢幕疊圖，手機 GPU 很吃力）
  // 鏡頭看到比貼圖更高的地方時，露出的是遊戲底色（main.ts 的 backgroundColor＝天空頂端的顏色）
  const BX0 = -1400,
    BX1 = W - 800,
    BY0 = -900,
    BY1 = G + 10;
  const RES = 0.4;
  const bw = Math.ceil((BX1 - BX0) * RES),
    bh = Math.ceil((BY1 - BY0) * RES);
  if (scene.textures.exists(BACKGROUND_KEY)) {
    const img = scene.add.image(BX0, BY1, BACKGROUND_KEY).setOrigin(0, 1).setScrollFactor(0.5, 1);
    img.setDisplaySize(BX1 - BX0, BY1 - BY0);
    root.add(img);
  } else {
    if (!scene.textures.exists('arena:backdrop')) {
      const tex = scene.textures.createCanvas('arena:backdrop', bw, bh)!;
      const ctx = tex.getContext();
      const X = (x: number) => (x - BX0) * RES,
        Y = (y: number) => (y - BY0) * RES,
        S = (v: number) => v * RES;
      // 天空漸層
      const grad = ctx.createLinearGradient(0, 0, 0, bh);
      grad.addColorStop(0, '#3f8fd0');
      grad.addColorStop(0.55, '#8cc4ea');
      grad.addColorStop(1, '#ffe3b0');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, bw, bh);
      const r = rng(7);
      // 太陽
      const sunX = (BX0 + BX1) / 2,
        sunY = 380;
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.arc(X(sunX), Y(sunY), S(150), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,243,196,0.95)';
      ctx.beginPath();
      ctx.arc(X(sunX), Y(sunY), S(95), 0, Math.PI * 2);
      ctx.fill();
      // 雲
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      const ell = (x: number, y: number, w: number, h: number) => {
        ctx.beginPath();
        ctx.ellipse(X(x), Y(y), S(w / 2), S(h / 2), 0, 0, Math.PI * 2);
        ctx.fill();
      };
      for (let k = 0; k < 16; k++) {
        const x = BX0 + r() * (BX1 - BX0),
          y = BY0 + 150 + r() * 650,
          sc = 0.8 + r() * 1.3;
        ell(x, y, 150 * sc, 44 * sc);
        ell(x + 38 * sc, y - 18 * sc, 95 * sc, 54 * sc);
      }
      // 遠山兩層
      const hills = (seed: number, color: string, baseY: number, amp: number, step: number) => {
        const rr = rng(seed);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(X(BX0), Y(BY1 + 50));
        for (let x = BX0; x <= BX1 + step; x += step) ctx.lineTo(X(x), Y(baseY - amp * (0.4 + rr() * 0.6)));
        ctx.lineTo(X(BX1 + step), Y(BY1 + 50));
        ctx.closePath();
        ctx.fill();
      };
      hills(11, '#a9cfae', G - 180, 260, 220);
      hills(13, '#86b78c', G - 70, 170, 160);
      tex.refresh();
    }
    root.add(scene.add.image(BX0, BY0, 'arena:backdrop').setOrigin(0, 0).setScale(1 / RES).setScrollFactor(0.5, 1));
  }

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

  return root;
}

/** 選單背景用：整個戰場縮小置中 */
export function fitArenaCamera(scene: Phaser.Scene): void {
  const cam = scene.cameras.main;
  cam.setZoom(ARENA.width / (ARENA.world.width + 200));
  cam.centerOn(ARENA.world.width / 2, ARENA.groundY - 360);
}
