// Types for the copied theme module (assets/js/qntns/graffiti.js); only what PaintAppComponent calls.
export function renderGraffiti(opts?: { name?: string }): string;
export function wallOf(q: string | null | undefined): string;
export function graffitiApi(): unknown;
export function attachGraffiti(root: HTMLElement, opts?: { member?: { id: string | null } | null; api?: unknown; scrollRoot?: HTMLElement | Window }): () => void;
