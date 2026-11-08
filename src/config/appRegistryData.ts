/**
 * Lightweight app registry data - only IDs and names
 * This file can be imported without triggering heavy component loads
 * Used by stores that need basic app info during initialization
 */

export const appIds = [
  "finder",
  "internet-explorer",
  "chats",
  "textedit",
  "preview",
  "mail",
  "photos",
  "paint",
  "photo-booth",
  "videos",
  "tv",
  "ipod",
  "karaoke",
  "terminal",
  "applet-viewer",
  "control-panels",
  "admin",
  "stickies",
  "calendar",
  "contacts",
  "dashboard",
  "maps",
  "books",
  "stuff",
  "dictionary",
  "fitness",
  "journal",
] as const;

export type AppId = (typeof appIds)[number];

const APP_ID_SET = new Set<string>(appIds);

export function resolveAppId(id: string): AppId | undefined {
  return APP_ID_SET.has(id) ? (id as AppId) : undefined;
}

/** Minimal app data for stores that don't need full registry */
export interface AppBasicInfo {
  id: AppId;
  name: string;
}

/** App ID to name mapping - matches appRegistry names exactly */
export const appNames: Record<AppId, string> = {
  "finder": "Finder",
  "internet-explorer": "Safari",
  "chats": "Chats",
  "textedit": "TextEdit",
  "preview": "Preview",
  "mail": "Mail",
  "photos": "Photos",
  "paint": "Paint",
  "photo-booth": "Photo Booth",
  "videos": "Videos",
  "tv": "TV",
  "ipod": "iPod",
  "karaoke": "Karaoke",
  "terminal": "Terminal",
  "applet-viewer": "Applet Store",
  "control-panels": "System Preferences",
  "admin": "Admin",
  "stickies": "Stickies",
  "calendar": "Calendar",
  "contacts": "Contacts",
  "dashboard": "Dashboard",
  "maps": "Maps",
  "books": "Books",
  "stuff": "Stuff",
  "dictionary": "Dictionary",
  "fitness": "Fitness",
  "journal": "Journal",
};

/** Get list of apps with basic info for stores */
export function getAppBasicInfoList(): AppBasicInfo[] {
  return appIds.map(id => ({ id, name: appNames[id] }));
}
