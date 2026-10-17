// ============================================================
// 戰鬥回合控制（伺服器權威狀態機）
// ------------------------------------------------------------
// turnStart → draw →(空白鍵) choose →(點選)
//    ├ throwable:  aimAngle → aimPower → resolving
//    ├ defense:    place → resolving
//    └ functional: target → resolving
// resolving → 下一位玩家的 turnStart / 或遊戲結束
//
// 第一階段計時涵蓋 draw + choose，第二階段計時涵蓋 aim/place/target，
// 兩個計時器互相獨立；resolving 期間完全不計時。
// ============================================================

import { AIM_CONFIG, GAME_CONFIG } from '../../shared/config/game.js';
import { EXTRA_OPTION, getItem, type ItemDef } from '../../shared/config/items.js';
import { teamOf, type BattleEvent, type ErrorCode, type GameMode, type Seat, type Team, type TurnPhase, type TurnView } from '../../shared/types.js';
import { BattleState } from './BattleState.js';
import { resolveThrow, throwDurationMs } from './Combat.js';
import { canPlaceMore, createDefense, validatePlacement } from './DefenseSystem.js';
import { getHandler } from './functional/registry.js';
import { drawItems, type Rng } from './ItemDraw.js';
import { PhaseTimer } from './PhaseTimer.js';

export interface BattleHooks {
  /** 狀態改變，請廣播最新快照 */
  onChange(): void;
  /** 動畫用事件 */
  onEvent(e: BattleEvent): void;
  onGameOver(winnerTeam: Team, reason: 'hp' | 'forfeit'): void;
}

export class Battle {
  readonly state: BattleState;
  private turnId = 0;
  private activeSeat: Seat = 0;
  private phase: TurnPhase = 'turnStart';
  private options: string[] | null = null;
  private hiddenSlots = 0;
  private chosenItemId: string | null = null;
  private angle: number | null = null;
  private readonly drawTimer = new PhaseTimer();
  private readonly useTimer = new PhaseTimer();
  private readonly pending = new Set<NodeJS.Timeout>();
  private finished = false;
  /** 已經宣告陣亡的座位（2v2） */
  private eliminated = new Set<Seat>();

  constructor(
    maxHp: number[],
    private readonly hooks: BattleHooks,
    private readonly rng: Rng = Math.random,
    characterIds: (string | null)[] = maxHp.map(() => null),
    mode?: GameMode,
  ) {
    this.state = new BattleState(maxHp, characterIds, mode);
  }

  get mode(): GameMode {
    return this.state.mode;
  }

  // ------------------------------------------------------------ 生命週期

  start(firstSeat: Seat): void {
    this.startTurn(firstSeat);
  }

  dispose(): void {
    this.finished = true;
    this.drawTimer.stop();
    this.useTimer.stop();
    for (const t of this.pending) clearTimeout(t);
    this.pending.clear();
  }

  get isFinished(): boolean {
    return this.finished;
  }

  /** 斷線太久判負（2v2：這個人陣亡，隊友還活著就繼續打） */
  forfeit(loser: Seat): void {
    if (this.finished) return;
    const team = teamOf(loser);
    if (this.mode === 'duel' || this.state.seats.filter((s) => teamOf(s) === team && s !== loser).every((s) => this.state.fighters[s].hp <= 0)) {
      this.endGame((1 - team) as Team, 'forfeit');
      return;
    }
    this.state.fighters[loser].hp = 0;
    this.markDead();
    if (this.activeSeat === loser && this.phase !== 'resolving' && this.phase !== 'turnStart') this.skip('useTimeout');
    else this.hooks.onChange();
  }

  turnView(): TurnView {
    const timer = this.drawTimer.view() ?? this.useTimer.view();
    return {
      turnId: this.turnId,
      activeSeat: this.activeSeat,
      phase: this.phase,
      options: this.options,
      hiddenSlots: this.hiddenSlots,
      chosenItemId: this.chosenItemId,
      angle: this.angle,
      timer,
    };
  }

  // ------------------------------------------------------------ 玩家操作（全部回傳錯誤碼或 null）

