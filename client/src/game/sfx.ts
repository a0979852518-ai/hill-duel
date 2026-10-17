// 遊戲音效：全部用 ZzFX 即時合成（不需要音檔、不用下載）。
// 每個音效可以由好幾層聲音組成（例如「拍照喀嚓＋爆炸」），at = 延遲幾秒播放。
// 想改聲音：調 SOUNDS 裡的參數陣列（格式見 zzfx.ts），可以到 https://killedbyapixel.github.io/ZzFX/ 試聽調整再貼回來。

import { SAMPLE_RATE, zzfxSamples, type ZzfxParams } from './zzfx.js';

interface Layer {
  p: ZzfxParams;
  at?: number;
}

const L = (p: ZzfxParams, at = 0): Layer => ({ p, at });

// ------------------------------------------------------------ 音效表

export const SOUNDS: Record<string, Layer[]> = {
  // ---------- 介面 ----------
  click: [L([0.5, 0, 900, 0, 0.005, 0.03, 1, 2])],
  slotTick: [L([0.25, 0.1, 1400, 0, 0.004, 0.02, 0])],
  slotStop: [L([0.9, 0, 160, 0, 0.02, 0.14, 1, 1, -3, 0, 0, 0, 0, 0.2]), L([0.5, 0, 1200, 0, 0.01, 0.06, 0], 0.01)],
  slotWin: [L([0.6, 0, 660, 0, 0.04, 0.18, 0, 1, 0, 0, 220, 0.05]), L([0.5, 0, 990, 0, 0.05, 0.25, 0], 0.12)],
  cardAppear: [L([0.45, 0.05, 420, 0, 0.02, 0.1, 0, 1, 14])],
  cardSpin: [L([0.45, 0, 220, 0.08, 0.25, 0.25, 4, 1, 6, 0, 0, 0, 0, 0.6, 0, 0, 0, 1, 0, 0, 2200])],
  cardBurst: [
    L([0.8, 0, 1600, 0, 0.04, 0.35, 0, 1, 0, 0, 500, 0.03, 0.06]),
    L([0.6, 0, 3000, 0, 0.05, 0.3, 4, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 3500], 0.02),
    L([0.4, 0, 2400, 0, 0.02, 0.4, 0, 1, 0, 0, 0, 0, 0.08, 0, 0, 0, 0.12], 0.08),
  ],
  turnStart: [L([0.6, 0, 523, 0, 0.06, 0.14, 1]), L([0.6, 0, 784, 0, 0.08, 0.25, 1], 0.12)],
  timerTick: [L([0.35, 0, 1100, 0, 0.01, 0.04, 0])],
  skip: [L([0.4, 0, 110, 0, 0.25, 0.1, 5, 0.5, 0, 0, 0, 0, 0.08])],
  win: [
    L([0.6, 0, 523, 0, 0.08, 0.12, 1]),
    L([0.6, 0, 659, 0, 0.08, 0.12, 1], 0.14),
    L([0.6, 0, 784, 0, 0.08, 0.12, 1], 0.28),
    L([0.7, 0, 1046, 0, 0.25, 0.4, 1], 0.42),
  ],
  lose: [L([0.6, 0, 392, 0, 0.12, 0.15, 1]), L([0.6, 0, 330, 0, 0.12, 0.15, 1], 0.2), L([0.7, 0, 262, 0, 0.3, 0.4, 1, 1, -2], 0.4)],

  // ---------- 投擲 ----------
  throwLight: [L([0.5, 0.1, 900, 0.02, 0.06, 0.12, 4, 1, 20, 0, 0, 0, 0, 0.6, 0, 0, 0, 1, 0, 0, 2500])],
  throwHeavy: [L([0.55, 0.1, 300, 0.04, 0.12, 0.2, 4, 1, 8, 0, 0, 0, 0, 0.7, 0, 0, 0, 1, 0, 0, 900])],
  groundBounce: [L([0.6, 0.1, 90, 0, 0.02, 0.12, 4, 1, -2, 0, 0, 0, 0, 0.5, 0, 0, 0, 1, 0, 0, -700])],
  miss: [L([0.4, 0.1, 140, 0, 0.03, 0.15, 4, 1, -2, 0, 0, 0, 0, 0.6, 0, 0, 0, 1, 0, 0, -900])],

  // 每個投擲物命中時的聲音
  hit_cigarette: [
    L([0.4, 0.05, 2200, 0, 0.01, 0.05, 2, 1, -40]),
    L([0.6, 0.05, 5000, 0.02, 0.25, 0.4, 4, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0.6, 0, 0.3, 3000], 0.03),
  ],
  hit_ulock: [
    L([1, 0.05, 520, 0, 0.02, 0.3, 1, 2, 0, 0, 0, 0, 0, 0, 37]),
    L([0.6, 0.05, 1300, 0, 0.04, 0.5, 0, 1, 0, 0, 0, 0, 0, 0, 9], 0.02),
    L([0.5, 0.05, 1720, 0, 0.02, 0.3, 0, 1, 0, 0, 0, 0, 0.07], 0.1),
  ],
  hit_maya2026: [
    L([1, 0.05, 160, 0, 0.03, 0.18, 4, 1, -2, 0, 0, 0, 0, 0.5, 0, 0, 0, 1, 0, 0, -900]),
    L([0.5, 0.05, 700, 0, 0.02, 0.08, 4, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -2500], 0.01),
  ],
  hit_acCard: [L([0.7, 0.05, 2600, 0, 0.005, 0.05, 2, 1, -60]), L([0.5, 0.05, 4000, 0, 0.01, 0.08, 4, 1, 0, 0, 0, 0, 0, 1], 0.02)],
  hit_expiredJuice: [
    L([0.9, 0.05, 260, 0, 0.06, 0.3, 4, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1600]),
    L([0.35, 0.1, 500, 0, 0.02, 0.05, 0, 1, 40, 0, 0, 0, 0.06], 0.08),
    L([0.3, 0.1, 700, 0, 0.02, 0.05, 0, 1, 40, 0, 0, 0, 0.05], 0.2),
  ],
  // 噗啾：低沉的濕黏聲＋一點水聲
  hit_poopoo: [
    L([1, 0.1, 120, 0, 0.04, 0.22, 0, 1, -6, 0, 0, 0, 0, 0.4, 8, 0, 0, 1, 0, 0, -900]),
    L([0.5, 0.1, 300, 0, 0.03, 0.12, 4, 1, -20, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1500], 0.03),
    L([0.35, 0.05, 900, 0, 0.01, 0.06, 0, 1, -80], 0.12),
  ],
  // 排球：啪！（皮面拍擊）
  hit_volleyball: [L([1, 0.05, 520, 0, 0.01, 0.12, 4, 1, -8, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1200]), L([0.6, 0.05, 180, 0, 0.03, 0.2, 0, 1, -4], 0.01)],
  hit_ricecooker: [
    L([1, 0.03, 110, 0, 0.12, 0.9, 0, 1, 0, 0, 0, 0, 0, 0, 23]),
    L([0.8, 0.03, 380, 0, 0.03, 0.6, 1, 2, 0, 0, 0, 0, 0, 0, 13], 0.01),
    L([0.6, 0.05, 60, 0, 0.05, 0.3, 4, 1, -1, 0, 0, 0, 0, 0.8, 0, 0, 0, 1, 0, 0, -500]),
  ],

  // ---------- 命中角色 ----------
  punch: [L([1, 0.1, 90, 0, 0.02, 0.2, 4, 1, -3, 0, 0, 0, 0, 0.6, 0, 0, 0, 1, 0, 0, -600])],
  headshot: [L([0.8, 0, 700, 0, 0.01, 0.15, 1, 1, -40]), L([0.6, 0, 1800, 0, 0.02, 0.35, 0, 1, 0, 0, 0, 0, 0.06], 0.05)],
  oof: [L([0.6, 0.1, 220, 0.01, 0.06, 0.12, 2, 1, -12, 0, 0, 0, 0, 0, 3, 0, 0, 1, 0, 0, -1200])],
  crush: [
    L([1, 0.05, 55, 0, 0.1, 0.6, 4, 1, -1, 0, 0, 0, 0, 0.9, 0, 0.3, 0, 1, 0, 0, -500]),
    L([0.6, 0.05, 300, 0, 0.04, 0.3, 4, 1, 0, 0, 0, 0, 0, 1, 0, 0.2], 0.03),
  ],

  // ---------- 被打飛 ----------
  knockWhoosh: [L([0.5, 0.1, 180, 0.05, 0.25, 0.3, 4, 1, 4, 0, 0, 0, 0, 0.8, 0, 0, 0, 1, 0, 0, 1200])],
  bodyThud: [L([0.9, 0.1, 70, 0, 0.03, 0.2, 4, 1, -2, 0, 0, 0, 0, 0.5, 0, 0, 0, 1, 0, 0, -400])],
  roll: [L([0.45, 0.2, 400, 0.02, 0.06, 0.1, 4, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1800])],
  getUp: [L([0.35, 0.05, 300, 0.02, 0.05, 0.08, 1, 1, 18])],

  // ---------- 防禦道具 ----------
  place_helmet: [L([0.8, 0.05, 950, 0, 0.01, 0.35, 0, 1, 0, 0, 0, 0, 0, 0, 31]), L([0.4, 0.05, 2100, 0, 0.01, 0.2, 0], 0.01)],
  place_penguinFridge: [L([1, 0.05, 55, 0, 0.06, 0.35, 4, 1, -1, 0, 0, 0, 0, 0.7, 0, 0, 0, 1, 0, 0, -350]), L([0.4, 0.05, 900, 0, 0.02, 0.1, 1, 1, 0, 0, 0, 0, 0, 0, 20], 0.02)],
  place_recyclePile: [L([0.7, 0.2, 900, 0.01, 0.12, 0.2, 4, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0.7, 0, 0.4, -3500])],
  block: [L([0.9, 0.05, 240, 0, 0.02, 0.15, 1, 1.5, -4, 0, 0, 0, 0, 0.2, 18])],
  breakDef: [L([1, 0.05, 400, 0, 0.05, 0.35, 4, 1, -3, 0, 0, 0, 0, 1, 0, 0.4]), L([0.5, 0.1, 1800, 0, 0.02, 0.3, 4, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0.05], 0.05)],
  defFall: [L([0.7, 0.1, 80, 0, 0.03, 0.2, 4, 1, -2, 0, 0, 0, 0, 0.6, 0, 0, 0, 1, 0, 0, -500])],

  // ---------- 功能道具 ----------
  // 住院：心電圖「嗶—嗶—」
  use_hospital: [L([0.5, 0, 1000, 0, 0.08, 0.05, 0]), L([0.5, 0, 1000, 0, 0.08, 0.05, 0], 0.5), L([0.4, 0, 1320, 0.05, 0.3, 0.4, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0.2], 0.9)],
  // 獸控：低吼＋上揚
  place_beastFan: [L([0.9, 0.1, 90, 0.05, 0.25, 0.3, 2, 1, 3, 0, 0, 0, 0, 0.3, 12, 0, 0, 1, 0, 0.3]), L([0.5, 0, 400, 0, 0.1, 0.3, 1, 1, 30, 0, 200, 0.08], 0.3)],
  use_mutualBomb: [
    L([0.8, 0, 3000, 0, 0.005, 0.03, 4, 1, 0, 0, 0, 0, 0, 1]),
    L([0.6, 0, 1500, 0, 0.01, 0.05, 4, 1, 0, 0, 0, 0, 0, 1], 0.07),
    L([1, 0.05, 50, 0, 0.15, 0.9, 4, 1, -1, 0, 0, 0, 0, 1, 0, 0.3, 0, 1, 0, 0, -400], 0.35),
  ],
  use_stockings: [L([0.8, 0.05, 180, 0.02, 0.2, 0.25, 1, 1, 9, -1.5, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0.5]), L([0.4, 0.05, 330, 0, 0.1, 0.3, 0, 1, 0, 0, 0, 0, 0.1, 0, 6], 0.3)],
  use_whey: [L([0.7, 0, 260, 0, 0.35, 0.15, 1, 1, 6, 0, 260, 0.07, 0.08]), L([0.5, 0, 1040, 0, 0.1, 0.3, 0], 0.45)],
  use_porkChop: [
    L([0.7, 0.1, 140, 0, 0.02, 0.06, 4, 1, 0, 0, 0, 0, 0, 0.8, 0, 0, 0, 1, 0, 0, -1500]),
    L([0.7, 0.1, 140, 0, 0.02, 0.06, 4, 1, 0, 0, 0, 0, 0, 0.8, 0, 0, 0, 1, 0, 0, -1500], 0.16),
    L([0.7, 0.1, 140, 0, 0.02, 0.06, 4, 1, 0, 0, 0, 0, 0, 0.8, 0, 0, 0, 1, 0, 0, -1500], 0.32),
    L([0.6, 0, 880, 0, 0.1, 0.4, 0, 1, 0, 0, 440, 0.08], 0.5),
  ],
  status: [L([0.5, 0.05, 400, 0, 0.15, 0.2, 2, 1, -6, 0, 0, 0, 0, 0, 4])],
};

