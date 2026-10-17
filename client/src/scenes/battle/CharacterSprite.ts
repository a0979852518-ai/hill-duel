// 戰場上的角色：依狀態切換照片（待機 / 投擲 / 受傷 / 死亡）。
// 照片都是面向右，右方玩家自動翻轉。缺少的姿勢會退回待機照。
// 角色站在地面上，會被擊退：位置由伺服器算好的影格 [腳底x, 離地高度(負=往上), 傾斜角] 驅動。

import * as Phaser from 'phaser';
import { getCharacter, type Pose } from '../../../../shared/config/characters.js';
import { ARENA } from '../../../../shared/config/game.js';
import type { Seat, StuckItem } from '../../../../shared/types.js';
import { iconKey, knockKey, poseTexture } from '../../game/assets.js';
import { FONT } from './effects.js';

/** 各姿勢相對「站姿高度」的大小：h = 以高度為準，w = 以寬度為準 */
const POSE_SIZE: Record<Pose, { h?: number; w?: number }> = {
  idle: { h: 1 },
  hurt: { h: 1 },
  throw: { h: 1 },
  dead: { w: 1.05 },
};

const SEAT_COLOR = ['#3d7bd8', '#d8463d'];

/**
 * 被打飛的 5 張動作圖裡，身體從「腳」到「頭頂」的位置（圖片的比例座標，圖是往左倒的方向）。
 * 黏在身上的東西用這條線把站姿位置換算到動作圖上，才會跟著身體滾。
 */
const KNOCK_AXIS: Record<number, { f: [number, number]; h: [number, number] }> = {
  1: { f: [0.62, 0.95], h: [0.12, 0.02] },
  2: { f: [0.72, 0.85], h: [0.13, 0.05] },
  3: { f: [0.35, 0.08], h: [0.25, 0.95] },
  4: { f: [0.6, 0.05], h: [0.05, 0.75] },
  5: { f: [0.95, 0.85], h: [0.05, 0.4] },
};
/** 黏在身上的便便畫面大小 */
const STUCK_SIZE = 30;

