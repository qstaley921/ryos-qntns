import { useTranslation } from "react-i18next";
import { AppMenuBarShell } from "@/components/shared/menubar/AppMenuBarShell";
import { AppMenuBarMenus, type MenuDescriptor } from "@/components/shared/menubar/AppMenuBarMenus";
import { useAppMenuBarChrome } from "@/hooks/useAppMenuBarChrome";
import { fileSubmenus } from "@/components/shared/menubar/fileSubmenus";

// File: Order Postcard, Play Slideshow, Close. View: Library, Previous/Next Photo, Back to Album.
// An action the window can't do now is passed undefined and shows disabled.
export function PhotosMenuBar({
  onClose,
  onShowAbout,
  onOrderPostcard,
  onPlay,
  playLabel,
  onLibrary,
  onPrev,
  onNext,
  onBack,
  onToggleStrip,
  stripLabel,
}: {
  onClose: () => void;
  onShowAbout: () => void;
  onOrderPostcard?: () => void;
  onPlay?: () => void;
  playLabel: string;
  onLibrary: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onBack?: () => void;
  onToggleStrip?: () => void;
  stripLabel: string;
}) {
  const { t } = useTranslation();
  const { isShareDialogOpen, setIsShareDialogOpen, isWindowsTheme, isMacOSTheme, appId, appName } =
    useAppMenuBarChrome("photos", "Photos");

  const menus: MenuDescriptor[] = [
    {
      label: t("common.menu.file"),
      items: [
        { type: "action", label: "Order Postcard", onClick: onOrderPostcard ?? (() => {}), disabled: !onOrderPostcard },
        { type: "action", label: playLabel, onClick: onPlay ?? (() => {}), disabled: !onPlay },
        ...fileSubmenus({ t, onShareApp: () => setIsShareDialogOpen(true) }),
        { type: "separator" },
        { type: "action", label: t("common.menu.close"), onClick: onClose, shortcutId: "close" },
      ],
    },
    {
      label: "View",
      items: [
        { type: "action", label: "Library", onClick: onLibrary },
        { type: "separator" },
        { type: "action", label: "Previous Photo", onClick: onPrev ?? (() => {}), disabled: !onPrev, shortcut: "\u2190" },
        { type: "action", label: "Next Photo", onClick: onNext ?? (() => {}), disabled: !onNext, shortcut: "\u2192" },
        { type: "action", label: "Back to Album", onClick: onBack ?? (() => {}), disabled: !onBack, shortcut: "Esc" },
        { type: "separator" },
        { type: "action", label: stripLabel, onClick: onToggleStrip ?? (() => {}), disabled: !onToggleStrip },
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
      aboutItemLabel="About Photos"
      onShowAbout={onShowAbout}
    >
      <AppMenuBarMenus menus={menus} />
    </AppMenuBarShell>
  );
}
