import { AppMenuBarShell } from "@/components/shared/menubar/AppMenuBarShell";
import { AppMenuBarMenus } from "@/components/shared/menubar/AppMenuBarMenus";
import { useAppMenuBarChrome } from "@/hooks/useAppMenuBarChrome";
import { JOURNAL_VIEWS } from "../types";
import type { JournalView } from "../types";
import type { JournalLogic } from "../hooks/useJournalLogic";
import { journalKinds } from "../journalEntries";
import { defaultDayId } from "../sampleContent";

export function JournalMenuBar({
  l,
  onClose,
  showSidebar,
  onToggleSidebar,
}: {
  l: JournalLogic;
  onClose: () => void;
  showSidebar: boolean;
  onToggleSidebar: () => void;
}) {
  const { t } = l;
  const kinds = journalKinds();
  const { isShareDialogOpen, setIsShareDialogOpen, isWindowsTheme, isMacOSTheme, appId, appName } =
    useAppMenuBarChrome("journal");

  return (
    <AppMenuBarShell
      isWindowsTheme={isWindowsTheme}
      isMacOSTheme={isMacOSTheme}
      appId={appId}
      appName={appName}
      isShareDialogOpen={isShareDialogOpen}
      setIsShareDialogOpen={setIsShareDialogOpen}
      helpItemLabel={t("apps.journal.menu.help")}
      aboutItemLabel={t("apps.journal.menu.about")}
      onShowHelp={() => l.setIsHelpDialogOpen(true)}
      onShowAbout={() => l.setIsAboutDialogOpen(true)}
    >
      <AppMenuBarMenus
        menus={[
          {
            label: t("common.menu.file"),
            items: [
              {
                type: "action",
                label: t("common.menu.close"),
                onClick: onClose,
                shortcutId: "close",
              },
            ],
          },
          // §57 TODO: Journal has no Edit menu; nest Edit/Share in File once author-A's helper lands.
          {
            label: "Filter",
            items: [
              {
                type: "radioGroup",
                value: l.filter ?? "",
                onValueChange: (v) => l.api.setFilter(v || null),
                options: [
                  { value: "", label: "All" },
                  ...kinds.map((k) => ({ value: k, label: k })),
                ],
              },
            ],
          },
          {
            label: t("common.menu.view"),
            items: [
              {
                type: "radioGroup",
                value: l.journal.view,
                onValueChange: (value) => l.api.setView(value as JournalView),
                options: JOURNAL_VIEWS.map((view) => ({
                  value: view,
                  label: t(`apps.journal.views.${view}`),
                })),
              },
              { type: "separator" },
              {
                type: "checkbox",
                label: "Show Sidebar",
                checked: showSidebar,
                onChange: () => onToggleSidebar(),
                disabled: l.journal.view !== "daily",
              },
              { type: "separator" },
              {
                type: "action",
                label: "Tidy Up",
                onClick: () => l.api.tidyUp(),
                disabled:
                  l.journal.view !== "freeform" || Object.keys(l.journal.positions).length === 0,
              },
              {
                type: "action",
                label: "Go to Latest Day",
                onClick: () => {
                  l.api.selectDay(defaultDayId());
                  if (l.journal.view !== "daily") l.api.setView("daily");
                },
              },
            ],
          },
        ]}
      />
    </AppMenuBarShell>
  );
}
