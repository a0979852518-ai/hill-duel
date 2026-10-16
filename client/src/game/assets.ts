// 素材載入：設定檔裡有填圖片就載入，載入失敗或沒填就自動畫 placeholder。
// 之後補素材只要把圖片放進 client/public/assets/... 並在設定檔填路徑。

import * as Phaser from 'phaser';
import { CHARACTERS, type CharacterDef, type Pose } from '../../../shared/config/characters.js';
import { ITEMS, type ItemDef, type ItemPlaceholder } from '../../../shared/config/items.js';

/** 角色某個姿勢的貼圖 key（idle 一定存在，其他姿勢可能沒有） */
export const charKey = (id: string, pose: Pose = 'idle') => `char:${id}:${pose}`;
/** 被打飛連續動作的第 n 張（1~5） */
export const knockKey = (id: string, n: number) => `char:${id}:knock${n}`;

/** 取得可用的姿勢貼圖：沒有這個姿勢就退回 idle */
export function poseTexture(scene: Phaser.Scene, id: string, pose: Pose): { key: string; exact: boolean } {
  const k = charKey(id, pose);
  if (scene.textures.exists(k)) return { key: k, exact: true };
  return { key: charKey(id, 'idle'), exact: pose === 'idle' };
}
export const iconKey = (id: string) => `icon:${id}`;
export const projKey = (id: string) => `proj:${id}`;
export const defKey = (id: string) => `def:${id}`;
export const HIDDEN_ICON = 'icon:__hidden';

/** 在 preload() 裡呼叫 */
export function queueAssets(scene: Phaser.Scene): void {
  for (const c of CHARACTERS) {
    if (c.enabled === false) continue;
    for (const [pose, src] of Object.entries(c.poses ?? {})) if (src) scene.load.image(charKey(c.id, pose as Pose), src);
    c.knockFrames?.forEach((src, i) => scene.load.image(knockKey(c.id, i + 1), src));
  }
  for (const i of ITEMS) {
    if (i.enabled === false) continue; // 停用的道具不載入圖片（不出現在遊戲裡）
    if (i.icon) scene.load.image(iconKey(i.id), i.icon);
    if (i.kind === 'throwable' && i.sprite) scene.load.image(projKey(i.id), i.sprite);
    if (i.kind === 'defense' && i.sprite) scene.load.image(defKey(i.id), i.sprite);
  }
  // 圖片不存在時不要讓整個遊戲壞掉：記錄下來，稍後用 placeholder 補
  scene.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
    console.info(`[assets] 找不到 ${file.src}，改用臨時圖形`);
  });
}

/** 在 create() 裡呼叫：補齊所有缺少的貼圖 */
export function ensurePlaceholders(scene: Phaser.Scene): void {
  if (!scene.textures.exists(HIDDEN_ICON)) {
    const g = scene.make.graphics({}, false);
    g.fillStyle(0x2b2118).fillRoundedRect(0, 0, 64, 64, 12);
    g.fillStyle(0x6ec1e4).fillRoundedRect(4, 4, 56, 56, 10);
    g.lineStyle(6, 0x2b2118).strokeCircle(32, 26, 11);
    g.fillStyle(0x2b2118).fillRect(28, 38, 8, 8).fillRect(28, 50, 8, 6);
    g.generateTexture(HIDDEN_ICON, 64, 64);
    g.destroy();
  }
  for (const c of CHARACTERS) if (!scene.textures.exists(charKey(c.id))) drawCharacter(scene, c);
  for (const i of ITEMS) {
    if (!scene.textures.exists(iconKey(i.id))) drawIcon(scene, iconKey(i.id), i.placeholder, 64);
    // 投擲物沒有專用圖時直接用道具圖示飛出去；連圖示都沒有才畫幾何圖形
    if (i.kind === 'throwable' && !scene.textures.exists(projKey(i.id)) && !i.icon)
      drawIcon(scene, projKey(i.id), i.placeholder, Math.max(12, i.radius * 2 + 4));
    if (i.kind === 'defense' && !scene.textures.exists(defKey(i.id))) drawDefense(scene, i);
  }
}

