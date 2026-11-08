/**
 * iPod default tracks: qntns.com audio posts (CHECKLIST-36 §23), not the ryOS
 * song server. Deduplicated in memory; `forceRefresh` re-reads Ghost.
 */
import type { Track } from "@/shared/media/library";
import { loadGhostTracks } from "@/stores/ipodGhostTracks";

let cached: { tracks: Track[]; version: number } | null = null;
let pending: Promise<{ tracks: Track[]; version: number }> | null = null;

/** No boot-time fetch: the list loads when the iPod store rehydrates. */
export function preloadIpodData(): void {}

export async function loadDefaultTracks(forceRefresh = false): Promise<{
  tracks: Track[];
  version: number;
}> {
  if (!forceRefresh && cached) return cached;
  if (!forceRefresh && pending) return pending;
  const p = loadGhostTracks().then((tracks) => {
    const version = Math.max(1, ...tracks.map((t) => t.createdAt ?? 1));
    return (cached = { tracks, version });
  });
  if (!forceRefresh) pending = p.finally(() => (pending = null));
  return p;
}
