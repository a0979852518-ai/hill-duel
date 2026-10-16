// DOM 介面：主選單、等待房間、角色選擇、遊戲結束。
// 用 HTML 做選單比較好打字、複製房號，也比較適合手機。

import { PLAYABLE_CHARACTERS } from '../../../shared/config/characters.js';
import { getItem } from '../../../shared/config/items.js';
import { ERROR_TEXT, type AiDifficulty, type ErrorCode, type RoomSnapshot, type Seat } from '../../../shared/types.js';
import { loadName } from '../net/Network.js';
import { store } from '../state/store.js';
import { toast } from './toast.js';

const ui = () => document.getElementById('ui')!;

function h(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function errText(e: string): string {
  if (e === 'TIMEOUT' || e === 'OFFLINE') return '連不上伺服器，請確認網路後再試。';
  return ERROR_TEXT[e as ErrorCode] ?? '發生錯誤';
}

export function clearUi(): void {
  ui().innerHTML = '';
}

// ------------------------------------------------------------ 主選單

export function showMenu(message?: string): void {
  const el = h(`
    <div class="panel" data-screen="menu">
      <h1 class="title">山丘投擲對決</h1>
      <p class="subtitle">雙人線上・回合制砲擊對戰（也能單挑電腦）</p>
      <div class="field">
        <label for="name">你的名字</label>
        <input id="name" maxlength="12" placeholder="輸入暱稱" value="${esc(loadName())}" />
      </div>
      <button class="btn block" data-act="match">隨機匹配對手</button>
      <div class="divider">或跟朋友玩</div>
      <button class="btn secondary block" data-act="create">創建房間</button>
      <div class="divider">或</div>
      <div class="field">
        <label for="code">輸入朋友給你的房號</label>
        <input id="code" class="code" maxlength="6" placeholder="ABC123" autocomplete="off" />
      </div>
      <button class="btn secondary block" data-act="join">加入房間</button>
      <div class="divider">單人對戰電腦</div>
      <div class="ai-row">
        <button class="btn ai-btn d-easy" data-ai="easy">弱</button>
        <button class="btn ai-btn d-normal" data-ai="normal">中</button>
        <button class="btn ai-btn d-hard" data-ai="hard">強</button>
        <button class="btn ai-btn d-nightmare" data-ai="nightmare">夢魘</button>
      </div>
      <div class="error" data-err>${message ? esc(message) : ''}</div>
    </div>`);
  const name = el.querySelector<HTMLInputElement>('#name')!;
  const code = el.querySelector<HTMLInputElement>('#code')!;
  const err = el.querySelector<HTMLElement>('[data-err]')!;
  const buttons = el.querySelectorAll<HTMLButtonElement>('button');
  const lock = (b: boolean) => buttons.forEach((x) => (x.disabled = b));

  el.querySelector('[data-act=create]')!.addEventListener('click', async () => {
    lock(true);
    err.textContent = '';
    const res = await store.net.createRoom(name.value.trim());
    lock(false);
    if (!res.ok) err.textContent = errText(res.error);
    else window.dispatchEvent(new CustomEvent('hillduel:route'));
  });
  el.querySelector('[data-act=match]')!.addEventListener('click', async () => {
    lock(true);
    err.textContent = '';
    const res = await store.net.joinMatch(name.value.trim());
    lock(false);
    if (!res.ok) err.textContent = errText(res.error);
    else showMatching(name.value.trim());
  });
  el.querySelectorAll<HTMLButtonElement>('[data-ai]').forEach((b) =>
    b.addEventListener('click', async () => {
      lock(true);
      err.textContent = '';
      const res = await store.net.createAiRoom(name.value.trim(), b.dataset.ai as AiDifficulty);
      lock(false);
      if (!res.ok) err.textContent = errText(res.error);
      else window.dispatchEvent(new CustomEvent('hillduel:route'));
    }),
  );
  const join = async () => {
    const c = code.value.trim().toUpperCase();
    if (c.length < 4) {
      err.textContent = '請輸入房號';
      return;
    }
    lock(true);
    err.textContent = '';
    const res = await store.net.joinRoom(c, name.value.trim());
    lock(false);
    if (!res.ok) err.textContent = errText(res.error);
    else window.dispatchEvent(new CustomEvent('hillduel:route'));
  };
  el.querySelector('[data-act=join]')!.addEventListener('click', join);
  code.addEventListener('keydown', (e) => e.key === 'Enter' && join());
  code.addEventListener('input', () => (code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '')));
  ui().replaceChildren(el);
}

// ------------------------------------------------------------ 隨機匹配中

