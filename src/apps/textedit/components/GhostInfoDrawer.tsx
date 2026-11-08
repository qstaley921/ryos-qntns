import { useState } from "react";
import { ThemedIcon } from "@/components/shared/ThemedIcon";
import { useThemeFlags } from "@/hooks/useThemeFlags";
import { AppDrawer } from "@/components/shared/AppDrawer";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useMediaQuery } from "@/hooks/useMediaQuery";
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
  const [copied, setCopied] = useState<boolean | null>(null); // null = alert closed
  const { isMacOSTheme } = useThemeFlags();
  const { doc, words, views, likes, links } = info;
  // Ghost's internal tags are the #-tags, slug "hash-…"; only public ones are shown.
  const tags = (doc.tags ?? []).filter((t) => !t.slug.startsWith("hash-"));
  const share = SHARE.filter(([k]) => links[k]);
  // §17k: below AppDrawer's own 768px split, Info is an Aqua sheet instead of the side drawer.
  const compact = useMediaQuery("(max-width: 767px)");
  const rows = (
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
            <a
              className={A}
              href={doc.url}
              onClick={(e) => {
                e.preventDefault();
                navigator.clipboard.writeText(doc.url!).then(() => setCopied(true), () => setCopied(false));
              }}
            >
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
  );
  const alert = (
    <Dialog open={copied !== null} onOpenChange={(o) => !o && setCopied(null)}>
      <DialogContent className="max-w-[400px]">
        <DialogTitle className="sr-only">Info</DialogTitle>
        <DialogDescription className="sr-only">{copied ? "Link copied to clipboard" : "Couldn't copy the link"}</DialogDescription>
        <DialogHeader>Info</DialogHeader>
        <div className="p-6">
          <div className="flex gap-3 items-start">
            <ThemedIcon name="warn.png" alt="" className="size-[32px] mt-1 [image-rendering:pixelated]" width={32} height={32} />
            <div className="font-geneva-12 text-[12px] leading-tight text-neutral-900">
              <p className="mb-2">{copied ? "Link copied to clipboard" : "Couldn't copy the link"}</p>
              <p className="break-all select-text">{doc.url}</p>
            </div>
          </div>
          <div className="mt-2 flex justify-end">
            <Button autoFocus variant={isMacOSTheme ? "default" : "retro"} onClick={() => setCopied(null)} className="font-geneva-12 text-[12px]">OK</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
  if (!compact) return (<>
    <AppDrawer isOpen={isOpen} onClose={onClose} title="Info" data-textedit-info-drawer="">
      {rows}
    </AppDrawer>
    {alert}
  </>);
  return (<>
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex flex-col gap-0 max-w-[400px] max-h-[calc(100dvh-32px)]" data-textedit-info-drawer="">
        <DialogTitle className="sr-only">Info</DialogTitle>
        <DialogDescription className="sr-only">This post's details</DialogDescription>
        <DialogHeader>Info</DialogHeader>
        {rows}
        <DialogFooter className="shrink-0 px-4 py-3 sm:justify-end">
          <Button variant="retro" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {alert}
  </>);
}
