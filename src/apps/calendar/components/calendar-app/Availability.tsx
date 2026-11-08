import { useEffect, useState } from "react";
import { fetchSlots, getEvent } from "./booking";
import { HOUR_END, HOUR_START } from "./calendarAppConstants";

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

/** Hours the grid shows: earliest free start (floored) to latest free end (ceiled) across the week; whole day with no slots. */
export function hoursOf({ slots, minutes }: Bookable): [number, number] {
  if (!slots?.length) return [HOUR_START, HOUR_END];
  const t = slots.map((s) => Date.parse(s));
  const mod = (ms: number) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };
  // shortcut: a booking that crosses midnight is clipped to the day, as dayRanges does
  const lo = Math.floor(Math.min(...t.map(mod)) / 60);
  const hi = Math.ceil(Math.min(24 * 60, Math.max(...t.map((x) => mod(x) + minutes))) / 60);
  return [lo, Math.max(hi, lo + 1)];
}

/** One day's free [start, end) minute ranges from the slots, and the gaps between them (merged runs). */
function dayRanges(date: string, b: Bookable) {
  const { slots, minutes } = b;
  const d0 = new Date(`${date}T00:00:00`).getTime();
  const [h0, h1] = hoursOf(b);
  const lo = h0 * 60, hi = h1 * 60;
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
export function Availability({ date, bookable, hourHeight, onSlot }: {
  date: string; bookable: Bookable; hourHeight: number; onSlot: (slot: string, minutes: number) => void;
}) {
  if (!bookable.slots) return null; // loading or failed: no blocks, nothing to click
  const { free, busy } = dayRanges(date, bookable);
  const y = (m: number) => ((m - hoursOf(bookable)[0] * 60) / 60) * hourHeight;
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
