import { defineConfig } from 'vite';

// 開發模式：前端跑在 5173，Socket.IO 連線轉發到後端 3000。
// 正式模式：`npm run build` 輸出到 dist/client，由後端同一個 port 一起提供。
export default defineConfig({
  root: 'client',
  publicDir: 'public',
  server: {
    port: 5173,
    host: true, // 讓同一個區網的其他裝置也能連進來測試
    proxy: {
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
});
