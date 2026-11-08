import { AppMenuBarShell } from "@/components/shared/menubar/AppMenuBarShell";
import {
  AppMenuBarMenus,
  type MenuDescriptor,
  type MenuItemDescriptor,
} from "@/components/shared/menubar/AppMenuBarMenus";
import { useAppMenuBarChrome } from "@/hooks/useAppMenuBarChrome";
import { fileSubmenus } from "@/components/shared/menubar/fileSubmenus";
import { useTranslation } from "react-i18next";
import { WidgetBarIcon } from "@/components/layout/dashboard/WidgetBarIcon";
import { CAN_ADD_WIDGETS, QNTNS_WIDGETS, type QntnsWidgetType } from "../widgets";

interface DashboardMenuBarProps {
  onClose: () => void;
  onShowAbout: () => void;
  onAddWidget: (type: QntnsWidgetType) => void;
  onResetWidgets: () => void;
}

const WIDGET_MENU_ITEM_CLASS = "gap-1.5";

export function DashboardMenuBar({
  onClose,
  onShowAbout,
  onAddWidget,
  onResetWidgets,
}: DashboardMenuBarProps) {
  const { t } = useTranslation();
  const {
    isShareDialogOpen,
    setIsShareDialogOpen,
    isWindowsTheme,
    isMacOSTheme,
    appId,
    appName,
  } = useAppMenuBarChrome("dashboard");

  const menus: MenuDescriptor[] = [
    {
      label: t("common.menu.file"),
      items: [
        ...(CAN_ADD_WIDGETS
          ? ([
              {
                type: "submenu",
                label: t("apps.dashboard.menu.addWidget"),
                items: QNTNS_WIDGETS.map(
                  (w): MenuItemDescriptor => ({
                    type: "action",
                    label: (
                      <>
                        <WidgetBarIcon icon={w.icon} size={14} alt="" />
                        {w.label}
                      </>
                    ),
                    onClick: () => onAddWidget(w.type),
                    className: WIDGET_MENU_ITEM_CLASS,
                  })
                ),
              },
              { type: "separator" },
            ] as MenuItemDescriptor[])
          : []),
        {
          type: "action",
          label: t("apps.dashboard.menu.resetWidgets"),
          onClick: onResetWidgets,
        },
        ...fileSubmenus({ t, onShareApp: () => setIsShareDialogOpen(true) }),
        { type: "separator" },
        {
          type: "action",
          label: t("common.menu.close"),
          onClick: onClose,
          shortcutId: "close",
        },
      ],
    },
  ];

  return (
    <AppMenuBarShell
      isWindowsTheme={isWindowsTheme}
      isMacOSTheme={isMacOSTheme}
      appId={appId}
      appName={appName}
      isShareDialogOpen={isShareDialogOpen}
      setIsShareDialogOpen={setIsShareDialogOpen}
      aboutItemLabel={t("apps.dashboard.menu.about")}
      onShowAbout={onShowAbout}
    >
      <AppMenuBarMenus menus={menus} />
    </AppMenuBarShell>
  );
}
