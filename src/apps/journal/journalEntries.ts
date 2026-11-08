import type { JournalCopy, JournalFragment } from "./sampleContent";
import { listHomeContent } from "@/lib/ghost";
import { isJournalKind, JOURNAL_KINDS } from "@/apps/finder/utils/ghostPlaces";

export interface JournalEntryDay {
  id: string;
  mood: number;
  title: JournalCopy;
}

// Filled in place by loadJournalEntries(), so every importer sees the posts.
export const JOURNAL_ENTRY_DAYS: JournalEntryDay[] = [];
export const JOURNAL_ENTRY_FRAGMENTS: JournalFragment[] = [];

const copy = (s: string): JournalCopy => ({ "zh-TW": s, "zh-CN": s, en: s });

// Posts tagged #home-content (quotes, notes, rules ...): one read-only card each,
// grouped by publish day. Failure leaves the journal empty, silently.
let all: Awaited<ReturnType<typeof listHomeContent>> = [];

// Kinds present among the posts (their public tags), A-Z.
export const journalKinds = () =>
  [...new Set(all.flatMap((d) => d.kinds))].filter((k) => isJournalKind({ name: k, slug: k })).sort();

// #home-content posts plus every Journal-kind post (CHECKLIST-36 §57, §57a): one list call, newest first.
const loadAll = () => listHomeContent(JOURNAL_KINDS);

export async function loadJournalEntries(kind: string | null): Promise<void> {
  all = await loadAll().catch(() => all);
  applyJournalFilter(kind);
}

// Re-fills the arrays with one kind (null = All). Untagged posts show under All only.
export function applyJournalFilter(kind: string | null): void {
  const docs = kind ? all.filter((d) => d.kinds.includes(kind)) : all;
  JOURNAL_ENTRY_DAYS.length = 0;
  JOURNAL_ENTRY_FRAGMENTS.length = 0;
  const perDay = new Map<string, number>();
  for (const d of docs) {
    const dayId = (d.published_at ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayId)) continue;
    const n = perDay.get(dayId) ?? 0;
    perDay.set(dayId, n + 1);
    if (n === 0) JOURNAL_ENTRY_DAYS.push({ id: dayId, mood: 3, title: copy("") });
    JOURNAL_ENTRY_FRAGMENTS.push({
      id: d.id,
      dayId,
      kind: "text",
      kinds: d.kinds,
      text: copy(d.text),
      photo: null,
      x: 8 + (JOURNAL_ENTRY_FRAGMENTS.length % 4) * 7,
      y: 10 + (JOURNAL_ENTRY_FRAGMENTS.length % 5) * 11,
      w: 30,
      rotate: JOURNAL_ENTRY_FRAGMENTS.length % 2 === 0 ? -2 : 2,
    });
  }
  JOURNAL_ENTRY_DAYS.sort((a, b) => a.id.localeCompare(b.id));
}
