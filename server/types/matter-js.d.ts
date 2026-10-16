// matter-js 沒有附型別檔；這裡宣告成 any，避免額外安裝 @types 套件
declare module 'matter-js' {
  const Matter: any;
  export default Matter;
}
