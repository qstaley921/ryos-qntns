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

/** One day's free [start, end) minute ranges from the slots, and the gaps between them (merged runs). */
function dayRanges(date: string, { slots, minutes }: Bookable) {
  const d0 = new Date(`${date}T00:00:00`).getTime();
  const lo = HOUR_START * 60, hi = HOUR_END * 60;
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
  const y = (m: number) => ((m - HOUR_START * 60) / 60) * hourHeight;
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
