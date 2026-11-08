import { AppProps } from "@/apps/base/types";
import { AppWindowShell } from "@/components/shared/AppWindowShell";
import { AppMenuBarShell } from "@/components/shared/menubar/AppMenuBarShell";
import { ShortcutHint } from "@/components/shared/menubar/ShortcutHint";
import { Button } from "@/components/ui/button";
import { MenubarMenu, MenubarTrigger, MenubarContent, MenubarItem } from "@/components/ui/menubar";
import { useAppMenuBarChrome } from "@/hooks/useAppMenuBarChrome";
import { useLaunchApp } from "@/hooks/useLaunchApp";
import { useThemeFlags } from "@/hooks/useThemeFlags";
import { useTranslation } from "react-i18next";

// §63j: read-only site, so TextEdit with no Ghost document is a pointer to Documents, never a blank page.
export function TextEditEmpty({ isWindowOpen, onClose, isForeground, skipInitialSound, instanceId, onNavigateNext, onNavigatePrevious }: AppProps) {
  const { t } = useTranslation();
  const { isWindowsTheme } = useThemeFlags();
  const launchApp = useLaunchApp();
  const chrome = useAppMenuBarChrome("textedit");
  const menuBar = (
    <AppMenuBarShell
      isWindowsTheme={chrome.isWindowsTheme}
      isMacOSTheme={chrome.isMacOSTheme}
      appId={chrome.appId}
      appName={chrome.appName}
      isShareDialogOpen={chrome.isShareDialogOpen}
      setIsShareDialogOpen={chrome.setIsShareDialogOpen}
      helpItemLabel={t("apps.textedit.menu.texteditHelp")}
      aboutItemLabel={t("apps.textedit.menu.aboutTextEdit")}
      onShowHelp={() => {}}
      onShowAbout={() => {}}
    >
      <MenubarMenu>
        <MenubarTrigger className="text-md px-2 py-1 border-none focus-visible:ring-0">{t("common.menu.file")}</MenubarTrigger>
        <MenubarContent align="start" sideOffset={1} className="px-0">
          <MenubarItem onClick={onClose} className="text-md h-6 px-3">
            {t("common.menu.close")}
            <ShortcutHint id="close" />
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>
    </AppMenuBarShell>
  );
  return (
    <AppWindowShell
      isWindowOpen={isWindowOpen}
      isWindowsTheme={isWindowsTheme}
      isForeground={isForeground}
      menuBar={menuBar}
      windowFrameProps={{ title: "TextEdit", onClose, isForeground, appId: "textedit", skipInitialSound, instanceId, onNavigateNext, onNavigatePrevious }}
    >
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-os-input-bg p-4 text-os-text-primary">
        <p className="text-md">Open a document from the Documents folder</p>
        <Button variant="outline" size="sm" onClick={() => launchApp("finder", { initialPath: "/Documents" })}>
          Open Documents
        </Button>
      </div>
    </AppWindowShell>
  );
}
