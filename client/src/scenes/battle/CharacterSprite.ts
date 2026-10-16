// 戰場上的角色：依狀態切換照片（待機 / 投擲 / 受傷 / 死亡）。
// 照片都是面向右，右方玩家自動翻轉。缺少的姿勢會退回待機照。
// 角色站在地面上，會被擊退：位置由伺服器算好的影格 [腳底x, 離地高度(負=往上), 傾斜角] 驅動。

import * as Phaser from 'phaser';
import { getCharacter, type Pose } from '../../../../shared/config/characters.js';
import { ARENA } from '../../../../shared/config/game.js';
import type { Seat } from '../../../../shared/types.js';
import { poseTexture } from '../../game/assets.js';
import { FONT } from './effects.js';

/** 各姿勢相對「站姿高度」的大小：h = 以高度為準，w = 以寬度為準 */
const POSE_SIZE: Record<Pose, { h?: number; w?: number }> = {
  idle: { h: 1 },
  hurt: { h: 1 },
  throw: { h: 1 },
  dead: { w: 1.05 },
};

const SEAT_COLOR = ['#3d7bd8', '#d8463d'];

export class CharacterSprite {
  readonly root: Phaser.GameObjects.Container;
  private body: Phaser.GameObjects.Container;
  private img: Phaser.GameObjects.Image;
  private shadow: Phaser.GameObjects.Ellipse;
  private tag: Phaser.GameObjects.Text;
  private breath: Phaser.Tweens.Tween | null = null;
  private base: Pose = 'idle';
  private current: Pose | null = null;
  private overrideTimer: Phaser.Time.TimerEvent | null = null;
  private readonly standHeight: number;
  /** 腳底 x（世界座標） */
  x: number;

  constructor(
    private scene: Phaser.Scene,
    private seat: Seat,
    private charId: string,
    x: number,
    name: string,
  ) {
    this.x = x;
    this.standHeight = getCharacter(charId)?.standHeight ?? 150;
    this.root = scene.add.container(x, ARENA.groundY).setDepth(20);
    this.shadow = scene.add.ellipse(0, 2, 90, 16, 0x000000, 0.25);
    // body 負責「被擊退時的傾斜/彈起」，以腳底為軸心
    this.body = scene.add.container(0, 0);
    this.img = scene.add.image(0, 0, poseTexture(scene, charId, 'idle').key).setOrigin(0.5, 1).setFlipX(seat === 1);
    this.body.add(this.img);
    this.tag = scene.add
      .text(0, -this.standHeight - 30, name, { fontFamily: FONT, fontSize: '20px', fontStyle: '900', color: '#ffffff', stroke: SEAT_COLOR[seat], strokeThickness: 6 })
      .setOrigin(0.5, 1);
    this.root.add([this.shadow, this.body, this.tag]);
    this.apply('idle');
    this.startBreathing();
  }

  get isDead(): boolean {
    return this.base === 'dead';
  }

  /** 頭頂附近的世界座標（傷害數字、狀態文字用） */
  get headY(): number {
    return ARENA.groundY - this.standHeight;
  }

  setName(name: string): void {
    this.tag.setText(name);
  }

  /** 直接放到某個位置（快照同步用） */
  placeAt(x: number): void {
    this.x = x;
    this.root.x = x;
    this.body.setPosition(0, 0).setRotation(0);
  }

  /** 擊退影格：腳底 x、離地位移（負 = 往上）、傾斜角 */
  setKnockPose(x: number, yOff: number, tilt: number): void {
    this.x = x;
    this.root.x = x;
    this.body.y = yOff;
    this.body.rotation = tilt;
    this.shadow.setScale(1 + yOff / 300, 1);
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

  /** 受傷：整個變白一瞬間 → 紅色 → 抖動（擊退本身由影格處理） */
  hurt(strong = false): void {
    if (this.base === 'dead') return;
    this.flash('hurt', strong ? 900 : 700);
    this.img.setTintFill(0xffffff);
    this.scene.time.delayedCall(70, () => this.img.setTint(0xff8a80));
    this.scene.time.delayedCall(strong ? 600 : 420, () => this.img.clearTint());
    const amp = strong ? 7 : 10;
    this.scene.tweens.add({
      targets: this.img,
      x: { from: -amp, to: amp },
      yoyo: true,
      repeat: 2,
      duration: 45,
      onComplete: () => (this.img.x = 0),
    });
  }

  die(animate = true): void {
    this.overrideTimer?.remove();
    this.overrideTimer = null;
    this.base = 'dead';
    this.breath?.stop();
    this.breath = null;
    this.root.setScale(1);
    this.body.setPosition(0, 0).setRotation(0);
    this.img.clearTint();
    this.apply('dead');
    this.tag.setAlpha(0.5);
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
      targets: this.body,
      scaleY: 1.015,
      yoyo: true,
      repeat: -1,
      duration: 1000 + this.seat * 130,
      ease: 'Sine.easeInOut',
    });
  }
}
