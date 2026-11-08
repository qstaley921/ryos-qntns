// Safari's bookmarks (CHECKLIST-37 §28b): a hardcoded list, no fetch. The Ghost-pages
// version (#friend / #portfolio tagged pages via the Content API) is in git history.
export type Bookmark = { id: string; title: string; url: string; excerpt: string };
export type Bookmarks = { friends: Bookmark[]; portfolio: Bookmark[] };

// The QNTNs Worker; the theme's one runtime origin (QNTNs-ghost CLAUDE.md).
const WORKER = "https://qntns-reads.qstaley921.workers.dev";

const b = (id: string, title: string, url: string): Bookmark => ({ id, title, url, excerpt: "" });
const LIST: Bookmarks = {
  friends: [
    b("julia", "J\u00falia - Land of J\u00falia", "https://landofjulia.com"),
    b("burke", "Burke", "https://burkeswanson.com"),
    b("yogananda", "Yogananda", "https://yogananda.org"),
  ],
  portfolio: [
    b("jostaley", "Jostaley.com", "https://jostaley.com"),
    b("coldfoam", "Coldfoamconsultancy.com", "https://coldfoamconsultancy.com"),
    b("kalstaley", "Kalstaley.com", "https://kalstaley.com"),
  ],
};

export const loadBookmarks = (): Promise<Bookmarks> => Promise.resolve(LIST);

// Whether the site lets www.qntns.com frame it. Any failure or a 4 s wait = no (link-out card).
export async function canFrame(url: string): Promise<boolean> {
  try {
    const r = await fetch(`${WORKER}/frame-ok?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(4000) });
    return r.ok && (await r.json()).ok === true;
  } catch {
    return false;
  }
}
