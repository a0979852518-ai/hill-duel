// 伺服器進入點：HTTP（正式模式下順便提供前端靜態檔）＋ Socket.IO。

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/types.js';
import type { SocketData } from './rooms/Room.js';
import { RoomManager } from './rooms/RoomManager.js';

const PORT = Number(process.env.PORT ?? 3000);
const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
// 正式版前端在 dist/web（npm run build 產生）；舊的 Vite 打包在 dist/client
const STATIC_DIR = resolve(
  process.env.STATIC_DIR ?? [join(process.cwd(), 'dist', 'web'), join(ROOT, 'dist', 'client')].find((d) => existsSync(d)) ?? join(process.cwd(), 'dist', 'web'),
);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

const httpServer = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: manager.roomCount }));
    return;
  }
  if (!existsSync(STATIC_DIR)) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('伺服器運作中。開發模式請開 http://localhost:5173 ；正式模式請先 npm run build。');
    return;
  }
  // 靜態檔案（防止 ../ 跳出目錄）
  let filePath = normalize(join(STATIC_DIR, decodeURIComponent(url.pathname)));
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    // 有副檔名的檔案（圖片、音效…）找不到就回 404；其他路徑回首頁
    if (extname(url.pathname)) {
      res.writeHead(404).end();
      return;
    }
    filePath = join(STATIC_DIR, 'index.html');
  }
  res.writeHead(200, { 'content-type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
});

const io = new Server<ClientToServerEvents, ServerToClientEvents, {}, SocketData>(httpServer, {
  cors: process.env.CORS_ORIGIN ? { origin: process.env.CORS_ORIGIN.split(',') } : undefined,
  pingInterval: 10_000,
  pingTimeout: 8_000,
});

const manager = new RoomManager(io);
io.on('connection', (socket) => manager.bind(socket));

httpServer.listen(PORT, () => {
  console.log(`[hill-duel] server listening on http://localhost:${PORT}`);
  if (existsSync(STATIC_DIR)) console.log(`[hill-duel] serving client from ${STATIC_DIR}`);
});
