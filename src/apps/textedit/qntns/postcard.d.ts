// Ambient types for the wall's verbatim postcard.js copy (CHECKLIST-36 §12c); only what GhostReader calls.
declare module "@/apps/paint/wall/qntns/postcard.js" {
  export function readArticle(root?: ParentNode, opts?: { url?: string }): unknown;
  export function renderPostcard(data: unknown): string;
  export function attachPostcard(root: HTMLElement, data: unknown): { open(): void; close(): void; destroy(): void };
}
