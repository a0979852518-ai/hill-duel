// ============================================================
// 拋物線物理（決定性、固定步長）
// ------------------------------------------------------------
// 伺服器用這支計算整條飛行路徑與命中點，結果直接傳給雙方播放，
// 因此兩邊看到的軌跡、命中位置一定一致。
// 這裡不依賴 Phaser，純數學，前後端都能 import。
// ============================================================

import { ARENA } from './config/game.js';
import type { ThrowableDef } from './config/items.js';
import type { DefenseView, ImpactKind, Seat } from './types.js';

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

export interface ThrowSimInput {
  seat: Seat;
  item: ThrowableDef;
  /** 角度（度），0 = 水平，90 = 垂直向上 */
  angle: number;
  /** 力道 0~1 */
  power: number;
  /** 場上防禦道具，以及每個防禦道具能擋哪些標籤 */
  defenses: (DefenseView & { blocks: 'all' | string[] })[];
}

export interface ThrowSimResult {
  path: [number, number][];
  sampleMs: number;
  impact: { x: number; y: number; kind: ImpactKind; defenseUid?: string; hitSeat?: Seat };
}

const SAMPLE_EVERY = 2; // 每 2 個物理步記錄一次路徑點

export function simulateThrow(input: ThrowSimInput): ThrowSimResult {
  const { seat, item, angle, power, defenses } = input;
  const dt = ARENA.physicsStep;
  const dir = seat === 0 ? 1 : -1;
  const enemy: Seat = seat === 0 ? 1 : 0;
  const p = Math.min(1, Math.max(0, power));
  const speed = item.minSpeed + (item.maxSpeed - item.minSpeed) * p;
  const rad = (angle * Math.PI) / 180;
  const g = ARENA.gravity * item.gravityScale;

  let { x, y } = launchPoint(seat);
  let vx = Math.cos(rad) * speed * dir;
  let vy = -Math.sin(rad) * speed;

  const path: [number, number][] = [[round1(x), round1(y)]];
  const enemyBox = characterHitbox(enemy);
  // 只有「敵方」且「能擋這種投擲物」的防禦道具會產生碰撞；自己的防禦不會擋到自己丟出去的東西
  const blockers = defenses.filter((d) => d.owner === enemy && defenseBlocks(d, item.tags));
  const maxSteps = Math.ceil(ARENA.maxFlightSeconds / dt);

  for (let step = 1; step <= maxSteps; step++) {
    vy += g * dt;
    x += vx * dt;
    y += vy * dt;
    if (step % SAMPLE_EVERY === 0) path.push([round1(x), round1(y)]);

    for (const d of blockers) {
      if (circleHitsRect(x, y, item.radius, defenseRect(d))) {
        return finish(path, x, y, 'defense', { defenseUid: d.uid });
      }
    }
    if (circleHitsRect(x, y, item.radius, enemyBox)) {
      return finish(path, x, y, 'character', { hitSeat: enemy });
    }
    for (const plat of ARENA.platforms) {
      if (circleHitsRect(x, y, item.radius, plat)) {
        return finish(path, x, y, 'platform');
      }
    }
    const ob = ARENA.outOfBounds;
    if (x < ob.minX || x > ob.maxX || y > ob.maxY) {
      return finish(path, x, y, 'out');
    }
  }
  return finish(path, x, y, 'out');
}

function finish(
  path: [number, number][],
  x: number,
  y: number,
  kind: ImpactKind,
  extra: { defenseUid?: string; hitSeat?: Seat } = {},
): ThrowSimResult {
  const last = path[path.length - 1];
  if (!last || last[0] !== round1(x) || last[1] !== round1(y)) path.push([round1(x), round1(y)]);
  return {
    path,
    sampleMs: (ARENA.physicsStep * SAMPLE_EVERY * 1000),
    impact: { x: round1(x), y: round1(y), kind, ...extra },
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
