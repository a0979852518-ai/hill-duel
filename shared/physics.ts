// ============================================================
// 共用幾何工具（角色判定框、出手點、距離）
// 真正的物理模擬在 server/game/PhysicsWorld.ts（Matter.js）
// 這裡不依賴 Phaser，純數學，前後端都能 import。
// ============================================================

import { ARENA } from './config/game.js';
import type { DefenseView, Seat } from './types.js';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 角色受擊判定框（feetX = 角色目前腳底 x，角色會被擊退所以位置會變） */
export function characterHitbox(feetX: number, scale = 1): Rect {
  const w = ARENA.characterHitbox.w * scale,
    h = ARENA.characterHitbox.h * scale;
  return { x: feetX - w / 2, y: ARENA.groundY - h, w, h };
}

/** 頭部判定：身體上緣以上 */
export function headLineY(scale = 1): number {
  return ARENA.groundY - ARENA.characterBody.torsoH * scale;
}

export function defenseRect(d: Pick<DefenseView, 'x' | 'y' | 'w' | 'h'>): Rect {
  return { x: d.x - d.w / 2, y: d.y - d.h / 2, w: d.w, h: d.h };
}

export function launchPoint(seat: Seat, feetX: number, scale = 1): { x: number; y: number } {
  const dir = seat === 0 ? 1 : -1;
  return { x: feetX + ARENA.launchOffset.x * dir * scale, y: ARENA.groundY + ARENA.launchOffset.y * scale };
}

/** 防禦道具放手位置的合法區域（跟著角色位置移動） */
export function placementZone(seat: Seat, feetX: number): Rect {
  const z = ARENA.placementZone;
  const dir = seat === 0 ? 1 : -1;
  const x0 = dir > 0 ? feetX - z.back : feetX - z.front;
  return { x: x0, y: ARENA.groundY - z.top, w: z.back + z.front, h: z.top - 20 };
}

/** 點到矩形的最短距離（點在矩形內 = 0） */
export function distPointRect(px: number, py: number, r: Rect): number {
  const dx = Math.max(r.x - px, 0, px - (r.x + r.w));
  const dy = Math.max(r.y - py, 0, py - (r.y + r.h));
  return Math.hypot(dx, dy);
}

export function circleHitsRect(cx: number, cy: number, radius: number, r: Rect): boolean {
  return distPointRect(cx, cy, r) <= radius;
}

export function defenseBlocks(def: { blocks: 'all' | string[] }, tags: string[]): boolean {
  return def.blocks === 'all' || tags.some((t) => (def.blocks as string[]).includes(t));
}
