// 戰鬥畫面上方 UI：雙方名稱/角色/血量條、中央的行動玩家、倒數、階段。

import * as Phaser from 'phaser';
import { getCharacter } from '../../../../shared/config/characters.js';
import { ARENA } from '../../../../shared/config/game.js';
import { getStatus, PERMANENT_TURNS } from '../../../../shared/config/items.js';
import type { PlayerView, RoomSnapshot, Seat, TurnPhase } from '../../../../shared/types.js';
import { FONT } from './effects.js';

const PHASE_TEXT: Record<TurnPhase, string> = {
  turnStart: '回合開始',
  draw: '抽取道具',
  choose: '選擇道具',
  aimAngle: '瞄準・蓄力',
  aimPower: '瞄準・蓄力',
  place: '放置防禦',
  target: '發動道具',
  resolving: '結算中',
};

const BAR_W = 300;
const SEAT_COLOR = [0x3d7bd8, 0xd8463d];

interface SidePanel {
  name: Phaser.GameObjects.Text;
  char: Phaser.GameObjects.Text;
  hpText: Phaser.GameObjects.Text;
  barFill: Phaser.GameObjects.Rectangle;
  barLag: Phaser.GameObjects.Rectangle;
  status: Phaser.GameObjects.Text;
  offline: Phaser.GameObjects.Text;
  activeGlow: Phaser.GameObjects.Rectangle;
  shownHp: number;
  maxHp: number;
}

export class Hud {
  private sides: SidePanel[] = [];
  private turnText: Phaser.GameObjects.Text;
  private phaseText: Phaser.GameObjects.Text;
  private timerRing: Phaser.GameObjects.Graphics;
  private timerText: Phaser.GameObjects.Text;
  private timerEnd = 0;
  private timerTotal = 1;
  private timerActive = false;

  constructor(private scene: Phaser.Scene) {
    for (const seat of [0, 1] as Seat[]) this.sides.push(this.makeSide(seat));
    const cx = ARENA.width / 2;
    this.turnText = scene.add
      .text(cx, 18, '', { fontFamily: FONT, fontSize: '22px', fontStyle: '900', color: '#ffffff', stroke: '#2b2118', strokeThickness: 6 })
      .setOrigin(0.5, 0)
      .setDepth(100);
    this.timerRing = scene.add.graphics().setDepth(100);
    this.timerText = scene.add
      .text(cx, 92, '', { fontFamily: FONT, fontSize: '30px', fontStyle: '900', color: '#2b2118' })
      .setOrigin(0.5)
      .setDepth(101);
    this.phaseText = scene.add
      .text(cx, 134, '', { fontFamily: FONT, fontSize: '16px', fontStyle: '800', color: '#2b2118', backgroundColor: '#fff8ea', padding: { x: 10, y: 3 } })
      .setOrigin(0.5, 0)
      .setDepth(100);
  }

  private makeSide(seat: Seat): SidePanel {
    const s = this.scene;
    const left = seat === 0;
    const x = left ? 16 : ARENA.width - 16 - BAR_W - 24;
    const y = 12;
    const w = BAR_W + 24;
    const activeGlow = s.add.rectangle(x + w / 2, y + 52, w + 10, 114, 0xffd54f, 0).setDepth(98).setStrokeStyle(5, 0xffd54f, 0);
    s.add.rectangle(x + w / 2, y + 52, w, 104, 0xfff8ea, 0.95).setStrokeStyle(3, 0x2b2118).setDepth(99);
    s.add.rectangle(x + (left ? 6 : w - 6), y + 52, 8, 104, SEAT_COLOR[seat]).setDepth(99);
    const tx = left ? x + 18 : x + w - 18;
    const origin = left ? 0 : 1;
    const name = s.add.text(tx, y + 8, '', { fontFamily: FONT, fontSize: '20px', fontStyle: '900', color: '#2b2118' }).setOrigin(origin, 0).setDepth(100);
    const char = s.add.text(tx, y + 34, '', { fontFamily: FONT, fontSize: '13px', fontStyle: '700', color: '#6d5c4b' }).setOrigin(origin, 0).setDepth(100);
    const hpText = s.add
      .text(left ? x + w - 12 : x + 12, y + 10, '', { fontFamily: FONT, fontSize: '18px', fontStyle: '900', color: '#d8463d' })
      .setOrigin(left ? 1 : 0, 0)
      .setDepth(100);
    const barX = x + 12;
    const barY = y + 58;
    s.add.rectangle(barX, barY, BAR_W, 16, 0x2b2118).setOrigin(0, 0).setDepth(100);
    const barLag = s.add.rectangle(barX + 2, barY + 2, BAR_W - 4, 12, 0xffffff).setOrigin(left ? 0 : 1, 0).setDepth(100);
    const barFill = s.add.rectangle(barX + 2, barY + 2, BAR_W - 4, 12, 0x66bb6a).setOrigin(left ? 0 : 1, 0).setDepth(101);
    if (!left) {
      barLag.x = barX + BAR_W - 2;
      barFill.x = barX + BAR_W - 2;
    }
    const status = s.add.text(tx, y + 80, '', { fontFamily: FONT, fontSize: '13px', fontStyle: '800', color: '#4e8a1f' }).setOrigin(origin, 0).setDepth(100);
    const offline = s.add
      .text(x + w / 2, y + 52, '斷線中…等待重連', { fontFamily: FONT, fontSize: '18px', fontStyle: '900', color: '#ffffff', backgroundColor: '#e53935', padding: { x: 8, y: 4 } })
      .setOrigin(0.5)
      .setDepth(105)
      .setVisible(false);
    return { name, char, hpText, barFill, barLag, status, offline, activeGlow, shownHp: -1, maxHp: 1 };
  }

