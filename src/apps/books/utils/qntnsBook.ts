// qntns.com books (CHECKLIST-36 §14): ports QNTNs-ghost assets/js/qntns/lock.js,
// unlocked.js, sync.js's syncUnlocks and listing.js's gift checkout. The locked
// text never reaches the browser until the Worker accepts the phrase; that split
// is the security boundary and lives in the Worker, not here.
import DOMPurify from "dompurify";
import type { GhostBook } from "@/lib/ghost";

const WORKER = "https://qntns-reads.qstaley921.workers.dev";

// `<content>ishta-draft</content>` typed as text; Ghost serves it escaped in a <p>.
const POINTER = /^<content>\s*([\w-]+)\s*<\/content>$/i;

export type FreeHalf = {
  html: string;
  lockedLength?: number;
  lockedHeadings?: { level: number; text: string }[];
};

export type ParsedBook = {
  head: string; // body before the pointer (listing text, images, audio)
  tail: string; // body after the pointer
  draft: string | null;
  buy: { href: string; label: string } | null;
  price: string;
  preorder: boolean;
};

// Embeds keep their <iframe> only when src is https; <style> would restyle the desktop.
DOMPurify.addHook("uponSanitizeElement", (node, data) => {
  if (data.tagName === "iframe" && !/^https:\/\//i.test((node as Element).getAttribute("src") ?? "")) node.parentNode?.removeChild(node);
});
export const clean = (html: string) =>
  DOMPurify.sanitize(html, {
    ADD_TAGS: ["iframe"],
    ADD_ATTR: ["allow", "allowfullscreen", "frameborder"],
    FORBID_TAGS: ["style"],
  });

const outer = (nodes: Element[]) => nodes.map((n) => n.outerHTML).join("");

export function parseBook(book: GhostBook): ParsedBook {
  const doc = new DOMParser().parseFromString(clean(book.html ?? ""), "text/html");
  const button = doc.body.querySelector<HTMLAnchorElement>(".kg-button-card .kg-btn");
  const buy = button?.getAttribute("href")
    ? { href: button.getAttribute("href")!, label: button.textContent!.trim() }
    : null;
  button?.closest(".kg-button-card")?.remove();
  const kids = [...doc.body.children];
  const at = kids.findIndex((n) => n.matches("p") && POINTER.test(n.textContent!.trim()));
  const names = (book.tags ?? []).map((t) => t.name);
  return {
    head: outer(at < 0 ? kids : kids.slice(0, at)),
    tail: at < 0 ? "" : outer(kids.slice(at + 1)),
    draft: at < 0 ? null : POINTER.exec(kids[at].textContent!.trim())![1],
    buy,
    price: (names.find((n) => n.startsWith("#$")) ?? "").slice(1),
    preorder: names.includes("#preorder"),
  };
}

/* ---- Worker calls. Each mirrors lock.js / listing.js exactly. ---- */

// null on any failure: the pointer paragraph stays as typed and no gate is built.
export async function fetchFree(book: string, draft: string): Promise<FreeHalf | null> {
  try {
    const r = await fetch(`${WORKER}/lock/${encodeURIComponent(book)}/${encodeURIComponent(draft)}`, { signal: AbortSignal.timeout(8000) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

// string = opened html, null = wrong phrase (401), undefined = unreachable.
export async function unlock(book: string, draft: string, phrase: string): Promise<string | null | undefined> {
  let r: Response;
  try {
    r = await fetch(`${WORKER}/lock/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ book, draft, phrase }),
    });
  } catch {
    return undefined;
  }
  if (r.status === 401) return null;
  if (!r.ok) return undefined;
  try {
    return (await r.json()).html || null;
  } catch {
    return undefined;
  }
}

// The Worker's own EPUB (§14p): Blob on 200, null on anything else (401 included;
// unlock's path judges the phrase, so nothing is forgotten here).
export async function fetchEpub(book: string, phrase: string): Promise<Blob | null> {
  try {
    const r = await fetch(`${WORKER}/lock/epub`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ book, phrase }),
      signal: AbortSignal.timeout(10000),
    });
    return r.status === 200 ? await r.blob() : null;
  } catch {
    return null;
  }
}

export type Suggestion = { line1?: string; city?: string; state?: string; zip?: string };

// [] on any failure: no list, never an error.
export async function suggest(params: Record<string, string>, signal: AbortSignal): Promise<Suggestion[]> {
  try {
    const r = await fetch(`${WORKER}/postcard/suggest?${new URLSearchParams(params)}`, { signal });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j?.suggestions) ? j.suggestions : [];
  } catch {
    return [];
  }
}

export type GiftOrder = {
  book: string;
  qty: number;
  gift: {
    name: string;
    message: string;
    email: string;
    sendDate?: string;
    tzOffset?: number;
    address: { name: string; line1: string; line2: string; city: string; state: string; zip: string };
  };
};

// Throws; the caller puts "Try again" on the button.
export async function checkout(order: GiftOrder): Promise<string> {
  const r = await fetch(`${WORKER}/book/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(order),
  });
  if (!r.ok) throw new Error(String(r.status));
  const j = await r.json();
  if (typeof j?.url !== "string" || !j.url.startsWith("https://")) throw new Error("url");
  return j.url;
}

/* ---- Saved phrases: the site's own localStorage record (unlocked.js), same
   origin, so a book unlocked on the site page opens here and back. ---- */

const KEY = "qntns:unlocked";
type Entry = { p: string; t: number };

function load(): Record<string, Entry> {
  try {
    const books = JSON.parse(localStorage.getItem(KEY) || "{}")?.books;
    if (!books || typeof books !== "object" || Array.isArray(books)) return {};
    const out: Record<string, Entry> = {};
    for (const [slug, e] of Object.entries(books as Record<string, Entry>)) {
      if (slug && typeof e?.p === "string" && e.p) out[slug] = { p: e.p, t: Number(e.t) || 0 };
    }
    return out;
  } catch {
    return {};
  }
}

function save(books: Record<string, Entry>) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, books }));
  } catch {
    // Storage full or blocked: the phrase is asked for again next time.
  }
}

