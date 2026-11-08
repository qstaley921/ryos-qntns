import { useEffect, useMemo, useState } from "react";
import { readKey, readEntries, markRead as markReadUrl } from "@/apps/paint/wall/qntns/reads.js";
import { getCounts } from "@/apps/paint/wall/qntns/counts.js";
import { listDocs, listHomeContent, type GhostDoc, type GhostList } from "@/lib/ghost";
import type { ExtendedDisplayFileItem } from "./fileSystemHelpers";

// Virtual Finder places over Ghost posts: /Poems, /Tag-<slug>. Recents lives only in Apple > Recent Items.
// Not in the files store, so nothing here is writable or synced.
export const POEMS_PATH = "/Poems";
export const RECENTS_PATH = "/Recents";
const TAG_PREFIX = "/Tag-";
const POEMS_TAG = "poems";

// Ids of #home-content posts (quotes, rules, notes): Journal only, no Finder folder or Recents.
// The baked list hides internal tags, so useGhostList loads them once (read-only) into this set.
let homeIds = new Set<string>();
/** A tag is a Finder folder candidate only when public (not "#name" / "hash-slug"). Same rule as the desktop. */
export const isPublicTag = (t: { name: string; slug: string }) =>
  !t.name.startsWith("#") && !t.slug.startsWith("hash-");

/** Tags that live in Journal, not Finder or the desktop (CHECKLIST-36 §57). Matched on slug or lower-cased name. */
export const JOURNAL_KINDS = ["lessons", "quotes", "notes", "rules", "goals", "excerpts", "products"];
/** Tags that live in another app: Store (books), Photos. */
export const OTHER_APP_TAGS = ["store", "photos"];
const hit = (list: string[], t: { name: string; slug: string }) =>
  list.includes(t.slug) || list.includes(t.name.toLowerCase());
export const isJournalKind = (t: { name: string; slug: string }) => hit(JOURNAL_KINDS, t);
/** A tag gets a Finder/desktop folder: public, and in neither list. */
export const isFolderTag = (t: { name: string; slug: string }) =>
  isPublicTag(t) && !isJournalKind(t) && !hit(OTHER_APP_TAGS, t);

let cache: Promise<GhostList> | null = null;
export function useGhostList(): GhostList {
  const [list, setList] = useState<GhostList>({ docs: [], tags: [] });
  useEffect(() => {
    cache ??= listDocs().then(async (l) => {
      homeIds = new Set((await listHomeContent().catch(() => [])).map((p) => p.id));
      return { ...l }; // new identity so memoized place lists recompute with homeIds
    });
    let live = true;
    cache.then((l) => live && setList(l));
    return () => {
      live = false;
    };
  }, []);
  return list;
}

export type GhostCounts = Record<string, { views?: number; likes?: number }>;

// Counts (CHECKLIST-36 §44's GET /counts) and the cross-device read sync (§45), both after first paint,
// both silent on failure. `tick` bumps when a sync merged reads so the lists repaint.
let extras: Promise<GhostCounts> | null = null;
export function useGhostExtras(l: GhostList): { counts: GhostCounts; tick: number } {
  const [counts, setCounts] = useState<GhostCounts>({});
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!l.docs.length) return;
    extras ??= new Promise<GhostCounts>((res) =>
      setTimeout(async () => {
        try {
          const { syncReads } = await import("@/apps/paint/wall/qntns/sync.js");
          await syncReads();
        } catch { /* silent */ }
        res((await getCounts(l.docs.map((d) => d.slug)).catch(() => null)) ?? {});
      }, 1500)
    );
    let live = true;
    extras.then((c) => live && setCounts(c));
    const bump = () => setTick((n) => n + 1);
    document.addEventListener("qntns:reads-synced", bump);
    return () => {
      live = false;
      document.removeEventListener("qntns:reads-synced", bump);
    };
  }, [l]);
  return useMemo(() => ({ counts, tick }), [counts, tick]);
}

/** Open a Ghost post: the Finder store keeps the id, reads.js keeps the URL (that is what syncs). */
export const markGhostRead = (d: { url?: string; title?: string }) => {
  if (d.url) markReadUrl(d.url, { title: d.title });
};

