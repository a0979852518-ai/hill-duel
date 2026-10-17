// 怪誕 bug：偶爾出現的搞笑畫面錯亂（純視覺、只在自己的畫面上，不影響傷害與勝負）。
// 設定面板可以關掉。

import * as Phaser from 'phaser';
import { sfx } from '../../game/sfx.js';
import { FONT } from './effects.js';

/** 這次要不要出 bug（設定關掉就永遠不會） */
export function glitch(chance: number): boolean {
  // 測試用：window.__glitchAll = true 時每次都出
  if ((window as unknown as { __glitchAll?: boolean }).__glitchAll) return sfx.settings.glitches;
  return sfx.settings.glitches && Math.random() < chance;
}

export const GLITCH_LINES = ['這不是 bug，是 feature 🐛', '工程師正在修…大概吧', '物理引擎喝醉了', '重力請假中', '貼圖讀錯了'];

/** bug 出現時的大字＋怪聲：字比一般提示大、會抖、顏色閃爍 */
export function glitchText(scene: Phaser.Scene, x: number, y: number, text: string): void {
  sfx.play('glitch');
  const t = scene.add
    .text(x, y, text, { fontFamily: FONT, fontSize: '38px', fontStyle: '900', color: '#ea80fc', stroke: '#2b2118', strokeThickness: 7 })
    .setOrigin(0.5)
    .setDepth(85);
  // 像訊號不良一樣左右抖、顏色亂跳
  const colors = ['#ea80fc', '#18ffff', '#ffff00', '#ff5252'];
  let n = 0;
  const ev = scene.time.addEvent({
    delay: 70,
    repeat: 14,
    callback: () => {
      n++;
      t.setX(x + (Math.random() - 0.5) * 16).setColor(colors[n % colors.length]);
    },
  });
  scene.tweens.add({ targets: t, scale: { from: 1.4, to: 1 }, duration: 180, ease: 'Back.easeOut' });
  scene.tweens.add({
    targets: t,
    y: y - 50,
    alpha: 0,
    delay: 1300,
    duration: 600,
    onComplete: () => {
      ev.remove();
      t.destroy();
    },
  });
}
