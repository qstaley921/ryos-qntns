import { useEffect, useState } from "react";
import type { AppId } from "@/config/appRegistry";

export const DEFAULT_SHORTCUT_ORDER: AppId[] = [
  "ipod",
  "chats",
  "internet-explorer",
  "karaoke",
  "applet-viewer",
  "textedit",
  "photo-booth",
  "videos",
  "paint",
  "calendar",
  "maps",
  "terminal",
  "dashboard",
];

export const getDesktopAppItemId = (appId: string) => `app:${appId}`;
export const getDesktopShortcutItemId = (path: string) => `shortcut:${path}`;

/** §49: below this visible height (px) the dock force-hides and Applications moves to the desktop. */
export const SHORT_VIEWPORT_PX = 600;

export function useShortViewport(): boolean {
  const [short, setShort] = useState(() => window.innerHeight < SHORT_VIEWPORT_PX);
  useEffect(() => {
    const on = () => setShort(window.innerHeight < SHORT_VIEWPORT_PX);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return short;
}
