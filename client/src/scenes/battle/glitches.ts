// 怪誕 bug：偶爾出現的搞笑畫面錯亂（純視覺、只在自己的畫面上，不影響傷害與勝負）。
// 設定面板可以關掉。

import { sfx } from '../../game/sfx.js';

/** 這次要不要出 bug（設定關掉就永遠不會） */
export function glitch(chance: number): boolean {
  // 測試用：window.__glitchAll = true 時每次都出
  if ((window as unknown as { __glitchAll?: boolean }).__glitchAll) return sfx.settings.glitches;
  return sfx.settings.glitches && Math.random() < chance;
}

export const GLITCH_LINES = ['這不是 bug，是 feature 🐛', '工程師正在修…大概吧', '物理引擎喝醉了', '重力請假中', '貼圖讀錯了'];