export class CharacterSprite {
  readonly root: Phaser.GameObjects.Container;
  private body: Phaser.GameObjects.Container;
  private img: Phaser.GameObjects.Image;
  private shadow: Phaser.GameObjects.Ellipse;
  /** 黏在身上的東西（跟著身體轉、滾） */
  private stuckLayer: Phaser.GameObjects.Container;
  private stuck: { item: StuckItem; img: Phaser.GameObjects.Image }[] = [];
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
    // 影子跟身高成比例（連恩比較矮）
    this.shadow = scene.add.ellipse(0, 2, (90 * this.standHeight) / 150, 16, 0x000000, 0.25);
    // body 負責「被擊退時的傾斜/彈起」，以腳底為軸心
    this.body = scene.add.container(0, 0);
    this.img = scene.add.image(0, 0, poseTexture(scene, charId, 'idle').key).setOrigin(0.5, 1).setFlipX(seat === 1);
    this.stuckLayer = scene.add.container(0, 0);
    this.body.add([this.img, this.stuckLayer]);
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
    this.realName = name;
    if (!this.nameGlitched) this.tag.setText(name);
  }

  // ------------------------------------------------------------ 怪誕 bug（純視覺，不影響遊戲）
  private realName = '';
  private nameGlitched = false;

  /** 名字變亂碼（到下次重設為止） */
  glitchName(on: boolean): void {
    this.nameGlitched = on;
    this.tag.setText(on ? ['▯▯▯ (undefined)', '名字讀取失敗', 'NULL', 'ㄅㄆㄇ亂碼'][(Math.random() * 4) | 0] : this.realName);
  }

  /** 頭下腳上（到下次重設為止） */
  glitchUpsideDown(on: boolean): void {
    this.img.setFlipY(on);
  }

  /** 模型被拉長又彈回來 */
  glitchStretch(): void {
    this.scene.tweens.add({ targets: this.root, scaleX: { from: 1, to: 2.2 }, scaleY: { from: 1, to: 0.6 }, yoyo: true, duration: 260, ease: 'Sine.easeInOut', onComplete: () => this.root.setScale(1) });
  }

  /** 原地轉一圈（物理引擎抽筋） */
  glitchSpin(): void {
    this.scene.tweens.add({ targets: this.root, angle: { from: 0, to: 360 }, duration: 700, ease: 'Cubic.easeInOut', onComplete: () => this.root.setAngle(0) });
  }

  /** 直接放到某個位置（快照同步用） */
  placeAt(x: number): void {
    this.endKnock();
    this.x = x;
    this.root.x = x;
    this.body.setPosition(0, 0).setRotation(0);
    this.body.scaleX = 1;
    this.shadow.setPosition(0, 2).setScale(1).setAlpha(1);
    this.layoutStuck();
  }

  // ------------------------------------------------------------ 黏在身上的東西（poopoo恩）

  /** 快照同步：數量不一樣才重建 */
  setStuck(list: StuckItem[]): void {
    if (list.length === this.stuck.length) return;
    for (const s of this.stuck) s.img.destroy();
    this.stuck = [];
    for (const it of list) this.addStuck(it, false);
  }

  /** 新黏上一坨：啪一下壓扁再彈回來 */
  addStuck(item: StuckItem, animate = true): void {
    const img = this.scene.add.image(0, 0, iconKey(item.itemId));
    const src = img.frame;
    const s = (STUCK_SIZE * (item.scale ?? 1)) / Math.max(src.width, src.height);
    img.setScale(s);
    this.stuckLayer.add(img);
    this.stuck.push({ item, img });
    this.layoutStuck();
    if (animate) {
      img.setScale(s * 1.6, s * 0.5);
      this.scene.tweens.add({ targets: img, scaleX: s, scaleY: s, duration: 380, ease: 'Back.easeOut' });
    }
  }

  /** 把站姿座標換算到目前的圖上（站著 / 被打飛的動作圖） */
  private layoutStuck(): void {
    if (this.stuck.length === 0) return;
    const facing = this.seat === 0 ? 1 : -1;
    const H = this.standHeight;
    // 腳 F → 頭頂 T 的身體軸線（body 容器座標）
    let F = { x: 0, y: 0 },
      T = { x: 0, y: -H };
    const ax = this.knockFrame ? KNOCK_AXIS[this.knockFrame] : undefined;
    if (ax) {
      const dw = this.img.displayWidth,
        dh = this.img.displayHeight;
      const pt = ([u, v]: [number, number]) => ({ x: (u - 0.5) * dw * facing, y: -(1 - v) * dh });
      F = pt(ax.f);
      T = pt(ax.h);
    }
    const Ax = T.x - F.x,
      Ay = T.y - F.y;
    const L = Math.hypot(Ax, Ay) || 1;
    // 胸口方向：軸線轉 90°（右方玩家鏡像）
    const Px = (-Ay / L) * facing,
      Py = (Ax / L) * facing;
    const base = Math.atan2(Ax, -Ay);
    const k = L / H;
    for (const { item, img } of this.stuck) {
      const t = item.y / H;
      img.setPosition(F.x + Ax * t + Px * item.x * k, F.y + Ay * t + Py * item.x * k);
      img.setRotation(base + item.rot * facing);
    }
  }

  /** 擊退影格：腳底 x、離地位移（負 = 往上）、傾斜角 */
  setKnockPose(x: number, yOff: number, tilt: number, flip = 1, frame = 0): void {
    this.x = x;
    this.root.x = x;
    this.body.y = yOff;
    this.body.rotation = tilt;
    const useFrame = frame > 0 && this.scene.textures.exists(knockKey(this.charId, frame));
    if (useFrame) {
      // 用被打飛的連續動作圖（往後仰 → 往後倒 → 滾 → 躺）
      this.showKnockFrame(frame);
      this.body.scaleX = 1;
    } else {
      if (this.knockFrame) this.endKnock();
      // 沒有連續動作圖的角色：在地上滾的時候身體翻面（側面看會變薄再翻過來）
      this.body.scaleX = Math.abs(flip) < 0.08 ? Math.sign(flip || 1) * 0.08 : flip;
    }
    this.layoutStuck();
    // 影子跟著身體中心，離地越高越小越淡
    const h = Math.max(0, -yOff);
    this.shadow.x = Math.sin(tilt) * this.standHeight * 0.5;
    this.shadow.setScale(Math.max(0.4, 1 - h / 400) * (1 + Math.abs(Math.sin(tilt)) * 0.8), 1).setAlpha(Math.max(0.08, 0.25 - h / 1200));
  }

  /** 目前顯示的連續動作圖（0 = 沒有） */
  private knockFrame = 0;

  private showKnockFrame(n: number): void {
    if (this.knockFrame === n) return;
    this.knockFrame = n;
    this.current = null;
    this.img.setTexture(knockKey(this.charId, n));
    // 5 張圖用同一個比例：第 1 張的高度 = 站姿高度
    const first = this.scene.textures.get(knockKey(this.charId, 1)).getSourceImage() as { height: number };
    this.img.setScale(this.standHeight / Math.max(1, first.height));
  }

  /** 結束連續動作，回到一般姿勢 */
  private endKnock(): void {
    if (!this.knockFrame) return;
    this.knockFrame = 0;
    this.current = null;
    this.apply(this.base === 'dead' ? 'dead' : this.base);
    this.layoutStuck();
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

  /** 被打飛時的受傷效果：只閃白/紅，不換受傷照、不抖（動作交給被打飛的連續動作圖） */
  hitFlash(): void {
    if (this.base === 'dead') return;
    this.img.setTintFill(0xffffff);
    this.scene.time.delayedCall(70, () => this.img.setTint(0xff8a80));
    this.scene.time.delayedCall(450, () => this.img.clearTint());
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
    this.knockFrame = 0;
    this.current = null;
    this.base = 'dead';
    this.breath?.stop();
    this.breath = null;
    this.root.setScale(1);
    this.body.setPosition(0, 0).setRotation(0);
    this.body.scaleX = 1;
    this.img.clearTint();
    this.apply('dead');
    this.tag.setAlpha(0.5);
    // 黏在身上的東西到死掉為止
    this.stuckLayer.setVisible(false);
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
    if (this.knockFrame) return; // 被打飛的動作播放中，不換圖
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
