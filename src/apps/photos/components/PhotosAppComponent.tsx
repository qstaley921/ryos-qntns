import { useEffect, useRef, useState } from "react";
import type { AppProps } from "@/apps/base/types";
import { AppHelpAboutDialogs } from "@/components/shared/AppHelpAboutDialogs";
import { AppWindowShell } from "@/components/shared/AppWindowShell";
import { useThemeFlags } from "@/hooks/useThemeFlags";
import { listDocs, openDoc, type GhostBody, type GhostDoc } from "@/lib/ghost";
import { listPhotoBodies } from "@/lib/ghost/photos";
import { cn } from "@/lib/utils";
import { useLaunchApp } from "@/hooks/useLaunchApp";
import { appMetadata, helpItems } from "../metadata";
import { play, readSlideshow, soundsOf } from "../slideshow";
import { PhotosMenuBar } from "./PhotosMenuBar";

/*
 * PHOTOS (CHECKLIST-37 §13, §13a). A simplified early-iPhoto layout (§13b):
 * a source list of albums on the left, a shadowed thumbnail grid on the right,
 * and a bottom bar whose only control is Play. One album per photo post (tag
 * slug `photos`, as tag-feed.js); its images are the <img>s in its body,
 * read when the album opens. Play shows only on an album tagged `#slideshow`
 * (slug `hash-slideshow`) whose footer injection holds a v2 show.
 */
type Album = { photos: string[]; own: { show: unknown; music: string; voice: string } | null };

const LIBRARY = "library";
const isPhotoPost = (d: GhostDoc) => d.tags?.some((t) => t.slug === "photos");
// Ghost resizes on request; a thumbnail never needs the 2000px copy.
const thumb = (src: string, w = 600) => src.replace(/\/content\/images\/(?!size\/)/, `/content/images/size/w${w}/`);

function albumOf(body: GhostBody): Album {
  const doc = new DOMParser().parseFromString(body.html ?? "", "text/html");
  const photos = [...doc.querySelectorAll<HTMLImageElement>(".kg-image-card img, .kg-gallery-card img")]
    .map((img) => img.getAttribute("src") ?? "")
    .filter(Boolean);
  const tagged = body.tags?.some((t) => t.slug === "hash-slideshow");
  // The show lives in code injection, head on live posts (checked: goodbye-ole-friend), foot per the theme docs; the Content API returns both on a read with no `fields` (openDoc), though GhostBody doesn't type them.
  const { codeinjection_head: head, codeinjection_foot: foot } = body as GhostBody & { codeinjection_head?: string | null; codeinjection_foot?: string | null };
  const show = tagged ? readSlideshow((head ?? "") + (foot ?? "")) : null;
  return { photos, own: show ? { show, ...soundsOf(body.html ?? "") } : null };
}

