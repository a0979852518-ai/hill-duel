// 手機直拿時強制橫向：把整個畫面（遊戲＋選單）轉 90°，不用等使用者開自動旋轉。
// 瀏覽器不能真的鎖定螢幕方向（iPhone 完全不支援，Android 只有全螢幕時可以），
// 所以用 CSS 旋轉 #app，並修正 Phaser 的尺寸計算與觸控座標。
// 手機橫拿時（或電腦）不做任何事。

import type * as Phaser from 'phaser';

let rotated = false;

export function isRotated(): boolean {
  return rotated;
}

export function setupLandscape(game: Phaser.Game): void {
  const app = document.getElementById('app')!;
  const touch = matchMedia('(pointer: coarse)').matches;
  // 手機專用的排版（style.css 的 body.mobile）
  document.body.classList.toggle('mobile', touch);
  const sm = game.scale as any;

  const apply = () => {
    const W = window.innerWidth,
      H = window.innerHeight;
    rotated = touch && H > W;
    document.body.classList.toggle('force-landscape', rotated);
    if (rotated) {
      // 順時針轉 90°：手機往左橫拿時畫面是正的
      app.style.width = `${H}px`;
      app.style.height = `${W}px`;
      app.style.transform = `rotate(90deg) translateY(-${W}px)`;
    } else {
      app.style.width = app.style.height = app.style.transform = '';
    }
    const root = document.documentElement.style;
    root.setProperty('--app-w', `${rotated ? H : W}px`);
    root.setProperty('--app-h', `${rotated ? W : H}px`);
    // 給版面用：畫面矮（手機橫向）/ 窄（手機直拿又沒轉）時改用比較緊湊的排版
    document.body.classList.toggle('short', (rotated ? W : H) < 560);
    document.body.classList.toggle('narrow', (rotated ? H : W) < 640);
    sm.refresh?.();
  };

  // Phaser 用 getBoundingClientRect 量父元素大小，轉過之後長寬會對調 → 改用未旋轉的 clientWidth/Height
  const origParentBounds = sm.getParentBounds.bind(sm);
  sm.getParentBounds = function (this: any) {
    if (!rotated) return origParentBounds();
    const w = this.parent.clientWidth,
      h = this.parent.clientHeight;
    const ps = this.parentSize;
    if (ps.width !== w || ps.height !== h) {
      ps.setSize(w, h);
      return true;
    }
    return false;
  };

  // 觸控座標：螢幕座標 → 旋轉前的畫面座標 → 遊戲座標
  const im = game.input as any;
  let lastX = 0,
    lastY = 0;
  const origTP = im.transformPointer.bind(im);
  im.transformPointer = (pointer: any, pageX: number, pageY: number, wasMove: boolean) => {
    lastX = pageX;
    lastY = pageY;
    return origTP(pointer, pageX, pageY, wasMove);
  };
  const toGame = () => {
    const canvas = game.canvas;
    // 轉回去：app 座標 ax = 螢幕 y，ay = 螢幕寬 − 螢幕 x
    const ax = lastY - window.scrollY;
    const ay = window.innerWidth - (lastX - window.scrollX);
    return {
      x: ((ax - canvas.offsetLeft) * sm.width) / canvas.offsetWidth,
      y: ((ay - canvas.offsetTop) * sm.height) / canvas.offsetHeight,
    };
  };
  const origX = sm.transformX.bind(sm),
    origY = sm.transformY.bind(sm);
  sm.transformX = (pageX: number) => (rotated ? toGame().x : origX(pageX));
  sm.transformY = (pageY: number) => (rotated ? toGame().y : origY(pageY));

  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', () => setTimeout(apply, 250));
  apply();
}