  stopSlot(seat: Seat, turnId: number): ErrorCode | null {
    const err = this.guard(seat, turnId, ['draw']);
    if (err) return err;
    const weightMul = (i: ItemDef) => this.state.traits(seat).drawWeight?.[i.id] ?? 1;
    let drawn: string[];
    const f = this.state.fighters[seat];
    const reward = this.state.traits(seat).streakReward;
    if (f.huReady && reward) {
      // 竹竿胡了：第一格必定是麻將（放第一格，冷氣卡藏的是最後一格）
      f.huReady = false;
      drawn = [reward.itemId, ...drawItems(GAME_CONFIG.drawCount - 1, (i) => i.id !== reward.itemId && this.eligible(i), this.rng, weightMul)];
    } else drawn = drawItems(GAME_CONFIG.drawCount, (i) => this.eligible(i), this.rng, weightMul);
    // 潘柏翰：抽到香菸直接升級成 Winston 一條
    const repl = this.state.traits(seat).drawReplace;
    if (repl) drawn = drawn.map((id) => repl[id] ?? id);
    // 冷氣卡效果：藏起部分選項（至少留一個能選）
    const hide = Math.min(this.state.hiddenDrawCount(seat), Math.max(0, drawn.length - 1));
    this.options = drawn.slice(0, drawn.length - hide);
    // 每回合固定多一個「移動」可以選（不佔抽到的格子）
    if (getItem(EXTRA_OPTION)?.enabled !== false) this.options.push(EXTRA_OPTION);
    this.hiddenSlots = hide;
    this.phase = 'choose';
    this.hooks.onEvent({ type: 'slotResult', seat, options: this.options, hiddenSlots: hide });
    this.hooks.onChange();
    return null;
  }

  choose(seat: Seat, turnId: number, itemId: string): ErrorCode | null {
    const err = this.guard(seat, turnId, ['choose']);
    if (err) return err;
    if (!this.options?.includes(itemId)) return 'INVALID_INPUT';
    const item = getItem(itemId);
    if (!item) return 'INVALID_INPUT';

    this.drawTimer.stop(); // 第一階段結束
    this.chosenItemId = itemId;
    this.phase = item.kind === 'throwable' ? 'aimAngle' : item.kind === 'defense' ? 'place' : 'target';
    const myTurn = this.turnId;
    this.useTimer.start(GAME_CONFIG.usePhaseMs, 'use', () => {
      if (this.turnId === myTurn) this.skip('useTimeout');
    });
    this.hooks.onEvent({ type: 'itemChosen', seat, itemId });
    this.hooks.onChange();
    return null;
  }

  confirmAngle(seat: Seat, turnId: number, angle: number): ErrorCode | null {
    const err = this.guard(seat, turnId, ['aimAngle']);
    if (err) return err;
    if (!Number.isFinite(angle) || angle < AIM_CONFIG.minAngle - 0.01 || angle > AIM_CONFIG.maxAngle + 0.01)
      return 'INVALID_INPUT';
    this.angle = Math.round(angle * 10) / 10;
    this.phase = 'aimPower';
    this.hooks.onChange();
    return null;
  }

  confirmPower(seat: Seat, turnId: number, power: number): ErrorCode | null {
    const err = this.guard(seat, turnId, ['aimPower']);
    if (err) return err;
    if (!Number.isFinite(power) || power < 0 || power > 1) return 'INVALID_INPUT';
    const item = getItem(this.chosenItemId ?? '');
    if (!item || item.kind !== 'throwable' || this.angle === null) return 'WRONG_PHASE';

    this.useTimer.stop(); // 發射後倒數停止
    this.phase = 'resolving';
    const ev = resolveThrow(this.state, seat, item, this.angle, power);
    this.hooks.onEvent(ev);
    this.hooks.onChange();
    this.later(throwDurationMs(ev) + GAME_CONFIG.impactSettleMs, () => this.endTurn());
    return null;
  }

  /** 拖曳瞄準＋按住蓄力的新操作：一次送出角度與力道 */
  throwAt(seat: Seat, turnId: number, angle: number, power: number): ErrorCode | null {
    const err = this.guard(seat, turnId, ['aimAngle', 'aimPower']);
    if (err) return err;
    if (!Number.isFinite(angle) || angle < AIM_CONFIG.minAngle - 0.01 || angle > AIM_CONFIG.maxAngle + 0.01) return 'INVALID_INPUT';
    this.angle = Math.round(angle * 10) / 10;
    this.phase = 'aimPower';
    return this.confirmPower(seat, turnId, power);
  }

