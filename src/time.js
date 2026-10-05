// 以"日"为粒度的历史时间工具。支持 YYYY 与 YYYY-MM-DD 两种精度，
// 配合 exact / circa / before / after 把时间主张归一成闭区间窗口（端点为日序号，null 表示开放）。

const DAY_MS = 86_400_000;
const CIRCA_DAYS = 45;

export function dayToNumber(value) {
  const [y, m = 1, d = 1] = String(value).split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function numberToDay(n) {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function isYearPrecision(value) {
  return /^\d{4}$/.test(String(value));
}

function endpoint(value, certainty, side) {
  if (value == null) return null;
  const yearOnly = isYearPrecision(value);
  const day = dayToNumber(value);
  if (certainty === "before") return side === "hi" ? day : null;
  if (certainty === "after") return side === "lo" ? day : null;
  if (yearOnly) {
    // 年份本身就是不确定区间：精确到年的主张按整年展开，circa 不再额外收窄
    return side === "lo" ? day : dayToNumber(`${String(value).split("-")[0]}-12-31`);
  }
  if (certainty === "circa") return side === "lo" ? day - CIRCA_DAYS : day + CIRCA_DAYS;
  return day; // exact
}

// temporal: { start, start_certainty, end, end_certainty }；缺省的一端为开放端
export function toWindow(temporal = {}) {
  const sc = temporal.start_certainty ?? "exact";
  const ec = temporal.end_certainty ?? "exact";
  const lo = endpoint(temporal.start, sc, "lo");
  const hi = temporal.end != null ? endpoint(temporal.end, ec, "hi") : endpoint(temporal.start, sc, "hi");
  if (lo != null && hi != null && lo > hi) return { lo: hi, hi: lo, swapped: true };
  return { lo, hi, swapped: false };
}

export function windowsOverlap(a, b) {
  if (a.lo == null || a.hi == null || b.lo == null || b.hi == null) {
    // 含开放端：只要无法明确排除相交，就视为相交
    return !(a.hi != null && b.lo != null && a.hi < b.lo) && !(b.hi != null && a.lo != null && b.hi < a.lo);
  }
  const lo = Math.max(a.lo, b.lo);
  const hi = Math.min(a.hi, b.hi);
  if (lo > hi) return false;
  // 两个"确切到同一天"的点不构成异地矛盾（当日在途是可能的）
  const bothPoints = a.lo === a.hi && b.lo === b.hi;
  return !(bothPoints && a.lo === b.lo);
}

export function addDays(isoDateTime, days) {
  const t = new Date(isoDateTime).getTime() + days * DAY_MS;
  return new Date(t).toISOString();
}

export function describeTemporal(temporal = {}) {
  const c = { exact: "", circa: "约", before: "早于", after: "晚于" };
  const s = temporal.start ? `${c[temporal.start_certainty ?? "exact"]}${temporal.start}` : "";
  const e = temporal.end && temporal.end !== temporal.start ? `—${c[temporal.end_certainty ?? "exact"]}${temporal.end}` : "";
  return s + e;
}
