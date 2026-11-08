// Photos (CHECKLIST-37 §13c): every photo post's body in one Content API call
// when Photos opens, so Library can show each album's first photo and an
// opened album reuses the body. Silent on failure (empty map).
import { api, type GhostBody } from ".";

// shortcut: first 100 photo posts, no paging; page when there are more.
export async function listPhotoBodies(): Promise<Record<string, GhostBody>> {
  try {
    const { base, key } = api();
    const q = new URLSearchParams({
      key,
      filter: "tag:photos",
      limit: "100",
      formats: "html",
      include: "tags", // albumOf reads #slideshow
      fields: "id,html,codeinjection_head,codeinjection_foot", // the show lives in code injection
    });
    const r = await fetch(`${base}/ghost/api/content/posts/?${q}`);
    if (!r.ok) return {};
    const { posts } = (await r.json()) as { posts: GhostBody[] };
    return Object.fromEntries(posts.map((p) => [p.id, p]));
  } catch {
    return {};
  }
}
