#!/usr/bin/env python3
"""按 layout.json 的锚点裁切某次提交的页面，方便放大查看手写字迹。

用法示例：
  python tools/crop.py --latest --list
  python tools/crop.py --latest --item 46
  python tools/crop.py --sub 20261108-235027-1501 --item 46 --padding 24
  python tools/crop.py --sub 20261108-235027-1501 --page 2 --box 600,120,150,120
  python tools/crop.py --sub 20261108-235027-1501 --page 2 --right-margin

输出默认写到 tmp/，脚本会打印绝对路径。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SUBS_DIR = ROOT / "submissions"
TMP_DIR = ROOT / "tmp"
ID_RE = re.compile(r"^[a-z0-9-]+$")


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        fail(f"文件不存在: {path}")
    except json.JSONDecodeError as exc:
        fail(f"JSON 解析失败: {path}: {exc}")


def latest_submission() -> str:
    if not SUBS_DIR.exists():
        fail(f"提交目录不存在: {SUBS_DIR}")
    dirs = [p for p in SUBS_DIR.iterdir() if p.is_dir() and not p.name.startswith(".")]
    if not dirs:
        fail("还没有任何提交")
    dirs.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return dirs[0].name


def find_page(layout: dict, page_index: int) -> dict:
    for page in layout.get("pages", []):
        if int(page.get("index", 0)) == page_index:
            return page
    fail(f"layout 中没有第 {page_index} 页")


def find_item(layout: dict, number: int):
    for page in layout.get("pages", []):
        for item in page.get("items", []):
            if item.get("number") is not None and int(item["number"]) == number:
                return page, item
    return None, None


def page_png(sub_dir: Path, page_index: int) -> Path:
    path = sub_dir / f"page-{page_index:02d}.png"
    if not path.exists():
        fail(f"页面图片不存在: {path}")
    return path


def crop_box(page: dict, box, padding: int, png_width: int, png_height: int):
    page_w = float(page.get("pageWidth") or 794)
    # layout 里的页面尺寸放在顶层时由调用方补进 page；这里用图片宽高与逻辑宽度的比例。
    logical_w = 794.0
    logical_h = 1123.0
    scale = png_width / logical_w
    x, y, w, h = box
    left = max(0, int((x - padding) * scale))
    top = max(0, int((y - padding) * (png_height / logical_h)))
    right = min(png_width, int((x + w + padding) * scale))
    bottom = min(png_height, int((y + h + padding) * (png_height / logical_h)))
    return left, top, right, bottom


def main() -> None:
    parser = argparse.ArgumentParser(description="按 layout 锚点裁切手写页面")
    parser.add_argument("--sub", help="提交 id；省略时配合 --latest")
    parser.add_argument("--latest", action="store_true", help="使用最近一次提交")
    parser.add_argument("--list", action="store_true", help="列出页面与锚点")
    parser.add_argument("--page", type=int, help="页码（1 起）")
    parser.add_argument("--item", type=int, help="题号，例如 46")
    parser.add_argument("--box", help="页面坐标 x,y,w,h（逻辑坐标 794x1123）")
    parser.add_argument("--right-margin", action="store_true", help="裁切页面右侧批注区")
    parser.add_argument("--padding", type=int, default=16, help="向外扩的像素（逻辑坐标），默认 16")
    parser.add_argument("--out", help="输出文件；默认自动命名")
    args = parser.parse_args()

    sub_id = latest_submission() if args.latest else args.sub
    if not sub_id:
        fail("请提供 --sub <id> 或 --latest")
    if not ID_RE.match(sub_id):
        fail(f"非法提交 id: {sub_id}")
    sub_dir = SUBS_DIR / sub_id
    if not sub_dir.exists():
        fail(f"提交不存在: {sub_dir}")

    meta = read_json(sub_dir / "meta.json")
    layout = read_json(sub_dir / "layout.json")
    print(f"提交: {sub_id}  {meta.get('paperTitle', '')}  状态={meta.get('status')}")
    print(f"页数: {meta.get('pageCount')}  用时: {meta.get('timeSpentSec')}s")

    if args.list:
        for page in layout.get("pages", []):
            items = page.get("items", [])
            numbers = ", ".join(str(i.get("number")) for i in items if i.get("number") is not None)
            print(f"  第 {page.get('index')} 页  {page.get('section', '')}  锚点: {numbers or '-'}")
        return

    if not args.item and not args.box and not args.right_margin:
        fail("请指定 --item、--box 或 --right-margin（或用 --list 查看）")

    if args.item:
        page, item = find_item(layout, args.item)
        if not item:
            fail(f"没有找到题号 {args.item} 的锚点")
        page_index = int(page["index"])
        box = (float(item["x"]), float(item["y"]), float(item["w"]), float(item["h"]))
        label = f"item{args.item}"
    else:
        page_index = args.page
        if not page_index:
            fail("使用 --box/--right-margin 时请同时指定 --page")
        page = find_page(layout, page_index)
        if args.right_margin:
            box = (660.0, 80.0, 84.0, 960.0)
            label = "margin"
        else:
            try:
                parts = [float(v) for v in args.box.split(",")]
            except ValueError:
                fail("--box 格式应为 x,y,w,h")
            if len(parts) != 4:
                fail("--box 格式应为 x,y,w,h")
            box = tuple(parts)
            label = "box"

    png = page_png(sub_dir, page_index)
    image = Image.open(png).convert("RGB")
    left, top, right, bottom = crop_box(page, box, args.padding, image.width, image.height)
    if right <= left or bottom <= top:
        fail("裁切区域为空，请检查坐标")
    crop = image.crop((left, top, right, bottom))

    TMP_DIR.mkdir(parents=True, exist_ok=True)
    out = Path(args.out) if args.out else TMP_DIR / f"{sub_id}-p{page_index:02d}-{label}.png"
    out = out.resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    crop.save(out)
    print(f"已裁切: {out}")
    print(f"尺寸: {crop.width}x{crop.height}（页面原图 {image.width}x{image.height}）")


if __name__ == "__main__":
    main()