  placeDefense(seat: Seat, turnId: number, x: number, y: number): ErrorCode | null {
    const err = this.guard(seat, turnId, ['place']);
    if (err) return err;
    const item = getItem(this.chosenItemId ?? '');
    if (!item || item.kind !== 'defense') return 'WRONG_PHASE';
    const posErr = validatePlacement(this.state, seat, item, x, y);
    if (posErr) return posErr;

    this.useTimer.stop();
    this.phase = 'resolving';
    const d = createDefense(this.state, seat, item, x, y);
    const spawn = this.state.defenseViews().find((v) => v.uid === d.uid)!;
    // 從放手位置掉下來，模擬到全部靜止
    const { frames, fell } = this.state.physics.settle();
    const fellUpdates = this.state.dropFallen(fell);
    this.state.syncPoses();
    this.hooks.onEvent({ type: 'defensePlaced', seat, defense: spawn, frames, fell: fellUpdates });
    this.hooks.onChange();
    this.later(frames.count * frames.sampleMs + GAME_CONFIG.effectSettleMs, () => this.endTurn());
    return null;
  }

  useFunctional(seat: Seat, turnId: number, targetUid?: string, targetSeat?: Seat): ErrorCode | null {
    const err = this.guard(seat, turnId, ['target']);
    if (err) return err;
    const item = getItem(this.chosenItemId ?? '');
    if (!item || item.kind !== 'functional') return 'WRONG_PHASE';
    const handler = getHandler(item.handler);
    if (!handler) return 'INVALID_INPUT';
    // 要對哪個敵人發動：2v2 兩個敵人都活著時由玩家指定
    const alive = this.state.aliveEnemiesOf(seat);
    const needsTarget = !!handler.targetsEnemy?.(item);
    let enemy: Seat = alive[0] ?? this.state.enemiesOf(seat)[0];
    if (needsTarget && alive.length > 1) {
      if (targetSeat === undefined || !alive.includes(targetSeat)) return 'INVALID_INPUT';
      enemy = targetSeat;
    } else if (targetSeat !== undefined && alive.includes(targetSeat)) enemy = targetSeat;
    const ctx = { state: this.state, seat, enemy, item, targetUid };
    const vErr = handler.validate?.(ctx) ?? null;
    if (vErr) return vErr;

    this.useTimer.stop();
    this.phase = 'resolving';
    const result = handler.execute(ctx);
    this.hooks.onEvent({
      type: 'functional',
      seat,
      itemId: item.id,
      handler: item.handler,
      targetUid,
      ...(needsTarget ? { targetSeat: enemy } : {}),
      damages: result.damages,
      heals: result.heals ?? [],
      defenseUpdates: result.defenseUpdates,
      statusApplied: result.statusApplied ?? [],
    });
    const settleMs = this.settleAndEmit();
    this.hooks.onChange();
    this.later(GAME_CONFIG.effectSettleMs + settleMs, () => this.endTurn());
    return null;
  }

  /** 瞄準過程即時預覽給對手看（不改變狀態） */
  canPreviewAim(seat: Seat, turnId: number): boolean {
    return this.guard(seat, turnId, ['aimAngle', 'aimPower']) === null;
  }

  // ------------------------------------------------------------ 內部流程

  private guard(seat: Seat, turnId: number, phases: TurnPhase[]): ErrorCode | null {
    if (this.finished) return 'WRONG_PHASE';
    if (seat !== this.activeSeat) return 'NOT_YOUR_TURN';
    if (turnId !== this.turnId) return 'STALE_TURN';
    if (!phases.includes(this.phase)) return 'WRONG_PHASE'; // 也擋掉重複提交
    return null;
  }

  private eligible(item: ItemDef): boolean {
    const seat = this.activeSeat;
    // 角色專屬卡牌
    if (item.exclusiveTo && !item.exclusiveTo.includes(this.state.characterIds[seat] ?? '')) return false;
    // 對上某些角色時抽不到（鄭霖澤的「連恩」遇到連恩本人）
    if (this.state.enemiesOf(seat).some((e) => item.notVs?.includes(this.state.characterIds[e] ?? ''))) return false;
    // 2v2 羈絆（鄭霖澤＋連恩同隊）：羈絆卡只有這時候抽得到；被取代的專屬卡抽不到
    if (item.bondOnly && !this.state.inBond(item.bondOnly, seat)) return false;
    if (item.notInBond && this.state.inBond(item.notInBond, seat)) return false;
    if (item.kind === 'defense') return canPlaceMore(this.state, seat, item);
    if (item.kind === 'functional') {
      const h = getHandler(item.handler);
      if (!h) return false;
      return h.canDraw ? h.canDraw(this.state, seat, item) : true;
    }
    return true;
  }

