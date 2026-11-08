// Ported from QNTNs-ghost assets/js/qntns/fund.js (port, not import). The rules
// there hold here: FIFO queue, runs never split, $2 a day, Eastern day boundary,
// an empty or drained queue reopens today, and gaps are never backfilled. Day
// steps go through addDays on a UTC midnight, never by adding milliseconds.

const ZONE = "America/New_York";
export const PRICE_PER_DAY = 2;
// Must match worker/src/fund.js, which clamps every checkout to it.
export const MAX_DAYS = 365;
export const FUND_BASE = "https://qntns-reads.qstaley921.workers.dev";
export const TIMEOUT_MS = 8000;

// Hand-edited from the real bills; the three parts must sum to total.
export const COST = {
  total: 682,
  segments: [
    { id: "hosting", label: "Website hosting", amount: 432 },
    { id: "domain", label: "Domain name", amount: 22 },
    { id: "tools", label: "Build tools", amount: 228 },
  ],
};

export interface Order {
  name: string;
  days: number;
  paidAt: string;
}
interface Moment {
  key: string;
  ms: number;
}
export interface Run {
  name: string;
  days: number;
  span: number;
  startKey: string;
  endKey: string;
  start: Moment;
  end: Moment;
}
export interface FundState {
  today: string;
  runs: Run[];
  filled: Set<string>;
  owner: Map<string, number>;
  firstOpenKey: string;
  current: Run | null;
  next: Run | null;
  remaining: number;
}

const KEY_FORMAT = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
export const dayKey = (date = new Date()) => KEY_FORMAT.format(date);

// h23, not hour12:false, so midnight is 00 and sorts first.
const TIME_FORMAT = new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit" });
export const dayOffset = (date = new Date()) => {
  const [h, m, s] = TIME_FORMAT.format(date).split(":").map(Number);
  return ((h * 60 + m) * 60 + s) * 1000;
};

const before = (a: Moment, b: Moment) => a.key < b.key || (a.key === b.key && a.ms < b.ms);
const keyToUTC = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const DAY_MS = 86400000;
const utcToKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (key: string, n: number) => utcToKey(keyToUTC(key) + n * DAY_MS);
export const diffDays = (from: string, to: string) => Math.round((keyToUTC(to) - keyToUTC(from)) / DAY_MS);
// 0 = Monday … 6 = Sunday.
export const weekdayIndex = (key: string) => (new Date(keyToUTC(key)).getUTCDay() + 6) % 7;

const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...o });
const MONTH_SHORT = fmt({ month: "short" });
export const monthShort = (key: string) => MONTH_SHORT.format(new Date(keyToUTC(key)));
export const dayOfMonth = (key: string) => key.slice(8, 10);
export const dateProse = (key: string) => `${monthShort(key)} ${Number(dayOfMonth(key))}`;
export const money = (n: number) => `$${n.toFixed(2)}`;
export const clampDays = (n: number) => Math.min(MAX_DAYS, Math.max(1, Math.floor(n) || 1));

// A run starts on the later of: the end of the run in front, and its own paid
// moment. A run lasts `days` x 24h from that moment, so it touches span squares.
export const layQueue = (orders: Order[], fromKey: string) => {
  const sorted = [...orders].sort((a, b) => +new Date(a.paidAt) - +new Date(b.paidAt));
  const filled = new Set<string>();
  const runs: Run[] = [];
  let cursor: Moment | null = null;
  for (const order of sorted) {
    const days = Math.max(1, Math.floor(Number(order.days) || 1));
    const p = new Date(order.paidAt);
    const paid = { key: dayKey(p), ms: dayOffset(p) };
    const start: Moment = cursor === null || before(cursor, paid) ? paid : cursor;
    const end = { key: addDays(start.key, days), ms: start.ms };
    const endKey = end.ms === 0 ? addDays(end.key, -1) : end.key;
    const span = diffDays(start.key, endKey) + 1;
    for (let i = 0; i < span; i += 1) filled.add(addDays(start.key, i));
    runs.push({ name: String(order.name ?? ""), days, span, startKey: start.key, endKey, start, end });
    cursor = end;
  }
  const c = cursor as Moment | null;
  const firstOpenKey = c === null || c.key < fromKey ? fromKey : c.key;
  return { runs, filled, firstOpenKey };
};

export const fundState = (orders: Order[] = [], today = dayKey(), nowMs = dayOffset()): FundState => {
  const { runs, filled, firstOpenKey } = layQueue(orders, today);
  // Later run wins a shared handoff day.
  const owner = new Map<string, number>();
  runs.forEach((run, i) => {
    for (let d = 0; d < run.span; d += 1) owner.set(addDays(run.startKey, d), i);
  });
  const now = { key: today, ms: nowMs };
  const index = runs.findIndex((r) => !before(now, r.start) && before(now, r.end));
  const current = index === -1 ? null : runs[index];
  return {
    today,
    runs,
    filled,
    owner,
    firstOpenKey,
    current,
    next: index === -1 ? null : runs[index + 1] || null,
    remaining: current ? diffDays(today, current.end.key) + (nowMs < current.end.ms ? 1 : 0) : 0,
  };
};

export const rangeText = (first: string | null, count: number) => {
  if (!first) return "";
  return count === 1
    ? `on ${dateProse(first)}`
    : `from ${dateProse(first)} to ${dateProse(addDays(first, count - 1))}`;
};

export const buyLabel = (count: number, first: string | null) => {
  const head = `Fund ${count} ${count === 1 ? "day" : "days"} for ${money(count * PRICE_PER_DAY)}`;
  const span = rangeText(first, count);
  return span ? `${head}, ${span}` : head;
};

// Same ramp as the theme: navy hsl(222 55% 21%) to grey hsl(222 0% 81%), eight
// stops; run n wears stop n % 8 so a new funder never recolours an older run.
const FUND_STOPS = 8;
export const fundColor = (n: number) => {
  const t = (n % FUND_STOPS) / (FUND_STOPS - 1);
  return `hsl(222 ${(55 - 55 * t).toFixed(2)}% ${(21 + 60 * t).toFixed(2)}%)`;
};
// Dark stops take white text, light ones dark.
export const inkOn = (n: number) => ((n % FUND_STOPS) < 4 ? "#fff" : "hsl(222 55% 21%)");