export function PhotosAppComponent({
  isWindowOpen,
  onClose,
  isForeground,
  skipInitialSound,
  instanceId,
  onNavigateNext,
  onNavigatePrevious,
}: AppProps) {
  const { isWindowsTheme } = useThemeFlags();
  const launchApp = useLaunchApp();
  const [docs, setDocs] = useState<GhostDoc[] | null>(null);
  const [sel, setSel] = useState(LIBRARY);
  const [albums, setAlbums] = useState<Record<string, Album | null>>({});
  const [big, setBig] = useState<number | null>(null);
  // §13d: one selected photo per album grid; a second click (or double-click, or Enter) opens it.
  const [picked, setPicked] = useState<number | null>(null);
  const [spots, setSpots] = useState<Record<string, number>>({});
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);

  useEffect(() => {
    let live = true;
    listDocs().then((l) => live && setDocs(l.docs.filter((d) => d.type === "post" && isPhotoPost(d))));
    // §13c: every album's body up front, for Library covers; an album already read keeps its own.
    listPhotoBodies().then((bodies) => {
      if (!live) return;
      const read = Object.fromEntries(Object.entries(bodies).map(([id, b]) => [id, albumOf(b)]));
      setAlbums((a) => ({ ...read, ...a }));
    });
    return () => { live = false; };
  }, []);

  // An album's body is read once: from listPhotoBodies, else on first open. A failed read is an empty album (silent).
  useEffect(() => {
    const d = docs?.find((x) => x.id === sel);
    if (!d || sel in albums) return;
    setAlbums((a) => ({ ...a, [sel]: null }));
    openDoc(d).then((b) => setAlbums((a) => ({ ...a, [d.id]: b ? albumOf(b) : { photos: [], own: null } })));
  }, [sel, docs, albums]);

  const album = sel === LIBRARY ? null : albums[sel];
  const current = docs?.find((d) => d.id === sel);
  const go = (id: string) => { setSel(id); setBig(null); setPicked(null); };

  // Grid keys, only while the grid shows in the foreground window (the viewer has its own).
  useEffect(() => {
    if (!isForeground || big !== null || picked === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPicked(null);
      else if (e.key === "Enter") setBig(picked);
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isForeground, big, picked]);

  const grid = (() => {
    if (!docs) return <Status>Loading…</Status>;
    if (sel === LIBRARY) {
      if (!docs.length) return <Status>No albums</Status>;
      return (
        <Grid>
          {docs.map((d) => (
            <Thumb key={d.id} src={d.feature_image ?? albums[d.id]?.photos[0] ?? null} title={d.title} onClick={() => go(d.id)} />
          ))}
        </Grid>
      );
    }
    if (!album) return <Status>Loading…</Status>;
    if (!album.photos.length) return <Status>No photos</Status>;
    return (
      <Grid>
        {album.photos.map((src, i) => (
          <Thumb
            key={src}
            src={src}
            selected={picked === i}
            onClick={() => (picked === i ? setBig(i) : setPicked(i))}
            onDoubleClick={() => setBig(i)}
          />
        ))}
      </Grid>
    );
  })();

  const count =
    sel === LIBRARY ? `${docs?.length ?? 0} albums` : album ? `${album.photos.length} photos` : "";

  return (
    <AppWindowShell
      isWindowOpen={isWindowOpen}
      isWindowsTheme={isWindowsTheme}
      isForeground={isForeground}
      menuBar={
        <PhotosMenuBar
          onClose={onClose}
          onShowHelp={() => setIsHelpOpen(true)}
          onShowAbout={() => setIsAboutOpen(true)}
        />
      }
      windowFrameProps={{
        title: current?.title ?? "Photos",
        onClose,
        isForeground,
        appId: "photos",
        skipInitialSound,
        instanceId,
        onNavigateNext,
        onNavigatePrevious,
      }}
      trailing={
        <AppHelpAboutDialogs
          appId={"photos"}
          helpItems={helpItems}
          metadata={appMetadata}
          isHelpOpen={isHelpOpen}
          onHelpOpenChange={setIsHelpOpen}
          isAboutOpen={isAboutOpen}
          onAboutOpenChange={setIsAboutOpen}
        />
      }
    >
      <div className="flex h-full w-full flex-col font-os-ui text-os-text-primary">
        <div className="flex min-h-0 flex-1">
          {/* Source list: Library, then one album per photo post. */}
          <nav className="w-48 shrink-0 overflow-auto border-r border-black/10 bg-os-panel-bg py-2 text-sm">
            <SourceRow active={sel === LIBRARY} onClick={() => go(LIBRARY)}>
              Library
            </SourceRow>
            <div className="px-3 pt-3 pb-1 text-xs font-semibold uppercase text-os-text-secondary">Albums</div>
            {docs?.map((d) => (
              <SourceRow key={d.id} active={sel === d.id} onClick={() => go(d.id)}>
                {d.title}
              </SourceRow>
            ))}
          </nav>
          {/* The content column: the grid, or the viewer in its place (§13 13-opus_high-3); the source list stays. A click on empty grid space clears the selection (Thumb stops its own). */}
          <div className="relative min-w-0 flex-1 overflow-auto bg-white" onClick={() => setPicked(null)}>
            {big !== null && album ? (
              <Viewer photos={album.photos} at={big} onAt={setBig} onClose={() => setBig(null)} active={!!isForeground} />
            ) : (
              grid
            )}
          </div>
        </div>
        {/* Bottom bar: Play (slideshow albums) and Order Postcard (any open album, §70). */}
        <div className="flex h-12 shrink-0 items-center justify-between border-t border-black/10 bg-os-panel-bg px-4 text-xs text-os-text-secondary">
          <span>{count}</span>
          <div className="flex items-center gap-2">
          {current && (
            <button
              type="button"
              className="flex h-8 items-center gap-2 rounded px-3 text-os-text-primary hover:bg-black/5"
              // §79a: the site's own postcard editor in a Mini window. Own window, so an open Safari is left alone.
              onClick={() =>
                launchApp("internet-explorer", { initialData: { mini: true, path: `/${current.slug}/?postcard` }, multiWindow: true })
              }
            >
              Order Postcard
            </button>
          )}
          {album?.own && (
            <button
              type="button"
              className="flex h-8 items-center gap-2 rounded px-3 text-os-text-primary hover:bg-black/5"
              // Must stay synchronous: play() starts the sound and full screen in this click's gesture.
              onClick={() =>
                play(spots[sel] ?? 0, {
                  ...album.own,
                  onstop: (spot: number) => setSpots((s) => ({ ...s, [sel]: spot })),
                })
              }
            >
              <span aria-hidden="true">▶</span>
              {spots[sel] ? "Resume" : "Play"}
            </button>
          )}
          </div>
        </div>
      </div>
    </AppWindowShell>
  );
}

const Status = ({ children }: { children: React.ReactNode }) => (
  <div className="flex h-full items-center justify-center text-sm text-os-text-secondary">{children}</div>
);