  private startTurn(seat: Seat): void {
    if (this.finished) return;
    this.turnId += 1;
    this.activeSeat = seat;
    this.phase = 'turnStart';
    this.options = null;
    this.hiddenSlots = 0;
    this.chosenItemId = null;
    this.angle = null;

    const { damage: statusDamage, skip: stunned, heals } = this.state.tickStatusesStart(seat);
    const expiredDefenses = this.state.tickDefenses(seat);
    this.hooks.onEvent({ type: 'turnStart', seat, turnId: this.turnId, statusDamage, expiredDefenses, ...(heals.length ? { heals } : {}) });
    // 有道具消失時，上面疊的東西會掉下來
    const settleMs = expiredDefenses.length ? this.settleAndEmit() : 0;
    this.hooks.onChange();

    if (this.state.fighters[seat].hp <= 0) {
      // 被持續傷害打死：結算（1v1 直接結束；2v2 換下一個人）
      this.phase = 'resolving';
      this.later(GAME_CONFIG.turnStartEffectMs, () => this.endTurn());
      return;
    }
    if (stunned) {
      // 被機車鎖鎖住：這回合直接跳過
      this.phase = 'resolving';
      this.later(GAME_CONFIG.turnStartEffectMs, () => this.skip('stunned'));
      return;
    }
    const delay = (statusDamage.length || expiredDefenses.length || heals.length ? GAME_CONFIG.turnStartEffectMs : 600) + settleMs;
    const myTurn = this.turnId;
    this.later(delay, () => {
      if (this.turnId !== myTurn) return;
      this.phase = 'draw';
      this.drawTimer.start(GAME_CONFIG.drawPhaseMs, 'draw', () => {
        if (this.turnId === myTurn) this.skip('drawTimeout');
      });
      this.hooks.onChange();
    });
  }

  private skip(reason: 'drawTimeout' | 'useTimeout' | 'stunned'): void {
    if (this.finished) return;
    this.drawTimer.stop();
    this.useTimer.stop();
    this.phase = 'resolving';
    this.hooks.onEvent({ type: 'skip', seat: this.activeSeat, reason });
    this.hooks.onChange();
    this.later(GAME_CONFIG.skipTurnDelayMs, () => this.endTurn());
  }

  private endTurn(): void {
    if (this.finished) return;
    this.state.tickStatusesEnd(this.activeSeat);
    this.markDead();
    const d0 = this.state.teamDead(0),
      d1 = this.state.teamDead(1);
    if (d0 || d1) {
      // 雙方同時全滅（例如自己的炸彈波及自己）時，判出手方獲勝
      const winner: Team = d0 && d1 ? teamOf(this.activeSeat) : d0 ? 1 : 0;
      this.endGame(winner, 'hp');
      return;
    }
    // 下一個還活著的人（順序 0 → 1 → 2 → 3）
    const seats = this.state.seats;
    let next = this.activeSeat;
    for (let i = 1; i <= seats.length; i++) {
      const s = seats[(seats.indexOf(this.activeSeat) + i) % seats.length];
      if (this.state.fighters[s].hp > 0) {
        next = s;
        break;
      }
    }
    this.startTurn(next);
  }

  /** 新陣亡的人：從物理世界移除（東西不會再撞到他），2v2 通知大家 */
  private markDead(): void {
    for (const f of this.state.fighters) {
      if (f.hp > 0 || this.eliminated.has(f.seat)) continue;
      this.eliminated.add(f.seat);
      if (this.mode === 'team') {
        this.state.physics.removeChar(f.seat);
        this.hooks.onEvent({ type: 'eliminated', seat: f.seat });
      }
    }
  }

  private endGame(winner: Team, reason: 'hp' | 'forfeit'): void {
    if (this.finished) return;
    this.dispose();
    this.phase = 'resolving';
    this.hooks.onEvent({ type: 'gameOver', winnerSeat: winner as Seat, winnerTeam: winner, reason });
    this.hooks.onGameOver(winner, reason);
  }

  /** 讓物理世界落定；有東西在動才送出動畫事件。回傳動畫長度（毫秒） */
  private settleAndEmit(): number {
    const { frames, fell } = this.state.physics.settle();
    const fellUpdates = this.state.dropFallen(fell);
    this.state.syncPoses();
    if (Object.keys(frames.d).length === 0 && fellUpdates.length === 0) return 0;
    this.hooks.onEvent({ type: 'settle', frames, fell: fellUpdates });
    return frames.count * frames.sampleMs;
  }

  private later(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.pending.delete(t);
      if (!this.finished) fn();
    }, ms);
    this.pending.add(t);
  }
}
