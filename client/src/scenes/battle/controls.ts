// 戰鬥中央的操作介面：老虎機、道具二選一卡片、角度/力道、放置預覽、目標選擇。
// 這些元件只負責「畫面」，真正的判定都在伺服器。

import * as Phaser from 'phaser';
import { ARENA } from '../../../../shared/config/game.js';
import { getItem, ITEMS, type DefenseDef } from '../../../../shared/config/items.js';
import { defenseRect, launchPoint, placementZone } from '../../../../shared/physics.js';
import type { DefenseView, Seat } from '../../../../shared/types.js';
import { iconKey } from '../../game/assets.js';
import { FONT } from './effects.js';

const CX = ARENA.width / 2;
import type { ItemDef } from '../../../../shared/config/items.js';
import { HIDDEN_ICON } from '../../game/assets.js';

function kindLabel(item: ItemDef): string {
  if (item.kind === 'throwable') return item.weightKg ? `投擲攻擊 · ${fmtKg(item.weightKg)}` : '投擲攻擊';
  if (item.kind === 'defense') return '防禦';
  return item.role === 'defense' ? '功能防禦' : '功能攻擊';
}
function fmtKg(kg: number): string {
  return kg >= 0.1 ? `${kg}kg` : `${Math.round(kg * 1000)}g`;
}
function kindColor(item: ItemDef): number {
  if (item.kind === 'throwable') return 0xe8743b;
  if (item.kind === 'defense') return 0x3d7bd8;
  return item.role === 'defense' ? 0x43a047 : 0x8e5cc2;
}

// ------------------------------------------------------------ 老虎機

export class SlotMachine {
  private root: Phaser.GameObjects.Container;
  private reels: Phaser.GameObjects.Image[] = [];
  private hint: Phaser.GameObjects.Text;
  private spinTimer: Phaser.Time.TimerEvent | null = null;
  private state: 'hidden' | 'spinning' | 'landing' | 'landed' = 'hidden';
  private landPromise: Promise<void> = Promise.resolve();
  private ids = ITEMS.filter((i) => i.enabled !== false).map((i) => i.id);

  constructor(private scene: Phaser.Scene) {
    this.root = scene.add.container(CX, 300).setDepth(60).setVisible(false);
    const frame = scene.add.rectangle(0, 0, 330, 190, 0x5d3a1a).setStrokeStyle(5, 0x2b2118);
    const title = scene.add
      .text(0, -78, '★ 道具老虎機 ★', { fontFamily: FONT, fontSize: '20px', fontStyle: '900', color: '#ffd54f' })
      .setOrigin(0.5);
    this.root.add([frame, title]);
    for (let i = 0; i < 2; i++) {
      const x = i === 0 ? -75 : 75;
      const win = scene.add.rectangle(x, 5, 120, 120, 0xfff8ea).setStrokeStyle(4, 0x2b2118);
      const img = scene.add.image(x, 5, iconKey(this.ids[0])).setDisplaySize(84, 84);
      this.reels.push(img);
      this.root.add([win, img]);
    }
    this.hint = scene.add
      .text(0, 112, '', { fontFamily: FONT, fontSize: '18px', fontStyle: '900', color: '#ffffff', stroke: '#2b2118', strokeThickness: 6 })
      .setOrigin(0.5);
    this.root.add(this.hint);
  }

  get isLanded(): boolean {
    return this.state === 'landed' || this.state === 'landing';
  }

  spin(hint: string): void {
    this.hint.setText(hint);
    if (this.state === 'spinning') return;
    this.state = 'spinning';
    this.root.setVisible(true).setScale(0.8).setAlpha(0);
    this.scene.tweens.add({ targets: this.root, scale: 1, alpha: 1, duration: 200, ease: 'Back.easeOut' });
    this.spinTimer?.remove();
    let tick = 0;
    this.spinTimer = this.scene.time.addEvent({
      delay: 70,
      loop: true,
      callback: () => {
        tick++;
        this.reels.forEach((r, i) => {
          r.setTexture(iconKey(this.ids[(tick + i * 3) % this.ids.length]));
          fitInto(r, 84);
          r.y = 5 + ((tick % 2) * 2 - 1) * 3;
        });
      },
    });
  }

