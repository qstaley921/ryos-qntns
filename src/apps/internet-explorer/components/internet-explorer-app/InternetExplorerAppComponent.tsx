// Safari (CHECKLIST-37 §28). Keeps the `internet-explorer` app id (the registry
// is CHECKLIST-35's); everything a visitor sees is Safari. Bookmarks bar = two
// folders, Friends and Portfolio, hardcoded (bookmarks.ts). A site's home page opens in
// a frame through the Worker's /site/ proxy (§28c); any click opens the real site in a
// new tab. A proxy error or timeout = a card that links out.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { CaretLeft, CaretRight, ArrowSquareOut } from "@phosphor-icons/react";
import type { AppProps, InternetExplorerInitialData } from "@/apps/base/types";
import { AppWindowShell } from "@/components/shared/AppWindowShell";
import { AppHelpAboutDialogs } from "@/components/shared/AppHelpAboutDialogs";
import { AppMenuBarShell } from "@/components/shared/menubar/AppMenuBarShell";
import { AppMenuBarMenus } from "@/components/shared/menubar/AppMenuBarMenus";
import { useAppMenuBarChrome } from "@/hooks/useAppMenuBarChrome";
import { fileSubmenus } from "@/components/shared/menubar/fileSubmenus";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemedIcon } from "@/components/shared/ThemedIcon";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSound, Sounds } from "@/hooks/useSound";
import { appMetadata, helpItems } from "../../metadata";
import { proxied, proxyOk, loadBookmarks, type Bookmark, type Bookmarks } from "../../bookmarks";

const NAME = "Safari";
const FOLDERS = [
  ["friends", "Friends"],
  ["portfolio", "Portfolio"],
] as const;

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

// §79: initialData { mini, path } is a Mini window (in the spirit of macOS's Captive Network
// Assistant) on one of our own pages. A mode of Safari, not a new app: no registry lines.
export function InternetExplorerAppComponent(props: AppProps<InternetExplorerInitialData>) {
  return props.initialData?.mini && props.initialData.path ? <Mini {...props} path={props.initialData.path} /> : <Safari {...props} />;
}

// The page itself, same origin, loaded with ?window (CHECKLIST-35 §8: no desktop inside).
// Title bar shows the page's title, the window's close button closes it; no address bar, tabs or bookmarks.
function Mini({
  isWindowOpen,
  onClose,
  isForeground,
  skipInitialSound,
  instanceId,
  onNavigateNext,
  onNavigatePrevious,
  path,
}: AppProps<InternetExplorerInitialData> & { path: string }) {
  const { t } = useTranslation();
  const chrome = useAppMenuBarChrome("internet-explorer", NAME);
  const [title, setTitle] = useState("");
  // off qntns.com (Storybook, dev) the page's own origin has no site pages, so frame the live www site
  const onSite = /^(www\.)?qntns\.com$/.test(location.hostname);
  const base = onSite ? location.origin : "https://www.qntns.com";
  const u = new URL(path, base);
  // our own pages only; any other origin never loads here
  const ours = u.origin === base || u.origin === "https://qntns.com" || u.origin === "https://www.qntns.com";
  const src = ours ? `${base}${u.pathname}${u.search ? `${u.search}&` : "?"}window${u.hash}` : null;

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
          <AppMenuBarMenus menus={[{ label: "File", items: [{ type: "action", label: "Close", onClick: onClose, shortcutId: "close" }, ...fileSubmenus({ t, onShareApp: () => chrome.setIsShareDialogOpen(true) })] }]} />
        </AppMenuBarShell>
      }
      windowFrameProps={{
        title: title || NAME,
        onClose,
        isForeground,
        appId: "internet-explorer",
        skipInitialSound,
        instanceId,
        onNavigateNext,
        onNavigatePrevious,
      }}
    >
      <div className="flex size-full flex-col bg-os-window-bg font-os-ui text-os-text-primary">
        <div className="relative min-h-0 flex-1 bg-white">
          {src && (
            <iframe
              src={src}
              title={title || "Page"}
              className="size-full border-0"
              onLoad={(e) => {
                // cross-origin (Storybook): the title is unreadable, keep the default
                try { setTitle(e.currentTarget.contentDocument?.title ?? ""); } catch { setTitle(""); }
              }}
            />
          )}
        </div>
      </div>
    </AppWindowShell>
  );
}

