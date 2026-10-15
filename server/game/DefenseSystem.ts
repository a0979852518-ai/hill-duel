// 防禦系統：放置合法性檢查與建立防禦道具。

import { ARENA } from '../../shared/config/game.js';
import type { DefenseDef } from '../../shared/config/items.js';
import type { ErrorCode, Seat } from '../../shared/types.js';
import { defenseRect, type Rect } from '../../shared/physics.js';
import type { BattleState, DefenseState } from './BattleState.js';

function rectInside(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h
  );
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** 這個玩家現在還能不能再放這種防禦道具（用於抽取池過濾） */
export function canPlaceMore(state: BattleState, seat: Seat, def: DefenseDef): boolean {
  if (def.maxPerPlayer === undefined) return true;
  return state.defenses.filter((d) => d.owner === seat && d.itemId === def.id).length < def.maxPerPlayer;
}

export function validatePlacement(state: BattleState, seat: Seat, def: DefenseDef, x: number, y: number): ErrorCode | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 'INVALID_INPUT';
  const rect = defenseRect({ x, y, w: def.size.w, h: def.size.h });
  if (!rectInside(rect, ARENA.placementZones[seat])) return 'INVALID_POSITION';
  if (state.defenses.some((d) => rectsOverlap(rect, defenseRect(d)))) return 'INVALID_POSITION';
  if (!canPlaceMore(state, seat, def)) return 'INVALID_POSITION';
  return null;
}

export function createDefense(state: BattleState, seat: Seat, def: DefenseDef, x: number, y: number): DefenseState {
  const d: DefenseState = {
    uid: state.nextUid('d'),
    itemId: def.id,
    owner: seat,
    x: Math.round(x),
    y: Math.round(y),
    w: def.size.w,
    h: def.size.h,
    durability: def.durability,
    maxDurability: def.durability,
    hits: 0,
    maxHits: def.maxHits,
    remainingTurns: def.durationTurns,
    blocks: def.blocks,
    damageReduction: def.damageReduction,
  };
  state.defenses.push(d);
  return d;
}
