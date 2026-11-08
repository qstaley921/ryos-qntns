// Reads qntns.com posts, pages and tags. List: baked {{#get}} JSON, else one
// Content API call. Body: Content API on open. Every failure is silent (empty).
export type GhostTag = { id: string; slug: string; name: string };
export type GhostDoc = {
  id: string;
  slug: string;
  title: string;
  type: "post" | "page";
  url: string;
  published_at: string | null;
  feature_image: string | null;
  excerpt: string | null;
  tags: GhostTag[];
  words?: number; // plaintext word count; absent when the list came from the baked JSON
};
export type GhostBody = GhostDoc & { html: string };
export type GhostList = { docs: GhostDoc[]; tags: GhostTag[] };

// ghost.io host, not www.qntns.com: www 302s here with no CORS header, so Storybook's cross-origin list call was blocked (CHECKLIST-36 §11b).
const LIVE = "https://qntns.ghost.io";
// Public Content API key (Ghost prints it in every page); Storybook fallback only.
const LIVE_KEY = "c6d872b64fc4140d85955a4341";
const LIST_FIELDS = "id,slug,title,url,published_at,feature_image,excerpt";
const EMPTY: GhostList = { docs: [], tags: [] };

const inPage = typeof document !== "undefined" && !!document.querySelector("script[data-ghost]");

// Exported for TextEdit's comments-ui script (CHECKLIST-36 §12b).
export function api(): { base: string; key: string } {
  const s = document?.querySelector<HTMLScriptElement>("script[data-key][data-ghost]");
  if (s?.dataset.key) {
    return { base: (s.dataset.ghost ?? "").replace(/\/$/, "") || location.origin, key: s.dataset.key };
  }
  return { base: LIVE, key: LIVE_KEY };
}

async function get<T>(path: string, params: Record<string, string>): Promise<T> {
  const { base, key } = api();
  const q = new URLSearchParams({ key, ...params });
  const r = await fetch(`${base}/ghost/api/content/${path}/?${q}`);
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

// Count words from the list call's plaintext, then drop the text.
function words(d: GhostDoc & { plaintext?: string }): GhostDoc {
  const { plaintext, ...rest } = d;
  return plaintext == null ? rest : { ...rest, words: plaintext.split(/\s+/).filter(Boolean).length };
}

// shortcut: first 100 of each kind, no paging; page when the site passes 100.
async function fetchList(): Promise<GhostList> {
  const p = { limit: "100", include: "tags" };
  const [posts, pages, tags] = await Promise.all([
    get<{ posts: GhostDoc[] }>("posts", { ...p, fields: LIST_FIELDS + ",plaintext", formats: "plaintext" }),
    get<{ pages: GhostDoc[] }>("pages", { ...p, fields: LIST_FIELDS + ",plaintext", formats: "plaintext" }),
    get<{ tags: GhostTag[] }>("tags", { limit: "100", fields: "id,slug,name" }),
  ]);
  return {
    docs: [
      ...posts.posts.map((d) => ({ ...words(d), type: "post" as const })),
      ...pages.pages.map((d) => ({ ...words(d), type: "page" as const })),
    ],
    tags: tags.tags,
  };
}

// Theme bakes <script type="application/json" id="ryos-ghost">{"posts":[..],"pages":[..],"tags":[..]}</script>
function baked(): GhostList | null {
  try {
    const el = document.getElementById("ryos-ghost");
    if (!el?.textContent) return null;
    const j = JSON.parse(el.textContent);
    return {
      docs: [
        ...(j.posts ?? []).map((d: GhostDoc) => ({ ...d, type: "post" as const })),
        ...(j.pages ?? []).map((d: GhostDoc) => ({ ...d, type: "page" as const })),
      ],
      tags: j.tags ?? [],
    };
  } catch {
    return null;
  }
}

// Each list fetches once per page load; a failure is dropped so a later open retries.
function memo<T>(fn: () => Promise<T>, fallback: T): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () =>
    (p ??= fn().catch(() => {
      p = null;
      return fallback;
    }));
}

export const listDocs = memo(async () => (inPage ? baked() : null) ?? (await fetchList()), EMPTY);

