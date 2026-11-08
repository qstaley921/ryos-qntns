import { useEffect, useRef, useState } from "react";
import type { AppProps } from "@/apps/base/types";
import { AppHelpAboutDialogs } from "@/components/shared/AppHelpAboutDialogs";
import { AppWindowShell } from "@/components/shared/AppWindowShell";
import { useResizeObserverWithRef } from "@/hooks/useResizeObserver";
import { cn } from "@/lib/utils";
import { appMetadata } from "../metadata";
import { useJournalLogic, type JournalLogic } from "../hooks/useJournalLogic";
import { currentJournalPage, isJournalDayId } from "../logic";
import { applyJournalFilter, loadJournalEntries } from "../journalEntries";
import { defaultDayId } from "../sampleContent";
import { FreeformCanvas } from "./FreeformCanvas";
import { GeneratedView } from "./GeneratedView";
import { JournalMenuBar } from "./JournalMenuBar";
import { JournalToolbar } from "./JournalToolbar";

const MOBILE_BREAKPOINT = 760;
const SIDEBAR_KEY = "ryos:journal:showSidebar";

function openCanvasPage(l: JournalLogic, pageId: string) {
  if (isJournalDayId(pageId)) l.api.selectDay(pageId);
  else l.api.selectUndated(pageId);
  if (l.journal.view === "freeform") l.api.setView("daily");
}

export function JournalAppComponent({
  isWindowOpen,
  onClose,
  isForeground,
  skipInitialSound,
  instanceId,
}: AppProps) {
  const l = useJournalLogic();
  const { t, isWindowsTheme, isMacOSTheme, isSystem7Theme, journal } = l;
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1120);
  const [, setLoaded] = useState(0);
  useEffect(() => {
    loadJournalEntries(l.filter).then(() => {
      l.api.selectDay(defaultDayId());
      setLoaded((n) => n + 1);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    applyJournalFilter(l.filter);
    l.api.selectDay(defaultDayId());
    setLoaded((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [l.filter]);
  useResizeObserverWithRef(containerRef, (entry) => {
    setContainerWidth(entry.contentRect.width);
  });
  const isMobileLayout = containerWidth < MOBILE_BREAKPOINT;
  // §22h: sidebar shown/hidden, kept per browser (the Journal store is outside this app's files).
  const [showSidebar, setShowSidebar] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) !== "0"; } catch { return true; }
  });
  const toggleSidebar = () =>
    setShowSidebar((shown) => {
      try { localStorage.setItem(SIDEBAR_KEY, shown ? "0" : "1"); } catch { /* private mode */ }
      return !shown;
    });
  const menuBar = (
    <JournalMenuBar l={l} onClose={onClose} showSidebar={showSidebar} onToggleSidebar={toggleSidebar} />
  );

  return (
    <AppWindowShell
      isWindowOpen={isWindowOpen}
      isWindowsTheme={isWindowsTheme}
      isForeground={isForeground}
      menuBar={menuBar}
      windowFrameProps={{
        title: t("apps.journal.title"),
        onClose,
        isForeground,
        appId: "journal",
        skipInitialSound,
        instanceId,
      }}
    >
      <div
        ref={containerRef}
        className={cn(
          "flex size-full flex-col overflow-hidden font-os-ui text-os-text-primary",
          isMacOSTheme ? "bg-transparent" : isSystem7Theme ? "bg-white" : "bg-os-window-bg"
        )}
      >
        <JournalToolbar
          l={l}
          isMobileLayout={isMobileLayout}
          showSidebar={showSidebar}
          onToggleSidebar={toggleSidebar}
        />
        <div className="flex min-h-0 flex-1 flex-col">
          {journal.view === "freeform" ? (
            <FreeformCanvas
              l={l}
              positions={journal.positions}
              texts={journal.texts}
              scraps={journal.scraps}
              showDates={journal.toggles.date}
              activePageId={currentJournalPage(journal).id}
              interactive
              onMove={l.api.moveFragment}
              onOpenDay={(pageId) => openCanvasPage(l, pageId)}
            />
          ) : (
            <GeneratedView l={l} showSidebar={showSidebar} />
          )}
        </div>
      </div>
      <AppHelpAboutDialogs
        appId="journal"
        helpItems={l.translatedHelpItems}
        metadata={appMetadata}
        isHelpOpen={l.isHelpDialogOpen}
        onHelpOpenChange={l.setIsHelpDialogOpen}
        isAboutOpen={l.isAboutDialogOpen}
        onAboutOpenChange={l.setIsAboutDialogOpen}
      />
    </AppWindowShell>
  );
}
