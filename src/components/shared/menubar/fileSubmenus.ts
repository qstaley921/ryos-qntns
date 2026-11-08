import type { TFunction } from "i18next";
import type { MenuItemDescriptor } from "./AppMenuBarMenus";

/**
 * §57: Share lives inside File as a submenu, above Close/Quit (Edit stays top-level).
 * Usage: items: [...fileItems, ...fileSubmenus({ t, shareItems, onShareApp }),
 *                { type: "separator" }, closeItem]
 * Empty/absent groups add nothing (no empty submenu). Shortcuts are unchanged.
 * `onShareApp` adds the shell's "Share App…" (opens AppShareItemDialog).
 */
export function fileSubmenus({
  t,
  shareItems = [],
  onShareApp,
}: {
  t: TFunction;
  shareItems?: MenuItemDescriptor[];
  onShareApp?: () => void;
}): MenuItemDescriptor[] {
  const share: MenuItemDescriptor[] = [...shareItems];
  if (onShareApp) {
    share.push({
      type: "action",
      label: t("common.menu.shareApp"),
      onClick: onShareApp,
    });
  }
  const out: MenuItemDescriptor[] = [];
  if (share.length)
    out.push({
      type: "submenu",
      label: t("common.menu.share", { defaultValue: "Share" }),
      items: share,
    });
  return out.length ? [{ type: "separator" }, ...out] : [];
}
