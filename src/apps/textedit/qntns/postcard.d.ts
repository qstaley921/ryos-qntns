// Ambient types for the wall's verbatim postcard.js copy (CHECKLIST-36 §12c); only what the Postcard window (§79d) calls.
declare module "@/apps/paint/wall/qntns/postcard.js" {
  export function readArticle(root?: ParentNode, opts?: { url?: string }): unknown;
  export function renderPostcard(data: unknown): string;
  export function attachPostcard(root: HTMLElement, data: unknown, opts?: { onClose?: () => void; isFront?: () => boolean; fit?: boolean }): { open(): void; close(): void; destroy(): void };
}
