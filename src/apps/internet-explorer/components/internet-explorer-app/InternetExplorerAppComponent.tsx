// Safari (CHECKLIST-37 §28). Keeps the `internet-explorer` app id (the registry
// is CHECKLIST-35's); everything a visitor sees is Safari. Bookmarks bar = two
// folders, Friends and Portfolio, from Ghost pages. A site opens in a frame if
// the Worker's /frame-ok says it allows framing, else a card that links out.
import { useEffect, useState } from "react";
import { CaretLeft, CaretRight, ArrowSquareOut } from "@phosphor-icons/react";
import type { AppProps, InternetExplorerInitialData } from "@/apps/base/types";
import { AppWindowShell } from "@/components/shared/AppWindowShell";
import { AppHelpAboutDialogs } from "@/components/shared/AppHelpAboutDialogs";
import { AppMenuBarShell } from "@/components/shared/menubar/AppMenuBarShell";
import { AppMenuBarMenus } from "@/components/shared/menubar/AppMenuBarMenus";
import { useAppMenuBarChrome } from "@/hooks/useAppMenuBarChrome";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemedIcon } from "@/components/shared/ThemedIcon";
import { appMetadata, helpItems } from "../../metadata";
import { canFrame, loadBookmarks, type Bookmark, type Bookmarks } from "../../bookmarks";

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

export function InternetExplorerAppComponent({
  isWindowOpen,
  onClose,
  isForeground,
  skipInitialSound,
  instanceId,
  onNavigateNext,
  onNavigatePrevious,
}: AppProps<InternetExplorerInitialData>) {
  const chrome = useAppMenuBarChrome("internet-explorer", NAME);
  const [marks, setMarks] = useState<Bookmarks>({ friends: [], portfolio: [] });
  // history of opened bookmarks; null = the start page
  const [trail, setTrail] = useState<(Bookmark | null)[]>([null]);
  const [at, setAt] = useState(0);
  const [framed, setFramed] = useState<boolean | null>(null); // null = asking the Worker
  const [helpOpen, setHelpOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const site = trail[at];

  useEffect(() => {
    loadBookmarks().then(setMarks);
  }, []);

  useEffect(() => {
    if (!site) return;
    let live = true;
    setFramed(null);
    // a same-origin page with allow-scripts + allow-same-origin escapes the sandbox: always link out
    if (new URL(site.url).origin === location.origin) { setFramed(false); return; }
    canFrame(site.url).then((ok) => live && setFramed(ok));
    return () => {
      live = false;
    };
  }, [site]);

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
      helpItemLabel={`${NAME} Help`}
      aboutItemLabel={`About ${NAME}`}
      onShowHelp={() => setHelpOpen(true)}
      onShowAbout={() => setAboutOpen(true)}
    >
      <AppMenuBarMenus
        menus={[
          {
            label: "File",
            items: [
              { type: "action", label: "Open in New Window", onClick: linkOut, disabled: !site },
              { type: "separator" },
              { type: "action", label: "Close", onClick: onClose, shortcutId: "close" },
            ],
          },
          {
            label: "History",
            items: [
              { type: "action", label: "Back", onClick: () => setAt(at - 1), disabled: at === 0 },
              { type: "action", label: "Forward", onClick: () => setAt(at + 1), disabled: at === trail.length - 1 },
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
              key={site.url}
              src={site.url}
              title={site.title}
              className="size-full border-0"
              // the site keeps its own origin; never ours
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
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
        isHelpOpen={helpOpen}
        onHelpOpenChange={setHelpOpen}
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