// Even columns of at least 160px that reflow with the window; 16px gaps and inset (base 4).
const Grid = ({ children }: { children: React.ReactNode }) => (
  <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4 p-4">{children}</div>
);

/*
 * Viewer (§13, 13-opus_high-3): fills the content column only (absolute inset-0 in it), so the
 * source list, menu bar and window chrome stay, and it reflows with the window. The photo is
 * letterboxed (contain on black) above a filmstrip; ← → step and stop at the ends, Esc or × closes.
 * Budget: column height = photo (flex-1) + filmstrip 16 + 72 + 16 = 104px; each frame 96×72 (4:3),
 * 8px apart; × is 32px, 16px in from the column's top-right.
 */
function Viewer({ photos, at, onAt, onClose, active }: { photos: string[]; at: number; onAt: (i: number) => void; onClose: () => void; active: boolean }) {
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") onAt(Math.min(at + 1, photos.length - 1));
      else if (e.key === "ArrowLeft") onAt(Math.max(at - 1, 0));
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [at, photos.length, onAt, onClose, active]);
  useEffect(() => {
    strip.current?.children[at]?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [at]);

  return (
    <div className="absolute inset-0 flex flex-col bg-black" role="region" aria-label="Photo" onClick={(e) => e.stopPropagation()}>
      {/* The cached w600 blurs up to the full image. */}
      <div className="relative min-h-0 w-full flex-1">
        <BlurUp key={at} src={photos[at]} tiny={thumb(photos[at])} fit="object-contain" />
      </div>
      <div ref={strip} className="flex h-[104px] shrink-0 gap-2 overflow-x-auto p-4">
        {photos.map((src, i) => (
          <button
            key={src}
            type="button"
            onClick={() => onAt(i)}
            aria-label={`Photo ${i + 1} of ${photos.length}`}
            aria-current={i === at}
            className={cn("relative h-[72px] w-24 shrink-0 opacity-50 hover:opacity-100", i === at && "opacity-100 outline outline-4 outline-white")}
          >
            <BlurUp src={thumb(src)} tiny={thumb(src, 30)} />
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-lg text-white hover:bg-black/80"
      >
        ×
      </button>
    </div>
  );
}

/*
 * Blur-up: the ~1KB w30 copy, stretched and blurred, sits under the real image, which fades in on load.
 * The wrapper clips the blur's soft edge; the cover fit scales the tiny copy past it. A failed tiny image hides itself (empty box).
 * Timing 200ms, blur 8px (base 4).
 */
function BlurUp({ src, tiny, alt = "", fit = "object-cover" }: { src: string; tiny: string; alt?: string; fit?: string }) {
  const [done, setDone] = useState(false);
  const [bad, setBad] = useState(false);
  // A cached image can finish before React attaches onLoad.
  const ref = (img: HTMLImageElement | null) => { if (img?.complete && img.naturalWidth) setDone(true); };
  return (
    <span className="absolute inset-0 block overflow-hidden">
      {!bad && (
        <img src={tiny} alt="" aria-hidden="true" draggable={false} onError={() => setBad(true)}
          className={cn("absolute inset-0 h-full w-full blur-[8px]", fit, fit === "object-cover" && "scale-110")} />
      )}
      <img ref={ref} src={src} alt={alt} loading="lazy" draggable={false} onLoad={() => setDone(true)}
        className={cn("absolute inset-0 h-full w-full transition-opacity duration-200", fit, done ? "opacity-100" : "opacity-0")} />
    </span>
  );
}

function Thumb({ src, title, selected, onClick, onDoubleClick }: { src: string | null; title?: string; selected?: boolean; onClick: () => void; onDoubleClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onDoubleClick={onDoubleClick}
      aria-pressed={onDoubleClick ? !!selected : undefined}
      className="flex flex-col items-center gap-2 text-xs"
    >
      {/* Every photo crop-fills one 4:3 cell, so the grid is even. Selected (§13d): a 4px ring in the
          OS selection blue (--os-color-selection-bg, the source list's own token), 4px off the photo,
          so 8px of the 16px gap; only one is ever on, so rings never meet. */}
      <span
        className={cn(
          "relative block aspect-[4/3] w-full bg-black/5 shadow-[0_4px_8px_rgba(0,0,0,0.35)]",
          selected && "outline outline-4 outline-offset-4 outline-os-selection-bg",
        )}
      >
        {src && <BlurUp src={thumb(src)} tiny={thumb(src, 30)} alt={title ?? ""} />}
      </span>
      {title && <span className="line-clamp-2 text-center text-os-text-primary">{title}</span>}
    </button>
  );
}

function SourceRow({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("block w-full truncate px-4 py-1 text-left", active && "bg-os-selection-bg text-os-selection-text")}
    >
      {children}
    </button>
  );
}
