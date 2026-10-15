// 戰場上的角色：依狀態切換照片（待機 / 投擲 / 受傷 / 死亡）。
// 照片都是面向右，右方玩家自動翻轉。缺少的姿勢會退回待機照。

import * as Phaser from 'phaser';
import { getCharacter, type Pose } from '../../../../shared/config/characters.js';
import { ARENA } from '../../../../shared/config/game.js';
import type { Seat } from '../../../../shared/types.js';
import { poseTexture } from '../../game/assets.js';

/** 各姿勢相對「站姿高度」的大小：h = 以高度為準，w = 以寬度為準 */
const POSE_SIZE: Record<Pose, { h?: number; w?: number }> = {
  idle: { h: 1 },
  hurt: { h: 1 },
  throw: { h: 1 },
  dead: { w: 1.05 },
};

export class CharacterSprite {
  readonly root: Phaser.GameObjects.Container;
  private img: Phaser.GameObjects.Image;
  private breath: Phaser.Tweens.Tween | null = null;
  private base: Pose = 'idle';
  private current: Pose | null = null;
  private overrideTimer: Phaser.Time.TimerEvent | null = null;
  private readonly standHeight: number;
  private readonly baseX: number;

  constructor(
    private scene: Phaser.Scene,
    private seat: Seat,
    private charId: string,
  ) {
    const feet = ARENA.characterFeet[seat];
    this.baseX = feet.x;
    this.standHeight = getCharacter(charId)?.standHeight ?? 150;
    this.root = scene.add.container(feet.x, feet.y).setDepth(20);
    this.img = scene.add.image(0, 0, poseTexture(scene, charId, 'idle').key).setOrigin(0.5, 1).setFlipX(seat === 1);
    this.root.add(this.img);
    this.apply('idle');
    this.startBreathing();
  }

  get isDead(): boolean {
    return this.base === 'dead';
  }

  /** 設定常態姿勢（待機 / 瞄準中）；受傷動畫進行中會等它結束再套用 */
  setBase(pose: Pose): void {
    if (this.base === 'dead' && pose !== 'dead') return;
    this.base = pose;
    if (!this.overrideTimer) this.apply(pose);
  }

  /** 短暫顯示某個姿勢，時間到回到常態姿勢 */
  flash(pose: Pose, ms: number): void {
    if (this.base === 'dead') return;
    this.overrideTimer?.remove();
    this.apply(pose);
    this.overrideTimer = this.scene.time.delayedCall(ms, () => {
      this.overrideTimer = null;
      this.apply(this.base);
    });
  }

  hurt(): void {
    if (this.base === 'dead') return;
    this.flash('hurt', 700);
    this.img.setTint(0xff8a80);
    const dir = this.seat === 0 ? -1 : 1;
    this.scene.tweens.add({
      targets: this.root,
      x: this.baseX + 12 * dir,
      yoyo: true,
      repeat: 1,
      duration: 70,
      onComplete: () => {
        this.root.x = this.baseX;
        this.img.clearTint();
      },
    });
  }

  die(animate = true): void {
    this.overrideTimer?.remove();
    this.overrideTimer = null;
    this.base = 'dead';
    this.breath?.stop();
    this.breath = null;
    this.root.setScale(1);
    this.img.clearTint();
    this.apply('dead');
    if (animate) {
      this.img.setAlpha(0);
      this.img.y = -40;
      this.scene.tweens.add({ targets: this.img, alpha: 1, y: 0, duration: 500, ease: 'Bounce.easeOut' });
    }
  }

  celebrate(): void {
    this.scene.tweens.add({ targets: this.img, y: -30, yoyo: true, repeat: 3, duration: 220 });
  }

  private apply(pose: Pose): void {
    if (this.current === pose) return;
    this.current = pose;
    const { key } = poseTexture(this.scene, this.charId, pose);
    this.img.setTexture(key);
    const frame = this.img.frame;
    // 退回待機照時沿用待機的大小
    const usedPose: Pose = key.endsWith(`:${pose}`) ? pose : 'idle';
    const s = POSE_SIZE[usedPose];
    const scale = s.w ? (this.standHeight * s.w) / frame.width : (this.standHeight * (s.h ?? 1)) / frame.height;
    this.img.setScale(scale);
  }

  private startBreathing(): void {
    this.breath = this.scene.tweens.add({
      targets: this.root,
      scaleY: 1.015,
      yoyo: true,
      repeat: -1,
      duration: 1000 + this.seat * 130,
      ease: 'Sine.easeInOut',
    });
  }
}
