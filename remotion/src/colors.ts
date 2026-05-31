// Color by province.  Every Chinese province that has ever placed a school
// in the chart gets its own hue.
//
// Tiers are ranked by *NOI gold count* (the most reliable proxy for on-screen
// visibility — high-tier provinces dominate the top of the chart for years
// at a time, so they need maximally-distinct hues; low-tier provinces blip
// in for a single record and can share more similar tonal variations).
//
// Design discipline:
//   • Tier 1 (>90 gold): 4 cardinal hues, ~90° apart on the wheel.
//   • Tier 2 (50–65):    in-between hues, equally saturated.
//   • Tier 3 (30–40):    secondary positions, full saturation.
//   • Tier 4 (10–25):    earth/muted variants of the wheel.
//   • Tier 5 ( 5–10):    desaturated, still hue-distinct.
//   • Tier 6 (1–4):      tail — quiet tones, blend gracefully.
//
// All values verified for legibility on the chart's #000 background.
const PROVINCE_COLORS: Record<string, string> = {
  // ─── Tier 1: the Big 4 (浙苏湘粤; 91–175 NOI gold) ──────────────────────
  '浙江': '#2DC8A8', // emerald / jade — water province
  '江苏': '#3D7EFF', // royal blue — Yangtze
  '湖南': '#FF9F0A', // marigold — fire / spice
  '广东': '#FF4E42', // vermillion — southern warmth

  // ─── Tier 2: secondary heavyweights (川闽京; 57–63 NOI gold) ───────────
  '四川': '#FF4E96', // magenta — Sichuan
  '福建': '#5DD867', // leaf green — Fujian forests
  '北京': '#A867FF', // imperial purple — capital

  // ─── Tier 3: mid-tier (皖渝沪鲁; 33–35 NOI gold) ────────────────────────
  '安徽': '#F4C034', // amber gold — Anhui
  '重庆': '#E66DC4', // rose pink — Chongqing
  '上海': '#58CFFF', // bright cyan — modern coastal
  '山东': '#5B5BE0', // cobalt indigo — Confucius blue

  // ─── Tier 4: smaller players (冀吉豫津陕; 10–22 NOI gold) ──────────────
  '河北': '#B58450', // bronze
  '吉林': '#9DB665', // olive
  '河南': '#D9A040', // mustard
  '天津': '#7C8DA8', // slate blue
  '陕西': '#C84F4F', // terra cotta

  // ─── Tier 5: tail (鄂辽晋黑; 4–9 NOI gold) ─────────────────────────────
  '湖北': '#38B8C8', // turquoise
  '辽宁': '#6B8DAA', // cool slate
  '山西': '#8C5DA5', // plum
  '黑龙江': '#98A8B8', // icy gray-blue

  // ─── Tier 6: rare (赣桂琼新; ≤ 3 NOI gold) ─────────────────────────────
  '江西': '#A0B248', // olive yellow
  '广西': '#C66B62', // muted coral
  '海南': '#46A7B5', // ocean teal
  '新疆': '#C9A878', // sand beige
};

const FALLBACK = '#8E8E93'; // systemGray, for any province not in the map

export const colorForProvince = (province: string): string =>
  PROVINCE_COLORS[province] ?? FALLBACK;

// Legacy entry point: now provided for safety if a caller still passes a
// school name. Resolves via dataset-injected mapping (see BarChartRace.tsx).
export const colorFor = (province: string): string => colorForProvince(province);
