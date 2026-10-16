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

export function characterHitbox(seat: Seat): Rect {
  const feet = ARENA.characterFeet[seat];
  const { w, h } = ARENA.characterHitbox;
  return { x: feet.x - w / 2, y: feet.y - h, w, h };
}

export function defenseRect(d: Pick<DefenseView, 'x' | 'y' | 'w' | 'h'>): Rect {
  return { x: d.x - d.w / 2, y: d.y - d.h / 2, w: d.w, h: d.h };
}

export function launchPoint(seat: Seat): { x: number; y: number } {
  const feet = ARENA.characterFeet[seat];
  const dir = seat === 0 ? 1 : -1;
  return { x: feet.x + ARENA.launchOffset.x * dir, y: feet.y + ARENA.launchOffset.y };
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
