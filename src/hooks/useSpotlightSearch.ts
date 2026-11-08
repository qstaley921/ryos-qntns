import { useEffect, useMemo, useState } from "react";
import { appRegistry, getAppIconPath, getNonFinderApps } from "@/config/appRegistry";
import type { AppId } from "@/config/appRegistry";
import { useLaunchApp } from "@/hooks/useLaunchApp";
import { APPLICATIONS_HIDDEN } from "@/components/layout/dock/dockConstants";
import { getTranslatedAppName } from "@/utils/i18n";
import { listDocs, type GhostDoc } from "@/lib/ghost";
import { isJournalKind, markGhostRead } from "@/apps/finder/utils/ghostPlaces";

export interface SpotlightResult {
  id: string;
  type:
    | "app"
    | "document"
    | "applet"
    | "music"
    | "site"
    | "video"
    | "calendar"
    | "contact"
    | "setting"
    | "command"
    | "ai";
  title: string;
  subtitle?: string;
  icon: string;
  isEmoji?: boolean;
  /** Optional thumbnail URL (cover art, favicon, image preview) */
  thumbnail?: string;
  /** Initials for avatar fallback (contacts) */
  initials?: string;
  /** Override section header label (e.g. "Top Hits" for empty state) */
  sectionLabel?: string;
  action: () => void;
  keywords?: string[];
}

export interface SpotlightSearchState {
  results: SpotlightResult[];
  isSearching: boolean;
}

const MAX_RESULTS_PER_TYPE = 4;
const MAX_TOTAL_RESULTS = 12;

function matchesQuery(query: string, ...fields: (string | undefined)[]): boolean {
  const q = query.toLowerCase();
  return fields.some((field) => field && field.toLowerCase().includes(q));
}

// Ported from QNTNs-ghost assets/js/qntns/search.js fuzzyScore: the site's rule.
// Title only; every non-space letter of the query appears in the title in order
// (subsequence). Score: +8 contiguous, +4 word start, +1 else, + run length; minus
// 0.05 per title char. null = no match.
export function fuzzyScore(rawQuery: string, rawText: string): number | null {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return 0;
  const text = rawText.toLowerCase();
  let score = 0;
  let cursor = 0;
  let run = 0;
  for (const ch of q) {
    if (ch === " ") {
      run = 0;
      continue;
    }
    const at = text.indexOf(ch, cursor);
    if (at === -1) return null;
    const contiguous = at === cursor;
    const wordStart = at === 0 || !/[a-z0-9]/.test(text[at - 1]);
    run = contiguous ? run + 1 : 0;
    score += (contiguous ? 8 : 1) + (wordStart ? 4 : 0) + run;
    cursor = at + 1;
  }
  return score - text.length * 0.05;
}

// Posts only, as the Finder lists them (no Journal kinds); Goals never match on the site.
const isSearchablePost = (d: GhostDoc) =>
  d.type === "post" && !d.tags.some((t) => isJournalKind(t) || t.slug === "goals");

export function useSpotlightSearch(query: string): SpotlightSearchState {
  const launchApp = useLaunchApp();
  const [docs, setDocs] = useState<GhostDoc[]>([]);

  // The list ryOS already holds (baked JSON, else the one list call, memoized).
  useEffect(() => {
    let live = true;
    listDocs().then((l) => live && setDocs(l.docs.filter(isSearchablePost)));
    return () => {
      live = false;
    };
  }, []);

  const results = useMemo(() => {
    const trimmed = query.trim();

    if (!trimmed) {
      const topApps: AppId[] = (["chats", "finder", "textedit", "internet-explorer", "ipod", "terminal"] as AppId[]).filter(
        (appId) => !APPLICATIONS_HIDDEN.has(appId),
      );
      return topApps.map((appId) => ({
        id: `app-${appId}`,
        type: "app" as const,
        title: getTranslatedAppName(appId),
        icon: getAppIconPath(appId),
        sectionLabel: "spotlight.topHits",
        action: () => launchApp(appId),
      }));
    }

    const apps = [{ name: "Finder", icon: getAppIconPath("finder"), id: "finder" as AppId }, ...getNonFinderApps(false)]
      .filter((app) => !APPLICATIONS_HIDDEN.has(app.id));
    const appResults: SpotlightResult[] = apps
      .filter((app) => matchesQuery(trimmed, getTranslatedAppName(app.id), app.name, appRegistry[app.id]?.description))
      .slice(0, MAX_RESULTS_PER_TYPE)
      .map((app) => ({
        id: `app-${app.id}`,
        type: "app" as const,
        title: getTranslatedAppName(app.id),
        icon: getAppIconPath(app.id),
        action: () => launchApp(app.id),
      }));

    // Posts open the way a Finder open does: TextEdit with { ghost: doc }, read marked.
    const postResults: SpotlightResult[] = docs
      .map((d) => ({ d, score: fuzzyScore(trimmed, d.title) }))
      .filter((h): h is { d: GhostDoc; score: number } => h.score !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_TOTAL_RESULTS)
      .map(({ d }) => ({
        id: `post-${d.id}`,
        type: "document" as const,
        title: d.title,
        subtitle: "Posts",
        icon: "file-text.png",
        action: () => {
          markGhostRead(d);
          launchApp("textedit", { initialData: { ghost: d } });
        },
      }));

    return [...appResults, ...postResults].slice(0, MAX_TOTAL_RESULTS);
  }, [query, launchApp, docs]);

  return { results, isSearching: false };
}