  /** 停在伺服器給的結果上（兩個轉輪依序停下） */
  land(options: string[], hiddenSlots = 0): Promise<void> {
    const shown = [...options, ...Array(hiddenSlots).fill(null)] as (string | null)[];
    if (this.state === 'landing' || this.state === 'landed') return this.landPromise;
    if (this.state === 'hidden') this.spin('');
    this.state = 'landing';
    this.hint.setText('');
    this.landPromise = new Promise((resolve) => {
      this.reels.forEach((reel, i) => {
        this.scene.time.delayedCall(250 + i * 300, () => {
          if (i === this.reels.length - 1) this.spinTimer?.remove();
          const id = shown[i];
          reel.setTexture(id ? iconKey(id) : HIDDEN_ICON);
          fitInto(reel, 84);
          reel.y = 5;
          this.scene.tweens.add({ targets: reel, scale: { from: reel.scale * 1.35, to: reel.scale }, duration: 220, ease: 'Back.easeOut' });
          if (i === this.reels.length - 1) {
            if (i < shown.length) this.reels.slice(shown.length).forEach((r) => r.setVisible(false));
            this.state = 'landed';
            this.scene.time.delayedCall(250, resolve);
          }
        });
      });
    });
    return this.landPromise;
  }

  hide(): void {
    this.spinTimer?.remove();
    this.spinTimer = null;
    this.state = 'hidden';
    this.reels.forEach((r) => r.setVisible(true));
    this.root.setVisible(false);
  }
}

// ------------------------------------------------------------ 二選一卡片

export class ChoiceCards {
  private root: Phaser.GameObjects.Container;

  constructor(private scene: Phaser.Scene) {
    this.root = scene.add.container(CX, 330).setDepth(61).setVisible(false);
  }

  show(options: string[], interactive: boolean, onPick: (id: string) => void, hiddenSlots = 0): void {
    this.root.removeAll(true);
    const gap = 290;
    const total = options.length + hiddenSlots;
    // 被冷氣卡藏起來的選項：一張鎖住的「？」卡
    for (let h = 0; h < hiddenSlots; h++) {
      const x = (options.length + h - (total - 1) / 2) * gap;
      const card = this.scene.add.container(x, 0);
      const bg = this.scene.add.rectangle(0, 0, 260, 210, 0x9fb7c4).setStrokeStyle(4, 0x2b2118);
      const icon = this.scene.add.image(0, -30, HIDDEN_ICON);
      fitInto(icon, 72);
      const t = this.scene.add
        .text(0, 40, '被冷氣卡封印\n這回合不能選', { fontFamily: FONT, fontSize: '18px', fontStyle: '900', color: '#2b2118', align: 'center' })
        .setOrigin(0.5);
      card.add([bg, icon, t]).setData('id', '__hidden');
      this.root.add(card);
    }
    options.forEach((id, i) => {
      const item = getItem(id);
      if (!item) return;
      const x = (i - (total - 1) / 2) * gap;
      const card = this.scene.add.container(x, 0);
      const bg = this.scene.add.rectangle(0, 0, 260, 210, 0xfff8ea).setStrokeStyle(4, 0x2b2118);
      const band = this.scene.add.rectangle(0, -88, 260, 34, kindColor(item)).setStrokeStyle(4, 0x2b2118);
      const kind = this.scene.add
        .text(0, -88, `${kindLabel(item)}${interactive ? `  [${i + 1}]` : ''}`, { fontFamily: FONT, fontSize: '16px', fontStyle: '900', color: '#ffffff' })
        .setOrigin(0.5);
      const icon = this.scene.add.image(0, -30, iconKey(id));
      fitInto(icon, 72);
      const name = this.scene.add.text(0, 14, item.name, { fontFamily: FONT, fontSize: '22px', fontStyle: '900', color: '#2b2118' }).setOrigin(0.5);
      const desc = this.scene.add
        .text(0, 58, item.description, { fontFamily: FONT, fontSize: '13px', color: '#5a4a3a', align: 'center', wordWrap: { width: 230, useAdvancedWrap: true } })
        .setOrigin(0.5);
      card.add([bg, band, kind, icon, name, desc]);
      card.setScale(0.6).setAlpha(0);
      this.scene.tweens.add({ targets: card, scale: 1, alpha: 1, delay: i * 90, duration: 220, ease: 'Back.easeOut' });
      if (interactive) {
        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerover', () => this.scene.tweens.add({ targets: card, y: -10, duration: 100 }));
        bg.on('pointerout', () => this.scene.tweens.add({ targets: card, y: 0, duration: 100 }));
        bg.on('pointerdown', () => onPick(id));
      }
      card.setData('id', id);
      this.root.add(card);
    });
    this.root.setVisible(true);
  }

