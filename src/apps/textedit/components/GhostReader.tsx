import { useEffect, useRef, useState } from "react";
import { AppProps } from "@/apps/base/types";
import { AppWindowShell } from "@/components/shared/AppWindowShell";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChatCircle, Heart, Info, Play, Printer } from "@phosphor-icons/react";
import { useThemeFlags } from "@/hooks/useThemeFlags";
import { useLaunchApp } from "@/hooks/useLaunchApp";
import { api, listDocs, openDoc, type GhostDoc } from "@/lib/ghost";
import { postLinks } from "@/lib/ghost/postLinks";
import {
  READER_FONTS,
  READER_SIZES,
  useReaderPrefs,
  type ReaderFont,
} from "@/stores/useTextEditStore";
import { bumpView, getCounts, memberToken, setLike } from "@/apps/paint/wall/qntns/counts.js";
import { renderBody } from "../qntns/render.js";
import { GhostReaderMenuBar, fontLabel, type ViewAlt } from "./GhostReaderMenuBar";
import { GhostInfoDrawer } from "./GhostInfoDrawer";
import "../qntns/fonts.css";
import "../qntns/tokens.css";
import "../qntns/content.css";
import "../qntns/footnotes.css";
import "../qntns/code.css";
import "../qntns/reader.css";
import "@/apps/paint/wall/css/tokens.css";

// A Ghost post or page, read-only (CHECKLIST-36 §12). Finder launches TextEdit
// with initialData { ghost: { id, type } } and the body is fetched here; a story may pass a full doc plus `html` to skip the fetch.
export type GhostReaderData = {
  ghost: Pick<GhostDoc, "id" | "type"> & Partial<GhostDoc> & { html?: string };
  viewAlt?: ViewAlt; // Storybook only: which View menu to show (§12a alts)
  infoOpen?: boolean; // Storybook only: start with the Info drawer out (§53d)
};

const COMMENTS_SRC = "https://cdn.jsdelivr.net/ghost/comments-ui@~1.6/umd/comments-ui.min.js";

// Mirrors the attributes Ghost's {{comments}} helper prints on a post page.
function commentsScript(postId: string): HTMLScriptElement {
  const { base, key } = api();
  const s = document.createElement("script");
  s.defer = true;
  s.src = COMMENTS_SRC;
  s.crossOrigin = "";
  const attrs: Record<string, string> = {
    "data-ghost-comments": base,
    "data-api": `${base}/ghost/api/content/`,
    "data-admin": `${base}/ghost/`,
    "data-key": key,
    "data-title": "null",
    "data-count": "true",
    "data-post-id": postId,
    "data-color-scheme": "light",
    "data-avatar-saturation": "60",
    "data-accent-color": "",
    "data-comments-enabled": "all",
    "data-publication": "",
    "data-locale": "",
  };
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  return s;
}

const has = (doc: Partial<GhostDoc>, slug: string) => doc.tags?.some((t) => t.slug === slug);

// §54: a post's audio is the iPod's, never TextEdit's. Ghost audio cards out; what is left is the text.
const AUDIO = ".kg-audio-card";
const textOnly = (html: string) => {
  const d = new DOMParser().parseFromString(html, "text/html").body;
  d.querySelectorAll(AUDIO).forEach((n) => n.remove());
  return d;
};


