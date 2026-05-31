#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Post-production: wrap the rendered bar-chart-race (output/ranking_race.mp4)
# with intro/outro title cards and a music bed, producing
# output/ranking_race_final.mp4.
#
#   tools/compose.sh                      # use defaults
#   BGM_START=30 MUSIC_VOL=0.7 tools/compose.sh   # override any tunable via env
#
# Section timing is DERIVED from the chart's real duration (ffprobe), so
# changing the animation pace (config.framesPerMonth) needs no edits here.
#
# NB: the music bed (time.mp4) is copyrighted and is NOT committed to the repo.
#     Drop your own track at $BGM, or run with `BGM=/path/to/music tools/compose.sh`.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ─── Tunables (override via env) ─────────────────────────────────────────────
TITLE_SEC="${TITLE_SEC:-6}"      # intro card hold, incl. crossfade tail (s)
END_SEC="${END_SEC:-6}"          # outro card hold (s)
XFADE="${XFADE:-1.5}"            # crossfade between sections (s)
BGM_START="${BGM_START:-0}"      # offset into the music track (s)
MUSIC_VOL="${MUSIC_VOL:-0.85}"   # linear gain (0.85 ≈ -1.4 dB)
AFADE_IN="${AFADE_IN:-2.5}"      # audio fade-in (s)
AFADE_OUT="${AFADE_OUT:-5}"      # audio fade-out (s)
CRF="${CRF:-18}"                 # x264 quality (lower = better; 18 ≈ visually lossless)
PRESET="${PRESET:-medium}"       # x264 speed/size preset

# ─── Paths ───────────────────────────────────────────────────────────────────
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHART="$ROOT/output/ranking_race.mp4"
TITLE_PNG="$ROOT/output/title_card.png"
END_PNG="$ROOT/output/end_card.png"
BGM="${BGM:-$ROOT/time.mp4}"
OUT="$ROOT/output/ranking_race_final.mp4"
PY="$(command -v python3)"

# ─── Pre-flight ──────────────────────────────────────────────────────────────
[ -f "$CHART" ] || { echo "✗ missing $CHART — run 'make video' first." >&2; exit 1; }
[ -f "$BGM" ]   || { echo "✗ missing music bed: $BGM (copyrighted; supply your own)" >&2; exit 1; }
if [ ! -f "$TITLE_PNG" ] || [ ! -f "$END_PNG" ]; then
  echo "▶ generating title/end cards…"
  "$PY" "$ROOT/tools/make_cards.py"
fi

# ─── Derive the timeline from the chart's real duration ──────────────────────
CHART_SEC="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$CHART")"
OFF1="$(echo "$TITLE_SEC - $XFADE" | bc -l)"                   # title → chart xfade start
OFF2="$(echo "$TITLE_SEC + $CHART_SEC - 2*$XFADE" | bc -l)"    # chart → end   xfade start
TOTAL="$(echo "$TITLE_SEC + $CHART_SEC + $END_SEC - 2*$XFADE" | bc -l)"
AOUT="$(echo "$TOTAL - $AFADE_OUT" | bc -l)"                   # audio fade-out start

printf '▶ chart %.1fs  +  intro %ss  +  outro %ss  −  2×%ss xfade  →  final %.1fs\n' \
  "$CHART_SEC" "$TITLE_SEC" "$END_SEC" "$XFADE" "$TOTAL"

ffmpeg -y -hide_banner \
  -loop 1 -t "$TITLE_SEC" -framerate 120 -i "$TITLE_PNG" \
  -i "$CHART" \
  -loop 1 -t "$END_SEC" -framerate 120 -i "$END_PNG" \
  -ss "$BGM_START" -i "$BGM" \
  -filter_complex "\
    [0:v]format=yuv420p,setsar=1,fps=120[v0];\
    [1:v]format=yuv420p,setsar=1,fps=120[v1];\
    [2:v]format=yuv420p,setsar=1,fps=120[v2];\
    [v0][v1]xfade=transition=fade:duration=$XFADE:offset=$OFF1[vab];\
    [vab][v2]xfade=transition=fade:duration=$XFADE:offset=$OFF2[v];\
    [3:a]atrim=duration=$TOTAL,asetpts=PTS-STARTPTS,volume=$MUSIC_VOL,\
      afade=t=in:st=0:d=$AFADE_IN,afade=t=out:st=$AOUT:d=$AFADE_OUT[a]" \
  -map "[v]" -map "[a]" \
  -c:v libx264 -preset "$PRESET" -crf "$CRF" -pix_fmt yuv420p \
  -c:a aac -b:a 256k -ar 48000 \
  -movflags +faststart \
  "$OUT"

echo "✓ $OUT"
