# 素材資料夾

把圖片放在這裡，並在設定檔填入路徑（相對於 `client/public`）。
檔案不存在時，遊戲會自動用幾何圖形代替，不會出錯。

| 資料夾 | 用途 | 建議規格 | 對應設定 |
|---|---|---|---|
| `characters/` | 角色站姿圖 | 透明背景 PNG，角色**面向右**，約 128×192（會縮成 64×96 顯示，可用 `displaySize` 改） | `shared/config/characters.ts` 的 `sprite` |
| `items/` | 道具圖示（老虎機、選擇卡片） | 透明背景 PNG，正方形 128×128 | `shared/config/items.ts` 的 `icon` |
| `items/` | 投擲物飛行圖（選填） | 透明背景 PNG，正方形 | throwable 的 `sprite` |
| `items/` | 防禦道具在場上的圖（選填） | PNG，比例接近該道具的 `size` | defense 的 `sprite` |
| `backgrounds/arena.png` | 戰鬥背景 | 1280×720 | 固定檔名 |

目前設定檔預先填好的檔名：
- characters/knight.png、characters/ranger.png
- items/rock.png、bomb.png、poison.png、wood.png、shield.png、steel.png、lightning.png、hammer.png
