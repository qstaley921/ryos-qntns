import { MenuBar } from "@/components/layout/MenuBar";
import {
  AppMenuBarMenus,
  type MenuDescriptor,
} from "@/components/shared/menubar/AppMenuBarMenus";
import { useAppMenuBarChrome } from "@/hooks/useAppMenuBarChrome";
import { requestCloudSyncDomainCheck } from "@/utils/cloudSyncEvents";
import { useTranslation } from "react-i18next";
import type { CalendarView } from "@/stores/useCalendarStore";
import { useInstanceUndoRedo } from "@/hooks/useUndoRedo";

interface CalendarMenuBarProps {
  onClose: () => void;
  onNewEvent: () => void;
  onImport: () => void;
  onExport: () => void;
  onEditEvent: () => void;
  onDeleteEvent: () => void;
  hasSelectedEvent: boolean;
  view: CalendarView;
  onSetView: (view: CalendarView) => void;
  onGoToToday: () => void;
  onPrev: () => void;
  onNext: () => void;
  showSidebar: boolean;
  onToggleSidebar: () => void;
  instanceId?: string;
}

export function CalendarMenuBar({
  onClose,
  onNewEvent,
  onImport,
  onExport,
  onEditEvent,
  onDeleteEvent,
  hasSelectedEvent,
  view,
  onSetView,
  onGoToToday,
  onPrev,
  onNext,
  showSidebar,
  onToggleSidebar,
  instanceId,
}: CalendarMenuBarProps) {
  const { t } = useTranslation();
  const { isWindowsTheme } = useAppMenuBarChrome("calendar");
  const { canUndo, canRedo, undo, redo } = useInstanceUndoRedo(instanceId || "");

  const viewCheckbox = (viewValue: CalendarView, label: string) =>
    ({
      type: "checkbox",
      label,
      checked: view === viewValue,
      onChange: () => onSetView(viewValue),
    } as const);

  const menus: MenuDescriptor[] = [
    {
      label: t("common.menu.file"),
      items: [
        {
          type: "action",
          label: t("apps.calendar.menu.newEvent"),
          onClick: onNewEvent,
        },
        { type: "separator" },
        {
          type: "action",
          label: t("apps.calendar.menu.importFromDevice"),
          onClick: onImport,
        },
        {
          type: "action",
          label: t("apps.calendar.menu.exportToIcs"),
          onClick: onExport,
        },
        { type: "separator" },
        {
          type: "action",
          label: t("apps.calendar.menu.syncCalendar", {
            defaultValue: "Sync Calendar",
          }),
          onClick: () => requestCloudSyncDomainCheck("calendar"),
        },
        { type: "separator" },
        {
          type: "submenu",
          label: t("common.menu.edit"),
          items: [
        {
          type: "action",
          label: t("common.menu.undo"),
          onClick: undo,
          disabled: !canUndo,
          className: !canUndo ? "text-neutral-500" : "",
          shortcutId: "undo",
        },
        {
          type: "action",
          label: t("common.menu.redo"),
          onClick: redo,
          disabled: !canRedo,
          className: !canRedo ? "text-neutral-500" : "",
          shortcutId: "redo",
        },
        { type: "separator" },
        {
          type: "action",
          label: t("apps.calendar.menu.editEvent"),
          onClick: onEditEvent,
          disabled: !hasSelectedEvent,
        },
        {
          type: "action",
          label: t("apps.calendar.menu.deleteEvent"),
          onClick: onDeleteEvent,
          disabled: !hasSelectedEvent,
        },
      ],
        },
        { type: "separator" },
        {
          type: "action",
          label: t("common.menu.close"),
          onClick: onClose,
          shortcutId: "close",
        },
      ],
    },
    {
      label: t("common.menu.view"),
      items: [
        viewCheckbox("day", t("apps.calendar.menu.dayView")),
        viewCheckbox("week", t("apps.calendar.menu.weekView")),
        viewCheckbox("month", t("apps.calendar.menu.monthView")),
        { type: "separator" },
        {
          type: "action",
          label: t("apps.calendar.menu.goToToday"),
          onClick: onGoToToday,
        },
        {
          type: "action",
          label: t("apps.calendar.menu.previous", { defaultValue: "Previous" }),
          onClick: onPrev,
        },
        {
          type: "action",
          label: t("apps.calendar.menu.next", { defaultValue: "Next" }),
          onClick: onNext,
        },
        { type: "separator" },
        {
          type: "action",
          label: showSidebar
            ? t("common.menu.hideSidebar", { defaultValue: "Hide Sidebar" })
            : t("common.menu.showSidebar", { defaultValue: "Show Sidebar" }),
          onClick: onToggleSidebar,
        },
        { type: "separator" },
        {
          type: "action",
          label: t("apps.calendar.menu.bookATime", { defaultValue: "Book a Time" }),
          onClick: () => onSetView("week"),
          disabled: view === "week",
        },
      ],
    },
  ];

  return (
    <MenuBar inWindowFrame={isWindowsTheme}>
      <AppMenuBarMenus menus={menus} />
    </MenuBar>
  );
}
