// Interpolation primitives used by the score-curve builder.

// ─── 1. Plain piecewise-linear (unevenly-spaced knots) ──────────────────────
export const evalLinear = (
  y: number[],
  xKnots: number[],
  x: number
): number => {
  const n = y.length;
  if (n === 0) return 0;
  if (x <= xKnots[0]) return y[0];
  if (x >= xKnots[n - 1]) return y[n - 1];

  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xKnots[mid] <= x) lo = mid;
    else hi = mid;
  }
  const x0 = xKnots[lo];
  const x1 = xKnots[hi];
  const y0 = y[lo];
  const y1 = y[hi];
  const t = (x - x0) / (x1 - x0);
  return y0 + (y1 - y0) * t;
};

// ─── 2. Monotone cubic Hermite (Fritsch–Carlson, non-uniform knots) ─────────
//
// Given strictly-increasing x[] and y[], returns the per-knot tangents m[]
// such that the cubic-Hermite interpolant is C¹ AND preserves monotonicity
// (no overshoot in monotone regions). For cumulative-score curves this is
// the right tool: the curve is exact at every knot, monotone-non-decreasing
// in flat / rising stretches, and smooth at every event boundary.

const sign = (x: number) => (x > 0 ? 1 : x < 0 ? -1 : 0);

export const computePchipTangents = (
  x: number[],
  y: number[]
): number[] => {
  const n = y.length;
  if (n === 0) return [];
  if (n === 1) return [0];
  if (n === 2) {
    const slope = (y[1] - y[0]) / (x[1] - x[0]);
    return [slope, slope];
  }

  const h = new Array<number>(n - 1);
  const d = new Array<number>(n - 1); // secant slopes
  for (let i = 0; i < n - 1; i++) {
    h[i] = x[i + 1] - x[i];
    d[i] = (y[i + 1] - y[i]) / h[i];
  }

  const m = new Array<number>(n);

  // Endpoint tangents (three-point one-sided)
  m[0] = ((2 * h[0] + h[1]) * d[0] - h[0] * d[1]) / (h[0] + h[1]);
  if (sign(m[0]) !== sign(d[0])) m[0] = 0;
  else if (sign(d[0]) !== sign(d[1]) && Math.abs(m[0]) > Math.abs(3 * d[0]))
    m[0] = 3 * d[0];

  m[n - 1] =
    ((2 * h[n - 2] + h[n - 3]) * d[n - 2] - h[n - 2] * d[n - 3]) /
    (h[n - 2] + h[n - 3]);
  if (sign(m[n - 1]) !== sign(d[n - 2])) m[n - 1] = 0;
  else if (
    sign(d[n - 2]) !== sign(d[n - 3]) &&
    Math.abs(m[n - 1]) > Math.abs(3 * d[n - 2])
  )
    m[n - 1] = 3 * d[n - 2];

  // Interior tangents (weighted harmonic mean; 0 at local extrema)
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) {
      m[i] = 0;
    } else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  return m;
};

export const evalPchip = (
  x: number[],
  y: number[],
  m: number[],
  xQuery: number
): number => {
  const n = y.length;
  if (n === 0) return 0;
  if (xQuery <= x[0]) return y[0];
  if (xQuery >= x[n - 1]) return y[n - 1];

  // Binary search the bracketing interval
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (x[mid] <= xQuery) lo = mid;
    else hi = mid;
  }
  const h = x[hi] - x[lo];
  const s = (xQuery - x[lo]) / h;
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  return h00 * y[lo] + h10 * h * m[lo] + h01 * y[hi] + h11 * h * m[hi];
};
