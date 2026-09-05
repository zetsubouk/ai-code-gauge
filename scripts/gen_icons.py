#!/usr/bin/env python
"""Generate AI 码表 (CodeGauge) extension icons.

设计（品牌方案 A）：深色渐变圆角底 + 240° 仪表弧线（蓝紫渐变色近似）+ 指针 + 轴心，
供应商中立，与徽章百分比隐喻一致。仅依赖 Pillow。
"""
import os
import sys
from PIL import Image, ImageDraw

# 兼容不注入 __file 的受限执行环境，退回 sys.argv[0] 定位项目根
BASE = os.path.dirname(os.path.dirname(os.path.abspath(globals().get("__file__", sys.argv[0]))))

def make_icon(size):
    scale = size / 128.0
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pad = int(6 * scale)
    radius = int(28 * scale)

    # 背景渐变（#1C2436 -> #10141d）经圆角蒙版合成，保证四角透明
    top, bottom = (28, 36, 54), (16, 20, 29)
    grad = Image.new("RGBA", (size, size))
    gd = ImageDraw.Draw(grad)
    for y in range(size):
        t = y / max(1, size - 1)
        gd.line([(0, y), (size, y)],
                fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)) + (255,))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([pad, pad, size - pad, size - pad], radius=radius, fill=255)
    img.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(img)
    # 细边框（白色 10% 透明度），小尺寸下保持轮廓清晰
    d.rounded_rectangle([pad, pad, size - pad, size - pad], radius=radius,
                        outline=(255, 255, 255, 26), width=max(1, int(2 * scale)))

    # 仪表弧：圆心 (64,64) 半径 34，240° 扫掠（150° -> 390°，底部开口）
    cx = cy = size / 2
    r = int(34 * scale)
    lw = max(1, int(11 * scale))
    bbox = [cx - r, cy - r, cx + r, cy + r]
    # 轨道弧（白色 14%）
    d.arc(bbox, start=150, end=390, fill=(255, 255, 255, 36), width=lw)
    # 进度弧 ~62%（蓝紫主色近似渐变中值）
    d.arc(bbox, start=150, end=299, fill=(114, 113, 255, 255), width=lw)

    # 指针指向 62% 刻度（128 空间终点 (73.2, 47.3)），端点补圆模拟圆头
    ex, ey = 73.2 * scale, 47.3 * scale
    nw = max(1, int(6 * scale))
    d.line([(cx, cy), (ex, ey)], fill=(255, 255, 255, 255), width=nw)
    cap = nw / 2
    d.ellipse([cx - cap, cy - cap, cx + cap, cy + cap], fill=(255, 255, 255, 255))
    d.ellipse([ex - cap, ey - cap, ex + cap, ey + cap], fill=(255, 255, 255, 255))

    # 轴心：白色圆 + 主色内点
    hr = int(7 * scale)
    d.ellipse([cx - hr, cy - hr, cx + hr, cy + hr], fill=(255, 255, 255, 255))
    ir = int(2.6 * scale)
    if ir >= 1:
        d.ellipse([cx - ir, cy - ir, cx + ir, cy + ir], fill=(91, 119, 255, 255))
    return img

for s in (16, 32, 48, 128):
    make_icon(s).save(os.path.join(BASE, "icons", f"icon{s}.png"))
    print("wrote", s)
