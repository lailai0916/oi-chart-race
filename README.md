<div align="center">
  <h1>OI Chart Race</h1>
  <p>English | <a href="README.zh-Hans.md">简体中文</a></p>
  <p>
    <img src="https://img.shields.io/github/last-commit/lailai0916/oi-chart-race?style=flat-square" />
    <img src="https://img.shields.io/github/languages/top/lailai0916/oi-chart-race?style=flat-square" />
    <img src="https://img.shields.io/github/repo-size/lailai0916/oi-chart-race?style=flat-square" />
    <img src="https://img.shields.io/github/license/lailai0916/oi-chart-race?style=flat-square" />
  </p>
</div>

> An animated 4K bar-chart-race replaying the **school-ranking** history of China's Informatics Olympiad month by month from 2004 to today, driven entirely by [OIerDb](https://oier.baoshuo.dev) public data.

![demo](docs/preview.gif)

> Download the full 4K MP4 from [GitHub Releases](../../releases) (auto-updated every Monday).

## Features

- **Data straight from OIerDb's public repo** — no scraping; the official git submodule is used directly
- **Two scoring formulas** — the official OIerDb exponential decay (`legacy`), or this project's bounded harmonic decay (`v2`); see [`docs/FORMULAS.md`](docs/FORMULAS.md)
- **Genuinely continuous animation** — monotone cubic Hermite splines + Gaussian-smoothed ranks + last-frame swap convergence; no monthly stutter, no half-stuck final frame
- **Smooth 2004 start** — early years had only NOI; milestones are merged into Dec 2005, and 2004 rises smoothly all year
- **Unified dark Apple-Keynote look** — pure-black background + PingFang SC + SF Pro + iOS system colors
- **Province-coded colors** — one color for each of the 19 provinces that ever ranked, maximizing contrast for the dominant ones
- **Contest event ticker** — floats in on NOI/NOIP/CSP/IOI months; a monotone slot algorithm keeps it from dropping back once raised
- **One-command pipeline** — `make video` for the main animation, `make final` for the finished cut with cover + BGM

## Quick Start

```bash
# 0. System dependencies
brew install ffmpeg node                # macOS
# Linux: sudo apt install ffmpeg fonts-noto-cjk && nvm install 20

git clone --recursive https://github.com/lailai0916/oi-chart-race
cd oi-chart-race
make install                            # python venv + npm deps + submodule init

# 1. Render the main animation (4:26, ~250 MB)
make video                              # → output/ranking_race.mp4 (3840×2160 @ 120fps)

# 2. (optional) Post-production: cover + outro + BGM (place a time.mp4 BGM at the repo root)
make final                              # → output/ranking_race_final.mp4 (4:34)
```

All available `make` targets:

```bash
make help          # list all targets
make doctor        # check for unmapped contest types / provinces upstream
make update-data   # pull the latest OIerDb data
make snapshot      # recompute snapshots.parquet only
make json          # export snapshots.json only
make studio        # open Remotion Studio for live preview
make cards         # regenerate the intro / outro PNGs
make final         # compose intro + outro + music into the final cut
make compare       # diff the legacy ↔ v2 formulas over Top-100
make clean         # remove render artifacts
```

## Pipeline