/** 每個投擲物命中時用哪個聲音（沒有就用通用打擊聲） */
export const itemHitSound = (itemId: string) => (SOUNDS[`hit_${itemId}`] ? `hit_${itemId}` : 'punch');

// ------------------------------------------------------------ 播放器

/** 玩家設定（記在這台裝置）：音量 0~1、怪誕 bug 開關 */
export interface Settings {
  master: number;
  sfx: number;
  music: number;
  glitches: boolean;
}
const SETTINGS_KEY = 'hillduel:settings';
const DEFAULT_SETTINGS: Settings = { master: 0.8, sfx: 0.8, music: 0.5, glitches: true };

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    // 舊版的「靜音」設定
    if (localStorage.getItem('hillduel:muted') === '1') return { ...DEFAULT_SETTINGS, master: 0 };
  } catch {
    /* 沒有 localStorage 就用預設 */
  }
  return { ...DEFAULT_SETTINGS };
}

class Sfx {
  private ctx: AudioContext | null = null;
  /** 總音量 → 音效 / 音樂兩條線 */
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  musicBus: GainNode | null = null;
  settings: Settings = loadSettings();
  private cache = new Map<string, AudioBuffer[]>();
  private chargeOsc: OscillatorNode | null = null;
  private chargeGain: GainNode | null = null;
  get muted(): boolean {
    return this.settings.master <= 0 || this.settings.sfx <= 0;
  }
  private last = new Map<string, number>();
  /** 每個音效播放了幾次（除錯/測試用） */
  readonly played: Record<string, number> = {};