export async function openDoc(d: Pick<GhostDoc, "id" | "type">): Promise<GhostBody | null> {
  try {
    const k = d.type === "page" ? "pages" : "posts";
    const r = await get<Record<string, GhostBody[]>>(`${k}/${d.id}`, { formats: "html", include: "tags" });
    const b = r[k][0];
    return { ...b, type: d.type };
  } catch {
    return null;
  }
}

// Videos: posts whose body holds a Ghost video card, newest first. One list
// call with html (the list has no body); the <video src> is the playable file.
export type GhostVideo = { id: string; url: string; title: string };
export const listVideos = memo(async (): Promise<GhostVideo[]> => {
  // shortcut: first 100 posts, no paging; page when the site passes 100.
  const r = await get<{ posts: (GhostDoc & { html: string })[] }>("posts", {
    limit: "100", order: "published_at desc", formats: "html", fields: "id,title,html",
  });
  return r.posts.flatMap((p) => {
    const m = /<video[^>]*\ssrc="([^"]+)"/.exec(p.html ?? "");
    return m ? [{ id: p.id, url: m[1], title: p.title }] : [];
  });
}, []);

// Posts carrying the internal #home-content tag, or any of `extra` tag slugs (OR), as plain
// text. Not served from the baked JSON (no html, internal tag hidden there); one Content API call.
// Cached per `extra` list, so the desktop's no-arg call and Journal's call don't share a result.
export type HomeDoc = { id: string; published_at: string | null; text: string; kinds: string[] };
const homeCache = new Map<string, Promise<HomeDoc[]>>();
export function listHomeContent(extra: string[] = []): Promise<HomeDoc[]> {
  const key = extra.join(",");
  if (!homeCache.has(key)) {
    homeCache.set(key, fetchHome(["hash-home-content", ...extra]).catch(() => { homeCache.delete(key); return []; }));
  }
  return homeCache.get(key)!;
}
async function fetchHome(tags: string[]): Promise<HomeDoc[]> {
  const r = await get<{ posts: { id: string; published_at: string | null; html: string; tags: GhostTag[] }[] }>("posts", {
    filter: `tag:[${tags.join(",")}]`,
    include: "tags",
    limit: "all",
    fields: "id,published_at,html",
    formats: "html",
    order: "published_at desc",
  });
  return r.posts.map((p) => ({
    id: p.id,
    published_at: p.published_at,
    // public tags only; internal ones start with "#"
    kinds: p.tags.map((t) => t.name).filter((n) => !n.startsWith("#")),
    text: new DOMParser()
      .parseFromString(p.html.replace(/<\/(p|blockquote|li|h\d)>/g, "$&\n\n"), "text/html")
      .body.textContent!.trim(),
  }));
}

export type GhostAudioPost = Pick<GhostDoc, "id" | "title" | "url" | "published_at" | "feature_image" | "tags"> & { html: string };

// iPod (CHECKLIST-36 §23): posts whose body holds a Ghost audio card. The list
// has no html, so this is one posts call with formats=html.
// shortcut: first 100 posts only; page when the site passes 100.
export const listAudioPosts = memo(async (): Promise<GhostAudioPost[]> => {
  const r = await get<{ posts: GhostAudioPost[] }>("posts", {
    limit: "100",
    formats: "html",
    include: "tags", // iPod Podcasts, one per tag (§55)
    fields: "id,title,url,published_at,feature_image,html",
  });
  return r.posts.filter((p) => p.html?.includes("kg-audio-card"));
}, []);

// Books (CHECKLIST-36 §14): #password posts, with html (the <content> pointer,
// the buy button) and tags (#$20 price, #preorder; internal tags ride include=tags).
// shortcut: first 100 books, no paging; page when there are more.
export type GhostBook = Pick<GhostDoc, "id" | "slug" | "title" | "url" | "feature_image" | "tags"> & { html: string };
export const listBooks = memo(async (): Promise<GhostBook[]> => {
  const r = await get<{ posts: GhostBook[] }>("posts", {
    filter: "tag:hash-password",
    limit: "100",
    formats: "html",
    include: "tags",
    fields: "id,slug,title,url,feature_image,html",
  });
  return r.posts;
}, []);
