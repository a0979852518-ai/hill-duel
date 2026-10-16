// ============================================================
// 戰鬥場景
// ------------------------------------------------------------
// 兩條資料流：
//   room:state（快照）→ 立即更新回合/倒數/操作介面
//   game:event（事件）→ 依序播放動畫；動畫播放期間，血量與防禦道具
//                       不直接套用快照，等動畫結束再同步，避免「還沒打到就扣血」。
// ============================================================

import * as Phaser from 'phaser';
import { AIM_CONFIG, ARENA } from '../../../shared/config/game.js';
import { getItem, type DefenseDef } from '../../../shared/config/items.js';
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
import { banner, damageNumber, explosion, floatingText, FUNCTIONAL_EFFECTS, puff, wait } from './battle/effects.js';
import { Hud } from './battle/Hud.js';
import { CharacterSprite } from './battle/CharacterSprite.js';

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

  constructor() {
    super('Battle');
  }

  create(): void {
    drawArena(this);
    this.hud = new Hud(this);
    this.slot = new SlotMachine(this);
    this.cards = new ChoiceCards(this);
    this.aim = new AimDisplay(this);
    this.placement = new PlacementOverlay(this);
    this.target = new TargetOverlay(this);
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
      if (this.isMyAim()) this.aimAt(p.worldX, p.worldY);
    });
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!this.isMyAim()) return;
      this.aimAt(p.worldX, p.worldY);
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

    store.whenAnimIdle = () => this.waitIdle();
    this.createDomButtons();
    this.unsub.push(store.net.onState((s) => this.onSnapshot(s)));
    this.unsub.push(store.net.onEvent((e) => this.onBattleEvent(e)));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());

    if (store.snapshot) {
      this.buildCharacters(store.snapshot);
      this.hud.updatePlayers(store.snapshot, store.mySeat);
      this.syncVisuals(store.snapshot, false);
      this.onSnapshot(store.snapshot);
    }
  }

  private cleanup(): void {
    this.unsub.forEach((u) => u());
    this.unsub = [];
    store.whenAnimIdle = () => Promise.resolve();
    this.actionBtn?.remove();
    this.leaveBtn?.remove();
    this.actionBtn = this.leaveBtn = null;
    this.placement.hide();
  }

  // ------------------------------------------------------------ 角色與防禦的畫面同步

  private buildCharacters(snap: RoomSnapshot): void {
    for (const seat of [0, 1] as Seat[]) {
      const id = snap.players[seat]?.characterId ?? '';
      this.chars[seat] = new CharacterSprite(this, seat, id);
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
    snap.players.forEach((p) => p && this.hud.setHp(p.seat, p.hp, animate));
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
          floatingText(this, Phaser.Math.Clamp(ds.root.x, 60, ARENA.width - 60), Math.min(ds.root.y, 600), '掉下去了！', '#ffffff');
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

  private hitCharacter(seat: Seat): void {
    this.chars[seat]?.hurt();
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
    this.tweens.timeScale = speed;
    this.time.timeScale = speed;
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
          banner(this, e.seat === mySeat ? '輪到你了！' : `輪到 ${name}`, e.seat === 0 ? 0x3d7bd8 : 0xd8463d, 800);
          for (const d of e.statusDamage) {
            const st = getStatus(d.statusId ?? '');
            damageNumber(this, d.seat, d.amount, '#' + (st?.color ?? 0xb2ff59).toString(16).padStart(6, '0'), st?.name.replace(/（.*）/, '') ?? '狀態');
            this.hitCharacter(d.seat);
            this.hud.setHp(d.seat, d.hpAfter);
          }
          for (const uid of e.expiredDefenses) {
            const ds = this.defenses.get(uid);
            if (ds) {
              floatingText(this, ds.view.x, ds.view.y - ds.view.h / 2 - 20, '時間到', '#ffffff');
              this.removeDefense(uid, ds, 'fade');
            }
          }
          await wait(this, e.statusDamage.length || e.expiredDefenses.length ? 700 : 150);
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
                }
              }
            },
          });
          this.applyDefenseUpdates(e.fell);
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
          if (fx) await fx(this, { seat: e.seat, enemy, target, itemId: e.itemId });
          else this.cameras.main.flash(200);
          this.applyDamages(e.damages);
          for (const h of e.heals) {
            damageNumber(this, h.seat, h.amount, '#69f0ae', '回復', '+');
            this.hud.setHp(h.seat, h.hpAfter);
          }
          for (const st of e.statusApplied) this.showStatusApplied(st);
          this.applyDefenseUpdates(e.defenseUpdates);
          await wait(this, 500);
        });
        break;
      case 'skip':
        this.enqueue(async () => {
          const text =
            e.reason === 'stunned'
              ? `${store.snapshot?.players[e.seat]?.name ?? ''} 被機車鎖鎖住，跳過這回合！`
              : e.reason === 'drawTimeout'
                ? '時間到！放棄本回合'
                : '時間到！取消使用道具';
          await banner(this, text, e.reason === 'stunned' ? 0x546e7a : 0x6d5c4b, 1000);
        });
        break;
      case 'gameOver':
        this.enqueue(async () => {
          const loser = e.winnerSeat === 0 ? 1 : 0;
          await wait(this, 300); // 讓受傷畫面先閃一下
          this.chars[loser]?.die();
          this.chars[e.winnerSeat]?.celebrate();
          await wait(this, 900);
        });
        break;
    }
  }

  private applyDamages(damages: { seat: Seat; amount: number; hpAfter: number; source: string }[]): void {
    for (const d of damages) {
      const color = d.source === 'direct' ? '#ffeb3b' : d.source === 'functional' ? '#ffd54f' : '#ffffff';
      damageNumber(this, d.seat, d.amount, color, d.source === 'direct' ? '直擊' : undefined);
      this.hitCharacter(d.seat);
      this.hud.setHp(d.seat, d.hpAfter);
    }
  }

  private showStatusApplied(st: { seat: Seat; statusId: string; turns: number }): void {
    const def = getStatus(st.statusId);
    const box = characterHitbox(st.seat);
    const turns = st.turns >= PERMANENT_TURNS ? '' : ` ${st.turns} 回合`;
    floatingText(this, Phaser.Math.Clamp(box.x + box.w / 2, 170, ARENA.width - 170), box.y - 44, `${def?.name ?? st.statusId}${turns}`, '#' + (def?.color ?? 0xffffff).toString(16).padStart(6, '0'));
  }

  /** 目前播放到第幾格（給 onFrame 用） */
  private frameCursor = 0;

  /**
   * 播放伺服器算好的物理影格：防禦道具位置/角度、投擲物位置/角度。
   * 影格之間做線性插值，畫面在高更新率的螢幕上也是順的。
   */
  private playFrames(
    frames: PhysicsFrames,
    opts: { proj?: Phaser.GameObjects.Image; trail?: Phaser.GameObjects.Graphics; onFrame?: (i: number) => void; reasons?: Record<string, DefenseUpdate> },
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
            else {
              floatingText(this, ds.root.x, ds.root.y - ds.view.h / 2 - 20, '破壞！', '#ffcc80');
              this.removeDefense(uid, ds, 'break');
            }
          } else if (ds) this.removeDefense(uid, ds, 'fall');
        }
        opts.onFrame?.(k);
      }
      last = Math.max(last, upto);
    };
    const pose = (arr: [number, number, number][], v: number) => {
      const i = Math.min(arr.length - 1, Math.floor(v));
      const j = Math.min(arr.length - 1, i + 1);
      const f = Math.min(1, v - i);
      const a = arr[i],
        b = arr[j];
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f] as const;
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
          if (opts.proj && frames.p) {
            if (v < frames.p.length - 1 || (frames.p.length === 1 && v < 1)) {
              const [x, y, a] = pose(frames.p, v);
              opts.proj.setPosition(x, y).setRotation(a).setVisible(true);
              opts.trail?.fillStyle(0xffffff, 0.45).fillCircle(x, y, 2.2);
            } else opts.proj.setVisible(false);
          }
          fire(Math.floor(v));
        },
        onComplete: () => {
          fire(n - 1);
          resolve();
        },
      });
    });
  }

  private async playThrow(e: Extract<BattleEvent, { type: 'throw' }>): Promise<void> {
    this.aim.hide();
    const item = getItem(e.itemId);
    const key = this.textures.exists(projKey(e.itemId)) ? projKey(e.itemId) : iconKey(e.itemId);
    const lp = launchPoint(e.seat);
    const start = e.frames.p?.[0] ?? [lp.x, lp.y, 0];
    const proj = this.add.image(start[0], start[1], key).setDepth(46);
    fitInto(proj, item?.kind === 'throwable' ? Math.max(32, item.radius * 3.4) : 32);
    const trail = this.add.graphics().setDepth(44);
    this.chars[e.seat]?.flash('throw', 450);

    const reasons: Record<string, DefenseUpdate> = {};
    for (const u of e.defenseUpdates) reasons[u.uid] = u;
    await this.playFrames(e.frames, {
      proj,
      trail,
      reasons,
      onFrame: (k) => {
        if (k !== e.impactFrame) return;
        this.showImpact(e);
      },
    });
    proj.destroy();
    this.tweens.add({ targets: trail, alpha: 0, duration: 400, onComplete: () => trail.destroy() });
    // 沒被影格處理到的（例如沒被打壞但扣了次數）更新標籤
    this.applyDefenseUpdates(e.defenseUpdates.filter((u) => !u.destroyed));
    await wait(this, 250);
  }

  /** 命中瞬間：爆炸、傷害數字、狀態 */
  private showImpact(e: Extract<BattleEvent, { type: 'throw' }>): void {
    const heavy = e.damages.some((d) => d.source === 'direct');
    if (e.impact.kind === 'out') {
      floatingText(this, Phaser.Math.Clamp(e.impact.x, 60, ARENA.width - 60), ARENA.height - 60, '飛出場外！', '#ffffff');
    } else {
      void explosion(this, e.impact.x, e.impact.y, Math.max(30, e.explosionRadius));
      if (heavy) this.cameras.main.shake(180, 0.007);
    }
    if (e.impact.kind === 'defense') floatingText(this, e.impact.x, e.impact.y - 40, '擋下了！', '#80deea');
    this.applyDamages(e.damages);
    if (e.statusApplied) this.showStatusApplied(e.statusApplied);
    if (e.damages.length === 0 && e.impact.kind === 'platform') floatingText(this, e.impact.x, e.impact.y - 30, '沒打中', '#ffffff');
  }

  // ------------------------------------------------------------ 快照 → 回合 UI

  private onSnapshot(snap: RoomSnapshot): void {
    const mySeat = store.mySeat;
    if (this.chars.length === 0) this.buildCharacters(snap);
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

  private renderPhase(snap: RoomSnapshot): void {
    const t = snap.turn;
    const mySeat = store.mySeat;
    const mine = !!t && t.activeSeat === mySeat;
    // 先收起所有互動元件，再依階段打開
    this.placement.hide();
    this.target.hide();
    if (!t || !['aimAngle', 'aimPower'].includes(t.phase)) this.aim.hide();
    if (!t || !['draw', 'choose'].includes(t.phase)) {
      this.slot.hide();
      this.cards.hide();
    }
    this.setAction(null);
    if (!t || snap.status !== 'battle') return;

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
          this.placement.show(t.activeSeat, item, mine, snap.defenses, defKey(item.id), this.touch, (x, y) =>
            this.send('turn:place', { turnId: t.turnId, x, y }),
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

  override update(time: number): void {
    this.hud.tick(performance.now());
    const t = store.snapshot?.turn;
    if (!t || store.snapshot?.status !== 'battle') return;
    if (t.phase !== 'aimAngle' && t.phase !== 'aimPower') return;
    if (t.activeSeat === store.mySeat) {
      if (this.busy) return;
      if (this.charging) {
        const elapsed = (performance.now() - this.chargeStart) / 1000;
        this.localPower = Math.min(AIM_CONFIG.maxPower, AIM_CONFIG.minPower + elapsed / AIM_CONFIG.chargeSeconds);
      }
      this.aim.draw(t.activeSeat, this.localAngle, this.charging ? this.localPower : null);
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
      this.aim.draw(t.activeSeat, this.previewAngle, this.previewPower);
    }
  }

  // ------------------------------------------------------------ 瞄準：拖曳方向、按住蓄力、放開投出

  private isMyAim(): boolean {
    const t = store.snapshot?.turn;
    return !!t && store.snapshot?.status === 'battle' && t.activeSeat === store.mySeat && (t.phase === 'aimAngle' || t.phase === 'aimPower') && !this.busy;
  }

  /** 由游標/手指位置換算投擲角度（以出手點為中心，朝向對手） */
  private aimAt(x: number, y: number): void {
    const seat = store.mySeat;
    if (seat === null) return;
    const lp = launchPoint(seat);
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
