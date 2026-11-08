// §79d: a Postcard window, Safari's other mode beside Mini. Only the site's postcard
// editor + buy view for one post (the fork's port, as GhostReader once laid it over
// the page), held in the window: no address bar, no navigation, no other page.
// Launch: launchApp("internet-explorer", { initialData: { postcard: { id, type } }, multiWindow: true });
// a doc with `html` skips the openDoc() fetch.
import { useEffect, useRef, useState } from "react";
import type { AppProps } from "@/apps/base/types";
import { AppWindowShell } from "@/components/shared/AppWindowShell";
import { AppMenuBarShell } from "@/components/shared/menubar/AppMenuBarShell";
import { AppMenuBarMenus } from "@/components/shared/menubar/AppMenuBarMenus";
import { useAppMenuBarChrome } from "@/hooks/useAppMenuBarChrome";
import { fileSubmenus } from "@/components/shared/menubar/fileSubmenus";
import { useTranslation } from "react-i18next";
import { openDoc, type GhostDoc } from "@/lib/ghost";
import { renderBody } from "@/apps/textedit/qntns/render.js";
import "@/apps/paint/wall/css/tokens.css";
import "@/apps/paint/wall/css/postcard.css";
import "./postcard-window.css";

export type PostcardDoc = Pick<GhostDoc, "id" | "type"> & Partial<GhostDoc> & { html?: string };

const NAME = "Postcard";

export function PostcardWindow({
  isWindowOpen,
  onClose,
  isForeground,
  skipInitialSound,
  instanceId,
  onNavigateNext,
  onNavigatePrevious,
  post,
}: AppProps & { post: PostcardDoc }) {
  const { t } = useTranslation();
  const chrome = useAppMenuBarChrome("internet-explorer", NAME);
  const [doc, setDoc] = useState<PostcardDoc | null>(post.html ? post : null);
  const [failed, setFailed] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);

  // The window's own close, with its animation (as TextEdit's close()).
  const close = () =>
    window.dispatchEvent(new CustomEvent(`closeWindow-${instanceId || "internet-explorer"}`, { detail: { onComplete: onClose } }));
  const closeRef = useRef(close);
  closeRef.current = close;
  const frontRef = useRef(isForeground);
  frontRef.current = isForeground;

  useEffect(() => {
    if (post.html) return;
    let live = true;
    openDoc(post).then((b) => live && (b ? setDoc(b) : setFailed(true)));
    return () => {
      live = false;
    };
  }, [post]);

  // The theme's openPostcard, mounted in the window. Closing the editor (Escape) closes the window;
  // closing the window closes the editor first, which saves the draft.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || doc?.html == null) return;
    let gone = false;
    let card: { open(): void; close(): void; destroy(): void } | null = null;
    import("@/apps/paint/wall/qntns/postcard.js").then((pc) => {
      if (gone) return;
      const poem = doc.tags?.some((t) => t.slug === "hash-fixed-lines");
      const root = document.createElement("div");
      root.innerHTML = `<h1 class="qntns-content__title"></h1><p class="qntns-content__tag"></p><div class="qntns-content__body${poem ? " qntns-content__body--poem" : ""}"></div>`;
      root.firstElementChild!.textContent = doc.title ?? "";
      root.lastElementChild!.innerHTML = doc.html!;
      root.querySelectorAll(".kg-audio-card").forEach((n) => n.remove()); // §54: audio is the iPod's
      renderBody(root)(); // the body passes the card reads (poem lines, drop cap); their listeners are not needed
      const u = new URL(doc.url ?? "https://www.qntns.com/", location.href);
      const data = pc.readArticle(root, { url: `${u.host}${u.pathname}` });
      host.innerHTML = pc.renderPostcard(data);
      card = pc.attachPostcard(host, data, { onClose: () => !gone && closeRef.current(), isFront: () => !!frontRef.current, fit: true });
      card!.open();
    });
    return () => {
      gone = true;
      card?.close();
      card?.destroy();
      host.replaceChildren();
    };
  }, [doc]);

  return (
    <AppWindowShell
      isWindowOpen={isWindowOpen}
      isWindowsTheme={chrome.isWindowsTheme}
      isForeground={isForeground}
      menuBar={
        <AppMenuBarShell
          isWindowsTheme={chrome.isWindowsTheme}
          isMacOSTheme={chrome.isMacOSTheme}
          appId={chrome.appId}
          appName={chrome.appName}
          isShareDialogOpen={chrome.isShareDialogOpen}
          setIsShareDialogOpen={chrome.setIsShareDialogOpen}
          aboutItemLabel={`About ${NAME}`}
        >
          <AppMenuBarMenus menus={[{ label: "File", items: [{ type: "action", label: "Close", onClick: close, shortcutId: "close" }, ...fileSubmenus({ t, onShareApp: () => chrome.setIsShareDialogOpen(true) })] }]} />
        </AppMenuBarShell>
      }
      windowFrameProps={{
        title: doc?.title ? `${NAME}: ${doc.title}` : NAME,
        onClose: close,
        isForeground,
        appId: "internet-explorer",
        skipInitialSound,
        instanceId,
        onNavigateNext,
        onNavigatePrevious,
      }}
    >
      <div className="flex size-full flex-col bg-os-window-bg font-os-ui text-os-text-primary">
        {failed ? (
          <p className="m-auto text-os-text-secondary">-</p>
        ) : (
          <div ref={hostRef} className="ryos-postcard-window ryos-aqua-scroll min-h-0 flex-1" />
        )}
      </div>
    </AppWindowShell>
  );
}
