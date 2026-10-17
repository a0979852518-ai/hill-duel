// 背景音樂：程式即時合成的 8-bit 小曲（不需要音檔），一直循環。
// 音量由設定面板的「音樂」控制（sfx.musicBus）。

import { sfx } from './sfx.js';

const BPM = 118;
const STEP = 60 / BPM / 2; // 八分音符

// 音名 → 頻率（A4 = 440）
const N = (n: string): number => {
  const m = /^([A-G])(#?)(\d)$/.exec(n);
  if (!m) return 0;
  const base: Record<string, number> = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
  const idx = base[m[1]] + (m[2] ? 1 : 0) + (Number(m[3]) - 4) * 12;
  return 440 * Math.pow(2, idx / 12);
};

// 主旋律（每格一個八分音符，'-' = 延長，'.' = 休止），輕快的鄉間小調
const LEAD = (
  'E5 - G5 E5 D5 - C5 . | D5 E5 - C5 A4 - . . | C5 - E5 C5 G4 - A4 . | B4 C5 D5 - G4 - . . |' +
  'E5 - G5 E5 D5 - C5 . | D5 E5 - G5 A5 - G5 . | E5 D5 C5 - A4 C5 D5 E5 | C5 - - - . . . . |'
)
  .replace(/\|/g, '')
  .trim()
  .split(/\s+/);
// 低音（每格一個八分音符）
const BASS = (
  'C3 . G2 . C3 . G2 . | F2 . C3 . F2 . C3 . | A2 . E3 . A2 . E3 . | G2 . D3 . G2 . B2 . |' +
  'C3 . G2 . C3 . G2 . | F2 . C3 . F2 . A2 . | F2 . C3 . G2 . D3 . | C3 . G2 . C3 . . . |'
)
  .replace(/\|/g, '')
  .trim()
  .split(/\s+/);

class Music {
  private step = 0;
  private nextTime = 0;
  private timer: number | null = null;

  start(): void {
    if (this.timer !== null) return;
    const tick = () => {
      const ctx = sfx.context;
      const bus = sfx.musicBus;
      if (!ctx || !bus || ctx.state !== 'running' || sfx.settings.music <= 0 || sfx.settings.master <= 0) {
        this.nextTime = 0;
        return;
      }
      if (this.nextTime < ctx.currentTime) this.nextTime = ctx.currentTime + 0.05;
      // 往前排 0.3 秒的音符
      while (this.nextTime < ctx.currentTime + 0.3) {
        this.schedule(ctx, bus, this.step, this.nextTime);
        this.nextTime += STEP;
        this.step = (this.step + 1) % LEAD.length;
      }
    };
    this.timer = window.setInterval(tick, 100);
  }

  private schedule(ctx: AudioContext, bus: GainNode, i: number, t: number): void {
    const note = (name: string, arr: string[], type: OscillatorType, vol: number) => {
      if (name === '-' || name === '.' || !name) return;
      // 往後數有幾格延長
      let len = 1;
      while (arr[(i + len) % arr.length] === '-' && len < 8) len++;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = N(name);
      const dur = len * STEP * 0.92;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.01);
      g.gain.setTargetAtTime(vol * 0.6, t + 0.05, 0.08);
      g.gain.setTargetAtTime(0, t + dur - 0.03, 0.02);
      osc.connect(g).connect(bus);
      osc.start(t);
      osc.stop(t + dur + 0.1);
    };
    note(LEAD[i], LEAD, 'square', 0.09);
    note(BASS[i % BASS.length], BASS, 'triangle', 0.22);
    // 每拍一下輕輕的鼓（短促的高頻方波當 hi-hat）
    if (i % 2 === 0) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = i % 8 === 0 ? 90 : 3200;
      g.gain.setValueAtTime(i % 8 === 0 ? 0.18 : 0.025, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (i % 8 === 0 ? 0.12 : 0.03));
      osc.connect(g).connect(bus);
      osc.start(t);
      osc.stop(t + 0.15);
    }
  }
}

export const music = new Music();
