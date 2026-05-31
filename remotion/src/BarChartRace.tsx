import React, {useEffect, useMemo, useState} from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  delayRender,
  continueRender,
} from 'remotion';
import {scaleLinear} from 'd3-scale';
import {format as d3format} from 'd3-format';

import {loadDataset, Dataset} from './data';
import {colorForProvince} from './colors';
import {computePchipTangents, evalPchip} from './splines';
import config from '../../config.json';

// ─── Display configuration ──────────────────────────────────────────────────
const TOP_N: number = config.displayTopN;
const OFF_RANK = TOP_N + 2;
// Hard visible boundary: opacity 1 up to rank 30.0, fully gone past 30.5.
const FADE_FULL = TOP_N;
const FADE_GONE = TOP_N + 0.5;

// Layout (1920×1080) — chart bars fill ~74% of the canvas width.
const PAD_LEFT = 60;
const PAD_RIGHT = 60;
const PAD_TOP = 170;
const LABEL_COL_WIDTH = 240;     // most school names fit in ~200 px
const LABEL_BAR_GAP = 16;
const VALUE_LABEL_GAP = 8;
const VALUE_LABEL_WIDTH = 80;    // max score "20.xx" only needs ~50 px
const ROW_PITCH = 28;
const BAR_HEIGHT = 20;
const RANK_COL_WIDTH = 40;
const RANK_NAME_GAP = 6;  // school name sits closer to the rank numeral

// Pre-compute parameters
const SAMPLES_PER_MONTH = 4;
const SMOOTH_SIGMA_MONTHS: number = config.smoothSigmaMonths;
const INTERP_MODE: 'event-annual' | 'annual' =
  ((config as {interp?: string}).interp ?? 'event-annual') as
    | 'event-annual'
    | 'annual';

// Frames to freeze the chart's first frame at the start, giving the
// title→chart crossfade room to breathe before the month counter starts
// ticking.
const HOLD_START_FRAMES = Math.round(
  ((config as {holdStartSec?: number}).holdStartSec ?? 0) * config.fps
);

// The first year of the dataset (2004) holds only one contest (NOI), so the
// curve barely moves and the chart looks frozen. We collapse that year into
// the 2005-12 milestone: months before Dec 2005 clamp to the Dec 2005 value,
// then the animation begins in earnest.
const ANNUAL_MILESTONE_FIRST_YEAR = 2005;

// ─── Palette ────────────────────────────────────────────────────────────────
const COLORS = {
  bg: '#000000',
  ink: '#F2F4F8',
  inkSoft: '#9AA0AA',
  inkMute: '#5C6370',
  inkFaint: '#2A2F38',
  rule: '#1A1C22',
  accent: '#0A84FF',
};

// Per-codepoint fallback. Latin → SF Pro / Inter; Chinese → PingFang SC (macOS)
// / Microsoft YaHei (Windows) / Noto Sans CJK SC (Linux).
const FONT_STACK =
  '"SF Pro Display", "SF Pro Text", "Inter", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Source Han Sans SC", "Noto Sans CJK SC", -apple-system, system-ui, sans-serif';

const MONTH_EN = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
];

// Legacy scores are large integers (0 ~ 3,000,000); v2 scores are small (0 ~ 20).
const fmtScore =
  config.formula === 'legacy' ? d3format(',.0f') : d3format(',.2f');
const fmtRank = (n: number) => n.toString().padStart(2, '0');

// "NOI2010" → "NOI 2010"; "NOIP2018提高" → "NOIP 2018 提高"; "CSP提高2019" → "CSP 提高 2019"
const formatContestName = (raw: string): {prefix: string; year: string; suffix: string} => {
  const m = raw.match(/^([A-Za-z]+)([^\d]*)(\d{4})(.*)$/);
  if (!m) return {prefix: raw, year: '', suffix: ''};
  const [, alpha, midSuffix, year, tailSuffix] = m;
  // For "CSP提高2019" the kanji part is in midSuffix; for "NOIP2018提高" it's in tailSuffix.
  const suffix = (midSuffix + tailSuffix).trim();
  return {prefix: alpha, year, suffix};
};

