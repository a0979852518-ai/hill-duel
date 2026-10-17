// ============================================================
// 戰鬥場景
// ------------------------------------------------------------
// 兩條資料流：
//   room:state（快照）→ 立即更新回合/倒數/操作介面
//   game:event（事件）→ 依序播放動畫；動畫播放期間，血量與防禦道具
//                       不直接套用快照，等動畫結束再同步，避免「還沒打到就扣血」。
// ============================================================

import * as Phaser from 'phaser';
import { AIM_CONFIG, ARENA, CAMERA } from '../../../shared/config/game.js';
import { getItem, type DefenseDef } from '../../../shared/config/items.js';
import { bodyScaleOf, getCharacter, scaledDefenseSize } from '../../../shared/config/characters.js';
import { characterHitbox, defenseRect, launchPoint } from '../../../shared/physics.js';
import {
  ERROR_TEXT,
  type BattleEvent,
  type DefenseUpdate,
  type DefenseView,
  type ErrorCode,
  type PhysicsFrames,
  type RoomSnapshot,
  type Seat,
} from '../../../shared/types.js';
import { defKey, iconKey, projKey } from '../game/assets.js';
import { fitInto } from './battle/controls.js';
import { getStatus, PERMANENT_TURNS } from '../../../shared/config/items.js';
import { drawArena } from '../game/arena.js';
import { store } from '../state/store.js';
import { toast } from '../ui/toast.js';
import { AimDisplay, ChoiceCards, PlacementOverlay, SlotMachine, TargetOverlay } from './battle/controls.js';
import { banner, damageNumber, dust, explosion, floatingText, FUNCTIONAL_EFFECTS, impactBurst, puff, wait } from './battle/effects.js';
import { Hud } from './battle/Hud.js';
import { CharacterSprite } from './battle/CharacterSprite.js';
import { CameraDirector } from './battle/CameraDirector.js';
import { itemHitSound, sfx, SOUNDS } from '../game/sfx.js';
import { OffscreenMarkers, SpeedLines } from './BattleUIScene.js';

interface DefenseSprite {
  view: DefenseView;
  root: Phaser.GameObjects.Container;
  bar: Phaser.GameObjects.Rectangle | null;
  label: Phaser.GameObjects.Text;
}

export class BattleScene extends Phaser.Scene {
  private hud!: Hud;
  private slot!: SlotMachine;
  private cards!: ChoiceCards;
  private aim!: AimDisplay;
  private placement!: PlacementOverlay;
  private target!: TargetOverlay;
  private chars: CharacterSprite[] = [];
  private defenses = new Map<string, DefenseSprite>();
  private unsub: (() => void)[] = [];

  // 動畫佇列
  private queue: Promise<void> = Promise.resolve();
  private animating = 0;

  // 回合 UI 狀態
  private phaseKey = '';
  private busy = false; // 等待 ack 中，避免重複送出
  private touch = false;
  /** 自己瞄準中的角度/力道 */
  private localAngle: number | null = null;
  private localPower: number | null = null;
  private charging = false;
  private chargeStart = 0;
  private previewAngle: number | null = null;
  private previewPower: number | null = null;
  private lastPreviewSent = 0;
  private actionBtn: HTMLButtonElement | null = null;
  private leaveBtn: HTMLButtonElement | null = null;
  private skillBtn: HTMLButtonElement | null = null;
  private skillPanel: HTMLElement | null = null;

  // 鏡頭與螢幕層
  private ui!: Phaser.Scene;
  private ready = false;
  private director!: CameraDirector;
  private speedLines!: SpeedLines;
  private markers!: OffscreenMarkers;
  private introPlayed = false;
  /** 命中頓格：動畫時間倍率（1 = 正常） */
  private hitstop = 1;
  private hitstopTimer = 0;

  constructor() {
    super('Battle');
  }

  create(): void {
    this.ready = false;
    this.introPlayed = false;
    this.hitstop = 1;
    drawArena(this, store.snapshot?.mapId);
    this.director = new CameraDirector(this.cameras.main);
    this.director.update(0);
    // 螢幕層（HUD 等）是另一個疊在上面的 Scene，不受戰場鏡頭縮放影響
    this.scene.launch('BattleUI');
    const ui = this.scene.get('BattleUI');
    ui.events.once(Phaser.Scenes.Events.CREATE, () => this.setup(ui));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
  }