  constructor() {
    // 瀏覽器規定要使用者先互動才能出聲：第一次點擊/按鍵時啟動
    const unlock = () => {
      this.ensure();
      void this.ctx?.resume();
    };
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.sfxBus = this.ctx.createGain();
      this.musicBus = this.ctx.createGain();
      this.sfxBus.connect(this.master);
      this.musicBus.connect(this.master);
      this.applyVolumes();
      // 壓縮器：很多聲音同時響（打中＋爆頭＋滾地）時不會爆音
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      this.master.connect(comp).connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  /** 改設定（設定面板呼叫）：立刻套用並存起來 */
  setSettings(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      /* ignore */
    }
    this.applyVolumes();
    if (this.muted) this.stopCharge();
  }

  private applyVolumes(): void {
    if (!this.master || !this.sfxBus || !this.musicBus) return;
    // 音量用平方曲線，拉桿中段聽起來比較線性
    const v = (x: number) => Math.max(0, Math.min(1, x)) ** 2;
    this.master.gain.value = v(this.settings.master) * 0.7;
    this.sfxBus.gain.value = v(this.settings.sfx);
    this.musicBus.gain.value = v(this.settings.music) * 0.35;
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  /** 每個聲音先產生 3 個略有差異的版本，播放時隨機挑一個，聽起來比較自然 */
  private buffers(name: string, layer: number, p: ZzfxParams): AudioBuffer[] {
    const key = `${name}#${layer}`;
    let arr = this.cache.get(key);
    if (!arr && this.ctx) {
      arr = [];
      for (let v = 0; v < 3; v++) {
        const data = zzfxSamples(p);
        const buf = this.ctx.createBuffer(1, Math.max(1, data.length), SAMPLE_RATE);
        buf.getChannelData(0).set(data);
        arr.push(buf);
      }
      this.cache.set(key, arr);
    }
    return arr ?? [];
  }

  /**
   * 播放音效
   * @param vol  音量倍率
   * @param rate 播放速度（>1 比較高、比較短）
   * @param gapMs 同一個音效最短間隔（避免一幀內疊太多次變爆音）
   */
  play(name: string, opts: { vol?: number; rate?: number; gapMs?: number } = {}): void {
    if (this.muted) return;
    const ctx = this.ensure();
    const layers = SOUNDS[name];
    if (!ctx || !layers || !this.master || ctx.state !== 'running') return;
    const now = performance.now();
    if (now - (this.last.get(name) ?? -1e9) < (opts.gapMs ?? 30)) return;
    this.last.set(name, now);
    this.played[name] = (this.played[name] ?? 0) + 1;
    layers.forEach((layer, i) => {
      const arr = this.buffers(name, i, layer.p);
      if (!arr.length) return;
      const src = ctx.createBufferSource();
      src.buffer = arr[(Math.random() * arr.length) | 0];
      src.playbackRate.value = (opts.rate ?? 1) * (0.97 + Math.random() * 0.06);
      const g = ctx.createGain();
      g.gain.value = Math.min(2, opts.vol ?? 1);
      src.connect(g).connect(this.sfxBus!);
      src.start(ctx.currentTime + (layer.at ?? 0));
    });
  }

  /** 蓄力音：按住時持續發出、音高跟著力道上升 */
  charge(power: number): void {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx || !this.master || ctx.state !== 'running') return;
    if (!this.chargeOsc) {
      this.chargeOsc = ctx.createOscillator();
      this.chargeOsc.type = 'triangle';
      this.chargeGain = ctx.createGain();
      this.chargeGain.gain.value = 0;
      this.chargeOsc.connect(this.chargeGain).connect(this.sfxBus!);
      this.chargeOsc.start();
      this.chargeGain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.05);
    }
    this.chargeOsc.frequency.setTargetAtTime(180 + power * 620, ctx.currentTime, 0.03);
  }

  stopCharge(): void {
    if (!this.chargeOsc || !this.ctx || !this.chargeGain) return;
    const osc = this.chargeOsc;
    this.chargeGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
    osc.stop(this.ctx.currentTime + 0.1);
    this.chargeOsc = null;
    this.chargeGain = null;
  }
}

export const sfx = new Sfx();
