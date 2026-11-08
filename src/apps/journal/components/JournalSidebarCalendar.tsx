import { useMemo, useState } from "react";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import type { CalendarDayCell } from "@/apps/calendar/hooks/useCalendarLogic";
import { TODAY_RED, TODAY_RED_XP } from "@/apps/calendar/components/calendar-app/calendarAppConstants";
import { cn } from "@/lib/utils";
import { JOURNAL_ENTRY_FRAGMENTS } from "../journalEntries";

interface VisibleMonth {
  year: number;
  month: number;
}

function visibleMonth(dayId: string): VisibleMonth {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(dayId);
  if (!match) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  }
  return { year: Number(match[1]), month: Number(match[2]) - 1 };
}

function shiftMonth(current: VisibleMonth, delta: number): VisibleMonth {
  const date = new Date(current.year, current.month + delta, 1);
  return { year: date.getFullYear(), month: date.getMonth() };
}

/** Same six-week grid the Calendar mini calendar draws, without its events. */
export function journalMonthGrid(
  year: number,
  month: number,
  today: string,
  selectedDate: string
): CalendarDayCell[][] {
  const startDayOfWeek = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const weeks: CalendarDayCell[][] = [];
  let dayCounter = 1;
  let nextMonthCounter = 1;

  for (let week = 0; week < 6; week += 1) {
    const row: CalendarDayCell[] = [];
    for (let dow = 0; dow < 7; dow += 1) {
      const cellIndex = week * 7 + dow;
      let cellYear = year;
      let cellMonth = month;
      let day = dayCounter;
      let isCurrentMonth = true;

      if (cellIndex < startDayOfWeek) {
        day = daysInPrevMonth - startDayOfWeek + cellIndex + 1;
        cellMonth = month === 0 ? 11 : month - 1;
        cellYear = month === 0 ? year - 1 : year;
        isCurrentMonth = false;
      } else if (dayCounter <= daysInMonth) {
        day = dayCounter;
        dayCounter += 1;
      } else {
        day = nextMonthCounter;
        nextMonthCounter += 1;
        cellMonth = month === 11 ? 0 : month + 1;
        cellYear = month === 11 ? year + 1 : year;
        isCurrentMonth = false;
      }

      const date = `${cellYear}-${String(cellMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      row.push({
        date,
        day,
        isCurrentMonth,
        isToday: date === today,
        isSelected: date === selectedDate,
        events: [],
      });
    }
    weeks.push(row);
  }

  return weeks;
}

export function JournalSidebarCalendar({
  selectedDate,
  today,
  language,
  isWindowsTheme,
  isMacOSTheme,
  isSystem7Theme,
  onSelectDay,
}: {
  selectedDate: string;
  today: string;
  language: string;
  isWindowsTheme: boolean;
  isMacOSTheme: boolean;
  isSystem7Theme: boolean;
  onSelectDay: (dayId: string) => void;
}) {
  const anchor = selectedDate || today;
  const [followedDay, setFollowedDay] = useState(anchor);
  const [month, setMonth] = useState(() => visibleMonth(anchor));
  if (anchor !== followedDay) {
    setFollowedDay(anchor);
    setMonth(visibleMonth(anchor));
  }

  const calendarGrid = useMemo(
    () => journalMonthGrid(month.year, month.month, today, selectedDate),
    [month.year, month.month, today, selectedDate]
  );
  const monthYearLabel = useMemo(
    () =>
      new Date(month.year, month.month, 1).toLocaleDateString(language, {
        month: "long",
        year: "numeric",
      }),
    [month.year, month.month, language]
  );
  const narrowDayNames = useMemo(() => {
    const format = new Intl.DateTimeFormat(language, { weekday: "narrow" });
    return Array.from({ length: 7 }, (_, index) =>
      format.format(new Date(2024, 0, 7 + index))
    );
  }, [language]);

  // §22g: a dot under each day with >=1 loaded entry (follows the Filter); no new call.
  const daysWithEntries = new Set(JOURNAL_ENTRY_FRAGMENTS.map((f) => f.dayId));
  const useGeneva = isMacOSTheme || isSystem7Theme;
  const prevNext = (delta: number, Icon: typeof CaretLeft) => (
    <button
      type="button"
      onClick={() => setMonth((current) => shiftMonth(current, delta))}
      className="rounded p-0.5 hover:opacity-70"
    >
      <Icon size={10} weight="bold" />
    </button>
  );

  // Calendar's MiniCalendar (read-only, no event slot) drawn here with the dot row.
  // Cell: 16px number circle + 4px dot row = 20px.
  return (
    <div className="os-sidebar flex select-none flex-col px-1.5 py-1">
      <div className="flex items-center justify-between px-0.5 py-1">
        {prevNext(-1, CaretLeft)}
        <span className={cn("text-[10px] font-semibold", useGeneva && "font-geneva-12")}>{monthYearLabel}</span>
        {prevNext(1, CaretRight)}
      </div>
      <div className="mb-0.5 grid grid-cols-7">
        {narrowDayNames.map((label, index) => (
          <div
            key={index}
            className={cn("text-center font-medium", useGeneva && "font-geneva-12")}
            style={{ opacity: 0.5, fontSize: 9 }}
          >
            {label}
          </div>
        ))}
      </div>
      {calendarGrid.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7">
          {week.map((cell) => {
            const isToday = cell.date === today;
            return (
              <button
                key={cell.date}
                type="button"
                onClick={() => onSelectDay(cell.date)}
                className="flex h-5 flex-col items-center rounded-sm"
                style={{ opacity: cell.isCurrentMonth ? 1 : 0.25 }}
              >
                <span
                  className={cn("flex items-center justify-center text-[10px] leading-none", useGeneva && "font-geneva-12")}
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    backgroundColor: isToday
                      ? isWindowsTheme ? TODAY_RED_XP : TODAY_RED
                      : cell.isSelected
                        ? isWindowsTheme ? "rgba(0,0,0,0.15)" : "rgba(0,0,0,0.08)"
                        : "transparent",
                    color: isToday ? "#FFF" : undefined,
                    fontWeight: isToday ? "bold" : "normal",
                  }}
                >
                  {cell.day}
                </span>
                {daysWithEntries.has(cell.date) ? (
                  <span
                    data-journal-has-entry
                    className="size-1 rounded-full bg-current opacity-60"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
