# Scoring formulas

This project supports **two scoring formulas**, selectable in
[`config.json`](../config.json) (`"formula": "legacy" | "v2"`) or per-run on
the command line (`make snapshot` honours the config; `python src/snapshot.py
--formula v2` overrides). Both produce the same parquet schema, so the rest
of the pipeline doesn't care which one is active.

---

## `legacy` — OIerDb's official formula

For every contest record (one OIer × one contest), compute:

$$
\text{contrib}(r) \;=\; \underbrace{1.25^{\,year-2000}}_{\text{decay}}
                       \times \underbrace{\text{rc}(rank, total)}_{\text{rank coef}}
                       \times \underbrace{\text{tc}(type)}_{\text{type coef}}
$$

A school's score is the unweighted sum over **every** record at that school.

### Pieces

| Piece | Definition | Notes |
|---|---|---|
| `decay(y)` | `1.25 ** (y − 2000)` | **Exponential growth**, doubles every 3.1 years. |
| `rc(rank, total)` | 401-entry lookup table | Top 1 → 100, fading roughly linearly; bottom ¼ → ≈0. |
| `tc(type)` | `static/scoring.json` | NOI=1.0, IOI=0.6, NOIP=0.15, CSP-J=0.06, … |

### Properties

- **Reproduces oier.baoshuo.dev exactly** (verified ±0 for current Top 20).
- Score scales explode: top schools today are at ~2.6 million, will be at ~250 million in 2050.
- Schools that won big contests in 2008 are essentially valued at zero compared to a NOIP 二等奖 last year.
- Rewards both quality and **sheer volume** of participation.

### What this is good for

- Reproducing the reference site.
- Visualising "current strength" trends — the exponential decay weights recent results heavily.

---

## `v2` — bounded harmonic-decay (project proposal)

Per-record value:

$$
V(r) \;=\; \underbrace{W(type)}_{\text{contest weight}}
           \times \underbrace{Q(rank, total)}_{\text{rank quality}}
           \times \underbrace{T(age)}_{\text{time factor}}
$$

Per-school aggregation (the **truncation** is the key idea):

$$
\text{score}(S) \;=\; \sum_{\text{top-15 OIers at }S} \Bigl(\sum_{\text{top-3 records}} V(r)\Bigr)
$$

### Pieces

| Piece | Definition | Tuned for |
|---|---|---|
| `W(type)` | 13-row dict in [`src/snapshot.py`](../src/snapshot.py) | IOI=1.5, NOI=1.0, NOIP/CSP-S=0.15, NOIP/CSP-J=0.05 (slightly recalibrated). |
| `Q(rank, total)` | `max(0, 1 − rank/(0.3·total))²` | **Only top 30% scores**, drops to zero past that — kills "participation prize" inflation. |
| `T(age)` | `1 / (1 + age/10)` | Harmonic decay, **never zero**. 10 years ≈ 50%; 50 years ≈ 17%. |
| Top-3 / Top-15 truncation | constants in code | Caps the contribution of any single student or large school. |

### Properties

- Scores are **bounded** (~5–50 range observed). No exponential explosion.
- Historical achievements still count: a 2008 NOI gold is worth ~33% of an equivalent 2024 gold (vs. ~3% in legacy).
- Schools with **few but elite** OIers are favoured (e.g., 宁波镇海中学 jumps from rank 35 → 2).
- Schools driven by **mass NOIP participation** lose ground (e.g., 芜湖市第二十七中学 falls from rank 22 → 122).
- Less sensitive to "school selectivity" — a school admitting 100 OI students cannot stockpile contributions beyond its top 15.

### What this is good for

- A "philosophically defensible" all-time school ranking.
- Comparable scales across decades (good for video, papers, comparisons).
- Recognising historic powerhouses whose strength has faded but achievements still merit acknowledgement.

### What this is not

- Not OIerDb's official position. Don't quote `v2` scores as if they were on oier.baoshuo.dev.
- Parameters (`0.3` for the rank cut, `1.5`/`1.0` weights, `Top-3`/`Top-15`) are reasonable starting points, not hard truths.

---

## Comparing the two

Run:

```bash
make compare    # → tools/compare_formulas.py
```

This prints, for the final month of the dataset:

- How many schools appear in both formulas' Top 100
- Top 5 schools that **rose** the most in rank under v2
- Top 5 schools that **fell** the most
- Schools newly entering / dropping out of Top 100

For our most recent run, 82 of 100 schools were shared and the most dramatic
movements were:

| Movement | School | Change | Why |
|---|---|---|---|
| ↑ +33 | 宁波市镇海中学 | rank 35 → 2 | Historic NOI/IOI density; legacy formula dec-discounted them. |
| ↓ −47 | 北京市第一零一中学 | rank 40 → 87 | Mass NOIP participation; v2 truncates volume. |
| Out | 芜湖市第二十七中学 | rank 22 → 122 | Pure NOIP-volume school. |
| In  | 南京师范大学附属中学 | rank 107 → 41 | Elite-focused; benefits from top-3/top-15 caps. |

---

## Adding your own formula

Drop a new entry into `FORMULAS` in [`src/snapshot.py`](../src/snapshot.py):

```python
FORMULAS["my_idea"] = {
    "description": "Brief one-line summary",
    "prepare": _my_prepare,   # contests → sorted [(date, ...)]
    "build":   _my_build,     # (items, schools_by_id, months, top_n) → DataFrame
}
```

The shared `load_oierdb_dataset()` and `month_iter()` helpers are available;
match the `prepare`/`build` signatures of the existing formulas.
