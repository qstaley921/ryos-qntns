import { useEffect, useMemo, useState } from "react";
import {
  ghostPlaces,
  isFolderTag,
  RECENTS_PATH,
  type useGhostList,
} from "@/apps/finder/utils/ghostPlaces";
import { listHomeContent } from "@/lib/ghost";

export interface ContentFolder {
  name: string;
  path: string;
  icon: string;
}

/** One folder per public tag with >=1 non-home-content post, most posts first. Shared by the desktop and Finder's Macintosh HD. */
export function useContentFolders(
  ghost: ReturnType<typeof useGhostList>
): ContentFolder[] {
  // Ids of #home-content posts (quotes, rules, notes: Journal only, no folder).
  // The baked list hides internal tags, so one read-only Content API call.
  const [homeIds, setHomeIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    let live = true;
    listHomeContent().then((r) => live && setHomeIds(new Set(r.map((p) => p.id))));
    return () => {
      live = false;
    };
  }, []);
  return useMemo(() => {
    const posts = ghost.docs.filter((d) => d.type === "post" && !homeIds.has(d.id));
    const count = (slug: string) =>
      posts.filter((d) => d.tags.some((t) => t.slug === slug)).length;
    return ghostPlaces(ghost)
      .filter((p) => p.path !== RECENTS_PATH)
      .filter((p) => !p.name.startsWith("#") && !p.path.startsWith("/Tag-hash-"))
      .filter((p) => isFolderTag({ name: p.name, slug: p.path.slice(5) }))
      .map((p) => ({
        ...p,
        n: count(p.path.startsWith("/Tag-") ? p.path.slice(5) : "poems"),
      }))
      .filter((p) => p.n > 0)
      .sort((a, b) => b.n - a.n)
      .map(({ name, path, icon }) => ({ name, path, icon }));
  }, [ghost, homeIds]);
}
