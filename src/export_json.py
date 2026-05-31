"""Convert snapshots.parquet into a compact JSON the Remotion renderer can load.

Output shape:
  {
    "months": ["2004-07", "2004-08", ...],
    "schools": { "<name>": { "province": "...", "city": "..." } },
    "frames": [ [ {"n": "...", "s": 12.34}, ... ], ... ],
    "contests": [ {"name": "NOI2010", "type": "NOI", "month": "2010-07"}, ... ]
  }
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_GEN_DIR = REPO_ROOT / "data_sources" / "OIerDb-data-generator"

sys.path.insert(0, str(REPO_ROOT / "src"))
from month_mapping import CONTEST_MONTH  # noqa: E402


def load_contests() -> list[dict]:
    """Load contests.json from the data-generator submodule and attach a
    nominal "YYYY-MM" month string based on the contest type's mapping."""
    with open(DATA_GEN_DIR / "static" / "contests.json", encoding="utf-8") as f:
        raw = json.load(f)
    out = []
    for c in raw:
        m = CONTEST_MONTH.get(c["type"])
        if m is None:
            continue
        out.append({
            "name": c["name"],
            "type": c["type"],
            "year": c["year"],
            "month": f"{c['year']}-{m:02d}",
        })
    # Stable, chronological order by nominal date
    out.sort(key=lambda c: c["month"])
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default=str(REPO_ROOT / "output" / "snapshots.parquet"))
    parser.add_argument("--output", default=str(REPO_ROOT / "remotion" / "public" / "snapshots.json"))
    args = parser.parse_args()

    df = pd.read_parquet(args.input)
    df["month"] = pd.to_datetime(df["month"])
    df = df.sort_values(["month", "rank"])

    months = sorted(df["month"].unique())

    schools_meta = (
        df.drop_duplicates("school_name")
        .set_index("school_name")[["province", "city"]]
        .to_dict("index")
    )

    frames = []
    for m in months:
        sub = df[df["month"] == m]
        frames.append([
            {"n": r.school_name, "s": float(r.score)}
            for r in sub.itertuples()
        ])

    contests = load_contests()

    payload = {
        "months": [pd.Timestamp(m).strftime("%Y-%m") for m in months],
        "schools": schools_meta,
        "frames": frames,
        "contests": contests,
    }

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    size_kb = out.stat().st_size / 1024
    print(f"Wrote {out}  ({size_kb:.1f} KB, {len(months)} months, "
          f"{len(schools_meta)} distinct schools, {len(contests)} contests)")


if __name__ == "__main__":
    main()
