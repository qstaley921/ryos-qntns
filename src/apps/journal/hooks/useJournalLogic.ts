import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { useAppHelpAboutDialogs } from "@/hooks/useAppHelpAboutDialogs";
import { useThemeFlags } from "@/hooks/useThemeFlags";
import { useTranslatedHelpItems } from "@/hooks/useTranslatedHelpItems";
import { useJournalStore } from "@/stores/useJournalStore";
import { reduceJournal } from "../logic";
import { helpItems } from "../metadata";

export function useJournalLogic() {
  const { t, i18n } = useTranslation();
  const translatedHelpItems = useTranslatedHelpItems("journal", helpItems);
  const { isWindowsTheme, isMacOSTheme, isSystem7Theme } = useThemeFlags();
  const journal = useJournalStore((state) => state.journal);
  const sidebarWidth = useJournalStore((state) => state.sidebarWidth);
  const notice = useJournalStore((state) => state.notice);
  const filter = useJournalStore((state) => state.filter);
  const api = useJournalStore(
    useShallow((state) => ({
      setView: state.setView,
      setFilter: state.setFilter,
      toggleFeature: state.toggleFeature,
      moveFragment: state.moveFragment,
      selectDay: state.selectDay,
      startDay: state.startDay,
      selectUndated: state.selectUndated,
      addUndatedPage: state.addUndatedPage,
      selectCanvasPage: state.selectCanvasPage,
      addCanvasPage: state.addCanvasPage,
      setReminderTime: state.setReminderTime,
      setMood: state.setMood,
      setEntryText: state.setEntryText,
      addScrap: state.addScrap,
      selectCard: state.selectCard,
      removeCard: state.removeCard,
      moveCard: state.moveCard,
      setPageTitle: state.setPageTitle,
      resetDemo: state.resetDemo,
      setSidebarWidth: state.setSidebarWidth,
      dismissNotice: state.dismissNotice,
    }))
  );
  const dialogs = useAppHelpAboutDialogs();
  // §22j: the store lives outside the app folder, so Tidy Up runs the reducer here.
  const tidyUp = () =>
    useJournalStore.setState((state) => {
      const next = reduceJournal(state.journal, { type: "tidyUp" });
      return next === state.journal ? state : { journal: next };
    });

  return {
    t,
    language: i18n.resolvedLanguage || i18n.language,
    translatedHelpItems,
    isWindowsTheme,
    isMacOSTheme,
    isSystem7Theme,
    ...dialogs,
    journal,
    sidebarWidth,
    notice,
    filter,
    api: { ...api, tidyUp },
  };
}

export type JournalLogic = ReturnType<typeof useJournalLogic>;
