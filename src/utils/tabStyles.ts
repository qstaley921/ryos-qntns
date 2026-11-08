import type { CSSProperties } from "react";
import { OsThemeId } from "@/themes/types";

export interface TabStyleConfig {
  tabListClasses: string;
  tabTriggerClasses: string;
  tabContentClasses: string;
  separatorStyle: CSSProperties;
}

/** Aqua tabs; Aqua is the only theme (CHECKLIST-35 §7), so the id is unused. */
export function getTabStyles(_currentTheme: OsThemeId): TabStyleConfig {
  return {
    tabListClasses: "flex w-full space-x-0.5 shadow-none aqua-tab-bar",
    tabTriggerClasses:
      "relative flex-1 px-2 rounded-t shadow-none! text-[16px] aqua-tab",
    tabContentClasses:
      "mt-0 min-w-0 max-w-full h-[calc(100%-2rem)] overflow-x-hidden aqua-tab-content",
    separatorStyle: { borderColor: "var(--os-color-separator)" },
  };
}
