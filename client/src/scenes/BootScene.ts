import * as Phaser from 'phaser';
import { ensurePlaceholders, queueAssets } from '../game/assets.js';
import { drawArena, fitArenaCamera, queueBackground } from '../game/arena.js';
import { randomMapId } from '../../../shared/config/maps.js';
import { FONT } from './battle/effects.js';

/** 載入所有素材（缺的自動補 placeholder），完成後進入背景場景 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }
  preload(): void {
    const t = this.add.text(640, 360, '載入中…', { fontFamily: FONT, fontSize: '28px', color: '#ffffff' }).setOrigin(0.5);
    this.load.on('progress', (v: number) => t.setText(`載入中… ${Math.round(v * 100)}%`));
    queueBackground(this);
    queueAssets(this);
  }
  create(): void {
    ensurePlaceholders(this);
    this.scene.start('Backdrop');
    this.game.events.emit('assets-ready');
  }
}

/** 選單畫面後面的背景（場地＋輕微動態） */
export class BackdropScene extends Phaser.Scene {
  constructor() {
    super('Backdrop');
  }
  create(): void {
    // 選單背景：每次隨機一張地圖
    drawArena(this, randomMapId());
    fitArenaCamera(this);
    this.add.rectangle(640, 360, 1280, 720, 0x1d2733, 0.35).setScrollFactor(0).setScale(1 / this.cameras.main.zoom);
  }
}
