import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const WORKER = "https://qntns-reads.qstaley921.workers.dev";
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
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
  const [locations, setLocations] = useState<{ type: string; label: string }[]>([]);
  const [loc, setLoc] = useState(0);

  useEffect(() => {
    fetch(`${WORKER}/cal/event`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setLocations(Array.isArray(j?.locations) ? j.locations : []))
      .catch(() => {}); // silent: no picker
  }, []);

  useEffect(() => {
    let live = true;
    setSlots([]);
    setPick(null);
    fetch(`${WORKER}/cal/slots?week=${week}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => live && setSlots(Array.isArray(j?.slots) ? j.slots : []))
      .catch(() => {}); // silent: empty week
    return () => { live = false; };
  }, [week, nonce]);

  const guestList = guests.split(/[,\s;]+/).filter(Boolean);
  const book = async () => {
    setState("sending");
    try {
      const r = await fetch(`${WORKER}/cal/book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), start: pick, timeZone: tz, ...(guestList.length && { guests: guestList }), ...(locations.length && { location: loc }) }),
      });
      if (r.status === 409) setNonce((n) => n + 1); // slot just taken: refresh the week
      if (!r.ok) return setState("failed");
      setState("done");
      setPick(null);
      setNonce((n) => n + 1);
    } catch {
      setState("failed");
    }
  };

  if (!slots.length && state !== "done") return null;
  const ok = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  const valid = name.trim() && ok(email.trim()) && guestList.length <= 5 && guestList.every(ok);
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
