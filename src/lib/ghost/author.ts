import { api } from "@/lib/ghost";

export type GhostAuthor = { name: string; profile_image: string | null; bio: string | null };

// Baked {"authors":[..]} in #ryos-ghost if the theme has it, else one Content API call. Throws on failure.
export async function getAuthor(slug = "quentin"): Promise<GhostAuthor> {
  try {
    const a = JSON.parse(document.getElementById("ryos-ghost")?.textContent ?? "{}").authors?.find(
      (x: GhostAuthor & { slug: string }) => x.slug === slug,
    );
    if (a) return a;
  } catch {
    /* no baked data */
  }
  const { base, key } = api();
  const q = new URLSearchParams({ key, fields: "name,profile_image,bio" });
  const r = await fetch(`${base}/ghost/api/content/authors/slug/${slug}/?${q}`);
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()).authors[0];
}
