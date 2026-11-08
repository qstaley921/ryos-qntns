// Ghost members, the way the theme's Portal does it: same-origin /members/api/,
// the browser's own member cookie, magic-link email for both sign in and sign
// up (Ghost has no passwords). No code here sees or stores the cookie.
import { useSyncExternalStore } from "react";

export type GhostMember = { email: string; name: string | null };

const API = "/members/api";

let member: GhostMember | null = null;
const subs = new Set<() => void>();
const set = (m: GhostMember | null) => {
  member = m;
  subs.forEach((f) => f());
};

// 200 is a member; 204/401/anything else (or no Ghost, as in Storybook) is
// signed out. Silent on failure.
let loaded = false;
async function load() {
  if (loaded) return;
  loaded = true;
  try {
    const r = await fetch(`${API}/member/`, {
      credentials: "same-origin",
      signal: AbortSignal.timeout(8000),
    });
    if (r.status !== 200) return;
    const m = await r.json();
    if (typeof m?.email === "string") set({ email: m.email, name: m.name || null });
  } catch {
    loaded = false; // let the next subscriber retry
  }
}

export function useMember(): GhostMember | null {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      void load();
      return () => subs.delete(f);
    },
    () => member,
    () => null
  );
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Throws an Error with a message fit to show. "signup" makes a member on the
// site's subscribe-on-signup newsletters (= subscribe); Ghost sends an
// existing member a sign-in link instead. The Referer (this page) is where
// the link brings the reader back.
export async function sendMagicLink(email: string, emailType: "signin" | "signup") {
  const e = email.trim();
  if (!EMAIL.test(e)) throw new Error("Enter a valid email address.");
  const FAIL = "Couldn't send. Try again.";
  let r: Response;
  try {
    const tok = await fetch(`${API}/integrity-token/`, {
      credentials: "same-origin",
      signal: AbortSignal.timeout(8000),
    });
    if (!tok.ok) throw new Error(FAIL);
    r = await fetch(`${API}/send-magic-link/`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: e, emailType, integrityToken: await tok.text() }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new Error(FAIL);
  }
  if (r.ok) return;
  const msg = await r
    .json()
    .then((j) => j?.errors?.[0]?.message)
    .catch(() => null);
  throw new Error(typeof msg === "string" && msg ? msg : "Couldn't send. Try again.");
}

// Portal's sign-out: DELETE the session, then reload so the theme's own
// scripts (comments, likes, wall, sync) see the signed-out page.
export async function signOut() {
  try {
    await fetch(`${API}/session`, { method: "DELETE", credentials: "same-origin" });
  } catch {
    // reload anyway
  } finally {
    location.reload();
  }
}