  /** 選中的卡片放大、另一張淡出 */
  highlight(id: string): Promise<void> {
    return new Promise((resolve) => {
      let pending = 0;
      for (const c of this.root.list as Phaser.GameObjects.Container[]) {
        pending++;
        const chosen = c.getData('id') === id;
        this.scene.tweens.add({
          targets: c,
          scale: chosen ? 1.12 : 0.8,
          alpha: chosen ? 1 : 0,
          duration: 220,
          onComplete: () => {
            if (--pending === 0) this.scene.time.delayedCall(250, resolve);
          },
        });
      }
      if (pending === 0) resolve();
    });
  }

  hide(): void {
    this.root.removeAll(true);
    this.root.setVisible(false);
  }
}

// ------------------------------------------------------------ 角度與力道

export class AimDisplay {
  private g: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.Text;
  private hint: Phaser.GameObjects.Text;
  visible = false;

  constructor(
    private scene: Phaser.Scene,
    ui: Phaser.Scene,
  ) {
    this.g = scene.add.graphics().setDepth(40);
    this.label = scene.add
      .text(0, 0, '', { fontFamily: FONT, fontSize: '18px', fontStyle: '900', color: '#ffffff', stroke: '#2b2118', strokeThickness: 6 })
      .setOrigin(0.5)
      .setDepth(41);
    this.hint = ui.add
      .text(CX, 190, '', { fontFamily: FONT, fontSize: '22px', fontStyle: '900', color: '#ffffff', stroke: '#2b2118', strokeThickness: 6, align: 'center' })
      .setOrigin(0.5)
      .setDepth(41);
    this.hide();
  }

  setHint(text: string): void {
    this.hint.setText(text).setVisible(!!text);
  }

