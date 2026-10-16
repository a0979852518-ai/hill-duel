// ============================================================
// 地圖（背景＋地板）。每場對戰開始時由伺服器隨機挑一張，雙方看到的一樣。
// ------------------------------------------------------------
// bg：遠景圖，「原圖＋左右鏡像」一組，可以左右一直重複貼（不會有接縫），上方補了天空/天花板。
// ground：配合遠景生成的像素風地板，左右可無縫重複。
// 新增地圖：把圖放到 client/public/assets/backgrounds/，在這裡加一筆。
// ============================================================

export interface MapDef {
  id: string;
  name: string;
  bg: string;
  ground: string;
  /** 地板圖 1 格 = 世界幾像素 */
  groundTexel: number;
  /** 遠景圖 1 像素 = 世界幾像素（越大，背景的東西看起來越大） */
  worldPerTexel: number;
  /** 視差：遠景跟著鏡頭移動的比例（越小越遠） */
  scrollX: number;
  /** 遠景圖底邊放在地面線往下幾像素（被前景地板蓋住） */
  bottomOffset: number;
  /** 遠景圖裡原圖中心的 x（貼圖像素），對齊到世界 centerX */
  photoCenter: number;
  centerX: number;
  /** 遠景圖蓋不到的地方（鏡頭往上拉很高）的底色 */
  bgColor: string;
}

export const MAPS: MapDef[] = [
  {
    id: 'campus',
    name: '蕙蘭樓',
    bg: 'assets/backgrounds/campus.jpg',
    ground: 'assets/backgrounds/ground_campus.png',
    groundTexel: 8,
    worldPerTexel: 1.4,
    scrollX: 0.35,
    bottomOffset: 10,
    photoCenter: 768,
    centerX: 1190,
    bgColor: '#3f8fd0',
  },
  {
    id: 'hallway',
    name: '走廊',
    bg: 'assets/backgrounds/hallway.jpg',
    ground: 'assets/backgrounds/ground_hallway.png',
    groundTexel: 6,
    worldPerTexel: 1.15,
    // 牆就在後面，跟著鏡頭移動得比較多
    scrollX: 0.5,
    bottomOffset: -2,
    photoCenter: 836,
    centerX: 1400,
    bgColor: '#46433e',
  },
  {
    id: 'avenue',
    name: '林蔭大道',
    bg: 'assets/backgrounds/avenue.jpg',
    ground: 'assets/backgrounds/ground_avenue.png',
    groundTexel: 8,
    worldPerTexel: 1.5,
    scrollX: 0.35,
    bottomOffset: 10,
    photoCenter: 836,
    centerX: 1190,
    bgColor: '#2870be',
  },
];

export function getMap(id: string | null | undefined): MapDef {
  return MAPS.find((m) => m.id === id) ?? MAPS[0];
}

export function randomMapId(rng: () => number = Math.random): string {
  return MAPS[Math.floor(rng() * MAPS.length)].id;
}
