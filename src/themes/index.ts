import { macosx } from "./macosx";
import {
  AquaMaterial,
  OsMacChrome,
  OsPlatform,
  OsTheme,
  OsThemeId,
  ThemeMetadata,
} from "./types";

/**
 * Aqua is the only theme (CHECKLIST-35 §7). `OsThemeId` keeps the old ids only
 * so app code that still compares against them compiles; every lookup below
 * resolves to Aqua whatever id it is handed.
 */
export const themes: Partial<Record<OsThemeId, OsTheme>> = { macosx };

export const DEFAULT_OS_THEME_ID: OsThemeId = "macosx";
export const DEFAULT_AQUA_MATERIAL: AquaMaterial = "glass";

export function getTheme(_id: OsThemeId): OsTheme {
  return macosx;
}

/**
 * Get theme metadata for layout and conditional rendering decisions.
 * Centralizes theme-based checks like isWindows, hasDock, etc.
 */
export function getThemeMetadata(_id: OsThemeId): ThemeMetadata {
  return macosx.metadata;
}

/**
 * Platform bucket for CSS and layout rules shared by multiple themes
 * (e.g. Windows XP + Windows 98).
 */
export function getOsPlatform(_id: OsThemeId): OsPlatform {
  return "mac";
}

/**
 * Mac chrome variant for `data-os-mac-chrome` (null when not a Mac theme).
 */
export function getOsMacChrome(_id: OsThemeId): OsMacChrome | null {
  return "aqua";
}

/**
 * Windows XP (Luna) — subset of {@link isWindowsTheme}. Use when Luna-specific chrome applies.
 */
export function isThemeWinXp(_id: OsThemeId): boolean {
  return false;
}

/**
 * Windows 98 (Classic) — subset of {@link isWindowsTheme}.
 */
export function isThemeWin98(_id: OsThemeId): boolean {
  return false;
}

/**
 * Check if a theme is Windows-style (XP, 98).
 * Replaces scattered `currentTheme === "xp" || currentTheme === "win98"` checks.
 */
export function isWindowsTheme(_id: OsThemeId): boolean {
  return false;
}

/**
 * Check if a theme is macOS-style (macOS X, System 7).
 */
export function isMacTheme(_id: OsThemeId): boolean {
  return true;
}

/**
 * Whether a theme has dark-mode tokens defined in `themes.css`.
 * Themes without dark-mode coverage ignore the dark-mode preference at apply time.
 */
export function themeSupportsDarkMode(_id: OsThemeId): boolean {
  return macosx.metadata.supportsDarkMode;
}

export type {
  AquaMaterial,
  OsColorScheme,
  OsMacChrome,
  OsPlatform,
  OsTheme,
  OsThemeId,
  ThemeMetadata,
} from "./types";