```
                ┌─────────────────────────────────────┐
                │  OIerDb-ng/OIerDb-data-generator    │
                │  (git submodule, AGPL-3.0)          │
                │  • data/raw.txt   ~290k records      │
                │  • static/contests.json  138 events  │
                └────────────────┬────────────────────┘
                                 ▼
        ┌───────────────────────────────────────────────┐
        │  src/snapshot.py    formula = legacy | v2     │
        │  → output/snapshots.parquet  (Top-N × month)  │
        │  → src/export_json.py                         │
        │  → remotion/public/snapshots.json             │
        └────────────────┬──────────────────────────────┘
                         ▼
        ┌───────────────────────────────────────────────┐
        │  remotion/src/BarChartRace.tsx  React + d3    │
        │  • PCHIP / linear interpolation               │
        │  • Gaussian-smoothed ranks + end convergence  │
        │  • province colors · monotone-slot ticker     │
        │  → output/ranking_race.mp4                    │
        └────────────────┬──────────────────────────────┘
                         ▼
        ┌───────────────────────────────────────────────┐
        │  tools/make_cards.py  (PingFang + SF Pro)     │
        │  tools/compose.sh     ffmpeg xfade + BGM      │
        │  → output/ranking_race_final.mp4              │
        └───────────────────────────────────────────────┘
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the detailed design trade-offs.

## Configuration

All tunables live in [`config.json`](./config.json):

```jsonc
{
  "formula": "legacy",            // 'legacy' (OIerDb official) or 'v2' (this project)
  "displayTopN": 30,              // how many ranks to show in the video
  "trackTopN": 50,                // tracking range in the background (≥ displayTopN + buffer)
  "fps": 120,
  "framesPerMonth": 120,          // 1 month = 1 second
  "holdStartSec": 1.5,            // hold time at the start
  "holdEndSec": 3,                // hold time at the end
  "smoothSigmaMonths": 0.15,
  "contestBadge": {
    "leadMonths": 0.3,            // fade-in window width (months)
    "holdMonths": 0.8,            // full-display duration
    "fadeMonths": 1.5,            // fade-out window width
    "tieSpreadMonths": 0.08       // micro-spread for same-month events
  }
}
```

Save and run `make video` to recompute every artifact. Province colors live in [`remotion/src/colors.ts`](remotion/src/colors.ts); the contest → month mapping is in [`src/month_mapping.py`](src/month_mapping.py).

## Two Scoring Formulas

| Dimension | `legacy` (OIerDb official) | `v2` (this project) |
|---|---|---|
| Time factor | exponential `1.25^(year-2000)` | harmonic `1/(1+age/10)` |
| Value range | 0 ~ 2,800,000+ | 0 ~ 20 |
| Historical weight | near zero after 10 years | still 50% after 10 years |
| Scale effect | bigger school → higher score | Top-15 OIers × Top-3 records per school |
| Long tail | participation awards count | zeroed beyond 30% |
| Explainability | three-step lookup + Decimal | a single formula |

See [`docs/FORMULAS.md`](docs/FORMULAS.md) for the full rationale, field definitions, and how to add your own formula.

## Post-production

`make final` wraps the rendered main animation into a finished cut:

- Intro card (6s, PingFang SC + SF Pro, 2004 — 2026)
- Main animation (duration auto-probed via ffprobe; no script change needed after editing `framesPerMonth`)
- Outro card (6s, OIerDb data source + project link)
- Full background music (bring your own `time.mp4` at the repo root; copyrighted, **not** committed to this repo)

All tunables (fades, volume, CRF, preset, etc.) are at the top of [`tools/compose.sh`](tools/compose.sh) and can be overridden with environment variables:

```bash
BGM_START=30 MUSIC_VOL=0.7 AFADE_OUT=8 make final
```

## License

**AGPL-3.0-or-later** — at runtime this project `import`s modules from the upstream `OIerDb-ng/OIerDb-data-generator` (AGPL-3.0), forming a derivative work that must use the same license. See [`LICENSE`](LICENSE) for the full text.

## Credits

- **Data + official formula**: [OIerDb-ng](https://github.com/OIerDb-ng), maintained by [@renbaoshuo (Baoshuo)](https://github.com/renbaoshuo)
- **Visualization stack**: [Remotion](https://www.remotion.dev/) + [d3](https://d3js.org/)
- **Fonts**: PingFang SC + Apple SF Pro

If you use frames generated by this project in a paper / video / media, please credit the sources above. Thanks 🙏

## Citing

```bibtex
@misc{oi_chart_race,
  title  = {OI Chart Race: animated visualisation of Chinese OI school history},
  author = {lailai0916},
  year   = {2026},
  howpublished = {\url{https://github.com/lailai0916/oi-chart-race}},
  note   = {Data from OIerDb (https://github.com/OIerDb-ng), AGPL-3.0-or-later}
}
```