// Bottom-right stack of contest badges, each on its own asymmetric clock.
// Newest sits at the anchor; older entries drift up to higher slot indices
// as new events arrive (slot index is computed from the sum of newer-entry
// opacities, so the upward drift is *continuous*, not snapped).
//
//   LEAD = brief anticipation fade-in before the contest's nominal date
//   HOLD = full-opacity prominence right after it happens (its moment)
//   FADE = long elegant decay back to invisible (the slow trip into history)
//
// Lifetimes are independent: a tightly packed cluster of contests stacks
// in parallel (no rushed crossfades), and a lone contest with a long
// follow-up gap still ages out on its own clock instead of overstaying.
const CONTEST_LEAD_MONTHS: number =
  (config.contestBadge as {leadMonths?: number}).leadMonths ?? 0.3;
const CONTEST_HOLD_MONTHS: number =
  (config.contestBadge as {holdMonths?: number}).holdMonths ?? 0.8;
const CONTEST_FADE_MONTHS: number =
  (config.contestBadge as {fadeMonths?: number}).fadeMonths ?? 1.5;
// Tiny nudge applied to same-month events so the stack order is deterministic
// without affecting their joint lifetime curves.
const CONTEST_TIE_SPREAD_MONTHS: number =
  (config.contestBadge as {tieSpreadMonths?: number}).tieSpreadMonths ?? 0.08;
const CONTEST_ANCHOR_BOTTOM = 75;
const CONTEST_BADGE_ROW_HEIGHT = 22;

// Cubic ease-in-out for the badge opacity curve — gentler than linear.
const easeInOut = (t: number): number => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};

// ─── Pre-processed data ─────────────────────────────────────────────────────
type Track = {
  name: string;
  province: string;
  // Cumulative score sampled at SAMPLES_PER_MONTH per month; Gaussian-smoothed
  // in 'event' mode, raw piecewise-linear in 'annual' mode.
  smoothedScores: Float32Array;
  // Sort-rank trajectory (Gaussian-smoothed for crisp swaps).
  smoothedRanks: Float32Array;
};

type ContestEventDerived = {
  name: string;
  prefix: string;
  year: string;
  suffix: string;
  monthFloat: number;
};

type Derived = {
  tracks: Track[];
  contestEvents: ContestEventDerived[];
};

const gaussianSmooth = (
  y: Float32Array | number[],
  sigmaSamples: number
): Float32Array => {
  const half = Math.ceil(3 * sigmaSamples);
  const kernel: number[] = [];
  let kSum = 0;
  for (let k = -half; k <= half; k++) {
    const w = Math.exp(-(k * k) / (2 * sigmaSamples * sigmaSamples));
    kernel.push(w);
    kSum += w;
  }
  for (let k = 0; k < kernel.length; k++) kernel[k] /= kSum;

  const n = y.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0, wsum = 0;
    for (let k = -half; k <= half; k++) {
      const j = i + k;
      if (j < 0 || j >= n) continue;
      const w = kernel[k + half];
      sum += y[j] * w;
      wsum += w;
    }
    out[i] = sum / wsum;
  }
  return out;
};

/**
 * Build a fine-grid cumulative-score curve for one school.
 *
 *  - 'event-annual' (recommended): knots = union(months where score changed,
 *    every December, first, last). Between knots use monotone cubic Hermite
 *    (PCHIP). Annual knots act as "if no new contest, hold this value"
 *    anchors — they prevent the linear-interp method from drawing a
 *    multi-year phantom ramp when a school drops out of Top-N and re-enters.
 *
 *  - 'annual': knots = December milestones only (the original GDP-style
 *    mode). Plain linear interp between knots.
 *
 * Both produce a Float32Array of length `totalSamples` sampled uniformly at
 * SAMPLES_PER_MONTH per month.
 */
