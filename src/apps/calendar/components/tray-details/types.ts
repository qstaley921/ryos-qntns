import type {
  CalendarEvent,
  CalendarGroup,
} from "@/stores/useCalendarStore";

export interface TrayDetailsProps {
  selectedEvent: CalendarEvent | null;
  calendars: CalendarGroup[];
  isMacOSTheme: boolean;
  isSystem7Theme: boolean;
  isWindowsTheme: boolean;
  onUpdateEvent: (id: string, updates: Partial<CalendarEvent>) => void;
  onDeleteEvent: (id: string) => void;
  /** First day (YYYY-MM-DD) of the shown week, for GET /cal/slots. */
  week: string;
}

export interface TrayThemeProps {
  useGeneva: boolean;
  isMacOSTheme: boolean;
  isSystem7Theme: boolean;
  isWindowsTheme: boolean;
}