export function GhostReader({
  isWindowOpen,
  onClose,
  isForeground,
  skipInitialSound,
  instanceId,
  initialData,
  onNavigateNext,
  onNavigatePrevious,
}: AppProps) {
  const { ghost: doc, viewAlt = "base", infoOpen: infoAtStart = false } = initialData as GhostReaderData;
  const { isWindowsTheme, isMacOSTheme } = useThemeFlags();
  const launchApp = useLaunchApp();
  const launchRef = useRef(launchApp);
  launchRef.current = launchApp;
  const { font, size, wide, update } = useReaderPrefs();
  const [html, setHtml] = useState<string | null>(doc.html ?? null);
  const [tagged, setTagged] = useState<Partial<GhostDoc>>(doc);
  const [failed, setFailed] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(infoAtStart); // §53d, closed by default
  const [counts, setCounts] = useState<{ views: number; likes: number } | null>(null);
  // Views and likes (§44): one view bump per open; the like is live only for a reader signed in to comments.
  const [likes, setLikes] = useState<{ token: string; n: number | null; liked: boolean } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const commentsRef = useRef<HTMLDivElement>(null);

  const close = () =>
    window.dispatchEvent(
      new CustomEvent(`closeWindow-${instanceId || "textedit"}`, {
        detail: { onComplete: onClose },
      })
    );

  useEffect(() => {
    if (doc.html) return;
    let live = true;
    openDoc(doc).then((b) => {
      if (!live) return;
      if (!b) return setFailed(true);
      setTagged(b);
      setHtml(b.html);
    });
    return () => {
      live = false;
    };
  }, [doc]);

  const slug = tagged.slug ?? doc.slug;
  useEffect(() => {
    if (!slug) return;
    let live = true;
    bumpView(slug).then((c) => live && c && setCounts(c));
    memberToken().then(async (token) => {
      if (!token || !live) return;
      const c = (await getCounts([slug], token))?.[slug] as { likes?: number; liked?: boolean } | undefined;
      if (live) setLikes({ token, n: c?.likes ?? null, liked: !!c?.liked });
    });
    return () => {
      live = false;
    };
  }, [slug]);
  const toggleLike = async () => {
    if (!likes || !slug) return;
    const r = await setLike(slug, !likes.liked, likes.token);
    if (r) setLikes({ ...likes, n: r.likes, liked: r.liked });
  };

  // A video post belongs to Videos; an audio post with no text left belongs to iPod.
  // Text + audio (a poem with its reading) stays here as text (§54, overrides §12).
  useEffect(() => {
    if (html == null) return;
    const app = /<video[^>]*\ssrc="/.test(html)
      ? "videos"
      : html.includes("kg-audio-card") && !textOnly(html).textContent!.trim()
        ? "ipod"
        : null;
    if (!app) return;
    launchApp(app);
    close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html]);

  // The theme's body passes. The body is written here, not by React, so every run
  // (StrictMode's double run too) starts from fresh HTML: the passes are not idempotent.
  useEffect(() => {
    const root = bodyRef.current;
    if (!root || html == null) return;
    const variant = `${has(tagged, "hash-dropcap") ? " qntns-content__body--dropcap" : ""}${
      has(tagged, "hash-fixed-lines") ? " qntns-content__body--poem" : ""
    }`;
    root.innerHTML = `<div class="qntns-content__body${variant}"></div>`;
    root.firstElementChild!.innerHTML = html;
    root.querySelectorAll(AUDIO).forEach((n) => n.remove());
    const off = renderBody(root);
    // §46: a link to an own-site post or page opens that document in TextEdit;
    // anything else keeps the new-tab target renderBody set.
    const onCapture = (e: MouseEvent) => {
      const a = (e.target as Element).closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || e.button || e.metaKey || e.ctrlKey || e.shiftKey) return;
      let u: URL;
      try {
        u = new URL(a.getAttribute("href")!, tagged.url ?? "https://www.qntns.com/");
      } catch {
        return;
      }
      if (!/^(www\.)?qntns\.com$|^qntns\.ghost\.io$/.test(u.hostname)) return;
      const slug = u.pathname.split("/").filter(Boolean).pop();
      if (!slug) return;
      e.preventDefault();
      listDocs().then(({ docs }) => {
        const hit = docs.find((d) => d.slug === slug);
        if (hit) launchRef.current("textedit", { initialData: { ghost: { id: hit.id, type: hit.type } } });
        else launchRef.current("internet-explorer", { initialData: { mini: true, path: u.pathname }, multiWindow: true });
      });
    };
    root.addEventListener("click", onCapture);
    // A goal embed is a button that opens its widget in Dashboard (§25 owns the widget).
    root.querySelectorAll<HTMLElement>("[data-qntns-goal]").forEach((host) => {
      const goal = host.dataset.qntnsGoal!;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "qntns-reader__goal";
      b.textContent = `Open ${goal[0].toUpperCase()}${goal.slice(1)}`;
      b.onclick = () => launchRef.current("dashboard", { initialData: { goal } });
      host.replaceChildren(b);
    });
    return () => {
      root.removeEventListener("click", onCapture);
      off();
    };
  }, [html, tagged]);

  // Ghost's comments, mounted once on first open (comments-ui has no unmount).
  useEffect(() => {
    const el = commentsRef.current;
    if (!commentsOpen || !el || el.childElementCount) return;
    el.append(commentsScript(doc.id));
  }, [commentsOpen, doc.id]);

  // §79e: File › Print and the toolbar's printer open this post's Postcard window (§79d), for any post or page.
  const print = () =>
    launchApp("internet-explorer", {
      initialData: { postcard: { ...tagged, id: doc.id, type: doc.type, ...(html != null && { html }) } },
      multiWindow: true,
    });

  const step = (d: number) =>
    update({ size: Math.min(READER_SIZES.length - 1, Math.max(0, size + d)) });
  const canComment = doc.type === "post";
  const links = postLinks(html);
  // §53e: Play is disabled (not hidden, so the toolbar doesn't jump) unless the post has an audio card.
  const hasAudio = html != null && html.includes("kg-audio-card");

  const menuBar = (
    <GhostReaderMenuBar
      onClose={close}
      onPrint={print}
      viewAlt={viewAlt}
      onBigger={() => step(1)}
      onSmaller={() => step(-1)}
      onActualSize={() => update({ size: 1 })}
      canComment={canComment}
      commentsOpen={commentsOpen}
      onToggleComments={() => setCommentsOpen((o) => !o)}
      links={links}
    />
  );
  const words = html == null ? null : (textOnly(html).textContent ?? "").split(/\s+/).filter(Boolean).length;
  // Stock TextEdit's toolbar per theme (EditorToolbar): Aqua sits on the window, under the title bar's rule.
  const bar = isWindowsTheme
    ? "border-b border-[#919b9c]"
    : isMacOSTheme
      ? "bg-transparent"
      : "bg-neutral-100 border-b border-neutral-300";
  const icon = (on: boolean) => `size-4 ${on ? "text-os-text-primary" : "text-os-text-secondary"}`;

  return (
    <AppWindowShell
      isWindowOpen={isWindowOpen}
      isWindowsTheme={isWindowsTheme}
      isForeground={isForeground}
      menuBar={menuBar}
      windowFrameProps={{
        title: tagged.title ?? "",
        onClose: close,
        isForeground,
        appId: "textedit",
        skipInitialSound,
        instanceId,
        onNavigateNext,
        onNavigatePrevious,
        drawer: (
          <GhostInfoDrawer
            isOpen={infoOpen}
            onClose={() => setInfoOpen(false)}
            info={{ doc: tagged, words, views: counts?.views ?? null, likes: likes?.n ?? counts?.likes ?? null, links }}
          />
        ),
      }}
    >
      <div className="flex flex-col h-full w-full">
        <div
          className={`flex items-center gap-1 p-1 ${bar}`}
          style={{
            borderBottom: isMacOSTheme
              ? "var(--os-metrics-titlebar-border-width, 1px) solid var(--os-color-titlebar-border-inactive, rgba(0, 0, 0, 0.2))"
              : undefined,
          }}
        >
          {/* TextEdit's format bar, read-only: typeface and point size; the rest of it edits. */}
          <Select value={font} onValueChange={(v) => update({ font: v as ReaderFont })}>
            <SelectTrigger className="h-7 pl-2 !pr-6 !w-auto !min-w-[96px] !max-w-[128px] !text-[12px] [&>span]:min-w-0 [&>span]:truncate" aria-label="Font">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start" className="px-0">
              {(Object.keys(READER_FONTS) as ReaderFont[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {fontLabel(k)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(size)} onValueChange={(v) => update({ size: Number(v) })}>
            <SelectTrigger className="h-7 pl-2 !pr-6 !w-auto !min-w-[48px] !max-w-[56px] !text-[12px] [&>span]:min-w-0 [&>span]:truncate" aria-label="Text size">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start" className="px-0">
              {READER_SIZES.map((z, i) => (
                <SelectItem key={z} value={String(i)}>
                  {z * 16}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="icon" className="size-7 ml-auto" onClick={toggleLike} disabled={!likes} aria-label="Like" aria-pressed={!!likes?.liked}>
            <Heart className={icon(!!likes?.liked)} weight={likes?.liked ? "fill" : "bold"} />
          </Button>
          {canComment && (
            <Button variant="ghost" size="icon" className="size-7" onClick={() => setCommentsOpen((o) => !o)} aria-label="Comments" aria-pressed={commentsOpen}>
              <ChatCircle className={icon(commentsOpen)} weight={commentsOpen ? "fill" : "bold"} />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="size-7" onClick={() => launchApp("ipod", { initialData: { ghostTrackId: doc.id } })} disabled={!hasAudio} aria-label="Play">
            <Play className={icon(false)} weight="fill" />
          </Button>
          <Button variant="ghost" size="icon" className="size-7" onClick={print} disabled={html == null} aria-label="Postcard" title="Postcard">
            <Printer className={icon(false)} weight="bold" />
          </Button>
          <Button variant="ghost" size="icon" className="size-7" onClick={() => setInfoOpen((o) => !o)} aria-label="Info" aria-pressed={infoOpen}>
            <Info className={icon(infoOpen)} weight={infoOpen ? "fill" : "bold"} />
          </Button>
        </div>
        <div
          className="qntns-reader qntns-content flex-1 overflow-y-auto min-h-0"
          style={
            {
              "--font-reader": READER_FONTS[font].stack,
              "--content-measure": wide ? "var(--text-measure)" : "var(--text-measure-narrow)",
            } as React.CSSProperties
          }
        >
          <div className="qntns-reader__page" style={{ zoom: READER_SIZES[size] }}>
            {failed ? (
              <p className="qntns-reader__empty">-</p>
            ) : html == null ? null : (
              <div ref={bodyRef} />
            )}
            {canComment && <div ref={commentsRef} hidden={!commentsOpen} className="qntns-reader__comments" />}
          </div>
        </div>
      </div>
    </AppWindowShell>
  );
}
