import type { ReactNode } from "react";
import { MenuBar } from "@/components/layout/MenuBar";
import { AppShareItemDialog } from "@/components/shared/menubar/AppShareItemDialog";
import type { AppId } from "@/config/appRegistry";

interface AppMenuBarShellProps {
  /** App-specific menus (File, Controls, View, Library, ...). */
  children: ReactNode;
  isWindowsTheme: boolean;
  isMacOSTheme: boolean;
  appId: AppId;
  appName: string;
  isShareDialogOpen: boolean;
  setIsShareDialogOpen: (open: boolean) => void;
  /** Unused since the Help menu went (§56); kept so app callers still compile. */
  helpItemLabel?: string;
  aboutItemLabel?: string;
  /** Optional override; defaults to the shared `common.menu.shareApp` label. */
  shareItemLabel?: string;
  onShowHelp?: () => void;
  onShowAbout?: () => void;
  /** QNTNs §55d caller; no-op now that the Help menu is gone (§56). */
  hideHelp?: boolean;
}

/**
 * Standard ryOS media-app menubar: app menus followed by the share dialog.
 * No Help menu here; About {App} lives in the bold app menu (AppMenu.tsx).
 */
export function AppMenuBarShell({
  children,
  isWindowsTheme,
  appId,
  appName,
  isShareDialogOpen,
  setIsShareDialogOpen,
}: AppMenuBarShellProps) {
  return (
    <>
      <MenuBar inWindowFrame={isWindowsTheme}>
        {children}
      </MenuBar>
      <AppShareItemDialog
        appId={appId}
        appName={appName}
        isOpen={isShareDialogOpen}
        onClose={() => setIsShareDialogOpen(false)}
      />
    </>
  );
}
