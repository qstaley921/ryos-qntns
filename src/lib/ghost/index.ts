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
};
export type GhostBody = GhostDoc & { html: string };
export type GhostList = { docs: GhostDoc[]; tags: GhostTag[] };

const LIVE = "https://www.qntns.com";
// Public Content API key (Ghost prints it in every page); Storybook fallback only.
const LIVE_KEY = "c6d872b64fc4140d85955a4341";
const LIST_FIELDS = "id,slug,title,url,published_at,feature_image,excerpt";
const EMPTY: GhostList = { docs: [], tags: [] };

const inPage = typeof document !== "undefined" && !!document.querySelector("script[data-ghost]");

function api(): { base: string; key: string } {
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

// shortcut: first 100 of each kind, no paging; page when the site passes 100.
async function fetchList(): Promise<GhostList> {
  const p = { limit: "100", include: "tags" };
  const [posts, pages, tags] = await Promise.all([
    get<{ posts: GhostDoc[] }>("posts", { ...p, fields: LIST_FIELDS }),
    get<{ pages: GhostDoc[] }>("pages", { ...p, fields: LIST_FIELDS }),
    get<{ tags: GhostTag[] }>("tags", { limit: "100", fields: "id,slug,name" }),
  ]);
  return {
    docs: [
      ...posts.posts.map((d) => ({ ...d, type: "post" as const })),
      ...pages.pages.map((d) => ({ ...d, type: "page" as const })),
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

export async function listDocs(): Promise<GhostList> {
  try {
    return (inPage ? baked() : null) ?? (await fetchList());
  } catch {
    return EMPTY;
  }
}

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