const buildScoreCurve = (
  monthly: Float32Array,
  totalSamples: number,
  mode: 'event-annual' | 'annual',
  annualKnots: number[]
): Float32Array => {
  const curve = new Float32Array(totalSamples);

  if (mode === 'event-annual') {
    // Knot set: every month where score changed + every annual milestone.
    const knotSet = new Set<number>(annualKnots);
    for (let i = 0; i < monthly.length; i++) {
      if (i === 0 || monthly[i] !== monthly[i - 1]) knotSet.add(i);
    }
    const knotIdx = Array.from(knotSet).sort((a, b) => a - b);
    const knotVal = knotIdx.map((k) => monthly[k]);

    // Drop leading-zero knots (school doesn't exist yet); keep one zero
    // immediately before the first non-zero knot so the school "rises in"
    // smoothly rather than popping.
    let firstNonZero = 0;
    while (firstNonZero < knotVal.length && knotVal[firstNonZero] === 0) firstNonZero++;
    if (firstNonZero === knotVal.length) return curve; // never appears

    const startCut = Math.max(0, firstNonZero - 1);
    const xs = knotIdx.slice(startCut);
    const ys = knotVal.slice(startCut);
    const firstActive = xs[xs.length - 1] === xs[0] ? xs[0] : xs[1] ?? xs[0];

    const tangents = computePchipTangents(xs, ys);

    for (let s = 0; s < totalSamples; s++) {
      const t = s / SAMPLES_PER_MONTH;
      if (t < xs[0]) {
        curve[s] = 0;
      } else {
        curve[s] = evalPchip(xs, ys, tangents, t);
      }
    }
    void firstActive;
    return curve;
  }

  // ── annual mode ─────────────────────────────────────────────────────────
  const annualVal: number[] = annualKnots.map((k) => monthly[k]);
  let ki = 0;
  for (let s = 0; s < totalSamples; s++) {
    const t = s / SAMPLES_PER_MONTH;
    if (t <= annualKnots[0]) {
      curve[s] = annualVal[0];
      continue;
    }
    if (t >= annualKnots[annualKnots.length - 1]) {
      curve[s] = annualVal[annualVal.length - 1];
      continue;
    }
    while (ki < annualKnots.length - 1 && annualKnots[ki + 1] <= t) ki++;
    const t0 = annualKnots[ki];
    const t1 = annualKnots[ki + 1];
    const a = (t - t0) / (t1 - t0);
    curve[s] = annualVal[ki] + (annualVal[ki + 1] - annualVal[ki]) * a;
  }
  return curve;
};