function Safari({
  isWindowOpen,
  onClose,
  isForeground,
  skipInitialSound,
  instanceId,
  onNavigateNext,
  onNavigatePrevious,
}: AppProps<InternetExplorerInitialData>) {
  const { t } = useTranslation();
  const chrome = useAppMenuBarChrome("internet-explorer", NAME);
  const [marks, setMarks] = useState<Bookmarks>({ friends: [], portfolio: [] });
  // history of opened bookmarks; null = the start page
  const [trail, setTrail] = useState<(Bookmark | null)[]>([null]);
  const [at, setAt] = useState(0);
  const [reload, setReload] = useState(0);
  const [framed, setFramed] = useState<boolean | null>(null); // null = asking the proxy
  const [aboutOpen, setAboutOpen] = useState(false);
  // address-field progress, faked (a cross-origin frame reports none): 0 off, 1 jump to 10%, 2 ease to 90%, 3 snap to 100% + fade
  const [bar, setBar] = useState(0);
  const site = trail[at];

  useEffect(() => {
    loadBookmarks().then(setMarks);
  }, []);

  useEffect(() => {
    if (!site) return setBar(0);
    let live = true;
    setFramed(null);
    setBar(1);
    const ease = setTimeout(() => live && setBar(2), 50);
    proxyOk(site.url).then((ok) => {
      if (!live) return;
      setFramed(ok);
      if (!ok) setBar(0); // the card: clear at once
    });
    return () => {
      live = false;
      clearTimeout(ease);
    };
  }, [site, reload]);

  // §28i: the proxied page reports {qntnsSite:{ok}} ~2s after its load. Only our frame's window counts, and
  // nothing in the message is rendered. Not ok, or no report 8s after onLoad, = the alert below.
  const frameRef = useRef<HTMLIFrameElement>(null);
  const silence = useRef<ReturnType<typeof setTimeout>>(undefined);
  const heard = useRef(false); // a report can beat a slow onLoad (its 10s fallback)
  useEffect(() => {
    heard.current = false;
    const on = (e: MessageEvent) => {
      if (!frameRef.current || e.source !== frameRef.current.contentWindow) return;
      const r = (e.data as { qntnsSite?: { ok?: unknown } } | null)?.qntnsSite;
      if (!r) return;
      heard.current = true;
      clearTimeout(silence.current);
      if (r.ok !== true) setFramed(false);
    };
    window.addEventListener("message", on);
    return () => {
      window.removeEventListener("message", on);
      clearTimeout(silence.current);
    };
  }, [site, reload]);

  useEffect(() => {
    if (bar !== 3) return;
    const id = setTimeout(() => setBar(0), 400); // after the snap (200ms) + fade (100ms delay, 200ms)
    return () => clearTimeout(id);
  }, [bar]);

  const open = (b: Bookmark) => {
    setTrail([...trail.slice(0, at + 1), b]);
    setAt(at + 1);
  };
  const linkOut = () => site && window.open(site.url, "_blank", "noopener,noreferrer");
  // back to the Bookmarks screen as a new history step, so Back still reaches the failed site
  const home = () => {
    setTrail([...trail.slice(0, at + 1), null]);
    setAt(at + 1);
  };
  const failed = !!site && framed === false;
  const openRef = useRef<HTMLButtonElement>(null);
  const { play: sosumi } = useSound(Sounds.ALERT_SOSUMI);
  useEffect(() => {
    if (failed) sosumi();
  }, [failed, sosumi]);

  const menuBar = (
    <AppMenuBarShell
      isWindowsTheme={chrome.isWindowsTheme}
      isMacOSTheme={chrome.isMacOSTheme}
      appId={chrome.appId}
      appName={chrome.appName}
      isShareDialogOpen={chrome.isShareDialogOpen}
      setIsShareDialogOpen={chrome.setIsShareDialogOpen}
      aboutItemLabel={`About ${NAME}`}
      onShowAbout={() => setAboutOpen(true)}
    >
      <AppMenuBarMenus
        menus={[
          {
            label: "File",
            items: [
              { type: "action", label: "Open in New Window", onClick: linkOut, disabled: !site },
              ...fileSubmenus({ t, onShareApp: () => chrome.setIsShareDialogOpen(true) }),
              { type: "separator" },
              { type: "action", label: "Close", onClick: onClose, shortcutId: "close" },
            ],
          },
          {
            label: "View",
            items: [
              { type: "action", label: "Back", onClick: () => setAt(at - 1), disabled: at === 0 },
              { type: "action", label: "Forward", onClick: () => setAt(at + 1), disabled: at === trail.length - 1 },
              { type: "action", label: "Reload", onClick: () => setReload((n) => n + 1), disabled: !site },
            ],
          },
          {
            label: "Bookmarks",
            items: FOLDERS.map(([k, label]) => ({
              type: "submenu" as const,
              label,
              disabled: marks[k].length === 0,
              items: marks[k].map((b) => ({ type: "action" as const, label: b.title, onClick: () => open(b) })),
            })),
          },
        ]}
      />
    </AppMenuBarShell>
  );

  return (
    <AppWindowShell
      isWindowOpen={isWindowOpen}
      isWindowsTheme={chrome.isWindowsTheme}
      isForeground={isForeground}
      menuBar={menuBar}
      windowFrameProps={{
        title: site?.title ?? NAME,
        onClose,
        isForeground,
        appId: "internet-explorer",
        skipInitialSound,
        instanceId,
        onNavigateNext,
        onNavigatePrevious,
      }}
    >
      <div className="flex size-full flex-col bg-os-window-bg font-os-ui text-os-text-primary">
        {/* Toolbar: back/forward, address, link out */}
        <div className="flex items-center gap-2 border-b border-os-window px-2 py-1">
          <Button variant="ghost" size="icon" aria-label="Back" disabled={at === 0} onClick={() => setAt(at - 1)}>
            <CaretLeft weight="bold" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Forward" disabled={at === trail.length - 1} onClick={() => setAt(at + 1)}>
            <CaretRight weight="bold" />
          </Button>
          <div className="relative min-w-0 flex-1 truncate rounded-md border border-os-window bg-white px-3 py-1 text-center text-[12px] text-neutral-700 os-dark:bg-neutral-800 os-dark:text-neutral-200">
            {bar > 0 && (
              // Safari 1–3's Aqua fill behind the address text. Width eases 10%→90% over 10s (decelerating), snaps to 100% on load, then fades.
              // Reduced motion: no easing, just a full fill while loading.
              <div
                key={reload}
                aria-hidden
                className={`pointer-events-none absolute inset-y-0 left-0 bg-[linear-gradient(to_bottom,#e6f1fd_0%,#c3ddf8_50%,#a9cdf4_51%,#cbe3fa_100%)] os-dark:bg-[linear-gradient(to_bottom,#3a6ea8_0%,#2c5b91_50%,#234f84_51%,#2f6198_100%)] motion-reduce:w-full motion-reduce:transition-none ${
                  bar === 1
                    ? "w-[10%]"
                    : bar === 2
                      ? "w-[90%] transition-[width] duration-[10s] ease-[cubic-bezier(0.1,0.7,0.2,1)]"
                      : "w-full opacity-0 transition-[width,opacity] duration-200 [transition-delay:0s,100ms]"
                }`}
              />
            )}
            <span className="relative">{site ? host(site.url) : "Bookmarks"}</span>
          </div>
          <Button variant="ghost" size="icon" aria-label="Open in new window" disabled={!site} onClick={linkOut}>
            <ArrowSquareOut weight="bold" />
          </Button>
        </div>

        {/* Bookmarks bar: Friends and Portfolio only */}
        <div className="flex items-center gap-1 border-b border-os-window px-2 py-0.5">
          {FOLDERS.map(([k, label]) => (
            <DropdownMenu key={k}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1 px-2 text-[11px]">
                  <ThemedIcon name="directory.png" alt="" className="size-4 [image-rendering:pixelated]" />
                  {label}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" sideOffset={4} className="max-w-xs px-0">
                {marks[k].length === 0 ? (
                  <DropdownMenuItem disabled className="h-6 px-3">Empty</DropdownMenuItem>
                ) : (
                  marks[k].map((b) => (
                    <DropdownMenuItem key={b.id} onClick={() => open(b)} className="flex h-6 items-center gap-2 px-3">
                      <ThemedIcon name="site.png" alt="" className="size-4 [image-rendering:pixelated]" />
                      {b.title}
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ))}
        </div>

        <div className="relative min-h-0 flex-1 bg-white os-dark:bg-neutral-900">
          {!site ? (
            <StartPage marks={marks} open={open} />
          ) : framed ? (

            <iframe
              key={`${site.url}#${reload}`}
              src={proxied(site.url)}
              title={site.title}
              className="size-full border-0"
              // no allow-same-origin: the page runs in an opaque origin, never the Worker's (the Worker's CSP says the same)
              sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
              referrerPolicy="strict-origin-when-cross-origin"
              ref={frameRef}
              onLoad={() => {
                setBar((b) => (b ? 3 : b));
                clearTimeout(silence.current);
                if (!heard.current) silence.current = setTimeout(() => setFramed(false), 8000);
              }}
            />
          ) : null /* waiting: the address-field fill shows it; failed: the alert below */}
        </div>
      </div>
      {/* Load failure (Worker error, non-2xx, 10s timeout): the system alert, same parts as ConfirmDialog's Aqua path.
          Its confirm button is hard-wired to "Confirm", hence this copy. */}
      <Dialog open={failed} onOpenChange={(o) => !o && home()}>
        <DialogContent
          className="max-w-[400px]"
          onOpenAutoFocus={(e) => {
            e.preventDefault(); // default button is Open in Browser, not the first one
            openRef.current?.focus();
          }}
        >
          <DialogTitle className="sr-only">Safari</DialogTitle>
          <DialogHeader>Safari</DialogHeader>
          <div className="p-6">
            <div className="flex items-start gap-3">
              <ThemedIcon name="warn.png" alt="" className="mt-1 size-8 [image-rendering:pixelated]" width={32} height={32} />
              <div className="font-geneva-12 text-[12px] leading-tight text-neutral-900">
                <p className="font-bold">Safari can't show “{site ? host(site.url) : ""}” here.</p>
                <DialogDescription className="mt-2 text-[12px] text-neutral-900">
                  The page didn't load inside Safari. You can open it in your browser instead.
                </DialogDescription>
              </div>
            </div>
            <DialogFooter className="mt-4 gap-2">
              <Button variant="retro" className="h-7 font-geneva-12 text-[12px]" onClick={home}>
                Cancel
              </Button>
              <Button
                ref={openRef}
                className="font-geneva-12 text-[12px]"
                onClick={() => {
                  linkOut();
                  home();
                }}
              >
                Open in Browser
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
      <AppHelpAboutDialogs
        appId="internet-explorer"
        helpItems={helpItems}
        metadata={appMetadata}
        isHelpOpen={false}
        onHelpOpenChange={() => {}}
        isAboutOpen={aboutOpen}
        onAboutOpenChange={setAboutOpen}
      />
    </AppWindowShell>
  );
}

// Safari 1–3's Bookmarks view: a Collections source list left, the folder's bookmarks as a striped
// Bookmark / Address table right. Rows 20px, headers 24px, list 160px wide (base 4; 1px rules exempt).
const HEAD =
  "flex h-6 shrink-0 items-center border-b border-black/20 bg-[linear-gradient(to_bottom,#ffffff,#e6e6e6)] px-2 text-[11px] text-neutral-700 os-dark:border-white/20 os-dark:bg-[linear-gradient(to_bottom,#4a4a4a,#333333)] os-dark:text-neutral-200";
const SELECTED = { "--os-color-selection-bg": "var(--os-accent-list-gradient, #3875d7)" } as CSSProperties;

function FolderGlyph() {
  // our own drawing: a blue Aqua folder, 16px
  return (
    <svg viewBox="0 0 16 16" className="size-4 shrink-0" aria-hidden>
      <path d="M1 4V3h5l1 1h8v9H1z" fill="#6a9fe0" />
      <path d="M1 6h14v7H1z" fill="#8dbaf0" />
      <path d="M1 6h14" stroke="#c7defa" />
    </svg>
  );
}

function StartPage({ marks, open }: { marks: Bookmarks; open: (b: Bookmark) => void }) {
  const [folder, setFolder] = useState<(typeof FOLDERS)[number][0]>("friends");
  const [pick, setPick] = useState<string | null>(null);
  const rows = marks[folder];
  const picked = rows.find((b) => b.id === pick);

  return (
    <div className="flex size-full text-[12px]" style={SELECTED}>
      <div className="flex w-40 shrink-0 flex-col border-r border-black/20 bg-[#e8edf5] os-dark:border-white/20 os-dark:bg-neutral-800">
        <div className={HEAD}>Collections</div>
        <div role="listbox" aria-label="Collections" className="py-1">
          {FOLDERS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="option"
              aria-selected={folder === k}
              data-selected={folder === k ? "true" : undefined}
              onClick={() => {
                setFolder(k);
                setPick(null);
              }}
              className="flex h-5 w-full items-center gap-1 px-2 text-left"
            >
              <FolderGlyph />
              <span className="truncate">{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div
        role="grid"
        aria-label={FOLDERS.find(([k]) => k === folder)?.[1]}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" && picked) open(picked);
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const n = rows.findIndex((b) => b.id === pick) + (e.key === "ArrowDown" ? 1 : -1);
            const b = rows[Math.max(0, Math.min(rows.length - 1, n))];
            if (b) setPick(b.id);
          }
        }}
        className="flex min-w-0 flex-1 flex-col overflow-auto outline-none"
      >
        <div className={`${HEAD} sticky top-0 px-0`}>
          <span className="w-1/2 truncate border-r border-black/20 px-2 os-dark:border-white/20">Bookmark</span>
          <span className="min-w-0 flex-1 truncate px-2">Address</span>
        </div>
        {rows.length === 0 ? (
          <p className="px-2 py-1 text-neutral-500">No sites yet.</p>
        ) : (
          rows.map((b, i) => (
            <div
              key={b.id}
              role="row"
              aria-selected={pick === b.id}
              data-selected={pick === b.id ? "true" : undefined}
              onClick={() => setPick(b.id)}
              onDoubleClick={() => open(b)}
              title={b.excerpt || undefined}
              className={`flex h-5 shrink-0 cursor-default items-center ${
                pick === b.id ? "" : i % 2 ? "bg-[#edf3fe] os-dark:bg-neutral-800" : "bg-white os-dark:bg-neutral-900"
              }`}
            >
              <span role="gridcell" className="flex w-1/2 min-w-0 items-center gap-1 px-2">
                <ThemedIcon name="site.png" alt="" className="size-4 shrink-0 [image-rendering:pixelated]" />
                <span className="truncate">{b.title}</span>
              </span>
              <span role="gridcell" className="min-w-0 flex-1 truncate px-2">
                {b.url}
              </span>
            </div>
          ))
        )}
        {/* stripes carry on below the last row, as in an NSTableView */}
        <div className="min-h-0 flex-1 bg-[repeating-linear-gradient(to_bottom,var(--stripe-a)_0_20px,var(--stripe-b)_20px_40px)] [--stripe-a:#ffffff] [--stripe-b:#edf3fe] os-dark:[--stripe-a:#171717] os-dark:[--stripe-b:#262626]" style={rows.length % 2 ? { backgroundPosition: "0 20px" } : undefined} />
      </div>
    </div>
  );
}
