// Safari's bookmarks (CHECKLIST-37 §28): one Ghost page per site, internal tag
// #friend or #portfolio, title = name, canonical URL = site (else the body's
// first link), excerpt = one line. One Content API call; every failure is silent.
import { api } from "@/lib/ghost";

export type Bookmark = { id: string; title: string; url: string; excerpt: string };
export type Bookmarks = { friends: Bookmark[]; portfolio: Bookmark[] };

// The QNTNs Worker; the theme's one runtime origin (QNTNs-ghost CLAUDE.md).
const WORKER = "https://qntns-reads.qstaley921.workers.dev";

type Page = {
  id: string;
  title: string;
  canonical_url: string | null;
  custom_excerpt: string | null;
  excerpt: string | null;
  html: string | null;
  tags: { slug: string }[];
};

const firstLink = (html: string | null) => /<a\s[^>]*href="(https?:\/\/[^"]+)"/i.exec(html ?? "")?.[1].replace(/&amp;/g, "&") ?? "";

let cached: Promise<Bookmarks> | null = null;
export function loadBookmarks(): Promise<Bookmarks> {
  return (cached ??= (async () => {
    const { base, key } = api();
    const q = new URLSearchParams({
      key,
      filter: "tag:[hash-friend,hash-portfolio]",
      include: "tags",
      formats: "html",
      limit: "all",
      order: "title asc",
    });
    const r = await fetch(`${base}/ghost/api/content/pages/?${q}`);
    if (!r.ok) throw new Error(String(r.status));
    const { pages } = (await r.json()) as { pages: Page[] };
    const out: Bookmarks = { friends: [], portfolio: [] };
    for (const p of pages) {
      const url = p.canonical_url || firstLink(p.html);
      if (!/^https?:\/\//.test(url)) continue;
      const b = { id: p.id, title: p.title, url, excerpt: p.custom_excerpt || p.excerpt || "" };
      const tags = p.tags.map((t) => t.slug);
      if (tags.includes("hash-friend")) out.friends.push(b);
      if (tags.includes("hash-portfolio")) out.portfolio.push(b);
    }
    return out;
  })().catch(() => {
    cached = null; // a later open retries
    return { friends: [], portfolio: [] };
  }));
}

// Whether the site lets www.qntns.com frame it. Any failure or a 4 s wait = no (link-out card).
export async function canFrame(url: string): Promise<boolean> {
  try {
    const r = await fetch(`${WORKER}/frame-ok?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(4000) });
    return r.ok && (await r.json()).ok === true;
  } catch {
    return false;
  }
}
