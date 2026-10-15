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
import { characterHitbox, defenseRect } from '../../../shared/physics.js';
import { ERROR_TEXT, type BattleEvent, type DefenseUpdate, type DefenseView, type ErrorCode, type RoomSnapshot, type Seat } from '../../../shared/types.js';
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
  private aimStart = 0;
  private localAngle: number | null = null;
  private localPower: number | null = null;
  private lockedAngle: number | null = null;
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

    this.input.keyboard?.on('keydown-SPACE', (e: KeyboardEvent) => {
      e.preventDefault();
      this.primaryAction();
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
      if (existing) this.updateDefense(existing, d);
      else this.createDefense(d);
    }
    for (const [uid, ds] of this.defenses) if (!seen.has(uid)) this.removeDefense(uid, ds, 'fade');
  }

  private createDefense(d: DefenseView): DefenseSprite {
    const item = getItem(d.itemId) as DefenseDef | undefined;
    const root = this.add.container(d.x, d.y).setDepth(25);
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

  private updateDefense(ds: DefenseSprite, d: DefenseView): void {
    ds.view = d;
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

  private removeDefense(uid: string, ds: DefenseSprite, style: 'fade' | 'break'): void {
    this.defenses.delete(uid);
    if (style === 'break') {
      const r = defenseRect(ds.view);
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
        floatingText(this, ds.view.x, ds.view.y - ds.view.h / 2 - 20, '破壞！', '#ffcc80');
        this.removeDefense(u.uid, ds, 'break');
      } else {
        this.updateDefense(ds, { ...ds.view, durability: u.durability, hits: u.hits });
        this.tweens.add({ targets: ds.root, x: ds.view.x + 5, yoyo: true, repeat: 3, duration: 40 });
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
        if (e.power !== undefined) this.previewPower = e.power;
        break;
      case 'throw':
        this.enqueue(() => this.playThrow(e));
        break;
      case 'defensePlaced':
        this.enqueue(async () => {
          const ds = this.defenses.get(e.defense.uid) ?? this.createDefense(e.defense);
          ds.root.y = e.defense.y - 160;
          ds.root.alpha = 0;
          this.tweens.add({ targets: ds.root, y: e.defense.y, alpha: 1, duration: 380, ease: 'Bounce.easeOut' });
          await wait(this, 400);
          puff(this, e.defense.x, e.defense.y + e.defense.h / 2);
          await wait(this, 250);
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
    floatingText(this, box.x + box.w / 2, box.y - 44, `${def?.name ?? st.statusId}${turns}`, '#' + (def?.color ?? 0xffffff).toString(16).padStart(6, '0'));
  }

  private async playThrow(e: Extract<BattleEvent, { type: 'throw' }>): Promise<void> {
    this.aim.hide();
    const item = getItem(e.itemId);
    const key = this.textures.exists(projKey(e.itemId)) ? projKey(e.itemId) : iconKey(e.itemId);
    const proj = this.add.image(e.path[0][0], e.path[0][1], key).setDepth(46);
    fitInto(proj, item?.kind === 'throwable' ? Math.max(30, item.radius * 3.2) : 30);
    const trail = this.add.graphics().setDepth(44);
    const total = Math.max(1, (e.path.length - 1) * e.sampleMs);
    // 出手動作
    this.chars[e.seat]?.flash('throw', 400);

    await new Promise<void>((resolve) => {
      this.tweens.addCounter({
        from: 0,
        to: e.path.length - 1,
        duration: total,
        onUpdate: (tw) => {
          const v = tw.getValue() ?? 0;
          const i = Math.min(e.path.length - 2, Math.floor(v));
          const f = v - i;
          const a = e.path[Math.max(0, i)],
            b = e.path[Math.max(0, i) + 1] ?? a;
          proj.setPosition(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f);
          proj.angle += e.seat === 0 ? 9 : -9;
          trail.fillStyle(0xffffff, 0.5).fillCircle(proj.x, proj.y, 2);
        },
        onComplete: () => resolve(),
      });
    });
    proj.destroy();
    this.tweens.add({ targets: trail, alpha: 0, duration: 500, onComplete: () => trail.destroy() });

    if (e.impact.kind === 'out') {
      floatingText(this, Phaser.Math.Clamp(e.impact.x, 60, ARENA.width - 60), ARENA.height - 60, '飛出場外！', '#ffffff');
    } else if (e.explosionRadius > 0) {
      await explosion(this, e.impact.x, e.impact.y, e.explosionRadius);
    } else {
      puff(this, e.impact.x, e.impact.y);
    }
    if (e.impact.kind === 'defense') floatingText(this, e.impact.x, e.impact.y - 40, '擋下了！', '#80deea');
    this.applyDefenseUpdates(e.defenseUpdates);
    this.applyDamages(e.damages);
    if (e.statusApplied) this.showStatusApplied(e.statusApplied);
    if (e.damages.length === 0 && e.impact.kind !== 'defense' && e.impact.kind !== 'out')
      floatingText(this, e.impact.x, e.impact.y - 30, '沒打中', '#ffffff');
    await wait(this, 450);
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
        this.slot.spin(mine ? '按空白鍵停止！' : '對手正在抽取道具…');
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
        this.cards.hide();
        this.slot.hide();
        this.aimStart = performance.now();
        this.lockedAngle = null;
        this.localPower = null;
        this.previewAngle = null;
        this.previewPower = null;
        if (mine) this.setAction('確定角度');
        break;
      case 'aimPower':
        this.lockedAngle = t.angle;
        this.aimStart = performance.now();
        this.previewPower = null;
        if (mine) this.setAction('確定力道');
        break;
      case 'place': {
        this.cards.hide();
        const item = getItem(t.chosenItemId ?? '');
        if (item?.kind === 'defense')
          this.placement.show(t.activeSeat, item, mine, snap.defenses, defKey(item.id), (x, y) =>
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
          this.target.show(mine ? `按空白鍵發動「${item.name}」` : `對手即將發動「${item.name}」`, [], false, () => {});
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
    const mine = t.activeSeat === store.mySeat;
    if (t.phase === 'aimAngle' || t.phase === 'aimPower') {
      const elapsed = (performance.now() - this.aimStart) / 1000;
      if (mine) {
        if (t.phase === 'aimAngle') {
          if (!this.busy) this.localAngle = pingPong(elapsed * AIM_CONFIG.angleSpeed, AIM_CONFIG.minAngle, AIM_CONFIG.maxAngle);
          this.aim.draw(t.activeSeat, this.localAngle, null, false);
        } else {
          if (!this.busy) this.localPower = pingPong(elapsed * AIM_CONFIG.powerSpeed, AIM_CONFIG.minPower, AIM_CONFIG.maxPower);
          this.aim.draw(t.activeSeat, this.lockedAngle ?? t.angle, this.localPower, true);
        }
        // 把瞄準狀態即時分享給對手（每秒 10 次）
        if (time - this.lastPreviewSent > 100) {
          this.lastPreviewSent = time;
          store.net.emit('turn:aimPreview', {
            turnId: t.turnId,
            angle: t.phase === 'aimAngle' ? this.localAngle ?? undefined : undefined,
            power: t.phase === 'aimPower' ? this.localPower ?? undefined : undefined,
          });
        }
      } else {
        const angle = t.phase === 'aimAngle' ? this.previewAngle : t.angle;
        this.aim.draw(t.activeSeat, angle, t.phase === 'aimPower' ? this.previewPower ?? 0 : null, t.phase === 'aimPower');
      }
    }
  }

  // ------------------------------------------------------------ 輸入

  private primaryAction(): void {
    const t = store.snapshot?.turn;
    if (!t || t.activeSeat !== store.mySeat || this.busy) return;
    switch (t.phase) {
      case 'draw':
        this.send('turn:stopSlot', { turnId: t.turnId });
        break;
      case 'aimAngle':
        if (this.localAngle !== null) this.send('turn:angle', { turnId: t.turnId, angle: round1(this.localAngle) });
        break;
      case 'aimPower':
        if (this.localPower !== null) this.send('turn:power', { turnId: t.turnId, power: Math.round(this.localPower * 1000) / 1000 });
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

  private async send(event: 'turn:stopSlot' | 'turn:choose' | 'turn:angle' | 'turn:power' | 'turn:place' | 'turn:functional', payload: object) {
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
    this.actionBtn.innerHTML = `${label}<small>空白鍵</small>`;
    this.actionBtn.style.display = 'block';
  }
}

function pingPong(v: number, min: number, max: number): number {
  const range = max - min;
  const m = v % (range * 2);
  return min + (m <= range ? m : range * 2 - m);
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
