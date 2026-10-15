// 隨機道具抽取：完全隨機、同一次不重複、支援權重。
// 不強制一攻一守，可能抽到兩個攻擊或兩個防禦。

import { ITEMS, type ItemDef } from '../../shared/config/items.js';

export type Rng = () => number;

/**
 * @param count     要抽幾個
 * @param eligible  額外的可抽條件（例如：場上已達上限的防禦道具、沒有目標的功能道具就不抽）
 */
export function drawItems(count: number, eligible: (item: ItemDef) => boolean, rng: Rng = Math.random): string[] {
  const pool = ITEMS.filter((i) => i.enabled !== false && (i.weight ?? 1) > 0 && eligible(i));
  const picked: string[] = [];
  const remaining = [...pool];
  while (picked.length < count && remaining.length > 0) {
    const total = remaining.reduce((s, i) => s + (i.weight ?? 1), 0);
    let r = rng() * total;
    let idx = 0;
    for (; idx < remaining.length - 1; idx++) {
      r -= remaining[idx].weight ?? 1;
      if (r < 0) break;
    }
    picked.push(remaining[idx].id);
    remaining.splice(idx, 1); // 不放回 → 同一次抽取不會重複
  }
  return picked;
}
