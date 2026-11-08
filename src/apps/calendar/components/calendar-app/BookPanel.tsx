import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { type BookLocation, bookingValid, getLocations, getSlots, parseGuests, postBook } from "./booking";

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/** The author's free times for the shown week (cal.com via the Worker); a click opens name + email, Book sends it. */
export function BookPanel({ week }: { week: string }) {
  const [slots, setSlots] = useState<string[]>([]);
  const [pick, setPick] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "failed">("idle");
  const [nonce, setNonce] = useState(0);
  const [guests, setGuests] = useState("");
  const [locations, setLocations] = useState<BookLocation[]>([]);
  const [loc, setLoc] = useState(0);

  useEffect(() => { getLocations().then(setLocations); }, []);

  useEffect(() => {
    let live = true;
    setSlots([]);
    setPick(null);
    getSlots(week).then((l) => live && setSlots(l));
    return () => { live = false; };
  }, [week, nonce]);

  const guestList = parseGuests(guests);
  const book = async () => {
    setState("sending");
    const status = await postBook({ name, email, start: pick!, guests: guestList, location: locations.length ? loc : undefined });
    if (status === 409) setNonce((n) => n + 1); // slot just taken: refresh the week
    if (status < 200 || status >= 300) return setState("failed");
    setState("done");
    setPick(null);
    setNonce((n) => n + 1);
  };

  if (!slots.length && state !== "done") return null;
  const valid = bookingValid(name, email, guestList);
  const days = new Map<string, string[]>();
  for (const s of slots) {
    const k = dayFmt.format(new Date(s));
    days.set(k, [...(days.get(k) ?? []), s]);
  }

  return (
    <div className="shrink-0 border-b border-black/10 bg-white p-2 text-[11px] max-h-32 overflow-y-auto">
      {state === "done" && <div className="mb-1">Booked. Check your email for the invite.</div>}
      {[...days].map(([day, list]) => (
        <div key={day} className="flex flex-wrap items-center gap-1 mb-1">
          <span className="w-24 shrink-0">{day}</span>
          {list.map((s) => (
            <button key={s} type="button" onClick={() => { setPick(s); setState("idle"); }}
              className={`px-1.5 border border-black/30 ${pick === s ? "bg-black text-white" : ""}`}>
              {timeFmt.format(new Date(s))}
            </button>
          ))}
        </div>
      ))}
      {pick && (
        <div className="flex flex-wrap items-center gap-1 mt-1">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="w-32 h-6" />
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" className="w-44 h-6" />
          <Input value={guests} onChange={(e) => setGuests(e.target.value)} placeholder="Guest emails (optional, up to 5)" className="w-52 h-6" />
          {locations.length > 0 && (
            <select value={loc} onChange={(e) => setLoc(Number(e.target.value))} className="h-6 border border-black/30 bg-white">
              {locations.map((l, i) => <option key={i} value={i}>{l.label || l.type}</option>)}
            </select>
          )}
          <Button size="sm" disabled={!valid || state === "sending"} onClick={book}>
            {state === "failed" ? "Try again" : "Book"}
          </Button>
          {state === "failed" && <span>Couldn't book. Try again.</span>}
        </div>
      )}
    </div>
  );
}
