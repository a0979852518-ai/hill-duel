// 場景背景：一大片平地戰場（世界座標 ARENA.world），遠景（視差）＋地面。
// 遠景用 client/public/assets/backgrounds/campus.jpg（蕙蘭樓照片：中間原圖、兩側鏡像延伸、上方補天空），
// 載入失敗時退回程式畫的天空與遠山。

import * as Phaser from 'phaser';
import { ARENA } from '../../../shared/config/game.js';

export const BACKGROUND_KEY = 'bg:arena';
export const BACKGROUND_PATH = 'assets/backgrounds/campus.jpg';

/**
 * 遠景照片怎麼擺：
 *  照片 1 像素 = 世界 1.4 像素（大樓在人物後面很遠，所以比真實比例小一點；人 150px）
 *  貼圖寬 4096 = 照片 4608 像素（3 份照片寬）→ 每貼圖像素 = 4608/4096 照片像素
 *  視差 0.35：大樓比人物後面很遠，鏡頭移動時移得比較慢
 *  照片底邊（裁在大樓前廣場）放在地面線下面，被前景地面蓋住（不能露出縫）
 */
const PHOTO = { worldPerTexel: (4608 / 4096) * 1.4, scrollX: 0.35, centerX: 1190, bottomY: ARENA.groundY + 10 };

export const GROUND_KEY = 'bg:groundPixel';
/** 像素風地磚（1 texel = 世界 8px，左右可無縫重複） */
export const GROUND_PATH = 'assets/backgrounds/ground_pixel.png';
const GROUND_TEXEL = 8;
/** 地面往世界兩側延伸多遠 */
const GROUND_EXTRA = 9000;

export function queueBackground(scene: Phaser.Scene): void {
  scene.load.image(BACKGROUND_KEY, BACKGROUND_PATH);
  scene.load.image(GROUND_KEY, GROUND_PATH);
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
    const img = scene.add
      .image(PHOTO.centerX, PHOTO.bottomY, BACKGROUND_KEY)
      .setOrigin(0.5, 1)
      .setScale(PHOTO.worldPerTexel)
      .setScrollFactor(PHOTO.scrollX, 1);
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

  // 地面：像素風地磚（配合背景圖的廣場）；圖片沒載入時退回程式畫的地磚
  const pixelGround = scene.textures.exists(GROUND_KEY);
  if (pixelGround) {
    scene.textures.get(GROUND_KEY).setFilter(Phaser.Textures.FilterMode.NEAREST);
    root.add(
      scene.add
        // 沒有地圖邊界：地面往兩邊鋪很遠（tileSprite 重複貼，不佔額外記憶體）
        .tileSprite(-GROUND_EXTRA, G - 4, (W + GROUND_EXTRA * 2) / GROUND_TEXEL, (BOTTOM - G + 4) / GROUND_TEXEL, GROUND_KEY)
        .setOrigin(0, 0)
        .setScale(GROUND_TEXEL),
    );
  }
  // 地面（程式畫的地磚＋距離木樁）
  const gTop = G - 40;
  root.add(
    baked(scene, pixelGround ? 'arena:stakes' : 'arena:ground', left, gTop, span, BOTTOM - gTop, 0.5, (g, X, Y, S) => {
      const rr = rng(17);
      if (pixelGround) {
        drawStakes(g, X, Y, S);
        return;
      }
      // 廣場的水泥地磚（跟背景照片的廣場同色）
      g.fillStyle(0xcdc8c0).fillRect(X(left), Y(G - 4), S(span), S(BOTTOM - G + 4));
      g.fillStyle(0xbdb8b0).fillRect(X(left), Y(G + 90), S(span), S(BOTTOM - G - 90));
      g.fillStyle(0xaaa59d).fillRect(X(left), Y(G + 260), S(span), S(BOTTOM - G - 260));
      // 地磚縫：橫線＋錯開的直線
      g.fillStyle(0x9e9990, 0.8);
      for (const yy of [G + 90, G + 260]) g.fillRect(X(left), Y(yy), S(span), S(3));
      for (let x = left; x < right; x += 240) {
        g.fillRect(X(x), Y(G - 4), S(3), S(94));
        g.fillRect(X(x + 120), Y(G + 90), S(3), S(170));
      }
      // 地磚上的斑點
      for (let i = 0; i < 160; i++) g.fillStyle(0x8f8a82, 0.25).fillCircle(X(left + rr() * span), Y(G + 6 + rr() * 500), S(2 + rr() * 5));
      // 地面邊緣的亮線
      g.fillStyle(0xe2ded7).fillRect(X(left), Y(G - 4), S(span), S(5));
      drawStakes(g, X, Y, S);
    }),
  );

  return root;
}

/** 距離標記：每 200px 一根小木樁，方便判斷距離 */
function drawStakes(g: Phaser.GameObjects.Graphics, X: (x: number) => number, Y: (y: number) => number, S: (v: number) => number): void {
  const G = ARENA.groundY;
  for (let x = 200; x < ARENA.world.width; x += 200) {
    g.fillStyle(0x2b2118).fillRect(X(x - 4), Y(G - 30), S(8), S(30));
    g.fillStyle(0xd7b98a).fillRect(X(x - 2), Y(G - 28), S(4), S(26));
  }
}

/** 選單背景用：整個戰場縮小置中 */
export function fitArenaCamera(scene: Phaser.Scene): void {
  const cam = scene.cameras.main;
  cam.setZoom(ARENA.width / (ARENA.world.width + 200));
  cam.centerOn(ARENA.world.width / 2, ARENA.groundY - 360);
}
