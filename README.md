# 山丘投擲對決（Hill Duel）

雙人線上、回合制、2D 橫向砲擊對戰網頁遊戲。
技術：**TypeScript + Phaser 3（前端）＋ Node.js + Socket.IO（後端）**，伺服器是唯一的權威狀態來源。

---

## 1. 本機啟動

需求：Node.js 20 以上。

```bash
npm install
npm run build      # TypeScript 編譯到 dist/（不需要 Vite）
npm start          # 打開 http://localhost:3000
```
這就是 Render 上跑的正式模式，也是我實際測過的方式。

改程式時可以用開發模式（存檔自動重載）：`npm run dev`，開 http://localhost:5173。

可用環境變數：`PORT`（預設 3000）、`CORS_ORIGIN`（前後端分開部署時才需要）。
前後端分開部署時，前端打包前設定 `VITE_SERVER_URL=https://你的後端網址`。

## 2. 雙人連線測試

**同一台電腦**：開兩個瀏覽器分頁（或一般視窗＋無痕視窗）→ A 按「創建房間」→ 把房號輸入到 B →「加入房間」。
每個分頁是獨立的玩家；重新整理分頁會自動回到原本的房間。

**同一個 Wi-Fi 的兩台電腦/手機**：`npm start` 後，另一台裝置開 `http://你電腦的區網IP:3000`（例如 http://192.168.1.23:3000）。

**不同地點**：需要把伺服器部署到網路上（見第 6 節）。

## 3. 遊戲流程（對應需求書）

| 階段 | 計時 | 操作 |
|---|---|---|
| 抽取道具 | 第一階段 30 秒 | 老虎機轉動 → **空白鍵**停止 → 兩個隨機道具二選一（點卡片或按 1 / 2） |
| 投擲 | 第二階段 30 秒（獨立） | 滑鼠/手指決定方向 → **按住**（左鍵、手指或空白鍵）蓄力 → **放開**投出 |
| 防禦 | 第二階段 30 秒 | 移到想放的位置（紅色 = 不能放）→ 點一下（手機：拖曳後放開），道具照物理掉落、堆疊 |
| 功能道具 | 第二階段 30 秒 | 需要目標的點選目標；不需要的按空白鍵發動 |
| 結算 | 不計時 | 播放動畫、扣血、檢查勝負、換人 |

手機沒有空白鍵：停止老虎機、發動功能道具用右下角的圓形大按鈕；投擲直接用手指按住拖曳。戰鬥中直拿手機會提示轉成橫向。
第一階段逾時 = 放棄本回合；第二階段逾時 = 取消使用道具。倒數剩 5 秒時計時器變紅閃動。

## 4. 專案結構

```
shared/                     前後端共用（改數值只要改這裡）
  config/game.ts            計時、場地座標、重力、角度/力道擺動速度
  config/characters.ts      角色資料（名稱、HP、圖片、介紹）
  config/items.ts           道具資料（投擲/防禦/功能）＋狀態效果
  physics.ts                共用幾何（角色判定框、出手點）
  types.ts                  快照、事件、錯誤碼、Socket 事件型別
server/
  index.ts                  HTTP + Socket.IO 進入點（正式模式也提供前端檔案）
  rooms/RoomManager.ts      房號產生、建立/加入/重連、事件分派
  rooms/Room.ts             席位、角色選擇、斷線寬限、廣播快照
  game/Battle.ts            回合狀態機＋兩個獨立倒數
  game/PhaseTimer.ts        單一階段計時器（含網路延遲寬限）
  game/ItemDraw.ts          完全隨機、不重複、可加權的道具抽取
  game/BattleState.ts       血量、狀態效果、防禦道具（唯一修改處）
  game/PhysicsWorld.ts      Matter.js 物理世界：投擲飛行、防禦道具掉落堆疊、被撞倒
  game/Combat.ts            投擲結算：命中、爆炸波及、減傷、附加狀態
  game/DefenseSystem.ts     放置合法性、建立防禦道具
  game/functional/registry.ts  功能型道具 handler
client/
  index.html
  public/assets/            ← 放角色、道具、背景圖片（見裡面的 README）
  src/main.ts               畫面切換（選單 → 等待 → 選角 → 戰鬥 → 結算）
  src/net/Network.ts        Socket.IO 包裝、自動重連、ack 逾時
  src/ui/screens.ts         HTML 選單畫面
  src/scenes/BattleScene.ts 戰鬥場景（快照 → UI、事件 → 動畫佇列）
  src/scenes/battle/        HUD、老虎機、卡片、瞄準、放置、目標、特效
  src/game/assets.ts        載入圖片，缺圖自動畫 placeholder
```

