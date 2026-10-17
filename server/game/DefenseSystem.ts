// 防禦系統：放置合法性檢查與建立防禦道具（真實物理：從放手位置掉下來堆疊）。

import { scaledDefenseSize } from '../../shared/config/characters.js';
import type { DefenseDef } from '../../shared/config/items.js';
import { placementZone } from '../../shared/physics.js';
import type { ErrorCode, Seat } from '../../shared/types.js';
import type { BattleState, DefenseState } from './BattleState.js';

/** 這個玩家現在還能不能再放這種防禦道具（用於抽取池過濾） */
export function canPlaceMore(state: BattleState, seat: Seat, def: DefenseDef): boolean {
  if (def.maxPerPlayer === undefined) return true;
  return state.defenses.filter((d) => d.owner === seat && d.itemId === def.id).length < def.maxPerPlayer;
}

/** 依放置者的角色調整防禦道具大小（捲毛的回收紙箱比較大） */
export function defenseForSeat(state: BattleState, seat: Seat, def: DefenseDef): DefenseDef {
  const size = scaledDefenseSize(def.size, def.id, state.characterIds[seat]);
  return size === def.size ? def : { ...def, size };
}

/** 放手位置（道具中心）必須在自己的區域內，而且不能跟現有東西重疊 */
export function validatePlacement(state: BattleState, seat: Seat, def: DefenseDef, x: number, y: number): ErrorCode | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 'INVALID_INPUT';
  def = defenseForSeat(state, seat, def);
  const z = placementZone(seat, state.physics.getCharX(seat));
  if (x < z.x || x > z.x + z.w || y < z.y || y > z.y + z.h) return 'INVALID_POSITION';
  if (!canPlaceMore(state, seat, def)) return 'INVALID_POSITION';
  if (!state.physics.canPlace(def, seat, x, y)) return 'INVALID_POSITION';
  return null;
}

export function createDefense(state: BattleState, seat: Seat, def: DefenseDef, x: number, y: number): DefenseState {
  def = defenseForSeat(state, seat, def);
  const uid = state.nextUid('d');
  state.physics.addDefense(uid, def, seat, x, y);
  const d: DefenseState = {
    uid,
    itemId: def.id,
    owner: seat,
    x: Math.round(x),
    y: Math.round(y),
    w: def.size.w,
    h: def.size.h,
    angle: 0,
    durability: def.durability,
    maxDurability: def.durability,
    hits: 0,
    maxHits: def.maxHits === null ? null : def.maxHits + (state.traits(seat).defenseExtraHits?.[def.id] ?? 0),
    remainingTurns: def.durationTurns,
    blocks: def.blocks,
    damageReduction: def.damageReduction,
  };
  state.defenses.push(d);
  return d;
}