const buildDerived = (dataset: Dataset): Derived => {
  const M = dataset.frames.length;
  const totalSamples = (M - 1) * SAMPLES_PER_MONTH + 1;

  // Annual knots (only needed if interp='annual'). We DROP the Dec milestone
  // of every year before ANNUAL_MILESTONE_FIRST_YEAR — the early years held
  // at most one contest and barely registered, so a knot there left the
  // chart frozen.  Crucially we KEEP month 0 as a knot (with its real,
  // mostly-empty starting value), so the linear interp from month 0 to the
  // first real Dec knot spans the whole "merged" period.  This gives 2004
  // continuous upward movement instead of a flat 12-month hold.
  const annualKnots: number[] = [];
  for (let i = 0; i < M; i++) {
    const [yyyy, m] = dataset.months[i].split('-');
    if (m === '12' && parseInt(yyyy, 10) >= ANNUAL_MILESTONE_FIRST_YEAR) {
      annualKnots.push(i);
    }
  }
  if (annualKnots.length === 0 || annualKnots[0] !== 0) annualKnots.unshift(0);
  if (annualKnots[annualKnots.length - 1] !== M - 1) annualKnots.push(M - 1);

  // Collect every school that ever appears in the top-N data.
  const present: Record<string, true> = {};
  for (const f of dataset.frames) for (const e of f) present[e.n] = true;
  const names = Object.keys(present);
  const N = names.length;

  // For each school: forward-fill monthly cumulative score → score curve.
  const smoothedScoresAll: Float32Array[] = [];
  for (const name of names) {
    const monthly = new Float32Array(M);
    let last = 0;
    for (let i = 0; i < M; i++) {
      let s = last;
      for (const e of dataset.frames[i]) {
        if (e.n === name) {
          s = e.s;
          last = s;
          break;
        }
      }
      monthly[i] = s;
    }
    smoothedScoresAll.push(
      buildScoreCurve(monthly, totalSamples, INTERP_MODE, annualKnots)
    );
  }

  // Compute discrete sort-rank at every sample point.
  const discreteRanks: Float32Array[] = names.map(
    () => new Float32Array(totalSamples)
  );
  const scoreScratch = new Float64Array(N);
  for (let s = 0; s < totalSamples; s++) {
    for (let i = 0; i < N; i++) scoreScratch[i] = smoothedScoresAll[i][s];
    const idxArr: number[] = [];
    for (let i = 0; i < N; i++) idxArr.push(i);
    idxArr.sort((a, b) => scoreScratch[b] - scoreScratch[a]);
    for (let p = 0; p < N; p++) {
      discreteRanks[idxArr[p]][s] = Math.min(p + 1, OFF_RANK + 2);
    }
  }

  // Gaussian-smooth ranks for crisp-but-not-jumpy swaps.
  //
  // End-of-data convergence: a swap happening within ~3σ samples of the
  // final point won't otherwise complete — the kernel mixes the post-swap
  // rank with pre-swap ranks from a few samples back, leaving the smoothed
  // value visibly off-integer at the held end frame.  Two-sided boundary
  // padding alone isn't enough because the *past* side of the kernel still
  // sees the pre-swap state.  We pre-snap the last `FORCE_TAIL` samples of
  // the discrete trajectory to the converged value before smoothing, so the
  // kernel near the tail sees the final rank on both sides and converges to
  // it exactly.  Trade-off: the swap visibly completes a fraction of a
  // second earlier than the raw data would — fine for a chart-race ending.
  const rankSigmaSamples = SMOOTH_SIGMA_MONTHS * SAMPLES_PER_MONTH;
  const PAD = Math.max(3, Math.ceil(3 * rankSigmaSamples));
  const FORCE_TAIL = 2 * PAD;
  const tracks: Track[] = names.map((name, i) => {
    const r = discreteRanks[i];
    const n = r.length;
    const finalR = r[n - 1];
    const buf = new Float32Array(n + 2 * PAD);
    for (let j = 0; j < PAD; j++) buf[j] = r[0];
    const snapFrom = Math.max(0, n - FORCE_TAIL);
    for (let j = 0; j < n; j++) buf[PAD + j] = j >= snapFrom ? finalR : r[j];
    for (let j = 0; j < PAD; j++) buf[PAD + n + j] = finalR;
    const smoothed = gaussianSmooth(buf, rankSigmaSamples);
    return {
      name,
      province: dataset.schools[name]?.province ?? '',
      smoothedScores: smoothedScoresAll[i],
      smoothedRanks: smoothed.slice(PAD, PAD + n) as Float32Array,
    };
  });

  // Map each contest event to a fractional position on the months axis.
  const monthIndex = new Map<string, number>();
  dataset.months.forEach((m, i) => monthIndex.set(m, i));
  const contestEvents: ContestEventDerived[] = [];
  for (const c of dataset.contests) {
    const idx = monthIndex.get(c.month);
    if (idx === undefined) continue;
    const parts = formatContestName(c.name);
    contestEvents.push({
      name: c.name,
      prefix: parts.prefix,
      year: parts.year,
      suffix: parts.suffix,
      monthFloat: idx,
    });
  }

  // Sort chronologically, then apply a *tiny* tie-spread to same-month
  // events so the stack has a deterministic order. The spread is much
  // smaller than LEAD/HOLD/FADE so the joint lifetime curves of e.g.
  // NOI + NOID类 + NOIST in the same July still overlap almost entirely —
  // they stack together throughout July, rather than racing past each
  // other.
  contestEvents.sort(
    (a, b) => a.monthFloat - b.monthFloat || a.name.localeCompare(b.name)
  );
  let g0 = 0;
  while (g0 < contestEvents.length) {
    let g1 = g0 + 1;
    while (
      g1 < contestEvents.length &&
      Math.abs(contestEvents[g1].monthFloat - contestEvents[g0].monthFloat) < 1e-6
    ) g1++;
    const n = g1 - g0;
    if (n > 1) {
      const base = contestEvents[g0].monthFloat;
      const half = CONTEST_TIE_SPREAD_MONTHS / 2;
      const step = CONTEST_TIE_SPREAD_MONTHS / (n - 1);
      for (let k = 0; k < n; k++) {
        contestEvents[g0 + k].monthFloat = base - half + k * step;
      }
    }
    g0 = g1;
  }

  return {tracks, contestEvents};
};