## 5. 新增角色 / 道具

**新增角色**：在 `shared/config/characters.ts` 的 `CHARACTERS` 加一筆，HP 直接填 `maxHp`。
圖片放 `client/public/assets/characters/<角色id>/`，每個姿勢一張（全部面向右、透明背景）：
`portrait`（選角正面照）、`idle`（待機）、`throw`（瞄準與出手）、`hurt`（受傷，選填）、`dead`（倒地）。缺的姿勢會自動用待機照代替。

白底照片可以用內附的去背工具（需要 `pip install pillow numpy scipy`）：
```bash
python3 tools/cutout.py 原圖.png client/public/assets/characters/xxx/idle.png 480
# 白色的球跟背景連在一起被吃掉時：--keep=x,y,半徑（原圖座標）強制保留
# 彎曲的腿中間有白色殘留時：加 --holes
```

**新增投擲道具**：在 `shared/config/items.ts` 加 `kind: 'throwable'`，調整 `damage`、`minSpeed/maxSpeed`（力道 0%/100% 的初速）、`gravityScale`、`explosionRadius`、`onHitStatus` 等。不用改程式。

**新增防禦道具**：加 `kind: 'defense'`，設定 `durability`（耐久，null = 不看）、`maxHits`（可擋次數）、`damageReduction`、`durationTurns`（null = 不限）、`blocks`（`'all'` 或可擋的投擲物 tag）、`maxPerPlayer`。不用改程式。

**新增功能道具**：
1. 在 `server/game/functional/registry.ts` 寫一個 handler（`execute` 必填；`validate`、`canDraw` 選填）
2. 在 `items.ts` 加 `kind: 'functional'`，`handler` 填名字、`targeting` 填 `'none'` 或 `'enemyDefense'`
3. （選填）在 `client/src/scenes/battle/effects.ts` 的 `FUNCTIONAL_EFFECTS` 加專屬動畫；沒加就用預設閃光

**新增狀態效果**（中毒、燃燒…）：在 `items.ts` 的 `STATUSES` 加一筆，再讓道具的 `onHitStatus` 指向它。

**抽取機率**：每個道具可設 `weight`（預設 1），`enabled: false` 可暫時移出道具池。

## 6. 部署到網路（Render，免費）

Socket.IO 需要一直開著的 Node 伺服器，GitHub Pages 這類純靜態空間不行。專案已附 `render.yaml`。

1. 註冊 GitHub，建立一個新的 repository（例如 `hill-duel`），把這個專案的檔案上傳上去（不要上傳 `node_modules`、`dist`）。
2. 到 https://render.com 用 GitHub 帳號登入 → **New → Web Service** → 選這個 repo。
3. 設定：Build Command `npm install && npm run build`、Start Command `npm start`、方案選 **Free** → Create Web Service。
4. 幾分鐘後會得到 `https://xxxx.onrender.com`，把網址傳給朋友就能對戰。

免費方案注意：15 分鐘沒人連線會休眠，下次打開要等大約 1 分鐘才醒來；伺服器休眠或重新部署時，進行中的房間會消失。

## 7. 目前的道具

