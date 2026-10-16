// ============================================================
// 角色設定檔
// ------------------------------------------------------------
// 新增角色：複製一筆，改 id / 名稱 / HP / 圖片路徑即可。
// 圖片放在 client/public/assets/characters/<角色id>/ 底下，路徑填相對於 client/public。
//
// 每個角色可以有這些圖（都要「面向右邊」、透明背景 PNG；右方玩家會自動左右翻轉）：
//   portrait  選角畫面用（正面照）
//   idle      戰場上待機
//   throw     輪到自己瞄準（角度/力道）時、以及出手瞬間
//   hurt      受到傷害時短暫顯示
//   dead      生命歸零（躺下）
// 缺哪張就自動用 idle 代替；連 idle 都沒有就畫臨時圖形，不會壞掉。
// 有白底照片可以用 tools/cutout.py 去背（用法見 README）。
// ============================================================

export type Pose = 'idle' | 'throw' | 'hurt' | 'dead';

export interface CharacterDef {
  id: string;
  name: string;
  /** 初始生命值（每個角色可以不同） */
  maxHp: number;
  description: string;
  /** 設為 false 就不會出現在選角畫面 */
  enabled?: boolean;
  /** 選角畫面的圖 */
  portrait?: string;
  /** 戰鬥中各種姿勢的圖 */
  poses?: Partial<Record<Pose, string>>;
  /**
   * 被打飛的連續動作圖（5 張，面向右、往左邊被打飛）：
   *  1 被打到往後仰  2 往後倒  3、4 在地上往後滾  5 躺平
   * 5 張要用同一個縮放比例存（第 1 張的高度 = 站姿高度）
   */
  knockFrames?: string[];
  /** 站姿在畫面上的高度（像素），其他姿勢依比例換算；預設 150 */
  standHeight?: number;
  /** 沒有圖片時的臨時外觀 */
  placeholder: { color: number; accent: number };
}

export const CHARACTERS: CharacterDef[] = [
  {
    id: 'lixinan',
    name: '李信安',
    maxHp: 100,
    description: '戴眼鏡的冷靜投手。',
    portrait: 'assets/characters/lixinan/portrait.png',
    poses: {
      idle: 'assets/characters/lixinan/idle.png',
      throw: 'assets/characters/lixinan/throw.png',
      // hurt: 'assets/characters/lixinan/hurt.png',   ← 有受傷照後取消註解
      dead: 'assets/characters/lixinan/dead.png',
    },
    knockFrames: [1, 2, 3, 4, 5].map((i) => `assets/characters/lixinan/knock${i}.png`),
    placeholder: { color: 0x222222, accent: 0xf1d3b8 },
  },
  {
    id: 'zhenglinze',
    name: '鄭霖澤',
    maxHp: 100,
    description: '身手靈活的投擲好手。',
    portrait: 'assets/characters/zhenglinze/portrait.png',
    poses: {
      idle: 'assets/characters/zhenglinze/idle.png',
      throw: 'assets/characters/zhenglinze/throw.png',
      // hurt: 'assets/characters/zhenglinze/hurt.png',
      dead: 'assets/characters/zhenglinze/dead.png',
    },
    knockFrames: [1, 2, 3, 4, 5].map((i) => `assets/characters/zhenglinze/knock${i}.png`),
    placeholder: { color: 0xbdb6aa, accent: 0xf1d3b8 },
  },
  {
    id: 'yebingcheng',
    name: '葉柄承',
    maxHp: 100,
    description: '架式十足的投擲新秀。',
    portrait: 'assets/characters/yebingcheng/portrait.png',
    poses: {
      idle: 'assets/characters/yebingcheng/idle.png',
      throw: 'assets/characters/yebingcheng/throw.png',
      hurt: 'assets/characters/yebingcheng/hurt.png',
      dead: 'assets/characters/yebingcheng/dead.png',
    },
    knockFrames: [1, 2, 3, 4, 5].map((i) => `assets/characters/yebingcheng/knock${i}.png`),
    placeholder: { color: 0xe8e6ea, accent: 0xf1d3b8 },
  },

  // ---- 以下是最早的臨時角色（沒有照片），先關閉；改成 enabled: true 就會回到選角畫面 ----
  {
    id: 'knight',
    name: '鐵壁騎士',
    maxHp: 120,
    description: '血量較厚，適合打持久戰。',
    enabled: false,
    placeholder: { color: 0x4a78c2, accent: 0xdfe8f5 },
  },
  {
    id: 'ranger',
    name: '疾風遊俠',
    maxHp: 100,
    description: '標準血量的平衡型角色。',
    enabled: false,
    placeholder: { color: 0x3f9e5a, accent: 0xf2e3b3 },
  },
];

export const PLAYABLE_CHARACTERS = CHARACTERS.filter((c) => c.enabled !== false);

export function getCharacter(id: string): CharacterDef | undefined {
  return CHARACTERS.find((c) => c.id === id);
}
