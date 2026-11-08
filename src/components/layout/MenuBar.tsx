import type { MenuBarProps } from "./menu-bar/menuBarTypes";
import { MacTopMenuBar } from "./menu-bar/MacTopMenuBar";

export type { MenuBarProps } from "./menu-bar/menuBarTypes";

/** Aqua is the only theme (CHECKLIST-35 §7): the Mac top menu bar, always. */
export function MenuBar({ children }: MenuBarProps) {
  return <MacTopMenuBar>{children}</MacTopMenuBar>;
}
