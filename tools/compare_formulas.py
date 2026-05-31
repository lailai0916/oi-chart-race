"""One-off: compute final-month (2026-05) Top 100 under BOTH the legacy and
the proposed v2 formulas and report the schools that moved the most.

Both formulas use the same raw record set; only the per-record value and the
per-school aggregation differ.
"""

from __future__ import annotations

import os
import sys
from collections import defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_GEN_DIR = REPO_ROOT / "data_sources" / "OIerDb-data-generator"
sys.path.insert(0, str(REPO_ROOT / "src"))
sys.path.insert(0, str(DATA_GEN_DIR))

# Reuse the unified snapshot script's data loader + v2 weights
from snapshot import load_oierdb_dataset, V2_TYPE_WEIGHTS as W_V2

# Reference year for the v2 time factor; matches our animation endpoint.
REF_YEAR = 2026


def legacy_school_scores(util, contests):
    """Replicate the official OIerDb formula: Σ decay × rank_coef × type_coef."""
    scores = defaultdict(float)
    for c in contests:
        dc = util.decay_coefficient(c.year)
        tc = util.contest_type_coefficient(c.type)
        if tc == 0:
            continue
        n = c.n_contestants()
        for rec in c.contestants:
            rc = util.rank_coefficient(rec.rank, n)
            scores[rec.school.id] += float(dc * rc * tc)
    return scores


def v2_school_scores(contests, ref_year=REF_YEAR,
                    top_records_per_oier=3, top_oiers_per_school=15):
    """Proposed bounded formula with top-3/top-15 truncation."""
    # Aggregate per (oier_id, school_id)
    pair_v = defaultdict(list)
    for c in contests:
        if c.type not in W_V2:
            continue
        w = W_V2[c.type]
        n = c.n_contestants()
        threshold = 0.3 * n
        if threshold <= 0:
            continue
        t = 1.0 / (1.0 + (ref_year - c.year) / 10.0)
        for rec in c.contestants:
            if rec.rank > threshold:
                continue
            x = 1.0 - rec.rank / threshold
            q = x * x
            v = w * q * t
            if v > 0:
                pair_v[(id(rec.oier), rec.school.id)].append(v)

    # Top-3 per (oier, school)
    pair_top3 = {}
    for key, vs in pair_v.items():
        vs.sort(reverse=True)
        pair_top3[key] = sum(vs[:top_records_per_oier])

    # Aggregate by school: top-15 OIers
    school_oier_pool = defaultdict(list)
    for (oier_id, sid), p in pair_top3.items():
        school_oier_pool[sid].append(p)
    scores = {}
    for sid, pool in school_oier_pool.items():
        pool.sort(reverse=True)
        scores[sid] = sum(pool[:top_oiers_per_school])
    return scores


def main():
    print("[1/3] Loading OIerDb dataset...", file=sys.stderr)
    util, contests, schools = load_oierdb_dataset()

    print("[2/3] Computing legacy scores...", file=sys.stderr)
    legacy = legacy_school_scores(util, contests)

    print("[3/3] Computing v2 scores...", file=sys.stderr)
    v2 = v2_school_scores(contests)

    # Build (school_id → metadata) lookup
    meta = {s.id: (s.name, s.province) for s in schools}

    legacy_sorted = sorted(legacy.items(), key=lambda x: -x[1])
    v2_sorted = sorted(v2.items(), key=lambda x: -x[1])

    legacy_rank = {sid: i + 1 for i, (sid, _) in enumerate(legacy_sorted)}
    v2_rank = {sid: i + 1 for i, (sid, _) in enumerate(v2_sorted)}

    # Schools that appear in BOTH top-100
    legacy_top100 = {sid for sid, _ in legacy_sorted[:100]}
    v2_top100 = {sid for sid, _ in v2_sorted[:100]}
    intersect = legacy_top100 & v2_top100
    only_legacy = legacy_top100 - v2_top100
    only_v2 = v2_top100 - legacy_top100

    print()
    print(f"Top-100 共同入围学校：{len(intersect)}")
    print(f"仅旧公式 Top 100：{len(only_legacy)}")
    print(f"仅新公式 Top 100：{len(only_v2)}")

    # Movement analysis on the intersection
    movements = []
    for sid in intersect:
        name, prov = meta[sid]
        movements.append((sid, name, prov, legacy_rank[sid], v2_rank[sid]))
    # Positive delta = rank rose (number went down). delta = legacy − v2
    movements.sort(key=lambda r: (r[3] - r[4]), reverse=True)

    print("\n=== 排名上升最多的 5 所学校（在 Top 100 内） ===")
    print(f"{'校名':<32} {'省':<4} {'旧→新':<10}  {'升':>4}")
    for sid, name, prov, lr, vr in movements[:5]:
        delta = lr - vr
        print(f"{name:<28} {prov:<4} {lr:>3} → {vr:<3}  +{delta:>3}")

    print("\n=== 排名下降最多的 5 所学校（在 Top 100 内） ===")
    for sid, name, prov, lr, vr in movements[-5:][::-1]:
        delta = vr - lr
        print(f"{name:<28} {prov:<4} {lr:>3} → {vr:<3}  -{delta:>3}")

    # New entrants (only in v2's top 100, not legacy's)
    print("\n=== 新公式 Top 100 新晋（旧公式不在 Top 100） ===")
    only_v2_sorted = sorted(only_v2, key=lambda sid: v2_rank[sid])
    for sid in only_v2_sorted[:5]:
        name, prov = meta[sid]
        print(f"{name:<28} {prov:<4} 旧 {legacy_rank[sid]:>4} → 新 {v2_rank[sid]:<3}")

    print("\n=== 跌出 Top 100 (旧公式 Top 100，新公式排名 100+) ===")
    only_legacy_sorted = sorted(only_legacy, key=lambda sid: legacy_rank[sid])
    for sid in only_legacy_sorted[:5]:
        name, prov = meta[sid]
        print(f"{name:<28} {prov:<4} 旧 {legacy_rank[sid]:>3}  → 新 {v2_rank[sid]:<4}")


if __name__ == "__main__":
    main()
