export const WORKER = "https://qntns-reads.qstaley921.workers.dev";
export const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
export const BOOKED_TITLE = "Booked with Quentin";

export type BookLocation = { type: string; label: string };

const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
export const parseGuests = (g: string) => g.split(/[,\s;]+/).filter(Boolean);

/** The one validity rule for a booking: name, email, up to five valid guest emails. */
export function bookingValid(name: string, email: string, guests: string[]) {
  return !!name.trim() && isEmail(email.trim()) && guests.length <= 5 && guests.every(isEmail);
}

/** The one POST /cal/book. Resolves the HTTP status; 0 on a network failure. */
export async function postBook(f: { name: string; email: string; start: string; guests: string[]; location?: number }) {
  try {
    const r = await fetch(`${WORKER}/cal/book`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: f.name.trim(), email: f.email.trim(), start: f.start, timeZone: tz,
        ...(f.guests.length && { guests: f.guests }),
        ...(f.location !== undefined && { location: f.location }),
      }),
    });
    return r.status;
  } catch {
    return 0;
  }
}

export const getLocations = (): Promise<BookLocation[]> =>
  fetch(`${WORKER}/cal/event`).then((r) => (r.ok ? r.json() : null))
    .then((j) => (Array.isArray(j?.locations) ? j.locations : []), () => []).catch(() => []);

export const getSlots = (week: string): Promise<string[]> =>
  fetch(`${WORKER}/cal/slots?week=${week}`).then((r) => (r.ok ? r.json() : null))
    .then((j) => (Array.isArray(j?.slots) ? j.slots : []), () => []).catch(() => []);
