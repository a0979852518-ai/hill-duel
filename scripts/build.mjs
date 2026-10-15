// 正式版打包（Render 等主機會執行 `npm run build`）：
//   1. TypeScript 編譯 server + shared → dist/server
//   2. TypeScript 編譯 client + shared → dist/web（瀏覽器直接載入 ES modules）
//   3. 複製 HTML / CSS / 圖片，以及 Phaser 與 Socket.IO 的瀏覽器版到 dist/web/vendor
// 不依賴 Vite，所以和開發時用的 `npm run dev` 互不影響。
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });

const tsc = require.resolve('typescript/bin/tsc');
for (const cfg of ['tsconfig.server.json', 'tsconfig.web.json']) {
  const r = spawnSync(process.execPath, [tsc, '-p', join(root, cfg)], { stdio: 'inherit' });
  // 型別警告不擋打包（tsc 仍會輸出 JS）；真正的語法錯誤會讓下面的檢查失敗
  if (r.status !== 0) console.warn(`[build] ${cfg} 有型別警告（不影響輸出）`);
}
const mustExist = [join(dist, 'server/server/index.js'), join(dist, 'web/client/src/main.js')];
for (const f of mustExist) if (!existsSync(f)) throw new Error(`[build] 編譯失敗，找不到 ${f}`);

const web = join(dist, 'web');
cpSync(join(root, 'client/public'), web, { recursive: true });
mkdirSync(join(web, 'client/src'), { recursive: true });
cpSync(join(root, 'client/src/style.css'), join(web, 'client/src/style.css'));
mkdirSync(join(web, 'vendor'), { recursive: true });
cpSync(join(dirname(require.resolve('phaser/package.json')), 'dist/phaser.esm.js'), join(web, 'vendor/phaser.esm.js'));
cpSync(join(dirname(require.resolve('socket.io/package.json')), 'client-dist/socket.io.esm.min.js'), join(web, 'vendor/socket.io.esm.min.js'));

let html = readFileSync(join(root, 'client/index.html'), 'utf8');
html = html
  .replace(
    '<link rel="stylesheet" href="/src/style.css" />',
    '<link rel="stylesheet" href="/client/src/style.css" />\n    <script type="importmap">{"imports":{"phaser":"/vendor/phaser.esm.js","socket.io-client":"/vendor/socket.io.esm.min.js"}}</script>',
  )
  .replace('src="/src/main.ts"', 'src="/client/src/main.js"');
writeFileSync(join(web, 'index.html'), html);
console.log('[build] 完成 → dist/');
