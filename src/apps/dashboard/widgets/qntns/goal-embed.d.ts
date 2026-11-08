// Types for the ported loader (goal-embed.js); only what QntnsWidget calls.
export function attachGoal(host: HTMLElement, name: string, alive?: () => boolean): Promise<(() => void) | undefined>;