function drawCharacter(scene: Phaser.Scene, c: CharacterDef): void {
  const w = 64,
    h = 150;
  const g = scene.make.graphics({}, false);
  g.fillStyle(0x2b2118).fillRoundedRect(14, 92, 14, 58, 6).fillRoundedRect(36, 92, 14, 58, 6); // 腿
  const ink = 0x2b2118;
  // 身體
  g.fillStyle(ink).fillRoundedRect(6, 38, 52, 58, 14);
  g.fillStyle(c.placeholder.color).fillRoundedRect(9, 41, 46, 52, 12);
  // 頭
  g.fillStyle(ink).fillCircle(32, 24, 22);
  g.fillStyle(c.placeholder.accent).fillCircle(32, 24, 19);
  // 眼睛（面向右）
  g.fillStyle(ink).fillCircle(38, 21, 3.2).fillCircle(48, 21, 3.2);
  g.fillStyle(0xffffff).fillCircle(39, 20, 1.2).fillCircle(49, 20, 1.2);
  // 腰帶
  g.fillStyle(ink, 0.5).fillRect(9, 70, 46, 5);
  g.generateTexture(charKey(c.id, 'idle'), w, h);
  g.destroy();
}

function drawIcon(scene: Phaser.Scene, key: string, ph: ItemPlaceholder, size: number): void {
  const g = scene.make.graphics({}, false);
  const s = size,
    c = s / 2,
    ink = 0x2b2118,
    lw = Math.max(2, s / 16);
  g.lineStyle(lw, ink);
  g.fillStyle(ph.color);
  switch (ph.shape) {
    case 'circle':
      g.fillCircle(c, c, c - lw).strokeCircle(c, c, c - lw);
      g.fillStyle(0xffffff, 0.35).fillCircle(c - s * 0.15, c - s * 0.15, s * 0.12);
      break;
    case 'rect':
      g.fillRoundedRect(s * 0.18, lw, s * 0.64, s - lw * 2, s * 0.08).strokeRoundedRect(s * 0.18, lw, s * 0.64, s - lw * 2, s * 0.08);
      break;
    case 'diamond': {
      const pts = [new Phaser.Math.Vector2(c, lw), new Phaser.Math.Vector2(s - lw, c), new Phaser.Math.Vector2(c, s - lw), new Phaser.Math.Vector2(lw, c)];
      g.fillPoints(pts, true).strokePoints(pts, true);
      break;
    }
    case 'bolt': {
      const p = (x: number, y: number) => new Phaser.Math.Vector2(x * s, y * s);
      const pts = [p(0.55, 0.04), p(0.2, 0.55), p(0.46, 0.55), p(0.36, 0.96), p(0.82, 0.4), p(0.54, 0.4), p(0.66, 0.04)];
      g.fillPoints(pts, true).strokePoints(pts, true);
      break;
    }
    case 'hammer':
      g.fillStyle(0x8d6e63).fillRect(c - s * 0.06, s * 0.3, s * 0.12, s * 0.66).strokeRect(c - s * 0.06, s * 0.3, s * 0.12, s * 0.66);
      g.fillStyle(ph.color).fillRoundedRect(s * 0.14, s * 0.08, s * 0.72, s * 0.28, 4).strokeRoundedRect(s * 0.14, s * 0.08, s * 0.72, s * 0.28, 4);
      break;
  }
  g.generateTexture(key, s, s);
  g.destroy();
}

function drawDefense(scene: Phaser.Scene, item: Extract<ItemDef, { kind: 'defense' }>): void {
  const { w, h } = item.size;
  const g = scene.make.graphics({}, false);
  const ink = 0x2b2118;
  const col = item.placeholder.color;
  if (item.placeholder.translucent) {
    g.fillStyle(col, 0.45).fillRoundedRect(0, 0, w, h, w / 2);
    g.lineStyle(3, 0xffffff, 0.9).strokeRoundedRect(2, 2, w - 4, h - 4, w / 2);
  } else {
    g.fillStyle(ink).fillRoundedRect(0, 0, w, h, 4);
    g.fillStyle(col).fillRoundedRect(3, 3, w - 6, h - 6, 3);
    g.lineStyle(2, ink, 0.35);
    for (let y = 18; y < h - 6; y += 18) g.lineBetween(4, y, w - 4, y);
  }
  g.generateTexture(defKey(item.id), w, h);
  g.destroy();
}
