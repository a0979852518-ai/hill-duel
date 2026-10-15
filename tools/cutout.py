"""
角色照片去背工具：把白色/透明背景去掉、裁掉多餘空白、縮成適合遊戲的大小。
用法：python3 tools/cutout.py 輸入.png 輸出.png [最長邊像素=480] [--flip] [--keep=x,y,r] [--holes]
  --keep=x,y,r  強制保留一個圓形區域（例如跟背景一樣白的球）
  --holes       也去掉被身體包住的大塊白色背景（例如彎曲的腿中間）
  --thresh=N    背景亮度門檻（預設 232；灰色漸層背景可調低，例如 190）
原理：從圖片邊緣開始「油漆桶」把連到外框的接近白色區域變透明，
      所以衣服上的白字、白色的球只要沒有碰到背景就會保留。
"""
import sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

def cutout(src, dst, max_side=480, flip=False, thresh=232, keep=None, holes=False):
    im = Image.open(src).convert('RGBA')
    a = np.asarray(im).astype(np.int16)
    rgb, alpha = a[..., :3], a[..., 3]
    # 背景候選：接近白色且低彩度，或原本就透明
    mn, mx = rgb.min(axis=2), rgb.max(axis=2)
    cand = ((mn >= thresh) & (mx - mn <= 18)) | (alpha < 20)
    # 只保留跟外框相連的候選區（真正的背景）
    lab, _ = ndimage.label(cand)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(border))
    if holes:
        # 被主體包住、面積夠大且非常白的區塊也當背景（字樣這種小區塊不會被挖掉）
        very_white = (mn >= 240) & (mx - mn <= 12)
        lab_h, nh = ndimage.label(very_white & ~bg)
        if nh:
            sizes = ndimage.sum(np.ones_like(lab_h), lab_h, range(1, nh + 1))
            big = np.zeros(nh + 1, bool)
            big[1:] = sizes >= 0.002 * cand.size
            bg |= big[lab_h]
    if keep:
        kx, ky, kr = keep
        yy, xx = np.ogrid[: bg.shape[0], : bg.shape[1]]
        bg &= ~(((xx - kx) ** 2 + (yy - ky) ** 2) <= kr * kr)
    # 填掉主體內部的小洞（避免皮膚反光被挖空）
    fg = ~bg
    fg = ndimage.binary_opening(fg, iterations=1)
    # 只留最大的主體區塊，去掉零碎雜點
    lab2, n = ndimage.label(fg)
    if n > 1:
        sizes = ndimage.sum(fg, lab2, range(1, n + 1))
        keep = np.zeros(n + 1, bool)
        keep[1:] = sizes >= sizes.max() * 0.02
        fg = keep[lab2]
    mask = Image.fromarray((fg * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
    m = np.asarray(mask).astype(np.float32) / 255
    m = np.clip((m - 0.25) / 0.75, 0, 1)  # 收邊，減少白邊
    out = np.asarray(im).copy()
    out[..., 3] = (np.minimum(m, alpha / 255) * 255).astype(np.uint8)
    res = Image.fromarray(out)
    bbox = res.getchannel('A').point(lambda v: 255 if v > 10 else 0).getbbox()
    res = res.crop(bbox)
    if flip:
        res = res.transpose(Image.FLIP_LEFT_RIGHT)
    s = max_side / max(res.size)
    if s < 1:
        res = res.resize((round(res.width * s), round(res.height * s)), Image.LANCZOS)
    res.save(dst, optimize=True)
    print(dst, res.size)

if __name__ == '__main__':
    args = [x for x in sys.argv[1:] if not x.startswith('--')]
    keep = next((tuple(map(int, x.split('=')[1].split(','))) for x in sys.argv if x.startswith('--keep=')), None)
    thresh = next((int(x.split('=')[1]) for x in sys.argv if x.startswith('--thresh=')), 232)
    cutout(args[0], args[1], int(args[2]) if len(args) > 2 else 480, '--flip' in sys.argv, thresh=thresh, keep=keep, holes='--holes' in sys.argv)