  /** 更新名稱、角色、狀態、連線（血量另外處理，因為要配合動畫） */
  updatePlayers(snap: RoomSnapshot, mySeat: Seat | null): void {
    snap.players.forEach((p, i) => {
      if (!p) return;
      const side = this.sides[i];
      side.name.setText(p.name + (p.seat === mySeat ? '（你）' : ''));
      side.char.setText(getCharacter(p.characterId ?? '')?.name ?? '');
      side.offline.setVisible(!p.connected);
      side.status.setText(
        p.statuses
          .map((s) => {
            const def = getStatus(s.statusId);
            const name = (def?.name ?? s.statusId).replace(/（.*）/, '');
            if (def?.stackable && def.damagePerTurn) return `${name} -${def.damagePerTurn * (s.stacks ?? 1)}/回合`;
            return `${name}${s.remainingTurns >= PERMANENT_TURNS ? '' : '×' + s.remainingTurns}`;
          })
          .join('  '),
      );
      if (side.maxHp !== p.maxHp) {
        side.maxHp = p.maxHp;
        const hp = side.shownHp;
        side.shownHp = -1; // 強制重畫
        this.setHp(p.seat, hp < 0 ? p.hp : hp, false);
      }
    });
    const active = snap.turn?.activeSeat;
    this.sides.forEach((side, i) => {
      side.activeGlow.setStrokeStyle(5, 0xffd54f, active === i ? 1 : 0);
    });
  }

  setHp(seat: Seat, hp: number, animate = true): void {
    const side = this.sides[seat];
    if (side.shownHp === hp) return;
    side.shownHp = hp;
    const ratio = Math.max(0, Math.min(1, hp / Math.max(1, side.maxHp)));
    side.hpText.setText(`${hp} / ${side.maxHp}`);
    side.barFill.fillColor = ratio > 0.5 ? 0x66bb6a : ratio > 0.25 ? 0xffca28 : 0xef5350;
    side.barFill.scaleX = ratio;
    if (animate) {
      this.scene.tweens.add({ targets: side.barLag, scaleX: ratio, delay: 300, duration: 500, ease: 'Quad.easeOut' });
      this.scene.tweens.add({ targets: side.hpText, scale: { from: 1.4, to: 1 }, duration: 300 });
    } else {
      side.barLag.scaleX = ratio;
    }
  }

  updateTurn(snap: RoomSnapshot, mySeat: Seat | null, receivedAt: number): void {
    const t = snap.turn;
    if (!t) {
      this.turnText.setText('');
      this.phaseText.setText('');
      this.timerActive = false;
      return;
    }
    const activeName = snap.players[t.activeSeat]?.name ?? '';
    this.turnText.setText(t.activeSeat === mySeat ? '你的回合' : `${activeName} 的回合`);
    this.turnText.setColor(t.activeSeat === 0 ? '#bcd6ff' : '#ffc9c4');
    this.phaseText.setText(PHASE_TEXT[t.phase] + (t.timer ? (t.timer.stage === 'draw' ? '（第一階段）' : '（第二階段）') : ''));
    if (t.timer) {
      this.timerActive = true;
      this.timerEnd = receivedAt + t.timer.remainingMs;
      this.timerTotal = t.timer.totalMs;
    } else {
      this.timerActive = false;
    }
  }

  /** 每幀更新倒數 */
  tick(now: number): void {
    const g = this.timerRing;
    const cx = ARENA.width / 2,
      cy = 92,
      r = 30;
    g.clear();
    if (!this.timerActive) {
      this.timerText.setText('');
      return;
    }
    const remain = Math.max(0, this.timerEnd - now);
    const secs = Math.ceil(remain / 1000);
    const warn = remain <= 5000;
    const pulse = warn ? 1 + 0.12 * Math.abs(Math.sin(now / 160)) : 1;
    g.fillStyle(warn ? 0xffcdd2 : 0xfff8ea).fillCircle(cx, cy, r * pulse);
    g.lineStyle(4, 0x2b2118).strokeCircle(cx, cy, r * pulse);
    g.lineStyle(6, warn ? 0xe53935 : 0xe8743b);
    g.beginPath();
    g.arc(cx, cy, r * pulse - 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (remain / this.timerTotal), false);
    g.strokePath();
    this.timerText.setText(String(secs));
    this.timerText.setColor(warn ? '#e53935' : '#2b2118');
    this.timerText.setScale(pulse);
  }

  playerView(snap: RoomSnapshot, seat: Seat): PlayerView | null {
    return snap.players[seat];
  }
}