// id -> first-read ms, from this Finder's store plus reads.js (which sync fills from other devices).
function readTimes(l: GhostList, reads: Record<string, number>): Record<string, number> {
  const byKey = new Map(readEntries().map((e) => [readKey(e.url), e.t]));
  const out = { ...reads };
  for (const d of l.docs) {
    const t = byKey.get(readKey(d.url));
    if (t && !out[d.id]) out[d.id] = t;
  }
  return out;
}

const posts = (l: GhostList) => l.docs.filter((d) => d.type === "post" && !homeIds.has(d.id) && !d.tags.some(isJournalKind));
const byNewest = (a: GhostDoc, b: GhostDoc) =>
  (b.published_at ?? "").localeCompare(a.published_at ?? "");
const day = (ms: number) => new Date(ms).toLocaleDateString("en-CA"); // YYYY-MM-DD
const folder = (name: string, path: string): ExtendedDisplayFileItem => ({
  name,
  path,
  isDirectory: true,
  icon: "/icons/directory.png",
  type: "directory-virtual",
});
// "Poems" -> "Poem", "Stories" -> "Story", "Essays" -> "Essay". shortcut: rule covers -ies/-s only, add -es when a tag needs it.
const singular = (n: string) => (/ies$/i.test(n) ? n.replace(/ies$/i, "y") : n.replace(/s$/i, ""));
const file = (
  d: GhostDoc,
  dir: string,
  reads: Record<string, number>,
  counts: GhostCounts
): ExtendedDisplayFileItem => ({
  name: d.title,
  path: `${dir}/${d.slug}`,
  isDirectory: false,
  icon: "/icons/file-text.png",
  type: "ghost-doc",
  kind: ((t) => (t ? singular(t.name) : "Post"))(d.tags.find(isFolderTag)),
  words: d.words,
  data: { id: d.id, type: d.type, url: d.url, title: d.title },
  tags: d.tags.map((t) => t.name),
  views: counts[d.slug]?.views ?? 0,
  likes: counts[d.slug]?.likes ?? 0,
  unread: !reads[d.id],
  modifiedAt: d.published_at ? new Date(d.published_at) : undefined,
});

/** Whether a path is a Ghost place or inside one (never writable). */
export const isGhostPlace = (path: string): boolean =>
  path === POEMS_PATH ||
  path === RECENTS_PATH ||
  path.startsWith(RECENTS_PATH + "/") ||
  path.startsWith(TAG_PREFIX);

/** Sidebar places: Poems, then a folder per other public tag with a non-home-content post. No Recents (Apple > Recent Items). */
export function ghostPlaces(l: GhostList): { name: string; path: string; icon: string }[] {
  const used = new Set(posts(l).flatMap((d) => d.tags.map((t) => t.slug)));
  const icon = "/icons/default/directory.png";
  return [
    { name: "Poems", path: POEMS_PATH, icon },
    ...l.tags
      .filter((t) => t.slug !== POEMS_TAG && isFolderTag(t) && used.has(t.slug))
      .map((t) => ({ name: t.name, path: TAG_PREFIX + t.slug, icon })),
  ];
}

/** Contents of a Ghost path, or null when the path is not one of ours. */
export function listGhostPath(
  path: string,
  l: GhostList,
  stored: Record<string, number>,
  counts: GhostCounts = {}
): ExtendedDisplayFileItem[] | null {
  const reads = readTimes(l, stored);
  const tagged = (slug: string) =>
    posts(l).filter((d) => d.tags.some((t) => t.slug === slug)).sort(byNewest);
  if (path === POEMS_PATH) return tagged(POEMS_TAG).map((d) => file(d, path, reads, counts));
  if (path.startsWith(TAG_PREFIX)) return tagged(path.slice(TAG_PREFIX.length)).map((d) => file(d, path, reads, counts));
  if (path === RECENTS_PATH || path.startsWith(RECENTS_PATH + "/")) {
    const opened = posts(l)
      .filter((d) => reads[d.id])
      .sort((a, b) => reads[b.id] - reads[a.id]);
    if (path === RECENTS_PATH) {
      return [...new Set(opened.map((d) => day(reads[d.id])))].map((k) => folder(k, `${path}/${k}`));
    }
    const k = path.slice(RECENTS_PATH.length + 1);
    return opened.filter((d) => day(reads[d.id]) === k).map((d) => file(d, path, reads, counts));
  }
  return null;
}
