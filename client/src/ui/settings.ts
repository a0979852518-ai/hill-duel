// 設定（齒輪按鈕）：總音量、音效、音樂、怪誕 bug 開關。存在這台裝置上。

import { sfx } from '../game/sfx.js';

export function setupSettings(): void {
  const app = document.getElementById('app')!;
  const gear = document.createElement('button');
  gear.className = 'gear-btn';
  gear.textContent = '⚙';
  gear.title = '設定';
  gear.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle();
  });
  app.appendChild(gear);

  let panel: HTMLElement | null = null;
  const toggle = () => {
    if (panel) {
      panel.remove();
      panel = null;
      return;
    }
    const s = sfx.settings;
    const row = (key: 'master' | 'sfx' | 'music', label: string) => `
      <label class="set-row"><span>${label}</span>
        <input type="range" min="0" max="100" step="1" value="${Math.round(s[key] * 100)}" data-k="${key}" />
        <b data-v="${key}">${Math.round(s[key] * 100)}</b></label>`;
    panel = document.createElement('div');
    panel.className = 'settings-wrap';
    panel.innerHTML = `
      <div class="panel settings" role="dialog" aria-label="設定">
        <h2>設定</h2>
        ${row('master', '總音量')}
        ${row('sfx', '音效')}
        ${row('music', '音樂')}
        <label class="set-check"><input type="checkbox" data-g ${s.glitches ? 'checked' : ''} /> 怪誕 bug（偶爾出現的搞笑畫面錯亂，不影響勝負）</label>
        <button class="btn block" data-close>完成</button>
      </div>`;
    panel.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((inp) =>
      inp.addEventListener('input', () => {
        const k = inp.dataset.k as 'master' | 'sfx' | 'music';
        sfx.setSettings({ [k]: Number(inp.value) / 100 });
        panel!.querySelector(`[data-v=${k}]`)!.textContent = inp.value;
      }),
    );
    // 放開拉桿時試聽一下
    panel.querySelectorAll<HTMLInputElement>('input[data-k=master], input[data-k=sfx]').forEach((inp) => inp.addEventListener('change', () => sfx.play('click')));
    panel.querySelector<HTMLInputElement>('[data-g]')!.addEventListener('change', (e) => sfx.setSettings({ glitches: (e.target as HTMLInputElement).checked }));
    panel.querySelector('[data-close]')!.addEventListener('click', toggle);
    // 點旁邊空白處也關閉
    panel.addEventListener('pointerdown', (e) => {
      if (e.target === panel) toggle();
    });
    app.appendChild(panel);
  };
}
