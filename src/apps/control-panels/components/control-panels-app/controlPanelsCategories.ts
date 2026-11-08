export type ControlPanelPaneId =
  | "appearance"
  | "desktop-screen-saver"
  | "international"
  | "assistant"
  | "security"
  | "displays"
  | "sound"
  | "dot-mac"
  | "sharing"
  | "accounts"
  | "software-update";

/** Legacy tab IDs used by Windows/System7 layout and deep links. */
export type ControlPanelLegacyTabId = "appearance" | "sound" | "sync" | "system";

/** Deep-link-only aliases (Spotlight) that map differently per layout. */
export type ControlPanelDeepLinkAlias = "wallpaper" | "screensaver";

export type ControlPanelCategory = {
  id: ControlPanelPaneId;
  labelKey: string;
  icon: string;
};

export type ControlPanelSectionId =
  | "personal"
  | "hardware-system"
  | "internet-network";

export type ControlPanelSection = {
  id: ControlPanelSectionId;
  labelKey: string;
  paneIds: ControlPanelPaneId[];
};

export const CONTROL_PANEL_CATEGORIES: ControlPanelCategory[] = [
  {
    id: "sound",
    labelKey: "apps.control-panels.panes.sound",
    icon: "sound.png",
  },
  {
    id: "accounts",
    labelKey: "apps.control-panels.panes.accounts",
    icon: "control-panels/users.png",
  },
];

/** Home grid — functional panes grouped like Mac OS X 10.3 System Preferences. */
export const CONTROL_PANEL_SECTIONS: ControlPanelSection[] = [
  {
    id: "hardware-system",
    labelKey: "apps.control-panels.sections.hardwareSystem",
    paneIds: ["sound", "accounts"],
  },
];

/** Pinned quick-access icons (10.3-style toolbar). */
export const CONTROL_PANEL_PINNED_PANES: ControlPanelPaneId[] = [
  "sound",
  "accounts",
];

const LEGACY_PANE_ALIASES: Record<string, ControlPanelPaneId> = {};

/** Maps macOS-only deep-link aliases back to classic tab IDs. */
const CLASSIC_TAB_ALIASES: Record<ControlPanelDeepLinkAlias, ControlPanelLegacyTabId> = {
  wallpaper: "appearance",
  screensaver: "appearance",
};

function isControlPanelDeepLinkAlias(
  value: string
): value is ControlPanelDeepLinkAlias {
  return value === "wallpaper" || value === "screensaver";
}

export function normalizeControlPanelPaneId(
  value: string | undefined
): ControlPanelPaneId | undefined {
  if (!value) return undefined;
  if (isControlPanelPaneId(value)) return value;
  return LEGACY_PANE_ALIASES[value];
}

export function getControlPanelCategory(
  paneId: ControlPanelPaneId
): ControlPanelCategory | undefined {
  return CONTROL_PANEL_CATEGORIES.find((category) => category.id === paneId);
}

export type ControlPanelMacNavigationEntry = "home" | ControlPanelPaneId;

/** macOS System Preferences window title for Show All vs an open pane. */
export function getControlPanelsMacWindowTitle(
  current: ControlPanelMacNavigationEntry,
  t: (key: string) => string,
  defaultTitle: string
): string {
  if (current === "home") return defaultTitle;
  const category = getControlPanelCategory(current);
  return category ? t(category.labelKey) : defaultTitle;
}

export function isControlPanelPaneId(value: string): value is ControlPanelPaneId {
  return CONTROL_PANEL_CATEGORIES.some((category) => category.id === value);
}

export function normalizeControlPanelClassicTabId(
  value: string | undefined
): ControlPanelLegacyTabId {
  if (!value) return "appearance";
  if (isControlPanelDeepLinkAlias(value)) return CLASSIC_TAB_ALIASES[value];
  if (isControlPanelLegacyTabId(value)) return value;
  return "appearance";
}

export function isControlPanelLegacyTabId(
  value: string
): value is ControlPanelLegacyTabId {
  return (
    value === "appearance" ||
    value === "sound" ||
    value === "sync" ||
    value === "system"
  );
}
