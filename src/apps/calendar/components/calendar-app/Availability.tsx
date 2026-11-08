import { useEffect, useState } from "react";
import { fetchSlots, getEvent } from "./booking";
import { ET_CLOSE, ET_OPEN } from "./calendarAppConstants";

export type Bookable = { slots: string[] | null; minutes: number };

/** Free cal.com slots for a week (null while loading or on failure) and the booking length. */
export function useBookable(week: string): Bookable & { failed: boolean } {
  const [slots, setSlots] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [minutes, setMinutes] = useState(30);
  useEffect(() => { getEvent().then((e) => setMinutes(e.minutes)); }, []);
  useEffect(() => {
    let live = true;
    setSlots(null);
    setFailed(false);
    if (week) fetchSlots(week).then((l) => { if (live) { setSlots(l); setFailed(!l); } });
    return () => { live = false; };
  }, [week]);
  return { slots, minutes, failed };
}

const ET = "America/New_York";
/** Minutes ET is ahead of UTC at an instant (negative: ET is behind). */
function etOffset(ms: number) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: ET, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })
    .formatToParts(ms).map((x) => [x.type, +x.value]));
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(ms / 60000) * 60000) / 60000;
}

/** The bookable window, 6 AM to 10 PM Eastern on that date, as minutes since the visitor's local midnight.
 *  shortcut: a window that wraps past local midnight (zones east of ~UTC+2) shows the whole day. */
export function dayWindow(date: string): [number, number] {
  const [y, m, d] = date.split("-").map(Number);
  const at = (h: number) => { const g = Date.UTC(y, m - 1, d, h); return g - etOffset(g) * 60000; };
  const d0 = new Date(y, m - 1, d).getTime();
  const lo = (at(ET_OPEN) - d0) / 60000, hi = (at(ET_CLOSE) - d0) / 60000;
  return lo >= 0 && hi <= 1440 ? [lo, hi] : [0, 1440];
}

/** Whole local hours the grid shows for these dates: the union of their ET windows. */
export function hoursOf(dates: string[]): [number, number] {
  const w = dates.map(dayWindow);
  return [Math.floor(Math.min(...w.map((x) => x[0])) / 60), Math.ceil(Math.max(...w.map((x) => x[1])) / 60)];
}

/** One day's free [start, end) minute ranges from the slots, and the gaps between them (merged runs), inside that day's ET window. */
function dayRanges(date: string, b: Bookable) {
  const { slots, minutes } = b;
  const d0 = new Date(`${date}T00:00:00`).getTime();
  const [lo, hi] = dayWindow(date);
  const free = (slots ?? [])
    .map((s) => ({ s, a: Math.max(lo, (Date.parse(s) - d0) / 60000) }))
    .map(({ s, a }) => ({ s, a, b: Math.min(hi, (Date.parse(s) - d0) / 60000 + minutes) }))
    .filter((f) => f.a < f.b)
    .sort((x, y) => x.a - y.a);
  const busy: [number, number][] = [];
  let at = lo;
  for (const f of free) {
    if (f.a > at) busy.push([at, f.a]);
    at = Math.max(at, f.b);
  }
  if (at < hi) busy.push([at, hi]);
  return { free, busy };
}

/** A day column's availability: read-only "Busy" blocks everywhere that is not a free slot, a button on each free slot. */
export function Availability({ date, bookable, hourHeight, gridStart, onSlot }: {
  date: string; bookable: Bookable; hourHeight: number; gridStart: number; onSlot: (slot: string, minutes: number) => void;
}) {
  if (!bookable.slots) return null; // loading or failed: no blocks, nothing to click
  const { free, busy } = dayRanges(date, bookable);
  const y = (m: number) => ((m - gridStart * 60) / 60) * hourHeight;
  return (
    <>
      {free.map((f) => (
        <button key={f.s} type="button" aria-label="Book this time" onClick={() => onSlot(f.s, bookable.minutes)}
          className="absolute left-0 right-0 hover:bg-black/[0.04] transition-colors" style={{ top: y(f.a), height: y(f.b) - y(f.a) }} />
      ))}
      {busy.map(([a, b]) => (
        <div key={a} onClick={(e) => e.stopPropagation()} className="absolute left-0.5 right-0.5 rounded overflow-hidden select-none px-1 py-0.5"
          style={{ top: y(a), height: y(b) - y(a), backgroundColor: "rgba(0,0,0,0.06)", borderLeft: "3px solid rgba(0,0,0,0.3)", zIndex: 1 }}>
          <span className="text-[10px] leading-tight opacity-60">Busy</span>
        </div>
      ))}
    </>
  );
}