  private setup(ui: Phaser.Scene): void {
    this.ui = ui;
    this.speedLines = new SpeedLines(ui);
    this.markers = new OffscreenMarkers(ui);
    this.hud = new Hud(ui);
    this.slot = new SlotMachine(ui);
    this.cards = new ChoiceCards(ui);
    this.aim = new AimDisplay(this, ui);
    this.placement = new PlacementOverlay(this);
    this.target = new TargetOverlay(this, ui);
    this.chars = [];
    this.defenses.clear();
    this.phaseKey = '';
    this.queue = Promise.resolve();
    this.animating = 0;

    this.touch = !!this.sys.game.device.input.touch && matchMedia('(pointer: coarse)').matches;
    // 空白鍵：瞄準階段＝按住蓄力、放開投出；其他階段＝確認
    this.input.keyboard?.on('keydown-SPACE', (e: KeyboardEvent) => {
      e.preventDefault();
      if (this.isMyAim()) {
        if (!e.repeat) this.startCharge();
      } else if (!e.repeat) this.primaryAction();
    });
    this.input.keyboard?.on('keyup-SPACE', () => {
      if (this.charging) this.releaseThrow();
    });
    // 滑鼠 / 手指：移動＝瞄準，按下＝開始蓄力，放開＝投出
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.isMyAim()) this.aimAtPointer(p);
    });
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!this.isMyAim()) return;
      this.aimAtPointer(p);
      this.startCharge();
    });
    this.input.on('pointerup', () => {
      if (this.charging) this.releaseThrow();
    });
    this.input.on('gameout', () => {
      if (this.charging) this.releaseThrow();
    });
    this.input.keyboard?.on('keydown-ONE', () => this.pickByIndex(0));
    this.input.keyboard?.on('keydown-TWO', () => this.pickByIndex(1));
    // Q：看自己角色的技能
    this.input.keyboard?.on('keydown-Q', () => this.toggleSkills());

    store.whenAnimIdle = () => this.waitIdle();
    this.createDomButtons();
    this.unsub.push(store.net.onState((s) => this.onSnapshot(s)));
    this.unsub.push(store.net.onEvent((e) => this.onBattleEvent(e)));
    this.ready = true;

    if (store.snapshot) {
      this.buildCharacters(store.snapshot);
      this.hud.updatePlayers(store.snapshot, store.mySeat);
      this.syncVisuals(store.snapshot, false);
      this.playIntro(store.snapshot);
      this.onSnapshot(store.snapshot);
    }
  }

  /** 開場：遠景看雙方位置 → 慢慢拉近到自己 */
  private playIntro(snap: RoomSnapshot): void {
    if (this.introPlayed) return;
    this.introPlayed = true;
    const xs: [number, number] = [this.xOf(0), this.xOf(1)];
    this.director.set(this.director.wideShot(xs), true);
    if (snap.status !== 'battle') return;
    this.enqueue(async () => {
      const names = snap.players.map((p) => p?.name ?? '');
      void banner(this.ui, `${names[0]}  VS  ${names[1]}`, 0x2b2118, CAMERA.introHoldMs - 400);
      await wait(this, CAMERA.introHoldMs);
      const me = store.mySeat ?? 0;
      this.director.set(this.director.seatShot(me, this.xOf(me), 1.8));
      await wait(this, 900);
    });
  }

  /** 角色目前腳底 x */
  private xOf(seat: Seat): number {
    return this.chars[seat]?.x ?? store.snapshot?.players[seat]?.x ?? ARENA.characterStartX[seat];
  }

  private focusSeat(seat: Seat, rate?: number): void {
    this.director.set(this.director.seatShot(seat, this.xOf(seat), rate));
  }

  private focusBoth(): void {
    this.director.set(this.director.wideShot([this.xOf(0), this.xOf(1)], 3));
  }

  private cleanup(): void {
    this.unsub.forEach((u) => u());
    this.unsub = [];
    store.whenAnimIdle = () => Promise.resolve();
    sfx.stopCharge();
    this.actionBtn?.remove();
    this.leaveBtn?.remove();
    this.skillBtn?.remove();
    this.skillPanel?.remove();
    this.actionBtn = this.leaveBtn = this.skillBtn = null;
    this.skillPanel = null;
    this.placement?.hide();
    clearTimeout(this.hitstopTimer);
    this.ready = false;
    this.scene.stop('BattleUI');
  }

  // ------------------------------------------------------------ 角色與防禦的畫面同步

  private buildCharacters(snap: RoomSnapshot): void {
    for (const seat of [0, 1] as Seat[]) {
      const p = snap.players[seat];
      this.chars[seat] = new CharacterSprite(this, seat, p?.characterId ?? '', p?.x ?? ARENA.characterStartX[seat], p?.name ?? '');
    }
    // 重新連線時遊戲已經結束：直接顯示倒地
    if (snap.status === 'gameOver' && snap.winnerSeat !== null) this.chars[snap.winnerSeat === 0 ? 1 : 0]?.die(false);
  }

  /** 依目前階段決定角色常態姿勢：輪到誰瞄準，誰就擺投擲姿勢 */
  private updatePoses(snap: RoomSnapshot): void {
    const t = snap.turn;
    for (const seat of [0, 1] as Seat[]) {
      const aiming = !!t && t.activeSeat === seat && (t.phase === 'aimAngle' || t.phase === 'aimPower');
      this.chars[seat]?.setBase(aiming ? 'throw' : 'idle');
    }
  }

  /** 把快照中的血量與防禦道具畫到場上（只在沒有動畫時呼叫） */
  private syncVisuals(snap: RoomSnapshot, animate = true): void {
    snap.players.forEach((p) => {
      if (!p) return;
      this.hud.setHp(p.seat, p.hp, animate);
      const c = this.chars[p.seat];
      if (c && Math.abs(c.x - p.x) > 0.5) c.placeAt(p.x);
      c?.setStuck(p.stuck ?? []);
    });
    const seen = new Set<string>();
    for (const d of snap.defenses) {
      seen.add(d.uid);
      const existing = this.defenses.get(d.uid);
      if (existing) this.updateDefense(existing, d, true);
      else this.createDefense(d);
    }
    for (const [uid, ds] of this.defenses) if (!seen.has(uid)) this.removeDefense(uid, ds, 'fade');
  }

  private createDefense(d: DefenseView): DefenseSprite {
    const item = getItem(d.itemId) as DefenseDef | undefined;
    const root = this.add.container(d.x, d.y).setDepth(25).setRotation(d.angle ?? 0);
    const img = this.add.image(0, 0, defKey(d.itemId)).setDisplaySize(d.w, d.h);
    root.add(img);
    let bar: Phaser.GameObjects.Rectangle | null = null;
    if (d.maxDurability !== null) {
      root.add(this.add.rectangle(0, -d.h / 2 - 10, 40, 7, 0x2b2118));
      bar = this.add.rectangle(-19, -d.h / 2 - 10, 38, 5, 0x66bb6a).setOrigin(0, 0.5);
      root.add(bar);
    }
    const label = this.add
      .text(0, d.h / 2 + 4, '', { fontFamily: 'sans-serif', fontSize: '12px', fontStyle: '800', color: '#ffffff', stroke: '#2b2118', strokeThickness: 3 })
      .setOrigin(0.5, 0);
    root.add(label);
    const ds: DefenseSprite = { view: d, root, bar, label };
    this.updateDefense(ds, d);
    this.defenses.set(d.uid, ds);
    if (item?.placeholder.translucent) this.tweens.add({ targets: img, alpha: { from: 0.7, to: 1 }, yoyo: true, repeat: -1, duration: 700 });
    return ds;
  }

  private updateDefense(ds: DefenseSprite, d: DefenseView, movePose = false): void {
    ds.view = d;
    if (movePose) ds.root.setPosition(d.x, d.y).setRotation(d.angle ?? 0);
    // 標籤與耐久條永遠保持水平
    ds.label.setRotation(-(ds.root.rotation));
    if (ds.bar && d.maxDurability) {
      const r = Math.max(0, (d.durability ?? 0) / d.maxDurability);
      ds.bar.scaleX = r;
      ds.bar.fillColor = r > 0.5 ? 0x66bb6a : r > 0.25 ? 0xffca28 : 0xef5350;
    }
    const parts: string[] = [];
    if (d.maxDurability !== null) parts.push(`${d.durability}`);
    if (d.maxHits !== null) parts.push(`擋${d.maxHits - d.hits}次`);
    if (d.remainingTurns !== null) parts.push(`${d.remainingTurns}回合`);
    ds.label.setText(parts.join(' · '));
  }

  private removeDefense(uid: string, ds: DefenseSprite, style: 'fade' | 'break' | 'fall'): void {
    this.defenses.delete(uid);
    if (style === 'break') sfx.play('breakDef');
    else if (style === 'fall') sfx.play('defFall', { vol: 0.6 });
    if (style === 'fall') {
      this.tweens.add({ targets: ds.root, y: ds.root.y + 120, alpha: 0, angle: ds.root.angle + 40, duration: 500, ease: 'Quad.easeIn', onComplete: () => ds.root.destroy() });
      return;
    }
    if (style === 'break') {
      const r = defenseRect({ ...ds.view, x: ds.root.x, y: ds.root.y });
      for (let i = 0; i < 8; i++) {
        const shard = this.add.rectangle(r.x + Math.random() * r.w, r.y + Math.random() * r.h, 8, 12, (getItem(ds.view.itemId)?.placeholder.color ?? 0x999999)).setDepth(45);
        this.tweens.add({
          targets: shard,
          x: shard.x + Phaser.Math.Between(-50, 50),
          y: shard.y + Phaser.Math.Between(40, 140),
          angle: Phaser.Math.Between(-200, 200),
          alpha: 0,
          duration: 700,
          ease: 'Quad.easeIn',
          onComplete: () => shard.destroy(),
        });
      }
      ds.root.destroy();
    } else {
      this.tweens.add({ targets: ds.root, alpha: 0, scale: 0.6, duration: 350, onComplete: () => ds.root.destroy() });
    }
  }

  private applyDefenseUpdates(updates: DefenseUpdate[]): void {
    for (const u of updates) {
      const ds = this.defenses.get(u.uid);
      if (!ds) continue;
      if (u.destroyed) {
        if (u.reason === 'fell') {
          floatingText(this, Phaser.Math.Clamp(ds.root.x, 60, ARENA.world.width - 60), Math.min(ds.root.y, ARENA.groundY - 60), '掉下去了！', '#ffffff');
          this.removeDefense(u.uid, ds, 'fall');
        } else {
          floatingText(this, ds.root.x, ds.root.y - ds.view.h / 2 - 20, '破壞！', '#ffcc80');
          this.removeDefense(u.uid, ds, 'break');
        }
      } else {
        this.updateDefense(ds, { ...ds.view, durability: u.durability, hits: u.hits });
        const img = ds.root.list[0] as Phaser.GameObjects.Image;
        img.setTint(0xffffff);
        img.setTintFill?.(0xffffff);
        this.time.delayedCall(90, () => img.clearTint());
      }
    }
  }

  /** 這次投擲會被打飛的座位（被打飛的人不顯示受傷照，直接接連續動作） */
  private knockedSeats = new Set<Seat>();

  private hitCharacter(seat: Seat, strong = false): void {
    if (this.knockedSeats.has(seat)) this.chars[seat]?.hitFlash();
    else this.chars[seat]?.hurt(strong);
  }

  // ------------------------------------------------------------ 動畫佇列

  private enqueue(fn: () => Promise<void>): void {
    this.animating++;
    this.updateCatchUp();
    this.queue = this.queue
      .then(fn)
      .catch((e) => console.error('[anim]', e))
      .finally(() => {
        this.animating--;
        this.updateCatchUp();
        if (this.animating === 0 && store.snapshot && this.scene.isActive()) this.syncVisuals(store.snapshot);
      });
  }

  /** 動畫積太多（例如分頁切到背景、裝置太慢）時加速播放，盡快追上伺服器 */
  private updateCatchUp(): void {
    const speed = this.animating > 2 ? 3 : 1;
    this.tweens.timeScale = speed * this.hitstop;
    this.time.timeScale = speed * this.hitstop;
    if (this.ui) {
      this.ui.tweens.timeScale = speed;
      this.ui.time.timeScale = speed;
    }
  }

  /** 命中頓格：短暫把戰場動畫放到很慢，再恢復（用真實時間計時） */
  private hitStop(ms: number): void {
    if (ms <= 0) return;
    this.hitstop = 0.04;
    this.updateCatchUp();
    clearTimeout(this.hitstopTimer);
    this.hitstopTimer = window.setTimeout(() => {
      this.hitstop = 1;
      this.updateCatchUp();
    }, ms);
  }

  /** 等到目前排隊的動畫都播完 */
  private async waitIdle(): Promise<void> {
    while (this.animating > 0) await this.queue;
  }

  private onBattleEvent(e: BattleEvent): void {
    const mySeat = store.mySeat;
    switch (e.type) {
      case 'turnStart':
        this.enqueue(async () => {
          const name = store.snapshot?.players[e.seat]?.name ?? '';
          this.focusSeat(e.seat);
          sfx.play('turnStart');
          banner(this.ui, e.seat === mySeat ? '輪到你了！' : `輪到 ${name}`, e.seat === 0 ? 0x3d7bd8 : 0xd8463d, 800);
          await wait(this, 450);
          for (const d of e.statusDamage) {
            const st = getStatus(d.statusId ?? '');
            damageNumber(this, this.xOf(d.seat), d.amount, '#' + (st?.color ?? 0xb2ff59).toString(16).padStart(6, '0'), st?.name.replace(/（.*）/, '') ?? '狀態');
            this.hitCharacter(d.seat);
            this.hud.setHp(d.seat, d.hpAfter);
            if (d.survived) floatingText(this, this.xOf(d.seat), ARENA.groundY - 260, '鎖血！剩 1 血', '#ffeb3b');
          }
          for (const h of e.heals ?? []) {
            damageNumber(this, this.xOf(h.seat), h.amount, '#69f0ae', h.seat !== undefined && store.snapshot?.players[h.seat]?.characterId === 'panbohan' ? '抽菸回血' : '便便回血', '+');
            this.hud.setHp(h.seat, h.hpAfter);
          }
          for (const uid of e.expiredDefenses) {
            const ds = this.defenses.get(uid);
            if (ds) {
              floatingText(this, ds.view.x, ds.view.y - ds.view.h / 2 - 20, '時間到', '#ffffff');
              this.removeDefense(uid, ds, 'fade');
            }
          }
          await wait(this, e.statusDamage.length || e.expiredDefenses.length || e.heals?.length ? 700 : 150);
        });
        break;
      case 'slotResult':
        this.slot.land(e.options, e.hiddenSlots);
        break;
      case 'aimPreview':
        if (e.angle !== undefined) this.previewAngle = e.angle;
        this.previewPower = e.power ?? null;
        break;
      case 'throw':
        this.enqueue(() => this.playThrow(e));
        break;
      case 'defensePlaced':
        this.enqueue(async () => {
          const ds = this.defenses.get(e.defense.uid) ?? this.createDefense(e.defense);
          ds.root.setPosition(e.defense.x, e.defense.y).setRotation(0).setAlpha(0).setScale(0.8);
          this.tweens.add({ targets: ds.root, alpha: 1, scale: 1, duration: 150 });
          let landed = false;
          await this.playFrames(e.frames, {
            onFrame: () => {
              // 第一次停下來的時候冒一點灰塵
              const arr = e.frames.d[e.defense.uid];
              if (!landed && arr && arr.length > 3) {
                const i = Math.min(arr.length - 1, this.frameCursor);
                if (i > 2 && Math.abs(arr[i][1] - arr[i - 1][1]) < 0.3 && arr[i][1] > arr[0][1] + 5) {
                  landed = true;
                  puff(this, arr[i][0], arr[i][1] + e.defense.h / 2);
                  sfx.play(SOUNDS[`place_${e.defense.itemId}`] ? `place_${e.defense.itemId}` : 'defFall');
                }
              }
            },
          });
          this.applyDefenseUpdates(e.fell);
          // 獸控：還在場上時攻擊力 ×2
          const placedDef = getItem(e.defense.itemId);
          if (placedDef?.kind === 'defense' && placedDef.ownerOutgoingMultiplier) {
            floatingText(this, this.xOf(e.seat), ARENA.groundY - 230, `攻擊力 ×${placedDef.ownerOutgoingMultiplier}！`, '#69f0ae');
            sfx.play('status');
          }
          await wait(this, 200);
        });
        break;
      case 'settle':
        this.enqueue(async () => {
          await this.playFrames(e.frames, {});
          this.applyDefenseUpdates(e.fell);
        });
        break;
      case 'functional':
        this.enqueue(async () => {
          const enemy: Seat = e.seat === 0 ? 1 : 0;
          const target = e.targetUid ? this.defenses.get(e.targetUid)?.view : undefined;
          const fx = FUNCTIONAL_EFFECTS[e.handler];
          const selfOnly = e.handler === 'heal' || e.itemId === 'whey';
          if (selfOnly) this.focusSeat(e.seat);
          else this.focusBoth();
          await wait(this, 450);
          sfx.play(SOUNDS[`use_${e.itemId}`] ? `use_${e.itemId}` : 'status');
          if (fx) await fx(this, { seat: e.seat, enemy, target, itemId: e.itemId, xOf: (s) => this.xOf(s) });
          else this.cameras.main.flash(200);
          this.applyDamages(e.damages);
          for (const h of e.heals) {
            damageNumber(this, this.xOf(h.seat), h.amount, '#69f0ae', '回復', '+');
            this.hud.setHp(h.seat, h.hpAfter);
          }
          for (const st of e.statusApplied) this.showStatusApplied(st);
          this.showRage(e.defenseUpdates);
          this.applyDefenseUpdates(e.defenseUpdates);
          await wait(this, 500);
        });
        break;
      case 'skip':
        this.enqueue(async () => {
          this.focusSeat(e.seat);
          sfx.play('skip');
          const text =
            e.reason === 'stunned'
              ? `${store.snapshot?.players[e.seat]?.name ?? ''} 被機車鎖鎖住，跳過這回合！`
              : e.reason === 'drawTimeout'
                ? '時間到！放棄本回合'
                : '時間到！取消使用道具';
          await banner(this.ui, text, e.reason === 'stunned' ? 0x546e7a : 0x6d5c4b, 1000);
        });
        break;
      case 'gameOver':
        this.enqueue(async () => {
          const loser = e.winnerSeat === 0 ? 1 : 0;
          await wait(this, 300); // 讓受傷畫面先閃一下
          this.focusBoth();
          this.chars[loser]?.die();
          this.chars[e.winnerSeat]?.celebrate();
          sfx.play(store.mySeat === loser ? 'lose' : 'win');
          await wait(this, 900);
        });
        break;
    }
  }

  private applyDamages(damages: { seat: Seat; amount: number; hpAfter: number; source: string; headshot?: boolean; bounces?: number; crit?: boolean; survived?: boolean; shielded?: number; label?: string }[]): void {
    for (const d of damages) {
      if (d.source === 'crush') {
        sfx.play('crush');
        damageNumber(this, this.xOf(d.seat), d.amount, '#ff7043', '被壓到！', '-', true);
        this.cameras.main.shake(220, 0.01);
        puff(this, this.xOf(d.seat), ARENA.groundY - 120);
        this.hitCharacter(d.seat, true);
        this.hud.setHp(d.seat, d.hpAfter);
        continue;
      }
      const color = d.headshot ? '#ff5252' : d.source === 'direct' ? '#ffeb3b' : d.source === 'functional' ? '#ffd54f' : '#ffffff';
      const bounceTag = d.bounces ? `彈地${d.bounces}次 ` : '';
      if (d.source === 'direct') {
        sfx.play('punch');
        sfx.play('oof', { rate: 0.9 + Math.random() * 0.25 });
        if (d.headshot) sfx.play('headshot');
      } else if (d.source === 'status') sfx.play('oof', { vol: 0.5, rate: 1.1 });
      const critTag = d.crit ? '爆擊！' : '';
      damageNumber(
        this,
        this.xOf(d.seat),
        d.amount,
        d.crit ? '#ff9100' : color,
        d.headshot ? bounceTag + critTag + '爆頭！' : d.source === 'direct' ? bounceTag + (critTag || '直擊') : undefined,
        '-',
        d.source === 'direct',
      );
      if (d.shielded) floatingText(this, this.xOf(d.seat), ARENA.groundY - 230, `護盾擋下 ${d.shielded}`, '#90caf9');
      if (d.label && d.source === 'status') {
        damageNumber(this, this.xOf(d.seat), d.amount, '#ffab91', d.label, '-');
        this.hud.setHp(d.seat, d.hpAfter);
        continue;
      }
      if (d.survived) {
        floatingText(this, this.xOf(d.seat), ARENA.groundY - 260, '鎖血！剩 1 血', '#ffeb3b');
        this.cameras.main.flash(180, 255, 235, 59);
      }
      if (d.crit) {
        sfx.play('headshot');
        this.cameras.main.flash(120, 255, 160, 0);
      }
      if (d.headshot) this.cameras.main.shake(300, 0.014);
      this.hitCharacter(d.seat, d.source === 'direct');
      this.hud.setHp(d.seat, d.hpAfter);
    }
  }

  private showStatusApplied(st: { seat: Seat; statusId: string; turns: number; immune?: boolean }): void {
    const def = getStatus(st.statusId);
    const box = characterHitbox(this.xOf(st.seat), this.scaleOf(st.seat));
    if (st.immune) {
      floatingText(this, box.x + box.w / 2, box.y - 95, `免疫${def?.name.replace(/（.*）/, '') ?? ''}！`, '#ffffff');
      return;
    }
    const turns = st.turns >= PERMANENT_TURNS ? '' : ` ${st.turns} 回合`;
    floatingText(this, box.x + box.w / 2, box.y - 95, `${def?.name ?? st.statusId}${turns}`, '#' + (def?.color ?? 0xffffff).toString(16).padStart(6, '0'));
  }

  /** 目前播放到第幾格（給 onFrame 用） */
  private frameCursor = 0;

  /**
   * 播放伺服器算好的物理影格：防禦道具位置/角度、投擲物位置/角度。
   * 影格之間做線性插值，畫面在高更新率的螢幕上也是順的。
   */
  private playFrames(
    frames: PhysicsFrames,
    opts: {
      proj?: Phaser.GameObjects.Image;
      trail?: Phaser.GameObjects.Container;
      onFrame?: (i: number) => void;
      /** 投擲物每次更新位置（世界座標、速度 px/s） */
      onProj?: (x: number, y: number, vx: number, vy: number) => void;
      reasons?: Record<string, DefenseUpdate>;
    },
  ): Promise<void> {
    const n = frames.count;
    if (n <= 0) return Promise.resolve();
    let last = -1;
    const fire = (upto: number) => {
      for (let k = last + 1; k <= upto; k++) {
        this.frameCursor = k;
        for (const [uid, at] of Object.entries(frames.gone)) {
          if (at !== k) continue;
          const ds = this.defenses.get(uid);
          const u = opts.reasons?.[uid];
          if (ds && u) {
            if (u.reason === 'fell') this.removeDefense(uid, ds, 'fall');
            else this.removeDefense(uid, ds, 'break'); // 「擊垮！」已經在命中時顯示
          } else if (ds) this.removeDefense(uid, ds, 'fall');
        }
        // 被擊退的角色：在地上滑行時揚起塵土、每次落地彈起時砰一下
        for (const arr of Object.values(frames.c ?? {})) {
          if (!arr || k < 2 || k >= arr.length) continue;
          const a = arr[k],
            b = arr[k - 1],
            c = arr[k - 2];
          // 身體中心的高度（腳底位移 + 身體轉動造成的變化）
          // 身體中心離腳底（圖的底部）多遠：縮成一團滾的時候比較小
          const L = (f: number[]) => (f[4] === 3 || f[4] === 4 ? 52 : f[4] === 5 ? 33 : 75);
          const cy = (f: number[]) => f[1] - Math.cos(f[2]) * L(f);
          const cx = (f: number[]) => f[0] + Math.sin(f[2]) * L(f);
          const vPrev = cy(b) - cy(c),
            vNow = cy(a) - cy(b);
          const low = cy(a) > -95;
          if (low && Math.abs(cx(a) - cx(b)) > 2.5 && k % 2 === 0) dust(this, cx(a), ARENA.groundY, Math.sign(cx(a) - cx(b)));
          if (low && vPrev > 2.5 && vNow <= 0.5) {
            puff(this, cx(a), ARENA.groundY);
            this.cameras.main.shake(90, Math.min(0.006, 0.0006 * vPrev));
            sfx.play('bodyThud', { vol: Math.min(1, 0.3 + vPrev / 12), gapMs: 110 });
          }
          // 被打飛的連續動作換圖時的音效
          const fa = a[4] ?? 0,
            fb = b[4] ?? 0;
          if (fa !== fb) {
            if (fa === 2 && fb === 1) sfx.play('knockWhoosh');
            else if ((fa === 3 || fa === 4) && (fb === 3 || fb === 4)) sfx.play('roll', { gapMs: 80 });
            else if ((fa === 3 || fa === 4) && fb === 2) sfx.play('bodyThud', { gapMs: 80 });
            else if (fa === 5) sfx.play('bodyThud', { vol: 0.6, rate: 0.9, gapMs: 80 });
            else if (fa === 2 && fb === 5) sfx.play('getUp');
          }
        }
        opts.onFrame?.(k);
      }
      last = Math.max(last, upto);
    };
    const pose = (arr: number[][], v: number): number[] => {
      const i = Math.min(arr.length - 1, Math.floor(v));
      const j = Math.min(arr.length - 1, i + 1);
      const f = Math.min(1, v - i);
      const a = arr[i],
        b = arr[j];
      return a.map((av, n) => av + (b[n] - av) * f);
    };
    return new Promise<void>((resolve) => {
      this.tweens.addCounter({
        from: 0,
        to: n - 1,
        duration: Math.max(16, (n - 1) * frames.sampleMs),
        onUpdate: (tw) => {
          const v = tw.getValue() ?? 0;
          for (const [uid, arr] of Object.entries(frames.d)) {
            const g = frames.gone[uid];
            if (g !== undefined && v >= g) continue;
            const ds = this.defenses.get(uid);
            if (!ds || arr.length === 0) continue;
            const [x, y, a] = pose(arr, v);
            ds.root.setPosition(x, y).setRotation(a);
            ds.label.setRotation(-a);
          }
          for (const [seatKey, arr] of Object.entries(frames.c ?? {})) {
            if (!arr || arr.length === 0) continue;
            const [x, y, a, flip] = pose(arr, v);
            // 動作圖編號不能內插，取目前這一格的
            const fr = arr[Math.min(arr.length - 1, Math.floor(v))][4] ?? 0;
            this.chars[Number(seatKey) as Seat]?.setKnockPose(x, y, a, flip ?? 1, fr);
          }
          if (opts.proj && frames.p) {
            if (v < frames.p.length - 1 || (frames.p.length === 1 && v < 1)) {
              const [x, y, a] = pose(frames.p, v);
              opts.proj.setPosition(x, y).setRotation(a).setVisible(true);
              // 軌跡：每隔一小段距離放一個點（用貼圖，不用每幀重畫 Graphics）
              if (opts.trail) {
                const lastDot = opts.trail.getData('last') as [number, number] | undefined;
                if (!lastDot || Math.hypot(x - lastDot[0], y - lastDot[1]) > 14) {
                  opts.trail.add(this.add.image(x, y, 'fx:dot').setAlpha(0.5));
                  opts.trail.setData('last', [x, y]);
                }
              }
              if (opts.onProj) {
                const i = Math.min(frames.p.length - 2, Math.floor(v));
                const vx = i >= 0 ? ((frames.p[i + 1][0] - frames.p[i][0]) * 1000) / frames.sampleMs : 0;
                const vy = i >= 0 ? ((frames.p[i + 1][1] - frames.p[i][1]) * 1000) / frames.sampleMs : 0;
                opts.onProj(x, y, vx, vy);
              }
            } else opts.proj.setVisible(false);
          }
          fire(Math.floor(v));
        },
        onComplete: () => {
          fire(n - 1);
          for (const [seatKey, arr] of Object.entries(frames.c ?? {})) {
            const last = arr?.[arr.length - 1];
            // 站起來了才歸位；被打倒（血量歸零）就維持躺著，交給死亡動畫
            if (last && Math.abs(last[2]) < 0.01 && Math.abs(last[1]) < 0.5) this.chars[Number(seatKey) as Seat]?.placeAt(last[0]);
          }
          resolve();
        },
      });
    });
  }

  private async playThrow(e: Extract<BattleEvent, { type: 'throw' }>): Promise<void> {
    this.aim.hide();
    const item = getItem(e.itemId);
    const key = this.textures.exists(projKey(e.itemId)) ? projKey(e.itemId) : iconKey(e.itemId);
    const lp = launchPoint(e.seat, this.xOf(e.seat), this.scaleOf(e.seat));
    const start = e.frames.p?.[0] ?? [lp.x, lp.y, 0];
    this.focusSeat(e.seat, 5);
    this.chars[e.seat]?.flash('throw', 450);
    await wait(this, 140); // 出手前的一點點蓄勢
    const proj = this.add.image(start[0], start[1], key).setDepth(46);
    // 出手的咻聲：重的東西比較低沉，越大力越大聲
    const kg = item?.kind === 'throwable' ? item.weightKg ?? 0.5 : 0.5;
    sfx.play(kg >= 0.5 ? 'throwHeavy' : 'throwLight', { vol: 0.5 + e.power * 0.6, rate: kg >= 1 ? 0.85 : 1 });
    // 連恩的 poopoo恩 2.5 倍大
    fitInto(proj, (item?.kind === 'throwable' ? item.displaySize ?? Math.max(32, item.radius * 3.4) : 32) * (e.projScale ?? 1));
    if (!this.textures.exists('fx:dot')) {
      const g = this.make.graphics({}, false);
      g.fillStyle(0xffffff, 1).fillCircle(3, 3, 2.4);
      g.generateTexture('fx:dot', 6, 6);
      g.destroy();
    }
    const trail = this.add.container(0, 0).setDepth(44);

    const reasons: Record<string, DefenseUpdate> = {};
    for (const u of e.defenseUpdates) reasons[u.uid] = u;
    let flying = true;
    const knocked = Object.entries(e.frames.c ?? {})[0];
    this.knockedSeats = new Set(Object.keys(e.frames.c ?? {}).map((k) => Number(k) as Seat));
    await this.playFrames(e.frames, {
      proj,
      trail,
      reasons,
      onProj: (x, y, vx, vy) => {
        if (!flying) return;
        this.director.follow(x, y, vx, vy);
        this.speedLines.set(vx, vy, Math.hypot(vx, vy));
      },
      onFrame: (k) => {
        // 投擲物落地彈起
        if (e.bounceFrames?.includes(k) && e.frames.p?.[k]) {
          puff(this, e.frames.p[k][0], ARENA.groundY);
          sfx.play('groundBounce', { gapMs: 90 });
        }
        // 被倒下的防禦道具壓到
        const crush = e.damages.filter((d) => d.frame === k);
        if (crush.length) this.applyDamages(crush);
        // 竹竿倒地睡覺 → 睡飽回血
        for (const z of e.sleepFrames?.filter((x) => x.frame === k) ?? []) floatingText(this, this.xOf(z.seat), ARENA.groundY - 120, 'Zzz…', '#b3e5fc');
        for (const h of e.frameHeals?.filter((x) => x.frame === k) ?? []) {
          damageNumber(this, this.xOf(h.seat), h.amount, '#69f0ae', h.label, '+');
          this.hud.setHp(h.seat, h.hpAfter);
        }
        // 獸控倒下壓到葉柄承：回血、獸控消失
        for (const h of e.crushHeals?.filter((x) => x.frame === k) ?? []) {
          damageNumber(this, this.xOf(h.seat), h.amount, '#69f0ae', '獸控療癒', '+');
          this.hud.setHp(h.seat, h.hpAfter);
          sfx.play('use_porkChop');
          const ds = this.defenses.get(h.uid);
          if (ds) {
            puff(this, ds.root.x, ds.root.y);
            this.removeDefense(h.uid, ds, 'fade');
          }
        }
        // 命中後鏡頭跟著被打飛的人
        if (!flying && knocked && k > e.impactFrame + 4) {
          const f = knocked[1]![Math.min(k, knocked[1]!.length - 1)];
          this.director.set({ x: f[0] + Math.sin(f[2]) * (f[4] === 3 || f[4] === 4 ? 52 : 75), y: this.director.restY(CAMERA.followZoom), zoom: CAMERA.followZoom, rate: 3.5 });
        }
        if (k !== e.impactFrame) return;
        flying = false;
        this.speedLines.stop();
        // 黏住了：投擲物本身消失，換成黏在身上的那坨
        if (e.stuck) {
          proj.setAlpha(0);
          this.chars[e.stuck.seat]?.addStuck(e.stuck.item);
        }
        this.showImpact(e);
      },
    });
    this.speedLines.stop();
    this.knockedSeats.clear();
    proj.destroy();
    this.tweens.add({ targets: trail, alpha: 0, duration: 400, onComplete: () => trail.destroy() });
    // 沒被影格處理到的（例如沒被打壞但扣了次數）更新標籤
    this.applyDefenseUpdates(e.defenseUpdates.filter((u) => !u.destroyed));
    await wait(this, 250);
  }

  /** 命中瞬間：爆炸、傷害數字、狀態 */
  private showImpact(e: Extract<BattleEvent, { type: 'throw' }>): void {
    const direct = e.damages.find((d) => d.source === 'direct');
    const item = getItem(e.itemId);
    const kg = item?.kind === 'throwable' ? item.weightKg ?? 0.3 : 0.3;
    // 力道感：越重、傷害越高、爆頭 → 頓越久、鏡頭推越多、晃越大
    const strength = Phaser.Math.Clamp(Math.sqrt(kg) * 0.55 + (direct ? direct.amount / 70 : 0) + (direct?.headshot ? 0.3 : 0), 0, 1);
    // 鏡頭停在命中點附近（不再跟著投擲物）
    const hold = this.director.wideShot([e.impact.x - 200, e.impact.x + 200], 4);
    // 命中音效：每個投擲物有自己的聲音
    if (e.impact.kind === 'character' || e.impact.kind === 'defense') sfx.play(itemHitSound(e.itemId), { vol: e.impact.kind === 'defense' ? 0.8 : 1 });
    if (e.impact.kind === 'defense') sfx.play('block');
    if (e.impact.kind === 'platform') sfx.play('miss');
    if (e.impact.kind === 'out') {
      floatingText(this, Phaser.Math.Clamp(e.impact.x, 60, ARENA.world.width - 60), ARENA.groundY - 120, '飛出場外！', '#ffffff');
      this.director.set({ ...hold, x: Phaser.Math.Clamp(e.impact.x, 0, ARENA.world.width), zoom: CAMERA.followZoom });
    } else {
      this.director.set({ ...hold, x: e.impact.x, zoom: CAMERA.followZoom });
      void explosion(this, e.impact.x, e.impact.y, Math.max(30, e.explosionRadius));
      if (direct) {
        impactBurst(this, e.impact.x, e.impact.y, strength);
        this.hitStop(70 + 150 * strength);
        this.director.punch(0.06 + 0.14 * strength);
        this.cameras.main.shake(140 + 220 * strength, 0.004 + 0.012 * strength);
        if (direct.headshot) this.cameras.main.flash(120, 255, 255, 255);
      } else if (e.impact.kind === 'defense') {
        impactBurst(this, e.impact.x, e.impact.y, strength * 0.6);
        this.hitStop(50 + 70 * strength);
        this.director.punch(0.04 + 0.06 * strength);
        this.cameras.main.shake(120, 0.004 + 0.005 * strength);
      }
    }
    if (e.impact.kind === 'defense') floatingText(this, e.impact.x, e.impact.y - 40, '擋下了！', '#80deea');
    this.applyDamages(e.damages.filter((d) => d.frame === undefined));
    if (e.statusApplied) this.showStatusApplied(e.statusApplied);
    // 被打壞的防禦道具：變灰、繼續倒，等全部靜止才碎掉
    for (const u of e.defenseUpdates) {
      if (!u.destroyed || u.reason === 'fell' || u.reason === 'removed') continue;
      const ds = this.defenses.get(u.uid);
      if (!ds) continue;
      floatingText(this, ds.root.x, ds.root.y - ds.view.h / 2 - 20, '擊垮！', '#ffcc80');
      (ds.root.list[0] as Phaser.GameObjects.Image).setTint(0x9e9e9e);
      ds.label.setText('');
    }
    this.showRage(e.defenseUpdates);
    // 竹竿連中 3 次：胡了！
    if (e.hu) {
      floatingText(this, this.xOf(e.seat), ARENA.groundY - 300, '胡！下次必抽麻將', '#ff5252');
      sfx.play('headshot');
    }
    if (e.damages.length === 0 && e.impact.kind === 'platform') floatingText(this, e.impact.x, e.impact.y - 30, '沒打中', '#ffffff');
  }

  // ------------------------------------------------------------ 快照 → 回合 UI

  private onSnapshot(snap: RoomSnapshot): void {
    const mySeat = store.mySeat;
    if (!this.ready) return;
    if (this.chars.length === 0) this.buildCharacters(snap);
    snap.players.forEach((p, i) => p && this.chars[i]?.setName(p.name));
    this.updatePoses(snap);
    this.hud.updatePlayers(snap, mySeat);
    this.hud.updateTurn(snap, mySeat, store.snapshotAt || performance.now());
    if (this.animating === 0) this.syncVisuals(snap);

    const t = snap.turn;
    const key = t ? `${t.turnId}:${t.phase}` : `none:${snap.status}`;
    if (key === this.phaseKey) return;
    this.phaseKey = key;
    this.busy = false;
    this.renderPhase(snap);
  }

  /** 選卡特效播放中（期間不能瞄準/放置） */
  private cardFx = false;

  private renderPhase(snap: RoomSnapshot): void {
    const t = snap.turn;
    const mySeat = store.mySeat;
    const mine = !!t && t.activeSeat === mySeat;
    // 剛選完卡：先播選卡特效（卡片旋轉放大到中央、發光、碎成粒子），播完才進入這個人的使用階段
    if (t && t.chosenItemId && ['aimAngle', 'aimPower', 'place', 'target'].includes(t.phase) && this.cards.has(t.chosenItemId) && !this.cardFx) {
      const key = this.phaseKey;
      this.cardFx = true;
      this.slot.hide();
      this.setAction(null);
      // 保險：最多 1.6 秒就繼續（例如分頁在背景、動畫被中斷）
      void Promise.race([this.cards.burst(t.chosenItemId), new Promise<void>((r) => setTimeout(r, 1600))]).then(() => {
        if (!this.cardFx) return;
        this.cardFx = false;
        if (this.phaseKey === key && store.snapshot) this.renderPhase(store.snapshot);
      });
      return;
    }
    // 先收起所有互動元件，再依階段打開
    this.placement.hide();
    this.target.hide();
    if (!t || !['aimAngle', 'aimPower'].includes(t.phase)) {
      this.aim.hide();
      sfx.stopCharge();
    }
    if (!t || !['draw', 'choose'].includes(t.phase)) {
      this.slot.hide();
      this.cards.hide();
    }
    this.setAction(null);
    if (!t || snap.status !== 'battle') return;
    // 輪到誰，鏡頭就在誰那邊（動畫播放中由動畫自己控制鏡頭）
    if (this.animating === 0 && t.phase !== 'resolving') {
      if (t.phase === 'target' && getItem(t.chosenItemId ?? '')?.kind === 'functional') this.focusBoth();
      else this.focusSeat(t.activeSeat);
    }

    switch (t.phase) {
      case 'draw':
        this.cards.hide();
        this.slot.spin(mine ? (this.touch ? '點右下角按鈕停止！' : '按空白鍵（或右下角按鈕）停止！') : '對手正在抽取道具…');
        if (mine) this.setAction('停止');
        break;
      case 'choose': {
        const options = t.options ?? [];
        this.slot.land(options, t.hiddenSlots).then(() => {
          if (this.phaseKey !== `${t.turnId}:choose`) return;
          this.slot.hide();
          this.cards.show(options, mine, (id) => this.send('turn:choose', { turnId: t.turnId, itemId: id }), t.hiddenSlots);
        });
        break;
      }
      case 'aimAngle':
      case 'aimPower':
        this.cards.hide();
        this.slot.hide();
        this.charging = false;
        this.localAngle = mine ? 35 : null;
        this.localPower = null;
        this.previewAngle = null;
        this.previewPower = null;
        this.aim.setHint(
          mine
            ? this.touch
              ? '手指按住並拖曳瞄準，放開就投出（按越久越大力）'
              : '移動滑鼠瞄準，按住左鍵或空白鍵蓄力，放開投出'
            : '對手正在瞄準…',
        );
        break;
      case 'place': {
        this.cards.hide();
        const item = getItem(t.chosenItemId ?? '');
        if (item?.kind === 'defense')
          this.placement.show(
            t.activeSeat,
            this.xOf(t.activeSeat),
            // 捲毛的回收紙箱比較大
            { ...item, size: scaledDefenseSize(item.size, item.id, snap.players[t.activeSeat]?.characterId) },
            mine,
            snap.defenses,
            defKey(item.id),
            this.touch,
            (x, y) => this.send('turn:place', { turnId: t.turnId, x, y }),
            (p) => this.toWorld(p),
          );
        break;
      }
      case 'target': {
        this.cards.hide();
        const item = getItem(t.chosenItemId ?? '');
        if (item?.kind !== 'functional') break;
        if (item.targeting === 'enemyDefense') {
          const targets = snap.defenses.filter((d) => d.owner !== t.activeSeat);
          this.target.show(mine ? `點選要摧毀的敵方防禦道具` : `對手正在選擇目標…`, targets, mine, (uid) =>
            this.send('turn:functional', { turnId: t.turnId, targetUid: uid }),
          );
        } else {
          this.target.show(
            mine ? (this.touch ? `點右下角按鈕發動「${item.name}」` : `按空白鍵（或右下角按鈕）發動「${item.name}」`) : `對手即將發動「${item.name}」`,
            [],
            false,
            () => {},
          );
          if (mine) this.setAction('發動');
        }
        break;
      }
      default:
        break;
    }
  }

  // ------------------------------------------------------------ 每幀：倒數與瞄準擺動

  override update(time: number, delta: number): void {
    if (!this.ready) return;
    this.director.update(delta);
    this.speedLines.update(delta);
    this.updateMarkers();
    this.hud.tick(performance.now());
    const t = store.snapshot?.turn;
    if (!t || store.snapshot?.status !== 'battle') return;
    if (t.phase !== 'aimAngle' && t.phase !== 'aimPower') return;
    if (this.cardFx) return;
    if (t.activeSeat === store.mySeat) {
      if (this.busy) return;
      if (this.charging) {
        const elapsed = (performance.now() - this.chargeStart) / 1000;
        this.localPower = Math.min(AIM_CONFIG.maxPower, AIM_CONFIG.minPower + elapsed / AIM_CONFIG.chargeSeconds);
        sfx.charge(this.localPower);
      }
      this.aim.draw(t.activeSeat, this.xOf(t.activeSeat), this.localAngle, this.charging ? this.localPower : null, this.scaleOf(t.activeSeat));
      // 把瞄準狀態即時分享給對手（每秒 10 次）
      if (time - this.lastPreviewSent > 100) {
        this.lastPreviewSent = time;
        store.net.emit('turn:aimPreview', {
          turnId: t.turnId,
          angle: this.localAngle ?? undefined,
          power: this.charging ? this.localPower ?? undefined : undefined,
        });
      }
    } else {
      this.aim.draw(t.activeSeat, this.xOf(t.activeSeat), this.previewAngle, this.previewPower, this.scaleOf(t.activeSeat));
    }
  }

  // ------------------------------------------------------------ 瞄準：拖曳方向、按住蓄力、放開投出

  private isMyAim(): boolean {
    const t = store.snapshot?.turn;
    return !!t && store.snapshot?.status === 'battle' && t.activeSeat === store.mySeat && (t.phase === 'aimAngle' || t.phase === 'aimPower') && !this.busy && !this.cardFx;
  }

  /** 畫面外的角色：在畫面邊緣顯示箭頭與距離 */
  private updateMarkers(): void {
    const snap = store.snapshot;
    if (!snap) return;
    const me = store.mySeat;
    for (const seat of [0, 1] as Seat[]) {
      const c = this.chars[seat];
      if (!c) continue;
      const s = this.toScreen(c.x, c.headY + 40);
      const dist = me !== null && me !== seat ? Math.abs(c.x - this.xOf(me)) : null;
      this.markers.update(seat, s.x, s.y, snap.players[seat]?.name ?? '', dist);
    }
  }

  private toScreen(wx: number, wy: number): { x: number; y: number } {
    const cam = this.cameras.main;
    return { x: (wx - cam.midPoint.x) * cam.zoom + ARENA.width / 2, y: (wy - cam.midPoint.y) * cam.zoom + ARENA.height / 2 };
  }

  private toWorld(p: Phaser.Input.Pointer): { x: number; y: number } {
    const v = this.cameras.main.getWorldPoint(p.x, p.y);
    return { x: v.x, y: v.y };
  }

  private aimAtPointer(p: Phaser.Input.Pointer): void {
    const w = this.toWorld(p);
    this.aimAt(w.x, w.y);
  }

  /** 由游標/手指位置換算投擲角度（以出手點為中心，朝向對手） */
  private aimAt(x: number, y: number): void {
    const seat = store.mySeat;
    if (seat === null) return;
    const lp = launchPoint(seat, this.xOf(seat), this.scaleOf(seat));
    const dir = seat === 0 ? 1 : -1;
    const dx = (x - lp.x) * dir,
      dy = lp.y - y;
    if (Math.hypot(dx, dy) < 12) return; // 太靠近出手點時角度會亂跳
    const deg = Phaser.Math.RadToDeg(Math.atan2(dy, dx));
    this.localAngle = Phaser.Math.Clamp(deg, AIM_CONFIG.minAngle, AIM_CONFIG.maxAngle);
  }

  private startCharge(): void {
    if (this.charging || this.busy) return;
    this.charging = true;
    this.chargeStart = performance.now();
    this.localPower = AIM_CONFIG.minPower;
  }

  private releaseThrow(): void {
    const t = store.snapshot?.turn;
    this.charging = false;
    sfx.stopCharge();
    if (!t || !this.isMyAim() || this.localAngle === null || this.localPower === null) return;
    const angle = round1(this.localAngle);
    const power = Math.round(this.localPower * 1000) / 1000;
    this.aim.setHint('');
    this.send('turn:throw', { turnId: t.turnId, angle, power });
  }

  // ------------------------------------------------------------ 輸入

  private primaryAction(): void {
    const t = store.snapshot?.turn;
    if (!t || t.activeSeat !== store.mySeat || this.busy) return;
    switch (t.phase) {
      case 'draw':
        this.send('turn:stopSlot', { turnId: t.turnId });
        break;
      case 'target': {
        const item = getItem(t.chosenItemId ?? '');
        if (item?.kind === 'functional' && item.targeting === 'none') this.send('turn:functional', { turnId: t.turnId });
        break;
      }
    }
  }

  private pickByIndex(i: number): void {
    const t = store.snapshot?.turn;
    if (!t || t.phase !== 'choose' || t.activeSeat !== store.mySeat || !t.options?.[i]) return;
    this.send('turn:choose', { turnId: t.turnId, itemId: t.options[i] });
  }

  private async send(event: 'turn:stopSlot' | 'turn:choose' | 'turn:throw' | 'turn:place' | 'turn:functional', payload: object) {
    if (this.busy) return;
    this.busy = true;
    const key = this.phaseKey;
    if (event === 'turn:choose') this.cards.highlight((payload as { itemId: string }).itemId);
    const res = await store.net.call(event, payload);
    if (!res.ok) {
      const msg = res.error === 'TIMEOUT' || res.error === 'OFFLINE' ? '連線不穩，請再試一次' : ERROR_TEXT[res.error as ErrorCode];
      // 階段已切換造成的拒絕（例如連按）不必打擾玩家，畫面會跟著下一份快照更新
      if (res.error !== 'STALE_TURN' && res.error !== 'WRONG_PHASE') toast(msg, true);
      if (this.phaseKey === key) {
        this.busy = false;
        if (event === 'turn:throw') this.aim.setHint('沒送出去，請再丟一次');
        // 選卡失敗時把卡片還原
        if (event === 'turn:choose' && store.snapshot) this.renderPhase(store.snapshot);
      }
    }
    // 成功時等下一個快照切換階段，busy 會在 onSnapshot 重設
  }

  // ------------------------------------------------------------ DOM 按鈕（手機觸控用）

  private createDomButtons(): void {
    const app = document.getElementById('app')!;
    const btn = document.createElement('button');
    btn.className = 'action-btn';
    btn.style.display = 'none';
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.primaryAction();
    });
    app.appendChild(btn);
    this.actionBtn = btn;

    const leave = document.createElement('button');
    leave.className = 'btn secondary leave-btn';
    leave.textContent = '投降離開';
    let armed = 0;
    leave.addEventListener('click', () => {
      if (store.snapshot?.status !== 'battle') return;
      if (Date.now() - armed < 3000) {
        store.net.leaveRoom();
        window.dispatchEvent(new CustomEvent('hillduel:left'));
      } else {
        armed = Date.now();
        leave.textContent = '再按一次確認投降';
        setTimeout(() => (leave.textContent = '投降離開'), 3000);
      }
    });
    app.appendChild(leave);
    this.leaveBtn = leave;

    const skill = document.createElement('button');
    skill.className = 'btn secondary skill-btn';
    skill.innerHTML = this.touch ? '技能' : '技能 <small>Q</small>';
    skill.addEventListener('click', () => this.toggleSkills());
    app.appendChild(skill);
    this.skillBtn = skill;
  }

  /** 竹竿的手辦被毀：憤怒加成 */
  private showRage(updates: DefenseUpdate[]): void {
    for (const u of updates) {
      if (!u.rage) continue;
      floatingText(this, this.xOf(u.rage.seat), ARENA.groundY - 280, `憤怒！傷害 +0.15（共 +${u.rage.total.toFixed(2)}）`, '#ff7043');
    }
  }

  /** 角色身體大小倍率（連恩 2/3） */
  private scaleOf(seat: Seat): number {
    return bodyScaleOf(store.snapshot?.players[seat]?.characterId);
  }

  /** 顯示 / 關閉自己角色的技能說明（按 Q 或左下角按鈕） */
  private toggleSkills(): void {
    if (this.skillPanel) {
      this.skillPanel.remove();
      this.skillPanel = null;
      return;
    }
    const me = store.snapshot?.players[store.mySeat ?? 0];
    const c = getCharacter(me?.characterId ?? '');
    if (!c) return;
    const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
    const cards = (c.exclusiveItems ?? [])
      .map((id) => getItem(id))
      .filter((i) => !!i)
      .map((i) => `<div class="skill-card">${i!.icon ? `<img src="${i!.icon}" alt="">` : ''}<div><b>${esc(i!.name)}</b><br>${esc(i!.description)}</div></div>`)
      .join('');
    const panel = document.createElement('div');
    panel.className = 'skill-panel';
    panel.innerHTML = `
      <div class="skill-head">${c.portrait ? `<img src="${c.portrait}" alt="">` : ''}<div><div class="skill-name">${esc(c.name)}</div><div class="skill-hp">初始血量 ${c.maxHp}</div></div></div>
      ${c.skills?.length ? `<ul>${c.skills.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : '<p>這個角色沒有特殊技能。</p>'}
      ${cards ? `<div class="skill-sub">專屬卡牌</div>${cards}` : ''}
      <div class="skill-close">${this.touch ? '點一下關閉' : '再按 Q 或點一下關閉'}</div>`;
    panel.addEventListener('click', () => this.toggleSkills());
    document.getElementById('app')!.appendChild(panel);
    this.skillPanel = panel;
  }

  private setAction(label: string | null): void {
    if (!this.actionBtn) return;
    if (!label) {
      this.actionBtn.style.display = 'none';
      return;
    }
    this.actionBtn.innerHTML = this.touch ? label : `${label}<small>空白鍵</small>`;
    this.actionBtn.style.display = 'block';
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
