import { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { AppProps } from "@/apps/base/types";
import { AppWindowShell } from "@/components/shared/AppWindowShell";
import { CalendarMenuBar } from "../CalendarMenuBar";
import { requestCloudSyncDomainCheck } from "@/utils/cloudSyncEvents";
import { AppHelpAboutDialogs } from "@/components/shared/AppHelpAboutDialogs";
import { appMetadata } from "../../metadata";
import { useCalendarLogic } from "../../hooks/useCalendarLogic";
import { DEFAULT_TIME_GRID_HOUR_HEIGHT } from "../../hooks/useTimeScaleGestures";
import { useRegisterUndoRedo } from "@/hooks/useUndoRedo";
import { cn } from "@/lib/utils";
import { useCalendarStore } from "@/stores/useCalendarStore";
import { useChatsStore } from "@/stores/useChatsStore";
import { useCloudSyncStore } from "@/stores/useCloudSyncStore";
import { useResizeObserverWithRef } from "@/hooks/useResizeObserver";
import { AppDrawer } from "@/components/shared/AppDrawer";
import { useSound, Sounds } from "@/hooks/useSound";
import { TrayDetails } from "../TrayDetails";
import { BottomToolbar } from "./BottomToolbar";
import { CalendarList } from "./CalendarList";
import { DayTimeGrid } from "./DayTimeGrid";
import { MiniCalendar } from "./MiniCalendar";
import { MonthGrid } from "./MonthGrid";
import { useBookable } from "./Availability";
import { WeekTimeGrid } from "./WeekTimeGrid";
import { isKeyboardDeleteTargetEditable } from "./calendarAppUtils";
import { usePersistHydrated } from "@/hooks/usePersistHydrated";

export function CalendarAppComponent({
  isWindowOpen, onClose, isForeground, skipInitialSound, instanceId, onNavigateNext, onNavigatePrevious,
}: AppProps) {
  const calendarHasHydrated = usePersistHydrated(useCalendarStore.persist);
  const username = useChatsStore((s) => s.username);
  const isAuthenticated = useChatsStore((s) => s.isAuthenticated);
  const calendarSyncReady = useCloudSyncStore(
    (s) => s.autoSyncEnabled && s.syncCalendar
  );
  const canSyncCalendar = Boolean(
    username && isAuthenticated && calendarSyncReady
  );
  useEffect(() => {
    if (canSyncCalendar && calendarHasHydrated) {
      requestCloudSyncDomainCheck("calendar");
    }
  }, [calendarHasHydrated, canSyncCalendar]);

  const logic = useCalendarLogic();
  const {
    t, translatedHelpItems, hasHydrated,
    isHelpDialogOpen, setIsHelpDialogOpen, isAboutDialogOpen, setIsAboutDialogOpen,
    isWindowsTheme, isMacOSTheme, isSystem7Theme,
    searchQuery, setSearchQuery,
    selectedDate, view, monthYearLabel, selectedDateLabel, calendarGrid, selectedDateEvents,
    narrowDayNames, hourLabels, weekDates, weekLabel,
    selectedEventId, setSelectedEventId,
    calendars, toggleCalendarVisibility,
    navigateMonth, navigateWeek, goToToday, setView, setSelectedDate,
    handleDateClick, handleDateDoubleClick, handleNewEvent, handleNewEventAtSlot, handleEditSelectedEvent, handleDeleteSelectedEvent, handleUpdateEvent,
    fileInputRef, handleImport, handleFileSelected, handleExport,
    undoCalendar, redoCalendar, canUndo, canRedo,
  } = logic;

  const events = useCalendarStore((s) => s.events);

  useRegisterUndoRedo(instanceId!, {
    undo: undoCalendar,
    redo: redoCalendar,
    canUndo,
    canRedo,
  });

  // Resolve currently-selected event for the tray.
  const selectedEvent = useMemo(
    () => (selectedEventId ? events.find((e) => e.id === selectedEventId) || null : null),
    [selectedEventId, events]
  );
  // Open the details tray whenever something is selected; close otherwise.
  const showTrayDrawer = !!selectedEvent;

  const handleSelectEvent = useCallback(
    (id: string, options?: { toggle?: boolean }) => {
      if (options?.toggle === false) {
        setSelectedEventId(id);
        return;
      }
      setSelectedEventId((prev) => (prev === id ? null : id));
    },
    [setSelectedEventId]
  );

  const handleDeleteEventFromTray = useCallback((id: string) => {
    if (id === selectedEventId) {
      handleDeleteSelectedEvent();
    }
  }, [selectedEventId, handleDeleteSelectedEvent]);

  const onNewEvent = handleNewEvent;
  const bookable = useBookable(weekDates[0]?.date ?? "");

  const onDateDoubleClick = useCallback(
    (date: string) => {
      handleDateDoubleClick(date);
    },
    [handleDateDoubleClick]
  );

  // Drawer open/close sounds — same SFX as the TV drawer for consistency.
  const { play: playDrawerOpen } = useSound(Sounds.WINDOW_ZOOM_MAXIMIZE);
  const { play: playDrawerClose } = useSound(Sounds.WINDOW_ZOOM_MINIMIZE);
  const drawerSoundMountedRef = useRef(false);
  useEffect(() => {
    if (!drawerSoundMountedRef.current) {
      drawerSoundMountedRef.current = true;
      return;
    }
    if (showTrayDrawer) void playDrawerOpen();
    else void playDrawerClose();
  }, [showTrayDrawer, playDrawerOpen, playDrawerClose]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(700);
  const [showCalendarSidebar, setShowCalendarSidebar] = useState(true);
  const [showMiniCalendar, setShowMiniCalendar] = useState(true);
  const [weekTimeGridHourHeight, setWeekTimeGridHourHeight] = useState(
    DEFAULT_TIME_GRID_HOUR_HEIGHT,
  );
  const [dayTimeGridHourHeight, setDayTimeGridHourHeight] = useState(
    DEFAULT_TIME_GRID_HOUR_HEIGHT,
  );
  useResizeObserverWithRef(containerRef, (entry) => {
    setContainerWidth(entry.contentRect.width);
  });

  const isNarrow = containerWidth < 600;
  const showSidebar = containerWidth >= 540 && showCalendarSidebar;
  const effectiveView = view;
  const safeSearchQuery = searchQuery ?? "";
  const normalizedSearchQuery = useMemo(() => safeSearchQuery.trim().toLocaleLowerCase(), [safeSearchQuery]);

  const handlePrev = useCallback(() => {
    if (effectiveView === "week") navigateWeek(-1);
    else if (effectiveView === "month") navigateMonth(-1);
    else {
      const [y, m, d] = selectedDate.split("-").map(Number);
      const prev = new Date(y, m - 1, d - 1);
      setSelectedDate(`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}-${String(prev.getDate()).padStart(2, "0")}`);
    }
  }, [effectiveView, navigateWeek, navigateMonth, selectedDate, setSelectedDate]);

  const handleNext = useCallback(() => {
    if (effectiveView === "week") navigateWeek(1);
    else if (effectiveView === "month") navigateMonth(1);
    else {
      const [y, m, d] = selectedDate.split("-").map(Number);
      const next = new Date(y, m - 1, d + 1);
      setSelectedDate(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`);
    }
  }, [effectiveView, navigateWeek, navigateMonth, selectedDate, setSelectedDate]);

  const headerLabel = effectiveView === "week" ? weekLabel : effectiveView === "day" ? selectedDateLabel : monthYearLabel;

  const menuBar = (
    <CalendarMenuBar
      onClose={onClose}
      onNewEvent={onNewEvent}
      onImport={handleImport}
      onExport={handleExport}
      onEditEvent={handleEditSelectedEvent}
      onDeleteEvent={handleDeleteSelectedEvent}
      hasSelectedEvent={!!selectedEventId}
      view={view}
      onSetView={setView}
      onGoToToday={goToToday}
      onPrev={handlePrev}
      onNext={handleNext}
      showSidebar={showCalendarSidebar}
      onToggleSidebar={() => setShowCalendarSidebar((c) => !c)}
      instanceId={instanceId}
    />
  );

  useEffect(() => {
    if (!hasHydrated || !isWindowOpen || !isForeground) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isKeyboardDeleteTargetEditable(e.target)) return;
      if (!selectedEventId) return;
      e.preventDefault();
      handleDeleteSelectedEvent();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    isWindowOpen,
    isForeground,
    hasHydrated,
    selectedEventId,
    handleDeleteSelectedEvent,
  ]);

  return (
    <AppWindowShell
      isWindowOpen={isWindowOpen}
      isWindowsTheme={isWindowsTheme}
      isForeground={isForeground}
      menuBar={hasHydrated ? menuBar : undefined}
      windowFrameProps={{
        title: headerLabel,
        onClose,
        isForeground,
        appId: "calendar",
        material: isMacOSTheme ? "brushedmetal" : "default",
        skipInitialSound,
        instanceId,
        onNavigateNext,
        onNavigatePrevious,
        windowConstraints: { minWidth: 300, minHeight: 380 },
        drawer: (
          <AppDrawer isOpen={showTrayDrawer}>
            <TrayDetails
              selectedEvent={selectedEvent}
              calendars={calendars}
              isMacOSTheme={isMacOSTheme}
              isSystem7Theme={isSystem7Theme}
              isWindowsTheme={isWindowsTheme}
              onUpdateEvent={handleUpdateEvent}
              onDeleteEvent={handleDeleteEventFromTray}
              week={weekDates[0]?.date ?? ""}
            />
          </AppDrawer>
        ),
      }}
      trailing={
        <>
          <AppHelpAboutDialogs
            appId="calendar"
            helpItems={translatedHelpItems}
            metadata={appMetadata}
            isHelpOpen={isHelpDialogOpen}
            onHelpOpenChange={setIsHelpDialogOpen}
            isAboutOpen={isAboutDialogOpen}
            onAboutOpenChange={setIsAboutDialogOpen}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept=".ics,.ical,.ifb,.icalendar"
            className="hidden"
            onChange={handleFileSelected}
          />
        </>
      }
    >
        <div
          ref={containerRef}
          className={cn(
            "flex flex-col size-full font-os-ui overflow-hidden",
            isMacOSTheme ? "bg-transparent" : "bg-white",
            !hasHydrated && "pointer-events-none opacity-0"
          )}
        >
          {/* Main content area */}
          <div className={cn("flex-1 flex overflow-hidden", isMacOSTheme && "gap-[5px]")}>
            {/* Left sidebar: Calendar list + Mini calendar */}
            {showSidebar && (
              isMacOSTheme ? (
                <div className="flex flex-col shrink-0 gap-[5px]" style={{ width: 160 }}>
                  <div
                    className="flex-1 overflow-y-auto bg-white os-inset-pane"
                    style={{
                      border: "1px solid rgba(0, 0, 0, 0.55)",
                      boxShadow: "inset 0 1px 2px rgba(0, 0, 0, 0.25), 0 1px 0 rgba(255, 255, 255, 0.4)",
                    }}
                  >
                    <CalendarList
                      calendars={calendars}
                      onToggle={toggleCalendarVisibility}
                      isMacOSTheme={isMacOSTheme}
                      isSystem7Theme={isSystem7Theme}
                    />
                  </div>
                  {showMiniCalendar && (
                    <div
                      className="shrink-0 bg-white os-inset-pane"
                      style={{
                        border: "1px solid rgba(0, 0, 0, 0.55)",
                        boxShadow: "inset 0 1px 2px rgba(0, 0, 0, 0.25), 0 1px 0 rgba(255, 255, 255, 0.4)",
                      }}
                    >
                      <MiniCalendar
                        calendarGrid={calendarGrid}
                        selectedDate={selectedDate}
                        todayStr={logic.todayStr}
                        onDateClick={handleDateClick}
                        isWindowsTheme={isWindowsTheme}
                        isMacOSTheme={isMacOSTheme}
                        isSystem7Theme={isSystem7Theme}
                        monthYearLabel={monthYearLabel}
                        narrowDayNames={narrowDayNames}
                        onPrevMonth={() => navigateMonth(-1)}
                        onNextMonth={() => navigateMonth(1)}
                      />
                    </div>
                  )}
                </div>
              ) : (
                <div
                  className="flex flex-col overflow-y-auto shrink-0 bg-white"
                  style={{ width: 160, borderRight: "1px solid rgba(0,0,0,0.08)" }}
                >
                  <CalendarList
                    calendars={calendars}
                    onToggle={toggleCalendarVisibility}
                    isMacOSTheme={isMacOSTheme}
                    isSystem7Theme={isSystem7Theme}
                  />
                  <div className="flex-1" />
                  {showMiniCalendar && (
                    <MiniCalendar
                      calendarGrid={calendarGrid}
                      selectedDate={selectedDate}
                      todayStr={logic.todayStr}
                      onDateClick={handleDateClick}
                      isWindowsTheme={isWindowsTheme}
                      isMacOSTheme={isMacOSTheme}
                      isSystem7Theme={isSystem7Theme}
                      monthYearLabel={monthYearLabel}
                      narrowDayNames={narrowDayNames}
                      onPrevMonth={() => navigateMonth(-1)}
                      onNextMonth={() => navigateMonth(1)}
                    />
                  )}
                </div>
              )
            )}

            {(
              <div
                className={cn("flex-1 flex overflow-hidden calendar-grid bg-white os-inset-pane", effectiveView !== "month" && "flex-col")}
                style={isMacOSTheme ? {
                  border: "1px solid rgba(0, 0, 0, 0.55)",
                  boxShadow: "inset 0 1px 2px rgba(0, 0, 0, 0.25), 0 1px 0 rgba(255, 255, 255, 0.4)",
                } : undefined}
              >
                {effectiveView !== "month" && bookable.failed && (
                  <div className="shrink-0 border-b border-black/10 px-2 py-1 text-[11px]">Booking is unavailable right now</div>
                )}
                {effectiveView === "week" && (
                  <WeekTimeGrid weekDates={weekDates} selectedEventId={selectedEventId}
                    onDateClick={handleDateClick} bookable={bookable} onSlot={handleNewEventAtSlot}
                    onEventClick={(ev) => handleSelectEvent(ev.id)}
                    onEventDoubleClick={(ev) => handleSelectEvent(ev.id, { toggle: false })}
                    isWindowsTheme={isWindowsTheme} isMacOSTheme={isMacOSTheme} isSystem7Theme={isSystem7Theme} searchQuery={normalizedSearchQuery} hourLabels={hourLabels}
                    hourHeight={weekTimeGridHourHeight} setHourHeight={setWeekTimeGridHourHeight}
                    onUpdateEvent={handleUpdateEvent} />
                )}
                {effectiveView === "day" && (
                  <DayTimeGrid date={selectedDate} events={selectedDateEvents} selectedEventId={selectedEventId}
                    bookable={bookable} onSlot={handleNewEventAtSlot}
                    onEventClick={(ev) => handleSelectEvent(ev.id)}
                    onEventDoubleClick={(ev) => handleSelectEvent(ev.id, { toggle: false })}
                    isWindowsTheme={isWindowsTheme} isMacOSTheme={isMacOSTheme} isSystem7Theme={isSystem7Theme} searchQuery={normalizedSearchQuery} hourLabels={hourLabels}
                    hourHeight={dayTimeGridHourHeight} setHourHeight={setDayTimeGridHourHeight}
                    onUpdateEvent={handleUpdateEvent} />
                )}
                {effectiveView === "month" && (
                  <MonthGrid calendarGrid={calendarGrid} selectedEventId={selectedEventId}
                    onDateClick={handleDateClick} onDateDoubleClick={onDateDoubleClick}
                    onEventClick={(ev) => handleSelectEvent(ev.id)}
                    onEventDoubleClick={(ev) => handleSelectEvent(ev.id, { toggle: false })}
                    isWindowsTheme={isWindowsTheme} searchQuery={normalizedSearchQuery} narrowDayNames={narrowDayNames} />
                )}
              </div>
            )}

          </div>

          {/* Bottom toolbar */}
          <BottomToolbar
            view={effectiveView} onSetView={setView} onGoToToday={goToToday} onNewEvent={onNewEvent}
            onPrev={handlePrev} onNext={handleNext}
            showCalendarSidebar={showCalendarSidebar} onToggleCalendarSidebar={() => setShowCalendarSidebar((current) => !current)}
            showMiniCalendar={showMiniCalendar} onToggleMiniCalendar={() => setShowMiniCalendar((current) => !current)}
            searchQuery={safeSearchQuery} onSearchQueryChange={setSearchQuery} showSearch={!isNarrow}
            isNarrow={isNarrow}
            isWindowsTheme={isWindowsTheme} isMacOSTheme={isMacOSTheme} isSystem7Theme={isSystem7Theme} t={t}
          />
        </div>
    </AppWindowShell>
  );
}
