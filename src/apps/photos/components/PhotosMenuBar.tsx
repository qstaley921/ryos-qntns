import { useTranslation } from "react-i18next";
import { AppMenuBarShell } from "@/components/shared/menubar/AppMenuBarShell";
import { AppMenuBarMenus, type MenuDescriptor } from "@/components/shared/menubar/AppMenuBarMenus";
import { useAppMenuBarChrome } from "@/hooks/useAppMenuBarChrome";

// File › Close only: Photos is read-only (CHECKLIST-37 §13, no iPhoto tools).
export function PhotosMenuBar({
  onClose,
  onShowHelp,
  onShowAbout,
}: {
  onClose: () => void;
  onShowHelp: () => void;
  onShowAbout: () => void;
}) {
  const { t } = useTranslation();
  const { isShareDialogOpen, setIsShareDialogOpen, isWindowsTheme, isMacOSTheme, appId, appName } =
    useAppMenuBarChrome("photos", "Photos");

  const menus: MenuDescriptor[] = [
    {
      label: t("common.menu.file"),
      items: [{ type: "action", label: t("common.menu.close"), onClick: onClose, shortcutId: "close" }],
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
      helpItemLabel="Photos Help"
      aboutItemLabel="About Photos"
      onShowHelp={onShowHelp}
      onShowAbout={onShowAbout}
    >
      <AppMenuBarMenus menus={menus} />
    </AppMenuBarShell>
  );
}