export const savedPhrase = (draft: string) => load()[draft]?.p ?? "";

export function rememberPhrase(draft: string, p: string) {
  if (!p) return;
  save({ ...load(), [draft]: { p, t: Date.now() } });
}

export function forgetPhrase(draft: string) {
  const books = load();
  if (!(draft in books)) return;
  delete books[draft];
  save(books);
}

// Newer wins; returns how many phrases arrived or changed.
export function mergePhrases(remote: unknown): number {
  if (!remote || typeof remote !== "object") return 0;
  const books = load();
  let added = 0;
  for (const [slug, e] of Object.entries(remote as Record<string, Entry>)) {
    if (!slug || typeof e?.p !== "string" || !e.p) continue;
    const t = Number(e.t) || 0;
    const mine = books[slug];
    if (mine && mine.t >= t) continue;
    if (!mine || mine.p !== e.p) added += 1;
    books[slug] = { p: e.p, t };
  }
  if (added) save(books);
  return added;
}

// POST /unlocks, signed-in readers only (no member token, no call). Silent.
export async function syncUnlocks(): Promise<number> {
  try {
    const s = await fetch("/members/api/session", { credentials: "include", signal: AbortSignal.timeout(8000) });
    const token = s.status === 200 ? (await s.text()).trim() : "";
    if (!token) return 0;
    const r = await fetch(`${WORKER}/unlocks`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ v: 1, books: load() }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return 0;
    return mergePhrases((await r.json())?.books);
  } catch {
    return 0;
  }
}

/* ---- Gift form rules, from listing.js / postcard.js validateAddress. ---- */

export const QTY_MIN = 1;
export const QTY_MAX = 99;
export const GIFT_MESSAGE_MAX = 500; // Stripe caps a metadata value at 500.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const GIFT_REQUIRED = {
  name: "recipient name",
  line1: "address",
  city: "city",
  state: "state",
  zip: "zip code",
} as const;
export type GiftFields = Record<keyof typeof GIFT_REQUIRED | "line2" | "email" | "message" | "sendDate", string>;

// The first field that blocks the gift, or null when it can be sent.
export function firstBadField(f: GiftFields): keyof GiftFields | null {
  for (const k of Object.keys(GIFT_REQUIRED) as (keyof typeof GIFT_REQUIRED)[]) if (!f[k].trim()) return k;
  if (!/^[A-Z]{2}$/.test(f.state.trim().toUpperCase())) return "state";
  if (!/^\d{5}(-?\d{4})?$/.test(f.zip.trim())) return "zip";
  const email = f.email.trim();
  if (email && !EMAIL_SHAPE.test(email)) return "email";
  if (email && !f.sendDate) return "sendDate";
  return null;
}

export function giftOrder(book: string, f: GiftFields): GiftOrder {
  const email = f.email.trim();
  return {
    book,
    qty: 1, // a gift is always one copy
    gift: {
      name: f.name.trim(),
      message: f.message.trim(),
      email,
      // No email means no send date: nobody to send to.
      ...(email ? { sendDate: f.sendDate, tzOffset: new Date().getTimezoneOffset() } : {}),
      address: {
        name: f.name.trim(),
        line1: f.line1.trim(),
        line2: f.line2.trim(),
        city: f.city.trim(),
        state: f.state.trim().toUpperCase(),
        zip: f.zip.trim(),
      },
    },
  };
}

// "$20" × 3 → "$60", integer cents, as listing.js does it.
export function priceTimes(price: string, n: number): string {
  const m = /(\d[\d,]*)(?:\.(\d+))?/.exec(price);
  if (!m) return price;
  const [run, whole, frac = ""] = m;
  const units = String(BigInt(whole.replaceAll(",", "") + frac) * BigInt(n)).padStart(frac.length + 1, "0");
  let head = units.slice(0, units.length - frac.length);
  if (whole.includes(",")) head = head.replace(/\B(?=(\d{3})+$)/g, ",");
  return price.replace(run, head + (frac && `.${units.slice(-frac.length)}`));
}
