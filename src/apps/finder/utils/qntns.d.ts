// Types for the copied theme modules Finder uses; only what ghostPlaces.ts calls.
declare module "@/apps/paint/wall/qntns/reads.js" {
  export function readKey(url: string): string;
  export function markRead(url: string, details?: { title?: string }): boolean;
  export function readEntries(): { url: string; t: number }[];
}
declare module "@/apps/paint/wall/qntns/sync.js" {
  export function syncReads(): Promise<void>;
}
declare module "@/apps/paint/wall/qntns/counts.js" {
  export function getCounts(slugs: string[]): Promise<Record<string, { views?: number; likes?: number }> | null>;
}
