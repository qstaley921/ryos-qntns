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

// The bookmark's home page through the Worker's /site/ proxy (CHECKLIST-37 §28c): the
// sites refuse framing, so the Worker serves their home page's HTML; every click opens
// the real site in a new tab.
export const proxied = (url: string) => `${WORKER}/site/${new URL(url).host}/`;

// Whether the proxy answers 2xx (Safari then frames it; anything else = the link-out card).
// Read first because a frame cannot tell an error page from a page; the second load is a memo hit only on the same isolate (Vary: Origin misses the browser cache).
export async function proxyOk(url: string): Promise<boolean> {
  try {
    return (await fetch(proxied(url), { signal: AbortSignal.timeout(10000) })).ok;
  } catch {
    return false;
  }
}
