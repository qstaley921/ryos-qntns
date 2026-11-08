// iPod track list from qntns.com audio posts (CHECKLIST-36 §23): one track per
// post, its first Ghost audio card, with that card's chapters read from the
// body's `<12:34>` timecodes the way QNTNs-ghost assets/js/qntns/chapters.js does.
import { listAudioPosts, type GhostAudioPost } from "@/lib/ghost";
import type { Track } from "@/shared/media/library";
import { isFolderTag, isJournalKind } from "@/apps/finder/utils/ghostPlaces";

const TIMECODE = /<((?:\d{1,2}:)?\d{1,2}:\d{2})>/g;
const BACK_THRESHOLD = 2;
const seconds = (code: string) => code.split(":").reduce((t, p) => t * 60 + Number(p), 0);

/** Chapter starts (seconds, sorted) by track id. */
export const trackChapters = new Map<string, number[]>();
/** Podcasts (CHECKLIST-36 §55, §55b) a track is an episode of: its folder tag names; home-content and Journal-kind posts get none. */
export const trackPodcasts = new Map<string, string[]>();
/** The post's body html by track id, for the Share menu's links (§55a). */
export const trackHtml = new Map<string, string>();

// A timecode belongs to the nearest audio card above it; ones before the first
// card belong to the first (chapters.js §54). Only the first card is the track.
export function readFirstCard(html: string): { src: string; times: number[] } | null {
  const body = new DOMParser().parseFromString(html, "text/html").body;
  const cards = [...body.querySelectorAll(".kg-audio-card")].filter((c) => c.querySelector("audio[src]"));
  const first = cards[0];
  if (!first) return null;
  const second = cards[1];
  const times = new Set<number>();
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.parentElement?.closest(".kg-card")) continue;
    if (second && second.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING) break;
    for (const m of (n.nodeValue ?? "").matchAll(TIMECODE)) times.add(seconds(m[1]));
  }
  return { src: first.querySelector("audio")!.getAttribute("src")!, times: [...times].sort((a, b) => a - b) };
}

function toTrack(p: GhostAudioPost): Track | null {
  const card = readFirstCard(p.html);
  if (!card) return null;
  trackChapters.set(p.id, card.times);
  const tags = p.tags ?? [];
  const home = tags.some((t) => t.slug === "hash-home-content");
  const journal = tags.some(isJournalKind);
  trackPodcasts.set(p.id, home || journal ? [] : tags.filter(isFolderTag).map((t) => t.name));
  trackHtml.set(p.id, p.html);
  return {
    id: p.id,
    url: card.src,
    title: p.title,
    cover: p.feature_image ?? undefined,
    createdAt: p.published_at ? Date.parse(p.published_at) : undefined,
  };
}

export async function loadGhostTracks(): Promise<Track[]> {
  return (await listAudioPosts()).map(toTrack).filter((t): t is Track => !!t);
}

/** Where a wheel skip lands inside the current track, or null to change track (chapters.js `target`). */
export function chapterSkip(list: number[], now: number, dir: "next" | "previous"): number | null {
  if (!list.length) return null;
  if (dir === "next") return list.find((t) => t > now + 0.5) ?? null;
  const current = list.filter((t) => t <= now + 0.5).pop();
  if (current === undefined) return null;
  if (now - current > BACK_THRESHOLD) return current;
  const before = list.filter((t) => t < current).pop();
  if (before !== undefined) return before;
  return now - current > 0.5 ? current : null;
}
