declare module "@/apps/paint/wall/qntns/counts.js" {
  export function getCounts(slugs: string[], token?: string | null): Promise<Record<string, { views?: number; likes?: number; liked?: boolean }> | null>;
  export function bumpView(slug: string): Promise<{ views: number; likes: number } | null>;
  export function memberToken(): Promise<string | null>;
  export function setLike(slug: string, liked: boolean, token: string): Promise<{ views: number; likes: number; liked: boolean } | null>;
}