  /**
   * 畫瞄準箭頭與蓄力環
   * @param power null = 還沒開始蓄力
   */
  draw(seat: Seat, feetX: number, angle: number | null, power: number | null): void {
    this.visible = true;
    const g = this.g;
    g.clear();
    if (angle === null) {
      this.label.setVisible(false);
      return;
    }
    const lp = launchPoint(seat, feetX);
    const dir = seat === 0 ? 1 : -1;
    const rad = Phaser.Math.DegToRad(angle);
    const ux = Math.cos(rad) * dir,
      uy = -Math.sin(rad);
    const p = power === null ? 0 : Phaser.Math.Clamp(power, 0, 1);
    // 箭頭長度隨蓄力變長
    const len = 70 + 110 * p;
    // 虛線導引
    for (let d = 26; d < len; d += 16) {
      g.fillStyle(0xffffff, 0.85 - (d / len) * 0.5).fillCircle(lp.x + ux * d, lp.y + uy * d, 3.2);
    }
    const ex = lp.x + ux * len,
      ey = lp.y + uy * len;
    const col = p > 0.8 ? 0xe53935 : p > 0.45 ? 0xff9800 : 0xffd54f;
    g.lineStyle(7, 0x2b2118).lineBetween(ex - ux * 18 - uy * 11, ey - uy * 18 + ux * 11, ex, ey);
    g.lineBetween(ex - ux * 18 + uy * 11, ey - uy * 18 - ux * 11, ex, ey);
    g.lineStyle(4, col).lineBetween(ex - ux * 18 - uy * 11, ey - uy * 18 + ux * 11, ex, ey);
    g.lineBetween(ex - ux * 18 + uy * 11, ey - uy * 18 - ux * 11, ex, ey);
    // 蓄力環（繞著出手點）
    g.lineStyle(9, 0x2b2118, 0.55).strokeCircle(lp.x, lp.y, 34);
    if (p > 0) {
      g.lineStyle(7, col);
      g.beginPath();
      g.arc(lp.x, lp.y, 34, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p, false);
      g.strokePath();
    }
    this.label
      .setPosition(lp.x + ux * (len + 30), lp.y + uy * (len + 30))
      .setText(power === null ? `${Math.round(angle)}°` : `${Math.round(angle)}° · ${Math.round(p * 100)}%`)
      .setVisible(true);
  }

  hide(): void {
    this.visible = false;
    this.g.clear();
    this.label.setVisible(false);
    this.hint.setVisible(false);
  }
}

// ------------------------------------------------------------ 防禦放置（拖到想放的位置，放開就掉下去）

export class PlacementOverlay {
  private zone: Phaser.GameObjects.Rectangle;
  private ghost: Phaser.GameObjects.Image;
  private dropLine: Phaser.GameObjects.Graphics;
  private hint: Phaser.GameObjects.Text;
  private handlers: [string, (p: Phaser.Input.Pointer) => void][] = [];

  constructor(private scene: Phaser.Scene) {
    this.zone = scene.add.rectangle(0, 0, 10, 10, 0xffffff, 0.12).setOrigin(0, 0).setDepth(30).setStrokeStyle(3, 0xffffff, 0.8).setVisible(false);
    this.ghost = scene.add.image(0, 0, '__WHITE').setDepth(31).setAlpha(0.6).setVisible(false);
    this.dropLine = scene.add.graphics().setDepth(30);
    this.hint = scene.add
      .text(0, 0, '', { fontFamily: FONT, fontSize: '16px', fontStyle: '900', color: '#ffffff', stroke: '#2b2118', strokeThickness: 5, align: 'center' })
      .setOrigin(0.5, 1)
      .setDepth(31)
      .setVisible(false);
  }

