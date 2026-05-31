#!/usr/bin/env python3
"""Generate the intro + outro title cards for the final video composite.

Pure-black 4K stills in the same Apple-keynote palette as the chart itself,
used as the open/close of ``output/ranking_race_final.mp4`` (see
``tools/compose.sh``).

Typography mirrors the chart: Chinese in **PingFang SC**, Latin/digits in
**SF Pro**.  Both ship with macOS; on Linux we fall back to Noto Sans CJK /
DejaVu so the script still runs in CI.  Run::

    python3 tools/make_cards.py
"""
import glob
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# Canvas + palette (mirrors COLORS in remotion/src/BarChartRace.tsx) ──────────
W, H = 3840, 2160
BG = (0, 0, 0)
INK = (242, 244, 248)        # bright white
INK_SOFT = (154, 160, 170)   # soft gray
INK_MUTE = (92, 99, 112)     # mute gray
ACCENT = (10, 132, 255)      # iOS system blue

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "output"


# ─── Font resolution ─────────────────────────────────────────────────────────
def _find_pingfang():
    """PingFang.ttc lives in a hashed AssetsV2 bundle on modern macOS."""
    hits = glob.glob(
        "/System/Library/AssetsV2/com_apple_MobileAsset_Font*/**/PingFang.ttc",
        recursive=True,
    )
    for p in hits + ["/System/Library/Fonts/PingFang.ttc", "/Library/Fonts/PingFang.ttc"]:
        if Path(p).exists():
            return p
    return None


# PingFang.ttc face indices: 3 = SC Regular, 7 = SC Medium, 11 = SC Semibold.
_PINGFANG = _find_pingfang()
_PINGFANG_REG, _PINGFANG_SEMI = 3, 11

# CJK fallbacks (Linux / no-PingFang) as (path, index).
_CJK_REG_FALLBACK = [
    ("/System/Library/Fonts/Hiragino Sans GB.ttc", 0),
    ("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", 0),
    ("/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf", 0),
]
_CJK_SEMI_FALLBACK = [
    ("/System/Library/Fonts/Hiragino Sans GB.ttc", 1),
    ("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", 0),
    ("/usr/share/fonts/opentype/noto/NotoSansCJKsc-Bold.otf", 0),
]

# SF Pro = the system font SFNS.ttf (variable; Weight axis 1–1000).
_SF_PRO = "/System/Library/Fonts/SFNS.ttf"
_LATIN_FALLBACK = [
    "/System/Library/Fonts/Helvetica.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]


def _first_existing(cands):
    for c in cands:
        path = c[0] if isinstance(c, tuple) else c
        if Path(path).exists():
            return c
    return None


def cjk(size, semibold=False):
    """PingFang SC, falling back to Hiragino / Noto."""
    if _PINGFANG:
        return ImageFont.truetype(
            _PINGFANG, size, index=_PINGFANG_SEMI if semibold else _PINGFANG_REG
        )
    hit = _first_existing(_CJK_SEMI_FALLBACK if semibold else _CJK_REG_FALLBACK)
    if not hit:
        raise SystemExit("✗ no CJK font found (PingFang / Hiragino / Noto).")
    return ImageFont.truetype(hit[0], size, index=hit[1])


def latin(size, weight=400):
    """SF Pro at an explicit weight (variable-font axis), falling back gracefully."""
    if Path(_SF_PRO).exists():
        f = ImageFont.truetype(_SF_PRO, size)
        try:
            vals = []
            for ax in f.get_variation_axes():
                name = ax["name"].decode() if isinstance(ax["name"], bytes) else ax["name"]
                if name == "Weight":
                    vals.append(weight)
                elif name == "Optical Size":
                    vals.append(min(max(size, ax["minimum"]), ax["maximum"]))
                else:
                    vals.append(ax["default"])
            f.set_variation_by_axes(vals)
        except Exception:
            pass  # static fallback: default instance
        return f
    hit = _first_existing(_LATIN_FALLBACK)
    if not hit:
        raise SystemExit("✗ no Latin font found (SF Pro / Helvetica / DejaVu).")
    return ImageFont.truetype(hit, size)


# ─── Layout system ───────────────────────────────────────────────────────────
# A shared vertical grid so the two cards read as bookends of one system:
#   eyebrow (tracked label) · hero (the one focal word) · accent hairline · meta
CX = W // 2                 # horizontal centre
EYEBROW_CY = 742            # vertical centre of the eyebrow label
HERO_CY = 968               # vertical centre of the hero line
RULE_CY = 1158              # accent hairline — sits in the river between hero & meta
META_CY = 1280              # vertical centre of the meta line
RULE_W, RULE_H = 132, 3     # hairline width / thickness (4K px)


def line(draw, text, cy, font, fill, tracking=0.0):
    """Horizontally-centred line, vertically centred on `cy`.

    Uses glyph advance widths (textlength) for correct optical tracking, and
    PIL text anchors so the baseline maths is exact at any size.
    """
    if tracking == 0:
        draw.text((CX, cy), text, fill=fill, font=font, anchor="mm")
        return
    advances = [draw.textlength(ch, font=font) for ch in text]
    total = sum(advances) + tracking * (len(text) - 1)
    x = CX - total / 2
    for ch, adv in zip(text, advances):
        draw.text((x, cy), ch, fill=fill, font=font, anchor="lm")
        x += adv + tracking


def hairline(draw, cy, color=ACCENT, width=RULE_W, thick=RULE_H):
    x0 = CX - width / 2
    y0 = cy - thick / 2
    draw.rounded_rectangle([x0, y0, x0 + width, y0 + thick], radius=thick / 2, fill=color)


# ─── Cards ───────────────────────────────────────────────────────────────────
def title_card():
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    line(d, "2004 — 2026", EYEBROW_CY, latin(50, weight=500), INK_SOFT, tracking=28)
    line(d, "信息学奥林匹克竞赛", HERO_CY, cjk(232, semibold=True), INK, tracking=10)
    hairline(d, RULE_CY)
    line(d, "学校评分排名", META_CY, cjk(58), INK_SOFT, tracking=22)
    img.save(OUT / "title_card.png", "PNG", optimize=True)
    print("✓ output/title_card.png")


def end_card():
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    line(d, "数 据 来 源", EYEBROW_CY, cjk(50), INK_SOFT, tracking=24)
    line(d, "OIerDb", HERO_CY, latin(248, weight=600), INK)
    hairline(d, RULE_CY)
    line(d, "github.com/lailai0916/oi-chart-race", META_CY, latin(56, weight=400), INK_SOFT, tracking=4)
    img.save(OUT / "end_card.png", "PNG", optimize=True)
    print("✓ output/end_card.png")


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    src = _PINGFANG or "(fallback CJK)"
    print(f"  CJK  → {src}")
    print(f"  Latin→ {_SF_PRO if Path(_SF_PRO).exists() else '(fallback)'}")
    title_card()
    end_card()
