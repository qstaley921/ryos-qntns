// Safari (CHECKLIST-37 §28). Keeps the `internet-explorer` app id (the registry
// is CHECKLIST-35's); everything a visitor sees is Safari. Bookmarks bar = two
// folders, Friends and Portfolio, hardcoded (bookmarks.ts). A site's home page opens in
// a frame through the Worker's /site/ proxy (§28c); any click opens the real site in a
// new tab. A proxy error or timeout = a card that links out.
import { useEffect, useState } from "react";
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
  const site = trail[at];

  useEffect(() => {
    loadBookmarks().then(setMarks);
  }, []);

  useEffect(() => {
    if (!site) return;
    let live = true;
    setFramed(null);
    proxyOk(site.url).then((ok) => live && setFramed(ok));
    return () => {
      live = false;
    };
  }, [site, reload]);

  const open = (b: Bookmark) => {
    setTrail([...trail.slice(0, at + 1), b]);
    setAt(at + 1);
  };
  const linkOut = () => site && window.open(site.url, "_blank", "noopener,noreferrer");

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
          <div className="min-w-0 flex-1 truncate rounded-md border border-os-window bg-white px-3 py-1 text-center text-[12px] text-neutral-700 os-dark:bg-neutral-800 os-dark:text-neutral-200">
            {site ? host(site.url) : "Bookmarks"}
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
          ) : framed === null ? (
            <p className="p-4 text-[12px] text-neutral-500">Loading {host(site.url)}…</p>
          ) : framed ? (
            <iframe
              key={`${site.url}#${reload}`}
              src={proxied(site.url)}
              title={site.title}
              className="size-full border-0"
              // no allow-same-origin: the page runs in an opaque origin, never the Worker's (the Worker's CSP says the same)
              sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          ) : (
            <div className="flex size-full items-center justify-center p-4">
              <div className="max-w-sm rounded-md border border-os-window p-4 text-center">
                <p className="text-[13px] font-semibold">{site.title}</p>
                {site.excerpt && <p className="mt-1 text-[12px] text-neutral-600 os-dark:text-neutral-300">{site.excerpt}</p>}
                <p className="mt-2 text-[11px] text-neutral-500">This site can't be shown inside Safari.</p>
                <Button className="mt-3" size="sm" onClick={linkOut}>
                  Open {host(site.url)}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
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

function StartPage({ marks, open }: { marks: Bookmarks; open: (b: Bookmark) => void }) {
  return (
    <div className="size-full overflow-auto p-4">
      {FOLDERS.map(([k, label]) => (
        <section key={k} className="mb-4">
          <h2 className="mb-2 text-[13px] font-semibold">{label}</h2>
          {marks[k].length === 0 ? (
            <p className="text-[12px] text-neutral-500">No sites yet.</p>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2">
              {marks[k].map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => open(b)}
                    className="w-full rounded-md border border-os-window p-2 text-left hover:bg-neutral-100 os-dark:hover:bg-neutral-800"
                  >
                    <span className="block truncate text-[12px] font-semibold">{b.title}</span>
                    <span className="block truncate text-[11px] text-neutral-500">{b.excerpt || host(b.url)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
