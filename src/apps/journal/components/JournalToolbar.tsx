import type { ReactNode } from "react";
import { BookOpen, CaretDown, Funnel, Note, SidebarSimple } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { osToolbarSurfaceClassName } from "@/components/shared/osThemePrimitives";
import { ToolbarButton as AquaButton, ToolbarButtonGroup } from "@/components/ui/toolbar-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { journalKinds } from "../journalEntries";
import { JOURNAL_VIEWS, type JournalView } from "../types";
import type { JournalLogic } from "../hooks/useJournalLogic";

const VIEW_ICONS: Record<JournalView, ReactNode> = {
  daily: <BookOpen size={14} />,
  freeform: <Note size={14} />,
};

function ToolbarButton({
  l,
  active,
  onClick,
  label,
  showLabel,
  children,
}: {
  l: JournalLogic;
  active?: boolean;
  onClick: () => void;
  label: string;
  showLabel?: boolean;
  children: ReactNode;
}) {
  if (l.isMacOSTheme) {
    return (
      <button
        type="button"
        className={cn("metal-inset-btn", showLabel ? "gap-1 px-2 text-[11px]" : "metal-inset-icon")}
        data-state={active ? "on" : "off"}
        onClick={onClick}
        title={label}
        aria-label={label}
        aria-pressed={active}
      >
        {children}
        {showLabel ? <span>{label}</span> : null}
      </button>
    );
  }
  return (
    <Button
      type="button"
      variant={l.isSystem7Theme ? "player" : "ghost"}
      data-state={active ? "on" : "off"}
      onClick={onClick}
      className={cn(
        "h-6 gap-1 px-1.5 text-[11px]",
        !showLabel && "w-6 px-0",
        l.isWindowsTheme && "text-black",
        active && !l.isSystem7Theme && "bg-black/10"
      )}
      title={label}
      aria-label={label}
      aria-pressed={active}
    >
      {children}
      {showLabel ? <span>{label}</span> : null}
    </Button>
  );
}

export function JournalToolbar({
  l,
  isMobileLayout,
  showSidebar,
  onToggleSidebar,
}: {
  l: JournalLogic;
  isMobileLayout: boolean;
  showSidebar: boolean;
  onToggleSidebar: () => void;
}) {
  const { t, isMacOSTheme, isSystem7Theme, isWindowsTheme, journal } = l;
  const group = isMacOSTheme ? "metal-inset-btn-group" : "flex items-center gap-0.5";
  const tabs: JournalView[] = [...JOURNAL_VIEWS];
  const kinds = journalKinds();
  return (
    <div
      className={cn(
        "flex h-[38px] shrink-0 items-center gap-2 py-1.5",
        isMacOSTheme ? "px-1" : "px-2",
        osToolbarSurfaceClassName(
          { isMacOSTheme, isSystem7Theme, isWindowsTheme },
          { border: "bottom" }
        )
      )}
    >
      {journal.view === "daily" && (
        // §22h: Calendar's sidebar toggle (BottomToolbar): SidebarSimple, data-state on/off.
        <div className={group}>
          <ToolbarButton l={l} active={showSidebar} onClick={onToggleSidebar} label="Show Sidebar">
            <SidebarSimple size={14} />
          </ToolbarButton>
        </div>
      )}
      <div className={group} role="toolbar" aria-label={t("common.menu.view")}>
        {tabs.map((view) => (
          <ToolbarButton
            key={view}
            l={l}
            active={journal.view === view}
            onClick={() => l.api.setView(view)}
            label={t(`apps.journal.views.${view}`)}
            showLabel={!isMobileLayout}
          >
            {VIEW_ICONS[view]}
          </ToolbarButton>
        ))}
      </div>
      {kinds.length > 0 && (
        // Aqua pop-up button, same parts as Finder's gear popup (FinderMacToolbar).
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {isMacOSTheme ? (
              <ToolbarButtonGroup>
                <AquaButton className="gap-1 px-2 text-[11px]" data-state={l.filter ? "on" : "off"} aria-label="Filter">
                  <Funnel size={14} weight="fill" />
                  <span>{l.filter ?? "All"}</span>
                  <CaretDown size={8} weight="bold" />
                </AquaButton>
              </ToolbarButtonGroup>
            ) : (
              <Button
                type="button"
                variant={isSystem7Theme ? "player" : "ghost"}
                className={cn("h-6 gap-1 px-1.5 text-[11px]", isWindowsTheme && "text-black")}
                aria-label="Filter"
              >
                <Funnel size={14} />
                <span>{l.filter ?? "All"}</span>
                <CaretDown size={8} weight="bold" />
              </Button>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup value={l.filter ?? ""} onValueChange={(v) => l.api.setFilter(v || null)}>
              <DropdownMenuRadioItem value="" className="text-md h-6">All</DropdownMenuRadioItem>
              <DropdownMenuSeparator />
              {kinds.map((k) => (
                <DropdownMenuRadioItem key={k} value={k} className="text-md h-6">{k}</DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
