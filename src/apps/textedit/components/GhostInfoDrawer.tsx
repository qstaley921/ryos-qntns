import { AppDrawer } from "@/components/shared/AppDrawer";
import type { GhostDoc } from "@/lib/ghost";
import type { PostLinks } from "@/lib/ghost/postLinks";

// §53d: the post's details in ryOS's shared side drawer (as Books' highlights and Calendar's tray use it).
// Everything here is data TextEdit already holds: no fetch of its own.
export type GhostInfo = {
  doc: Partial<GhostDoc>;
  words: number | null;
  views: number | null;
  likes: number | null;
  links: PostLinks;
};

const SHARE: [keyof PostLinks, string][] = [
  ["spotify", "Spotify"],
  ["apple", "Apple Podcasts"],
  ["youtube", "YouTube"],
];

const date = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : null;
const num = (n: number | null) => (n == null ? "-" : n.toLocaleString("en-US"));
const A = "text-os-link underline-offset-2 hover:underline break-all";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 px-2 py-1">
      <dt className="font-os-ui text-[11px] text-os-text-secondary">{label}</dt>
      <dd className="font-os-ui text-[12px] leading-snug text-os-text-primary">{children}</dd>
    </div>
  );
}

export function GhostInfoDrawer({ isOpen, onClose, info }: { isOpen: boolean; onClose: () => void; info: GhostInfo }) {
  const { doc, words, views, likes, links } = info;
  // Ghost's internal tags are the #-tags, slug "hash-…"; only public ones are shown.
  const tags = (doc.tags ?? []).filter((t) => !t.slug.startsWith("hash-"));
  const share = SHARE.filter(([k]) => links[k]);
  return (
    <AppDrawer isOpen={isOpen} onClose={onClose} title="Info" data-textedit-info-drawer="">
      <dl className="flex min-h-0 flex-1 flex-col overflow-y-auto py-1 select-text">
        <Row label="Title">{doc.title || "-"}</Row>
        <Row label="Published">{date(doc.published_at) ?? "-"}</Row>
        <Row label="Tags">{tags.length ? tags.map((t) => t.name).join(", ") : "-"}</Row>
        <Row label="Length">
          {words == null ? "-" : `${num(words)} words · ${Math.max(1, Math.ceil(words / 275))} min read`}
        </Row>
        <Row label="Views">{num(views)}</Row>
        <Row label="Likes">{num(likes)}</Row>
        {doc.url && (
          <Row label="Link">
            <a className={A} href={doc.url} target="_blank" rel="noopener">
              {doc.url.replace(/^https?:\/\/(www\.)?/, "")}
            </a>
          </Row>
        )}
        {share.length > 0 && (
          <Row label="Share">
            <span className="flex flex-col">
              {share.map(([k, label]) => (
                <a key={k} className={A} href={links[k]} target="_blank" rel="noopener">
                  {label}
                </a>
              ))}
            </span>
          </Row>
        )}
      </dl>
    </AppDrawer>
  );
}
