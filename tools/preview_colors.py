#!/usr/bin/env python3
"""Render a 4K swatch preview of the province color system so you can judge
the palette on the chart's actual #000 background — without re-rendering
the full 4-minute video.

The bars are drawn at widths proportional to each province's NOI-gold count,
so what you see is roughly what the bar race will look like in motion::

    python3 tools/preview_colors.py
"""
import json
import re
from pathlib import Path
from collections import Counter

from PIL import Image, ImageDraw, ImageFont

# Re-use the cards' font resolver / palette / layout helpers
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from make_cards import cjk, latin, BG, INK, INK_SOFT, INK_MUTE, ACCENT  # noqa: E402

W, H = 3840, 2160
ROOT = Path(__file__).resolve().parent.parent
COLORS_TS = ROOT / "remotion" / "src" / "colors.ts"
OUT = ROOT / "output" / "swatch_preview.png"


# ─── Parse PROVINCE_COLORS straight from colors.ts (single source of truth) ──
def load_colors():
    src = COLORS_TS.read_text(encoding="utf-8")
    pattern = re.compile(r"'([一-鿿]+)':\s*'(#[0-9A-Fa-f]{6})'")
    seen = []
    out = []
    for m in pattern.finditer(src):
        if m.group(1) in seen:
            continue
        seen.append(m.group(1))
        out.append((m.group(1), m.group(2)))
    return out


# ─── NOI gold counts (same logic as previous stats runs) ─────────────────────
def load_noi_gold():
    base = ROOT / "data_sources" / "OIerDb-data-generator"
    with open(base / "static" / "contests.json", encoding="utf-8") as f:
        ctype = {c["name"]: c["type"] for c in json.load(f)}
    school_prov = {}
    with open(base / "data" / "school.txt", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split(",")
            if len(parts) >= 3:
                school_prov[parts[2]] = parts[0]
                for alias in parts[3:]:
                    school_prov[alias] = parts[0]
    gold = Counter()
    with open(base / "data" / "raw.txt", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split(",")
            if len(parts) != 9:
                continue
            if ctype.get(parts[0]) == "NOI" and parts[1] == "金牌":
                gold[school_prov.get(parts[4], "?")] += 1
    return gold


# ─── Layout ──────────────────────────────────────────────────────────────────
def render():
    palette = load_colors()
    gold = load_noi_gold()
    max_gold = max(gold.values()) if gold else 1

    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    # Title strip (mirrors the title-card design language)
    d.text((W // 2, 110), "PROVINCE  COLOR  SYSTEM", fill=INK_SOFT,
           font=latin(40, weight=500), anchor="mm")
    d.text((W // 2, 180), "省份配色 · 按 NOI 金牌降序",
           fill=INK, font=cjk(58, semibold=True), anchor="mm")

    # Grid: two columns, 12 rows each.
    rows_per_col = 12
    col_w = W // 2
    margin_x, margin_top, margin_bot = 240, 290, 90
    grid_h = H - margin_top - margin_bot
    row_h = grid_h // rows_per_col

    # Pre-sort by NOI gold descending; provinces with 0 gold sort last.
    ordered = sorted(palette, key=lambda kv: -gold.get(kv[0], 0))

    bar_max = col_w - margin_x - 580   # max bar width in pixels

    for i, (prov, hex_) in enumerate(ordered):
        col = i // rows_per_col
        row = i % rows_per_col
        y = margin_top + row * row_h + row_h // 2

        # Rank
        x_rank = col * col_w + margin_x // 2
        d.text((x_rank, y), f"{i + 1:02d}", fill=INK_MUTE,
               font=latin(36, weight=400), anchor="rm")

        # Province name
        x_name = col * col_w + margin_x
        d.text((x_name, y), prov, fill=INK,
               font=cjk(54, semibold=True), anchor="lm")

        # Bar
        n = gold.get(prov, 0)
        bw = max(8, int(bar_max * (n / max_gold)))
        x_bar = col * col_w + margin_x + 240
        bar_h = 40
        d.rounded_rectangle(
            [x_bar, y - bar_h // 2, x_bar + bw, y + bar_h // 2],
            radius=4, fill=hex_,
        )

        # NOI gold count
        x_count = x_bar + bw + 16
        d.text((x_count, y), str(n), fill=INK_SOFT,
               font=latin(34, weight=500), anchor="lm")

        # Hex code (right-edge of column)
        x_hex = (col + 1) * col_w - margin_x // 4
        d.text((x_hex, y), hex_.upper(), fill=INK_MUTE,
               font=latin(28, weight=400), anchor="rm")

    OUT.parent.mkdir(exist_ok=True)
    img.save(OUT, "PNG", optimize=True)
    print(f"✓ {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    render()