| 道具 | 類型 | 效果 |
|---|---|---|
| 大哥的香菸 | 投擲 | 傷害 20，之後對方每回合扣 1（到遊戲結束） |
| 機車鎖 | 投擲 | 傷害 10，對方下一回合不能行動 |
| Maya 2026 | 投擲 | 傷害 30 |
| 侯宸宇的冷氣卡 | 投擲 | 傷害 10，對方下一回合兩個選項藏一個 |
| 竹竿的過期果汁 | 投擲 | 傷害 10，對方下一回合造成的傷害減半 |
| 得咖咪咪的鋼盔 | 防禦 | 擋 2 次投擲 |
| 企鵝的冰箱 | 防禦 | 擋 1 次投擲 |
| 捲毛的回收堆 | 防禦 | 擋 1 次投擲 |
| 同歸於盡炸彈 | 功能攻擊 | 自己和對手各扣 50 |
| 竹竿的絲襪 | 功能攻擊 | 到你下次攻擊結束前，對方受到的傷害 ×1.5 |
| 乳清蛋白 | 功能攻擊 | 你的下一回合傷害 ×1.5 |
| 正忠排骨 | 功能防禦 | 回復 30 血（不超過上限） |

數值全部在 `shared/config/items.ts`；最早的臨時道具（石頭、炸彈…）還在檔案裡，設成 `enabled: false`。

## 8. 目前的設計決定（可改）

- 投擲物**不會**被自己的防禦道具擋住，但自己的爆炸**會**波及自己。
- 擋下攻擊的防禦道具即使剩餘耐久不夠，這一發也算完整擋下。
- 爆炸只會傷到被直接撞到的那個防禦道具，不會連帶傷到旁邊的（但物理上會被撞歪、撞倒）。
- 防禦道具用真實物理（Matter.js）：從放手位置掉下來、會滑、會倒，掉出平台就消失；鋼盔是倒 U 形，可以戴在頭上。
- 物理只在伺服器上算，雙方收到同一份逐格動畫，所以畫面一定一致。
- 物理數值（重力、彈性、摩擦、各道具密度）在 `shared/config/game.ts` 的 `ARENA.gravity`、`PHYSICS` 與 `items.ts` 各道具的 `density`/`friction`/`body`。
- 雙方同時歸零（自己炸到自己）時，判出手的一方獲勝。
- 持續回合數在「放置者自己的回合開始」時扣 1，歸零移除；所以「2 回合」= 擋得住對手接下來 2 個回合。
- 斷線保留 60 秒；戰鬥中超過 60 秒沒回來判負，選角/等待中則空出位置。
- 角度與力道的擺動在玩家自己的瀏覽器上跑，送出的是確認當下的數值；伺服器只檢查範圍，不檢查「擺到那裡的時間點」。
- 第一回合由誰先：`shared/config/game.ts` 的 `firstTurn`（預設隨機）。

## 9. 尚未完成 / 已知限制

- **音效**：完全沒有（需求書第 14 步「完善音效」未做）。
- **素材**：角色已換成李信安、鄭霖澤的照片，但兩人都還沒有受傷照（目前受傷時用待機照加紅色閃爍）；道具、背景仍是程式畫的臨時圖形。
- **重新比賽**：結束後只能回主選單重開房間，沒有「再來一局」。
- **防作弊**：角度/力道數值由客戶端送出，懂技術的人可以直接送出精準數值（見第 7 節）。
- **伺服器重啟**會清空所有房間（房間只存在記憶體）。
- 只做了 1 對 1；沒有觀戰、聊天。
- 套件版本（package.json）是依已知版本填寫，開發環境中沒有實際跑過 `npm install`（正式版打包流程有用相同版本的套件原始碼模擬測過）；如果安裝報錯，把錯誤貼給我。
- 開發模式（`npm run dev`，用 Vite）沒有在我這邊實際跑過；正式模式（`npm run build` + `npm start`）有完整測過。
