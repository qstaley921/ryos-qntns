// A post's own Spotify / Apple Podcasts / YouTube links (CHECKLIST-36 §53a, §55a),
// read from its body html: plain <a href> links and embed iframes (Ghost's
// YouTube / Spotify embed cards). First of each kind wins; a missing kind is absent.
// Shared by TextEdit's and iPod's Share menus.
export type PostLinks = { spotify?: string; apple?: string; youtube?: string };

const HOSTS: [keyof PostLinks, RegExp][] = [
  ["spotify", /(^|\.)spotify\.com$/],
  ["apple", /^(podcasts|music)\.apple\.com$/],
  ["youtube", /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/],
];

export function postLinks(html: string | null | undefined): PostLinks {
  const out: PostLinks = {};
  for (const [, url] of (html ?? "").matchAll(/<(?:a|iframe)\b[^>]*?\s(?:href|src)="([^"]+)"/gi)) {
    let u: URL;
    try {
      u = new URL(url.replace(/&amp;/g, "&"));
    } catch {
      continue;
    }
    const hit = HOSTS.find(([k, re]) => !out[k] && re.test(u.hostname));
    // An embed's src is the player; send the reader to the page instead.
    if (hit) out[hit[0]] = u.href.replace("open.spotify.com/embed/", "open.spotify.com/").replace("youtube.com/embed/", "youtube.com/watch?v=").replace(/watch\?v=([^?&]+)\?/, "watch?v=$1&");
  }
  return out;
}
