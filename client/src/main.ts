// 前端進入點：建立連線、Phaser 遊戲，依房間狀態切換畫面。

import * as Phaser from 'phaser';
import { ARENA } from '../../shared/config/game.js';
import { ERROR_TEXT, type RoomSnapshot } from '../../shared/types.js';
import { Network } from './net/Network.js';
import { BattleScene } from './scenes/BattleScene.js';
import { BattleUIScene } from './scenes/BattleUIScene.js';
import { BackdropScene, BootScene } from './scenes/BootScene.js';
import { store } from './state/store.js';
import { clearUi, showCharacterSelect, showGameOver, showMenu, showWaiting } from './ui/screens.js';
import { toast } from './ui/toast.js';
import { sfx } from './game/sfx.js';

// 音效開關（記在這台裝置上）＋所有按鈕的點擊聲
const muteBtn = document.createElement('button');
muteBtn.className = 'mute-btn';
const renderMute = () => {
  muteBtn.textContent = sfx.muted ? '🔇' : '🔊';
  muteBtn.title = sfx.muted ? '開啟音效' : '關閉音效';
};
renderMute();
muteBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  sfx.setMuted(!sfx.muted);
  renderMute();
  sfx.play('click');
});
document.body.appendChild(muteBtn);
document.addEventListener('click', (e) => {
  const el = e.target as HTMLElement | null;
  if (el && el !== muteBtn && el.closest('button, .char-card')) sfx.play('click');
});

const net = new Network();
store.net = net;

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: ARENA.width,
  height: ARENA.height,
  backgroundColor: '#3f8fd0', // 天空頂端的顏色（清畫面用，比畫一層全螢幕的圖便宜）
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  // 慢的裝置（低於 5 FPS）時 Phaser 預設會把每幀時間縮成 16ms，動畫和計時會變得超慢；
  // 放寬到 2 FPS 才啟動保護，讓慢裝置的動畫仍跟真實時間同步。
  fps: { min: 2 },
  scene: [BootScene, BackdropScene, BattleScene, BattleUIScene],
});

let assetsReady = false;
game.events.once('assets-ready', () => {
  assetsReady = true;
  route();
});

function route(): void {
  if (!assetsReady) return;
  const snap = store.snapshot;
  const seat = store.mySeat;
  const inRoom = !!net.session && !!snap && snap.code === net.session.code && seat !== null;

  const wantBattle = inRoom && (snap!.status === 'battle' || snap!.status === 'gameOver');
  document.body.classList.toggle('in-battle', wantBattle);
  if (wantBattle && !game.scene.isActive('Battle')) {
    game.scene.stop('Backdrop');
    game.scene.start('Battle');
  } else if (!wantBattle && game.scene.isActive('Battle')) {
    game.scene.stop('Battle');
    game.scene.start('Backdrop');
  }

  if (!inRoom) {
    if (!document.querySelector('[data-screen=menu]')) showMenu();
    return;
  }
  switch (snap!.status) {
    case 'waiting':
      showWaiting(snap!);
      break;
    case 'characterSelect':
      showCharacterSelect(snap!, seat!);
      break;
    case 'battle':
      clearUi();
      break;
    case 'gameOver':
      showGameOver(snap!, seat!);
      break;
  }
}

net.onState((s: RoomSnapshot) => {
  store.snapshot = s;
  store.snapshotAt = performance.now();
  route();
});

net.onStatus(({ connected, resumeFailed }) => {
  if (!connected) toast('與伺服器斷線，正在重新連線…', true, 3500);
  else if (resumeFailed) {
    store.snapshot = null;
    showMenu(resumeFailed === 'ROOM_NOT_FOUND' ? '原本的房間已經不存在了。' : ERROR_TEXT[resumeFailed]);
    route();
  }
});

net.onClosed((reason) => {
  store.snapshot = null;
  showMenu(reason);
  route();
});

// 建立/加入房間成功：伺服器的第一份快照可能比 ack 先到，這裡再判斷一次畫面
window.addEventListener('hillduel:route', () => route());

window.addEventListener('hillduel:left', () => {
  store.snapshot = null;
  showMenu();
  route();
});

// 開發時方便除錯
(window as unknown as { __hillduel: unknown }).__hillduel = { store, game, sfx };
