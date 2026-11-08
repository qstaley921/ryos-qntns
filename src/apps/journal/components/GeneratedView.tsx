import { useRef } from "react";
import { AppSidebarPanel } from "@/components/layout/AppSidebarPanel";
import { PanelHeader } from "@/apps/contacts/components/contacts-app/PanelHeader";
import { cn } from "@/lib/utils";
import {
  clamp,
  fragmentsForJournalDay,
  journalPageIndex,
  journalDateUnderTitle,
  journalPageTitle,
  journalSidebarDays,
  JOURNAL_SIDEBAR_MAX_WIDTH,
  JOURNAL_SIDEBAR_MIN_WIDTH,
  todayDayId,
} from "../logic";
import {
  formatJournalDay,
  JOURNAL_DAYS,
  sampleJournalTitle,
} from "../sampleContent";
import type { JournalLogic } from "../hooks/useJournalLogic";
import { JournalSidebarCalendar } from "./JournalSidebarCalendar";
import { JournalEntryEditor } from "./JournalEntryEditor";

export function GeneratedView({ l, showSidebar }: { l: JournalLogic; showSidebar: boolean }) {
  return <DailyJournal l={l} showSidebar={showSidebar} />;
}

// §22f: the list + calendar is always a left sidebar, at every width (no stacked top bar).
export function DailyJournal({ l, showSidebar }: { l: JournalLogic; showSidebar: boolean }) {
  const { t, language, journal, isMacOSTheme, isSystem7Theme, isWindowsTheme, sidebarWidth } = l;
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;
  const features = journal.toggles;
  const today = todayDayId();
  const sidebarDays = journalSidebarDays(journal);
  const pageIndex = journalPageIndex(journal, today);
  const showingUndated =
    journal.selectedUndatedId !== null &&
    journal.undatedPages.includes(journal.selectedUndatedId);
  const pageItems = [
    ...JOURNAL_DAYS.map((day) => ({ kind: "day" as const, id: day.id })),
    ...journal.undatedPages.map((id) => ({ kind: "page" as const, id })),
  ];
  const selectedDayId = journal.selectedDayId;
  const activeDayId = showingUndated ? null : selectedDayId;
  const pageId = showingUndated ? journal.selectedUndatedId! : activeDayId;
  const fragments = activeDayId ? fragmentsForJournalDay(journal, activeDayId) : [];
  const textFragments = fragments;
  const useGeneva = isMacOSTheme || isSystem7Theme;
  const dateLabel =
    features.date && activeDayId ? formatJournalDay(activeDayId, language) : "";
  const defaultPageTitle =
    (pageId ? sampleJournalTitle(pageId, language) : "") ||
    dateLabel ||
    t("apps.journal.pageNumber", { count: pageIndex + 1 });
  const displayedTitle = journalPageTitle(journal, pageId ?? "", defaultPageTitle);
  const titleDate = journalDateUnderTitle(displayedTitle, dateLabel);

  return (
    <div className="flex min-h-0 flex-1 flex-row">
      {showSidebar ? (
      <div className="relative flex min-h-0 shrink-0" style={{ width: sidebarWidth }}>
      <AppSidebarPanel
        bordered={isMacOSTheme}
        className="flex min-h-0 w-full flex-col"
        style={!isMacOSTheme ? { borderRight: "1px solid rgba(0,0,0,0.08)" } : undefined}
      >
        <PanelHeader
          title={features.date ? t("apps.journal.sidebar.days") : t("apps.journal.views.daily")}
          useGeneva={useGeneva}
          bordered={isMacOSTheme}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {features.date
            ? sidebarDays.map((dayId) => {
                const active = !showingUndated && dayId === selectedDayId;
                return (
                  <button
                    key={dayId}
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => l.api.selectDay(dayId)}
                    data-selected={active ? "true" : undefined}
                    className={cn(
                      "flex w-full items-center px-2.5 py-1 text-left text-[13px] leading-tight",
                      !active && "transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                    )}
                  >
                    <span className="truncate">
                      {journalPageTitle(
                        journal,
                        dayId,
                        sampleJournalTitle(dayId, language) || formatJournalDay(dayId, language)
                      )}
                    </span>
                  </button>
                );
              })
            : null}
          {features.date
            ? journal.undatedPages.map((id, index) => {
                const active = journal.selectedUndatedId === id;
                return (
                  <button
                    key={`page:${id}`}
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => l.api.selectUndated(id)}
                    data-selected={active ? "true" : undefined}
                    className={cn(
                      "flex w-full items-center px-2.5 py-1 text-left text-[13px] leading-tight",
                      !active && "transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                    )}
                  >
                    <span className="truncate">
                      {t("apps.journal.pageNumber", {
                        count: sidebarDays.length + index + 1,
                      })}
                    </span>
                  </button>
                );
              })
            : pageItems.map((item, index) => {
                const active =
                  item.kind === "page"
                    ? item.id === journal.selectedUndatedId
                    : !showingUndated && item.id === selectedDayId;
                return (
                  <button
                    key={`${item.kind}:${item.id}`}
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() =>
                      item.kind === "page" ? l.api.selectUndated(item.id) : l.api.selectDay(item.id)
                    }
                    data-selected={active ? "true" : undefined}
                    className={cn(
                      "flex w-full items-center px-2.5 py-1 text-left text-[13px] leading-tight",
                      !active && "transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                    )}
                  >
                    <span className="truncate">
                      {t("apps.journal.pageNumber", { count: index + 1 })}
                    </span>
                  </button>
                );
              })}
        </div>
        {features.date ? (
          <div className="shrink-0 border-t border-black/10 os-dark:border-white/10">
            <JournalSidebarCalendar
              selectedDate={showingUndated ? "" : selectedDayId}
              today={today}
              language={language}
              isWindowsTheme={isWindowsTheme}
              isMacOSTheme={isMacOSTheme}
              isSystem7Theme={isSystem7Theme}
              onSelectDay={l.api.selectDay}
            />
          </div>
        ) : null}
      </AppSidebarPanel>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("apps.journal.sidebar.days")}
          className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize touch-none"
          onPointerDown={(event) => {
            event.preventDefault();
            const startX = event.clientX;
            const startWidth = sidebarWidthRef.current;
            const move = (pointerEvent: PointerEvent) => {
              l.api.setSidebarWidth(
                clamp(
                  startWidth + pointerEvent.clientX - startX,
                  JOURNAL_SIDEBAR_MIN_WIDTH,
                  JOURNAL_SIDEBAR_MAX_WIDTH
                )
              );
            };
            const stop = () => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", stop);
              window.removeEventListener("pointercancel", stop);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", stop);
            window.addEventListener("pointercancel", stop);
          }}
        />
      </div>
      ) : null}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <article className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 pb-16">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-medium leading-tight">{displayedTitle}</h2>
            {titleDate ? (
              <span data-journal-title-date className="mt-2 block text-sm text-os-text-secondary">
                {titleDate}
              </span>
            ) : null}
          </div>
        </header>
        <div className="mt-4 flex max-w-xl flex-col gap-3">
          {textFragments.map((fragment) => (
            <JournalEntryEditor key={fragment.id} fragment={fragment} language={language} />
          ))}
        </div>
      </article>
      </div>
    </div>
  );
}