export function showMatching(name: string): void {
  const el = h(`
    <div class="panel" data-screen="matching">
      <h2>尋找對手中<span class="waiting-dots"></span></h2>
      <p class="subtitle">已經等了 <b data-sec>0</b> 秒</p>
      <p class="subtitle" data-hint></p>
      <div class="ai-row" data-ai-row style="display:none">
        <button class="btn ai-btn d-easy" data-ai="easy">弱</button>
        <button class="btn ai-btn d-normal" data-ai="normal">中</button>
        <button class="btn ai-btn d-hard" data-ai="hard">強</button>
        <button class="btn ai-btn d-nightmare" data-ai="nightmare">夢魘</button>
      </div>
      <button class="btn secondary block" data-act="cancel" style="margin-top:14px">取消</button>
      <div class="error" data-err></div>
    </div>`);
  const t0 = Date.now();
  const sec = el.querySelector<HTMLElement>('[data-sec]')!;
  const timer = setInterval(() => {
    if (!el.isConnected) return clearInterval(timer);
    const s = Math.floor((Date.now() - t0) / 1000);
    sec.textContent = String(s);
    // 等太久：提供改打電腦（不會自動取消排隊，還是可能配到人）
    if (s >= 30) {
      el.querySelector<HTMLElement>('[data-hint]')!.textContent = '目前線上的人比較少，要不要先跟電腦打？';
      el.querySelector<HTMLElement>('[data-ai-row]')!.style.display = '';
    }
  }, 500);
  // 斷線重連後伺服器已經把我們移出隊伍：重新排
  const offStatus = store.net.onStatus(({ connected }) => {
    if (connected && el.isConnected) void store.net.joinMatch(name);
  });
  const stop = () => {
    clearInterval(timer);
    off();
    offStatus();
  };
  // 配到了：伺服器已經把我們放進房間，切到角色選擇
  const off = store.net.onMatchFound(() => {
    stop();
    toast('找到對手了！');
    window.dispatchEvent(new CustomEvent('hillduel:route'));
  });
  el.querySelector('[data-act=cancel]')!.addEventListener('click', () => {
    stop();
    store.net.cancelMatch();
    showMenu();
  });
  el.querySelectorAll<HTMLButtonElement>('[data-ai]').forEach((b) =>
    b.addEventListener('click', async () => {
      stop();
      store.net.cancelMatch();
      const res = await store.net.createAiRoom(name, b.dataset.ai as AiDifficulty);
      if (!res.ok) el.querySelector('[data-err]')!.textContent = errText(res.error);
      else window.dispatchEvent(new CustomEvent('hillduel:route'));
    }),
  );
  ui().replaceChildren(el);
}

// ------------------------------------------------------------ 等待第二位玩家

export function showWaiting(snap: RoomSnapshot): void {
  const existing = ui().querySelector('[data-screen=waiting]');
  const slots = snap.players
    .map(
      (p, i) =>
        `<div class="player-slot ${p ? '' : 'empty'}"><div class="seat">玩家 ${i + 1}${i === 0 ? '（左）' : '（右）'}</div>
         <div class="name">${p ? esc(p.name) : '等待中'}</div>${p && !p.connected ? '<div class="offline">斷線中</div>' : ''}</div>`,
    )
    .join('');
  if (existing) {
    existing.querySelector('.player-slots')!.innerHTML = slots;
    return;
  }
  const el = h(`
    <div class="panel" data-screen="waiting">
      <h2>房間已建立</h2>
      <p class="subtitle">把房號傳給朋友，對方在主選單輸入即可加入</p>
      <div class="room-code"><span data-code>${snap.code}</span><button class="btn secondary" data-act="copy">複製</button></div>
      <div class="player-slots">${slots}</div>
      <p class="subtitle"><span class="waiting-dots">等待對手加入</span></p>
      <button class="btn secondary block" data-act="leave">離開房間</button>
    </div>`);
  el.querySelector('[data-act=copy]')!.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(snap.code);
      toast('已複製房號：' + snap.code);
    } catch {
      // 舊瀏覽器 / 非 https：退而求其次，選取文字讓玩家手動複製
      const range = document.createRange();
      range.selectNodeContents(el.querySelector('[data-code]')!);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
      toast('請按 Ctrl+C / 長按複製房號');
    }
  });
  el.querySelector('[data-act=leave]')!.addEventListener('click', () => {
    store.net.leaveRoom();
    window.dispatchEvent(new CustomEvent('hillduel:left'));
  });
  ui().replaceChildren(el);
}

// ------------------------------------------------------------ 角色選擇