  show(
    seat: Seat,
    feetX: number,
    item: DefenseDef,
    interactive: boolean,
    existing: DefenseView[],
    textureKey: string,
    touch: boolean,
    onPlace: (x: number, y: number) => void,
    toWorld: (p: Phaser.Input.Pointer) => { x: number; y: number },
  ): void {
    this.hide();
    const z = placementZone(seat, feetX);
    const zone = this.zone.setPosition(z.x, z.y).setSize(z.w, z.h).setVisible(true);
    zone.setDisplaySize(z.w, z.h);
    this.scene.tweens.add({ targets: zone, alpha: { from: 0.55, to: 1 }, yoyo: true, repeat: -1, duration: 650 });
    this.hint
      .setPosition(z.x + z.w / 2, z.y - 6)
      .setText(
        interactive
          ? touch
            ? `手指拖到想放的位置，放開就放下「${item.name}」`
            : `移到想放的位置，點一下放下「${item.name}」`
          : `對手正在放置「${item.name}」`,
      )
      .setVisible(true);
    if (!interactive) return;

    this.ghost.setTexture(textureKey).setDisplaySize(item.size.w, item.size.h).setVisible(false);
    const inZone = (x: number, y: number) => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h;
    const overlaps = (x: number, y: number) => {
      const r = defenseRect({ x, y, w: item.size.w, h: item.size.h });
      return existing.some((d) => {
        const o = defenseRect(d);
        return r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y;
      });
    };
    const valid = (x: number, y: number) => inZone(x, y) && !overlaps(x, y);
    let dragging = false;
    const move = (p: Phaser.Input.Pointer) => {
      if (touch && !dragging) return;
      const { x, y } = toWorld(p);
      const ok = valid(x, y);
      this.ghost.setPosition(x, y).setVisible(true).setTint(ok ? 0xffffff : 0xff5252);
      // 往下畫一條落下的參考線
      this.dropLine.clear();
      if (ok) {
        this.dropLine.lineStyle(2, 0xffffff, 0.6);
        const gy = ARENA.groundY;
        for (let yy = y + item.size.h / 2 + 6; yy < gy; yy += 14) this.dropLine.lineBetween(x, yy, x, Math.min(gy, yy + 7));
      }
    };
    const down = (p: Phaser.Input.Pointer) => {
      dragging = true;
      move(p);
      const w = toWorld(p);
      if (!touch && valid(w.x, w.y)) onPlace(Math.round(w.x), Math.round(w.y));
    };
    const up = (p: Phaser.Input.Pointer) => {
      if (!touch || !dragging) return;
      dragging = false;
      const w = toWorld(p);
      if (valid(w.x, w.y)) onPlace(Math.round(w.x), Math.round(w.y));
    };
    this.handlers = [
      ['pointermove', move],
      ['pointerdown', down],
      ['pointerup', up],
    ];
    for (const [ev, fn] of this.handlers) this.scene.input.on(ev, fn);
  }

  hide(): void {
    this.scene.tweens.killTweensOf(this.zone);
    this.zone.setVisible(false).setAlpha(1);
    this.ghost.setVisible(false);
    this.dropLine.clear();
    this.hint.setVisible(false);
    for (const [ev, fn] of this.handlers) this.scene.input.off(ev, fn);
    this.handlers = [];
  }
}

// ------------------------------------------------------------ 功能道具：目標選擇

export class TargetOverlay {
  private marks: Phaser.GameObjects.GameObject[] = [];
  private hint: Phaser.GameObjects.Text;

  constructor(
    private scene: Phaser.Scene,
    ui: Phaser.Scene,
  ) {
    this.hint = ui.add
      .text(CX, 190, '', { fontFamily: FONT, fontSize: '22px', fontStyle: '900', color: '#ffffff', stroke: '#2b2118', strokeThickness: 6, align: 'center' })
      .setOrigin(0.5)
      .setDepth(62)
      .setVisible(false);
  }

  show(text: string, targets: DefenseView[], interactive: boolean, onPick: (uid: string) => void): void {
    this.hide();
    this.hint.setText(text).setVisible(true);
    for (const d of targets) {
      const r = defenseRect(d);
      const box = this.scene.add
        .rectangle(r.x + r.w / 2, r.y + r.h / 2, r.w + 16, r.h + 16, 0xff5252, 0.18)
        .setStrokeStyle(4, 0xff5252)
        .setDepth(35);
      this.scene.tweens.add({ targets: box, alpha: { from: 0.4, to: 1 }, yoyo: true, repeat: -1, duration: 400 });
      if (interactive) {
        box.setInteractive({ useHandCursor: true });
        box.on('pointerdown', () => onPick(d.uid));
      }
      this.marks.push(box);
    }
  }

  hide(): void {
    this.hint.setVisible(false);
    for (const m of this.marks) {
      this.scene.tweens.killTweensOf(m);
      m.destroy();
    }
    this.marks = [];
  }
}

/** 等比縮放到最長邊 = size（照片不會被拉歪） */
export function fitInto(img: Phaser.GameObjects.Image, size: number): void {
  const f = img.frame;
  img.setScale(size / Math.max(f.width, f.height, 1));
}