// ─── Helpers ────────────────────────────────────────────────────────────────
const monthInfo = (dataset: Dataset, monthFloat: number) => {
  const i = Math.max(
    0,
    Math.min(dataset.months.length - 1, Math.floor(monthFloat))
  );
  const [y, m] = dataset.months[i].split('-');
  const monthNum = parseInt(m, 10);
  return {
    year: y,
    monthIdx: monthNum,
    monthEn: MONTH_EN[monthNum - 1],
  };
};

const fadeOpacity = (rank: number): number => {
  if (rank <= FADE_FULL) return 1;
  if (rank >= FADE_GONE) return 0;
  return (FADE_GONE - rank) / (FADE_GONE - FADE_FULL);
};

// Linear-interp lookup on a uniformly-sampled Float32Array (both smoothed
// scores and smoothed ranks use this).
const lookupSampled = (arr: Float32Array, gridFloat: number): number => {
  const n = arr.length;
  if (gridFloat <= 0) return arr[0];
  if (gridFloat >= n - 1) return arr[n - 1];
  const i = Math.floor(gridFloat);
  const t = gridFloat - i;
  return arr[i] * (1 - t) + arr[i + 1] * t;
};

// ─── Component ──────────────────────────────────────────────────────────────
export const BarChartRace: React.FC<{framesPerMonth: number}> = ({framesPerMonth}) => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  void height;

  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [handle] = useState(() => delayRender('Loading snapshots.json'));

  useEffect(() => {
    loadDataset()
      .then((d) => {
        setDataset(d);
        continueRender(handle);
      })
      .catch((err) => {
        console.error(err);
        continueRender(handle);
      });
  }, [handle]);

  const derived = useMemo(() => (dataset ? buildDerived(dataset) : null), [dataset]);

  if (!dataset || !derived) {
    return <AbsoluteFill style={{backgroundColor: COLORS.bg}} />;
  }

  const {tracks, contestEvents} = derived;
  // Subtract the hold-start window: during those first frames monthFloat
  // stays pinned at 0, so the title→chart crossfade lands on a still frame.
  const monthFloat = Math.max(0, (frame - HOLD_START_FRAMES) / framesPerMonth);
  const gridFloat = monthFloat * SAMPLES_PER_MONTH;
  const {year, monthIdx} = monthInfo(dataset, monthFloat);

  // Each contest carries its own asymmetric clock plus a *monotonic* entry
  // progress that is the real driver of stack motion:
  //
  //   age in [-LEAD, 0):   fade-in — opacity AND entry rise together
  //   age in [0, HOLD]:    full opacity, entry locked at 1
  //   age in (HOLD, HOLD+FADE]: opacity decays back to 0, entry STAYS at 1
  //   beyond HOLD+FADE:    entry drops to 0 and the event leaves the list
  //
  // The split matters: slot positions are summed from the `entry` values of
  // newer entries, which only RISE during their lifetime.  That means once
  // an older badge is pushed up the stack by a newer sibling, it can never
  // be pulled back down when that sibling subsequently fades out — each
  // badge ages in place at its highest reached slot and just dims away.
  // Without this split, two same-month events (APIO + CTSC 2018) would
  // visibly slide back down on top of each other as they faded out.
  type ActiveContest = ContestEventDerived & {
    opacity: number; // display opacity (rises then falls)
    entry: number;   // monotonic entry progress (rises 0→1, locks at 1)
    slot: number;
  };
  const activeContests: ActiveContest[] = [];
  for (const c of contestEvents) {
    const age = monthFloat - c.monthFloat;
    let opacity: number;
    let entry: number;
    if (age < -CONTEST_LEAD_MONTHS) continue;
    else if (age < 0) {
      const raw = (age + CONTEST_LEAD_MONTHS) / CONTEST_LEAD_MONTHS;
      const eased = easeInOut(Math.max(0, Math.min(1, raw)));
      opacity = eased;
      entry = eased;
    } else if (age < CONTEST_HOLD_MONTHS) {
      opacity = 1;
      entry = 1;
    } else if (age < CONTEST_HOLD_MONTHS + CONTEST_FADE_MONTHS) {
      const raw = 1 - (age - CONTEST_HOLD_MONTHS) / CONTEST_FADE_MONTHS;
      opacity = easeInOut(Math.max(0, Math.min(1, raw)));
      entry = 1; // locked — older neighbours stay where they were pushed
    } else continue;
    activeContests.push({...c, opacity, entry, slot: 0});
  }
  // Sort NEWEST-first: the most recent event sits at slot 0 (anchor, closest
  // to the axis = most prominent), older events drift upward into the stack.
  activeContests.sort((a, b) => b.monthFloat - a.monthFloat);
  // Continuous slot index = sum of `entry` values of all NEWER (lower-index)
  // entries below this one.  Because entry is monotonic, the slot is too —
  // each badge climbs to a resting position during its LEAD and stays there
  // through HOLD + FADE, fading out in place rather than sliding back down.
  for (let i = 0; i < activeContests.length; i++) {
    let s = 0;
    for (let j = 0; j < i; j++) s += activeContests[j].entry;
    activeContests[i].slot = s;
  }

  type LiveRow = {
    name: string;
    province: string;
    score: number;
    rankPos: number;
    opacity: number;
  };

  const rows: LiveRow[] = [];
  for (const tk of tracks) {
    const rankPos = lookupSampled(tk.smoothedRanks, gridFloat);
    const opacity = fadeOpacity(rankPos);
    if (opacity <= 0.001) continue;
    const score = Math.max(0, lookupSampled(tk.smoothedScores, gridFloat));
    rows.push({name: tk.name, province: tk.province, score, rankPos, opacity});
  }

  let xMax = 0;
  for (const r of rows) if (r.score > xMax) xMax = r.score;
  xMax = Math.max(xMax * 1.04, 10);

  const barLeft = PAD_LEFT + RANK_COL_WIDTH + RANK_NAME_GAP + LABEL_COL_WIDTH + LABEL_BAR_GAP;
  const barAreaWidth = width - barLeft - PAD_RIGHT - VALUE_LABEL_WIDTH;
  const xScale = scaleLinear().domain([0, xMax]).range([0, barAreaWidth]);
  const ticks = xScale.ticks(5);

  const fmtTick = (v: number) => {
    if (v === 0) return '0';
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}K`;
    if (v >= 1) return `${v.toFixed(0)}`;
    return v.toFixed(1);
  };

  // Render back-to-front so leading rows are drawn on top during crossings.
  rows.sort((a, b) => b.rankPos - a.rankPos);

  const chartBottom = PAD_TOP + TOP_N * ROW_PITCH;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.bg,
        fontFamily: FONT_STACK,
        color: COLORS.ink,
        fontFeatureSettings: '"tnum", "ss01"',
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      {/* ── Title block (left) ───────────────────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          left: PAD_LEFT,
          top: 56,
        }}
      >
        <div
          style={{
            fontSize: 36,
            fontWeight: 700,
            letterSpacing: '0.01em',
            color: COLORS.ink,
            lineHeight: 1.1,
          }}
        >
          信息学奥林匹克竞赛
        </div>
        <div
          style={{
            fontSize: 32,
            fontWeight: 400,
            letterSpacing: '0.01em',
            color: COLORS.ink,
            lineHeight: 1.1,
            marginTop: 4,
          }}
        >
          学校评分排名
        </div>
      </div>

      {/* ── Date readout (right) — year small, month dominant ────────── */}
      <div
        style={{
          position: 'absolute',
          right: PAD_RIGHT,
          top: 52,
          textAlign: 'right',
        }}
      >
        <div
          style={{
            fontSize: 28,
            fontWeight: 400,
            letterSpacing: '0.02em',
            color: COLORS.inkSoft,
            lineHeight: 1,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {year} 年
        </div>
        <div
          style={{
            fontSize: 56,
            fontWeight: 400,
            letterSpacing: '0.01em',
            color: COLORS.accent,
            marginTop: 10,
            lineHeight: 1,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {monthIdx} 月
        </div>
      </div>

      {/* ── Contest event stack (bottom-right) ──────────────────────────
        * Each badge is anchored at the same bottom Y plus a fractional
        * `slot` offset (sum of newer entries' opacities).  As a new event
        * fades in, every older entry's slot grows continuously → the whole
        * stack drifts upward in lock-step with the newcomer.  The opacity
        * curve and the slot motion together do the work; no additional
        * translate animation is layered on top (that was what made the
        * old version feel busy — two competing motions at once).
        */}
      {activeContests.map((c) => (
        <div
          key={c.name}
          style={{
            position: 'absolute',
            right: PAD_RIGHT,
            bottom: CONTEST_ANCHOR_BOTTOM + c.slot * CONTEST_BADGE_ROW_HEIGHT,
            textAlign: 'right',
            opacity: c.opacity,
            fontSize: 16,
            fontWeight: 400,
            color: COLORS.inkSoft,
            lineHeight: 1.15,
            letterSpacing: '0.04em',
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{fontWeight: 500, color: COLORS.ink}}>{c.prefix}</span>
          {c.suffix && <span style={{marginLeft: 5}}>{c.suffix}</span>}
          <span style={{marginLeft: 6}}>{c.year}</span>
        </div>
      ))}

      {/* ── x = 0 baseline (single hairline, no grid) ────────────────── */}
      <div
        style={{
          position: 'absolute',
          left: barLeft,
          top: PAD_TOP - 8,
          width: 1,
          height: chartBottom - PAD_TOP + 16,
          backgroundColor: COLORS.rule,
        }}
      />

      {/* ── Bottom hairline + axis ticks ─────────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          left: PAD_LEFT,
          right: PAD_RIGHT,
          top: chartBottom + 14,
          height: 1,
          backgroundColor: COLORS.rule,
        }}
      />
      {ticks.map((tv, idx) => {
        const x = barLeft + xScale(tv);
        return (
          <div
            key={`tick-${idx}-${tv}`}
            style={{
              position: 'absolute',
              left: x - 50,
              width: 100,
              textAlign: 'center',
              top: chartBottom + 30,
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: '0.12em',
              color: COLORS.inkMute,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {fmtTick(tv)}
          </div>
        );
      })}

      {/* ── Static RANK column (does not move with swaps) ────────────── */}
      {Array.from({length: TOP_N}, (_, i) => {
        const yCenter = PAD_TOP + i * ROW_PITCH + ROW_PITCH / 2;
        return (
          <div
            key={`rank-${i}`}
            style={{
              position: 'absolute',
              left: PAD_LEFT,
              top: yCenter - 8,
              width: RANK_COL_WIDTH,
              textAlign: 'right',
              fontSize: 16,
              fontWeight: 400,
              color: COLORS.inkSoft,
              fontVariantNumeric: 'tabular-nums',
              opacity: 0.55,
              letterSpacing: '0.02em',
              lineHeight: 1,
            }}
          >
            {fmtRank(i + 1)}
          </div>
        );
      })}

      {/* ── Rows ─────────────────────────────────────────────────────── */}
      {rows.map((row) => {
        const yCenter = PAD_TOP + (row.rankPos - 1) * ROW_PITCH + ROW_PITCH / 2;
        const barWidth = Math.max(2, xScale(row.score));
        const color = colorForProvince(row.province);

        return (
          <React.Fragment key={row.name}>
            <div
              style={{
                position: 'absolute',
                left: barLeft - LABEL_BAR_GAP - LABEL_COL_WIDTH,
                top: yCenter - 8,
                width: LABEL_COL_WIDTH,
                textAlign: 'right',
                fontSize: 14,
                fontWeight: 500,
                color: COLORS.ink,
                opacity: row.opacity,
                lineHeight: 1.1,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {row.name}
            </div>

            <div
              style={{
                position: 'absolute',
                left: barLeft,
                top: yCenter - BAR_HEIGHT / 2,
                width: barWidth,
                height: BAR_HEIGHT,
                backgroundColor: color,
                borderRadius: 2,
                opacity: row.opacity,
              }}
            />

            <div
              style={{
                position: 'absolute',
                left: barLeft + barWidth + VALUE_LABEL_GAP,
                top: yCenter - 7,
                width: VALUE_LABEL_WIDTH,
                fontSize: 14,
                fontWeight: 400,
                color: COLORS.ink,
                fontVariantNumeric: 'tabular-nums',
                opacity: row.opacity * 0.95,
                lineHeight: 1,
                letterSpacing: '0.01em',
                whiteSpace: 'nowrap',
              }}
            >
              {fmtScore(row.score)}
            </div>
          </React.Fragment>
        );
      })}

    </AbsoluteFill>
  );
};