export function showCharacterSelect(snap: RoomSnapshot, mySeat: Seat): void {
  let el = ui().querySelector<HTMLElement>('[data-screen=select]');
  if (!el) {
    el = h(`
      <div class="panel wide" data-screen="select">
        <h2>選擇角色</h2>
        <div class="select-status" data-status></div>
        <div class="char-grid" data-grid></div>
        <button class="btn block" data-act="confirm">確認角色</button>
        <div class="error" data-err></div>
      </div>`);
    const grid = el.querySelector<HTMLElement>('[data-grid]')!;
    for (const c of PLAYABLE_CHARACTERS) {
      const card = h(`
        <div class="char-card" data-id="${c.id}">
          <div class="pickers"></div>
          <div class="portrait"></div>
          <div class="cname">${esc(c.name)}</div>
          <div class="hp">HP ${c.maxHp}</div>
          <div class="desc">${esc(c.description)}</div>
          ${c.skills?.length ? `<ul class="skills">${c.skills.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
          ${
            c.exclusiveItems?.length
              ? `<div class="ex">${c.exclusiveItems
                  .map((id) => getItem(id))
                  .filter((i) => i?.icon)
                  .map((i) => `<img src="${i!.icon}" title="${esc(i!.name)}：${esc(i!.description)}" alt="${esc(i!.name)}">`)
                  .join('')}</div>`
              : ''
          }
        </div>`);
      const portrait = card.querySelector<HTMLElement>('.portrait')!;
      const placeholder = () => {
        portrait.innerHTML = `<div class="ph" style="background:#${hex(c.placeholder.color)};--head:#${hex(c.placeholder.accent)}"></div>`;
      };
      const src = c.portrait ?? c.poses?.idle;
      if (src) {
        const img = new Image();
        img.alt = c.name;
        img.onerror = placeholder;
        img.src = src;
        portrait.appendChild(img);
      } else placeholder();
      card.addEventListener('click', async () => {
        const me = store.snapshot?.players[mySeat];
        if (me?.confirmed) return;
        const res = await store.net.call('char:select', { characterId: c.id });
        if (!res.ok) toast(errText(res.error), true);
      });
      grid.appendChild(card);
    }
    const btn = el.querySelector<HTMLButtonElement>('[data-act=confirm]')!;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const res = await store.net.call('char:confirm');
      if (!res.ok) {
        btn.disabled = false;
        el!.querySelector('[data-err]')!.textContent = errText(res.error);
      }
    });
    ui().replaceChildren(el);
  }

  // 更新每張卡片上「誰選了」的標記
  const me = snap.players[mySeat];
  el.querySelectorAll<HTMLElement>('.char-card').forEach((card) => {
    const id = card.dataset.id;
    card.classList.toggle('selected', me?.characterId === id);
    card.classList.toggle('locked', !!me?.confirmed);
    card.querySelector('.pickers')!.innerHTML = snap.players
      .filter((p) => p && p.characterId === id)
      .map((p) => `<span class="pick-tag p${p!.seat}">${p!.seat === mySeat ? '你' : '對手'}</span>`)
      .join('');
  });
  el.querySelector('[data-status]')!.innerHTML = snap.players
    .map((p) =>
      p
        ? `<div><b>${esc(p.name)}</b>${p.seat === mySeat ? '（你）' : ''}<br>${
            p.confirmed ? '<span class="ok">✔ 已確認</span>' : p.characterId ? '選擇中…' : '尚未選擇'
          }${p.connected ? '' : ' <span class="offline">斷線中</span>'}</div>`
        : '<div>等待中</div>',
    )
    .join('');
  const btn = el.querySelector<HTMLButtonElement>('[data-act=confirm]')!;
  btn.disabled = !me?.characterId || !!me?.confirmed;
  btn.textContent = me?.confirmed ? '等待對手確認…' : '確認角色';
}

function hex(n: number): string {
  return n.toString(16).padStart(6, '0');
}

// ------------------------------------------------------------ 遊戲結束

let resultPending = false;

export function showGameOver(snap: RoomSnapshot, mySeat: Seat): void {
  if (resultPending || ui().querySelector('[data-screen=result]')) return;
  resultPending = true;
  const win = snap.winnerSeat === mySeat;
  const winner = snap.players[snap.winnerSeat ?? 0];
  const loser = snap.players[snap.winnerSeat === 0 ? 1 : 0];
  const reason = snap.endReason === 'forfeit' ? '（對手離開或斷線過久）' : '';
  const el = h(`
    <div class="panel result ${win ? 'win' : 'lose'}" data-screen="result">
      <div class="big">${win ? '勝利！' : '失敗…'}</div>
      <div class="detail">
        🏆 勝利：<b>${esc(winner?.name ?? '')}</b>（剩餘 HP ${winner?.hp ?? 0}）<br>
        💥 落敗：<b>${esc(loser?.name ?? '')}</b> ${esc(reason)}
      </div>
      <button class="btn block" data-act="menu">返回主選單</button>
    </div>`);
  el.querySelector('[data-act=menu]')!.addEventListener('click', () => {
    store.net.leaveRoom();
    window.dispatchEvent(new CustomEvent('hillduel:left'));
  });
  // 等戰場上的動畫（最後一擊、倒地）播完再顯示結算
  // （最多等 5 秒，避免裝置太慢時一直看不到結果）
  Promise.race([store.whenAnimIdle(), new Promise((r) => setTimeout(r, 5000))])
    .then(() => new Promise((r) => setTimeout(r, 600)))
    .then(() => {
      resultPending = false;
      if (store.snapshot?.status !== 'gameOver') return;
      ui().replaceChildren(el);
      if (win) confetti();
    });
}

function confetti(): void {
  const colors = ['#e8743b', '#ffd54f', '#3d7bd8', '#66bb6a', '#d8463d'];
  for (let i = 0; i < 60; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = 1.8 + Math.random() * 1.6 + 's';
    c.style.animationDelay = Math.random() * 0.6 + 's';
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 4500);
  }
}
