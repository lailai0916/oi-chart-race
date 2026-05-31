# Architecture

A small project, but a few non-obvious design decisions are worth recording.

## Data flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│  OIerDb-data-generator/  (git submodule, AGPL-3.0)        │
│  • data/raw.txt        ~293 000 award records                          │
│  • data/school.txt     ~13 800 schools + alias merges                  │
│  • static/contests.json  138 contests, type/year/full-score            │
│  • util.py / oier.py / …  the official scoring code                    │
└────────────────────────────┬────────────────────────────────────────────┘
                             ▼
        ┌─────────────────────────────────────────────────────┐
        │  src/snapshot.py                                    │
        │   • load_oierdb_dataset()                           │
        │   • FORMULAS['legacy' | 'v2']                       │
        │   • for each month → compute Top-N → DataFrame      │
        └────────────────────────────┬────────────────────────┘
                                     ▼
                       output/snapshots.parquet
                                     │
                                     ▼
        ┌─────────────────────────────────────────────────────┐
        │  src/export_json.py                                 │
        │   parquet + contests + nominal-month mapping        │
        │     → compact JSON the bundler can `import`         │
        └────────────────────────────┬────────────────────────┘
                                     ▼
                  remotion/public/snapshots.json
                                     │
                                     ▼
        ┌─────────────────────────────────────────────────────┐
        │  remotion/src/BarChartRace.tsx (React + d3)         │
        │   • PCHIP & linear interpolation                    │
        │   • Gaussian-smoothed rank trajectory               │
        │   • Province palette, contest event badges          │
        └────────────────────────────┬────────────────────────┘
                                     ▼
                     output/ranking_race.mp4
```

Everything below `OIerDb-data-generator/` is **regenerable**. Nothing in `output/`
or `remotion/public/snapshots.json` should be committed.

## Why a shared `config.json`?

Both Python and TypeScript read the same file:

- Python via [`src/config_loader.py`](../src/config_loader.py) → `json.load`.
- Remotion via TypeScript's `import config from '../../config.json'`. The
  bundler resolves it at build time, so `Root.tsx` can use `config.fps` to
  compute `durationInFrames` without an async fetch.

This avoids the classic "data and animation disagree" bug.

## Why split snapshot computation from JSON export?

Two reasons:

1. **Caching.** Snapshot computation takes ~5 s of pure CPU (a million-or-two
   tuples). JSON export is < 1 s. Keeping them separate means `make json`
   doesn't recompute scores when you only changed the export shape.
2. **Parquet for analysis, JSON for animation.** parquet is far more
   pleasant to inspect with pandas; JSON is what Remotion needs.

## Animation: continuous-rank trick

The naive approach — recompute rank at every video frame and snap rows to
integer Y positions — produces visually jarring frame-to-frame swaps.

What we do instead, in [`BarChartRace.tsx`](../remotion/src/BarChartRace.tsx):

1. **Pre-sample** discrete sort-ranks at 4×/month resolution over the entire
   timeline (`buildDerived`, one pass).
2. **Gaussian-smooth** each track's rank trajectory with σ = `config.smoothSigmaMonths`.
3. **Linearly interpolate** the smoothed-rank array at the current frame.

The result: schools sit on integer rows 95% of the time, but during a swap
they slide past each other over roughly ±2σ months. Combined with a tight σ
(0.15) this reads as a crisp "snap-then-settle", not a wobble.

Scores are interpolated separately, between **annual milestones**
(December of each year + first + last months), with pure linear interpolation.
This gives the "GDP/population chart" look: bars grow at constant velocity
within a year, year-boundary velocity changes are subtle.

## Contest event badges

For each frame, badges fade in/out based on the gap between the current
month-float and each contest's nominal date:

- Within `±fullMonths` → opacity 1 (smoothed by `smoothstep`)
- Within `±goneMonths` → opacity 0 → 1 ramp
- Beyond → not rendered

A small `translateY` adds a subtle rise-into-place motion. Both knobs live
in `config.json` under `contestBadge`.

## Colour: per-province

[`colors.ts`](../remotion/src/colors.ts) maps each of the 19 provinces that
have ever placed a school in Top 30 to a distinct hue, chosen for maximum
separation among the top contributors:

| Tier | Provinces | Colour family |
|---|---|---|
| 1 (≥6 schools) | 广东, 浙江, 福建, 江苏 | red, orange, green, blue |
| 2 (4 schools)  | 安徽, 湖南, 北京     | yellow, pink, purple |
| 3 (3 schools)  | 上海, 四川, 山东     | teal, indigo, mint |
| 4 (2 schools)  | 湖北, 河北           | brown, coral |
| 5 (1 school)   | 重庆, 新疆, 海南, 山西, 天津, 吉林, 陕西 | tonal variations |

Provinces that have never placed a school are not in the map (`#8E8E93`
grey fallback). Add new entries as the dataset evolves.

## Why submodule and not vendor?

We rely on the upstream's exact `util.py`/`oier.py`/etc. via Python `import`.
Vendoring would risk drifting from upstream; a submodule keeps us pinned but
upgradable in one command (`make update-data`).

It also makes the licence chain unambiguous: we are clearly a derivative work
of an AGPL-3.0 project, so we are AGPL-3.0 ourselves.

## Failure modes & fallbacks

| Failure | Behaviour |
|---|---|
| Upstream adds a new contest type | Snapshot silently drops those records. `make doctor` warns at build time. |
| Upstream adds a school whose province is not in `colors.ts` | Bar renders with the grey fallback colour. |
| `OIerDb-data-generator/` submodule uninitialised | `make doctor` warns; snapshot would fail with a clearer error. |
| Fonts missing on Linux | `noto-cjk` covers the Chinese; install via `apt install fonts-noto-cjk`. CI workflow does this automatically. |
