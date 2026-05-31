"""Compute monthly Top-N school snapshots from the OIerDb dataset.

Two scoring formulas are available — choose with ``--formula``:

  legacy
    The official OIerDb formula. For every record::

        contribution = decay(year) × rank_coef(rank, total) × type_coef(type)

    where ``decay(y) = 1.25^(y − 2000)``. School score = Σ contributions of
    every record at that school. Scores grow exponentially over time.

  v2
    A bounded harmonic-decay proposal. Per-record value::

        V(r) = W(type) × Q(rank, total) × T(age)
        Q(rank, total) = max(0, 1 − rank/(0.3·total))²       # only top 30%
        T(age)         = 1 / (1 + age/10)                    # 10-year half-ish

    Aggregation truncates to keep small/quality schools competitive::

        score(school) = Σ_{top-15 OIers at school}( Σ_{top-3 records} V(r) )

Output schema (parquet, same for both formulas)::

    month  rank  school_id  school_name  province  city  score

Default formula and "track-top-N" buffer come from ``config.json`` at the
repository root.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Callable

import pandas as pd
from tqdm import tqdm

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_GEN_DIR = REPO_ROOT / "data_sources" / "OIerDb-data-generator"

sys.path.insert(0, str(REPO_ROOT / "src"))
sys.path.insert(0, str(DATA_GEN_DIR))

from month_mapping import nominal_month  # noqa: E402
from config_loader import load_config  # noqa: E402

CONFIG = load_config()


# ─── shared: dataset loading ─────────────────────────────────────────────────
def load_oierdb_dataset():
    """Parse the upstream data-generator's input files.

    Skips the upstream ``attempt_merge`` step — both school-level scoring
    formulas sum/aggregate over records, so OIer identity merges don't
    change the result, and skipping saves a few minutes per run.
    """
    cwd = os.getcwd()
    os.chdir(DATA_GEN_DIR)
    try:
        import util  # noqa: F401  — populates Contest registry on import
        from contest import Contest
        from oier import OIer
        from school import School

        with open("data/school.txt", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                parts = line.split(",")
                if len(parts) < 3:
                    continue
                province, city, name, *aliases = parts
                School.create(name, province, city, aliases)

        with open("data/raw.txt", encoding="utf-8") as f:
            raw_lines = f.readlines()

        for line in tqdm(raw_lines, desc="parse raw.txt", unit="line"):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            fields = line.split(",")
            if len(fields) != 9:
                continue
            (contest_name, level, name, grade_name, school_name,
             score, province, gender_name, identifier) = fields
            if name == "":
                continue
            try:
                contest = Contest.by_name(contest_name)
            except ValueError:
                continue
            try:
                school = School.by_name_in_province(school_name, province)
            except ValueError:
                try:
                    school = School.by_name(school_name)
                except ValueError:
                    continue
            grades = util.get_grades(grade_name) if grade_name else 0
            gender = {"男": 1, "女": -1}.get(gender_name, 0)
            if not Contest.is_score_valid(score):
                continue
            oier = OIer.of(name, identifier)
            record = contest.add_contestant(
                oier, score, level, grades, school, province, gender
            )
            oier.add_record(record)

        return util, Contest.get_all(), School.get_all()
    finally:
        os.chdir(cwd)


def month_iter(start: date, end: date):
    """Yield first-of-month dates from start to end inclusive."""
    y, m = start.year, start.month
    while True:
        cur = date(y, m, 1)
        if cur > end:
            return
        yield cur
        m += 1
        if m == 13:
            m = 1
            y += 1


# ─── legacy formula ──────────────────────────────────────────────────────────
def _legacy_prepare(util, contests):
    """Pre-compute per-record (date, school_id, contribution) tuples.

    Contribution is invariant of the cutoff time → we can sweep cumulatively.
    """
    items = []
    for contest in contests:
        nm = nominal_month(contest.type)
        d = date(contest.year, nm, 1)
        n_total = contest.n_contestants()
        dc = util.decay_coefficient(contest.year)
        tc = util.contest_type_coefficient(contest.type)
        for rec in contest.contestants:
            rc = util.rank_coefficient(rec.rank, n_total)
            items.append((d, rec.school.id, dc * rc * tc))
    items.sort(key=lambda t: t[0])
    return items


def _legacy_build(items, schools_by_id, months, top_n):
    cumulative: dict[int, float] = defaultdict(float)
    idx = 0
    rows = []
    for cutoff in tqdm(months, desc="legacy snapshots"):
        while idx < len(items) and items[idx][0] <= cutoff:
            _, sid, delta = items[idx]
            cumulative[sid] += float(delta)
            idx += 1
        if not cumulative:
            continue
        top = sorted(cumulative.items(), key=lambda kv: -kv[1])[:top_n]
        for rank, (sid, score) in enumerate(top, start=1):
            s = schools_by_id[sid]
            rows.append({
                "month": cutoff,
                "rank": rank,
                "school_id": sid,
                "school_name": s.name,
                "province": s.province,
                "city": s.city,
                "score": round(score, 2),
            })
    return pd.DataFrame(rows)


# ─── v2 formula ──────────────────────────────────────────────────────────────
V2_TYPE_WEIGHTS: dict[str, float] = {
    "IOI": 1.5,
    "NOI": 1.0,
    "NOID类": 0.75,
    "WC": 0.5,
    "APIO": 0.4,
    "CTSC": 0.3,
    "NGOI": 0.2,
    "NOIST": 0.2,
    "NOIP": 0.15,
    "NOIP提高": 0.15,
    "CSP提高": 0.15,
    "NOIP普及": 0.05,
    "CSP入门": 0.05,
}

V2_TOP_RECORDS_PER_OIER = 3
V2_TOP_OIERS_PER_SCHOOL = 15


def _v2_prepare(util, contests):
    """Pre-compute per-record items with the W·Q product (T applied per-cutoff).

    Records past the 30%-rank threshold are dropped (Q = 0 anyway).
    """
    del util  # unused by v2
    items = []
    for contest in contests:
        if contest.type not in V2_TYPE_WEIGHTS:
            continue
        w = V2_TYPE_WEIGHTS[contest.type]
        nm = nominal_month(contest.type)
        d = date(contest.year, nm, 1)
        n = contest.n_contestants()
        threshold = 0.3 * n
        if threshold <= 0:
            continue
        for rec in contest.contestants:
            if rec.rank > threshold:
                continue
            x = 1.0 - rec.rank / threshold
            q = x * x
            wq = w * q
            if wq <= 0:
                continue
            items.append((d, contest.year, id(rec.oier), rec.school.id, wq))
    items.sort(key=lambda t: t[0])
    return items


def _v2_build(items, schools_by_id, months, top_n):
    rows = []
    for cutoff in tqdm(months, desc="v2 snapshots"):
        ref_year = cutoff.year  # T(age) is per-year

        pair_records: dict[tuple[int, int], list[float]] = defaultdict(list)
        for (d, year, oier_id, sid, wq) in items:
            if d > cutoff:
                break
            t = 1.0 / (1.0 + (ref_year - year) / 10.0)
            pair_records[(oier_id, sid)].append(wq * t)

        if not pair_records:
            continue

        # Top-3 records per (oier, school) pair
        pair_scores: dict[tuple[int, int], float] = {}
        for key, vs in pair_records.items():
            vs.sort(reverse=True)
            pair_scores[key] = sum(vs[:V2_TOP_RECORDS_PER_OIER])

        # Top-15 OIer-school pairs per school
        school_pool: dict[int, list[float]] = defaultdict(list)
        for (_, sid), p in pair_scores.items():
            school_pool[sid].append(p)
        scores: dict[int, float] = {}
        for sid, pool in school_pool.items():
            pool.sort(reverse=True)
            scores[sid] = sum(pool[:V2_TOP_OIERS_PER_SCHOOL])

        top = sorted(scores.items(), key=lambda kv: -kv[1])[:top_n]
        for rank, (sid, score) in enumerate(top, start=1):
            s = schools_by_id[sid]
            rows.append({
                "month": cutoff,
                "rank": rank,
                "school_id": sid,
                "school_name": s.name,
                "province": s.province,
                "city": s.city,
                "score": round(float(score), 4),
            })
    return pd.DataFrame(rows)


# ─── formula registry ───────────────────────────────────────────────────────
FORMULAS: dict[str, dict] = {
    "legacy": {
        "description": "OIerDb official: Σ decay × rank_coef × type_coef "
                       "(exponential growth, no truncation)",
        "prepare": _legacy_prepare,
        "build": _legacy_build,
    },
    "v2": {
        "description": "Bounded harmonic: top-15 OIers × top-3 records, "
                       "T(age) = 1/(1+age/10)",
        "prepare": _v2_prepare,
        "build": _v2_build,
    },
}


# ─── CLI entry point ─────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--formula",
        choices=sorted(FORMULAS),
        default=CONFIG.get("formula", "v2"),
        help="Scoring formula (default from config.json)",
    )
    parser.add_argument(
        "--top",
        type=int,
        default=CONFIG.get("trackTopN", 50),
        help="Track this many ranks per month "
             "(animation displays config.displayTopN; extras are a buffer)",
    )
    parser.add_argument("--start", default="2004-01", help="YYYY-MM")
    parser.add_argument("--end",   default=None,      help="YYYY-MM (default: last contest)")
    parser.add_argument(
        "--out",
        default=str(REPO_ROOT / "output" / "snapshots.parquet"),
    )
    args = parser.parse_args()

    f = FORMULAS[args.formula]
    print(f"▶ Formula: {args.formula} — {f['description']}", file=sys.stderr)

    sy, sm = map(int, args.start.split("-"))
    start_date = date(sy, sm, 1)

    print("▶ Loading OIerDb dataset...", file=sys.stderr)
    util, contests, schools = load_oierdb_dataset()
    print(f"  {len(contests)} contests, {len(schools)} schools", file=sys.stderr)
    schools_by_id = {s.id: s for s in schools}

    print("▶ Pre-computing record contributions...", file=sys.stderr)
    items = f["prepare"](util, contests)
    print(f"  {len(items)} records survive the formula's filters", file=sys.stderr)

    if args.end:
        ey, em = map(int, args.end.split("-"))
        end_date = date(ey, em, 1)
    else:
        end_date = max(item[0] for item in items)

    months = list(month_iter(start_date, end_date))
    print(f"▶ Building snapshots {start_date} → {end_date} "
          f"({len(months)} months, top-{args.top})...", file=sys.stderr)

    df = f["build"](items, schools_by_id, months, args.top)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out_path, index=False)
    print(f"✓ Wrote {len(df)} rows ({df['month'].nunique()} months) → {out_path}",
          file=sys.stderr)

    # Print the final month's Top 20 as a sanity check
    print("\nFinal-month Top 20:")
    final = df[df["month"] == df["month"].max()].sort_values("rank").head(20)
    for _, r in final.iterrows():
        print(f"  {r['rank']:>3}. {r['school_name']:<32} {r['province']:<6} "
              f"{r['score']:>14,.2f}")


if __name__ == "__main__":
    main()
