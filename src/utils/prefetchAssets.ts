import {
  pickIconPath,
  type IconManifest,
} from "@/utils/icons";

const KNOWN_ICON_THEMES = new Set(["default", "macosx"]);

function getLogicalIconName(iconPath: string): string | null {
  if (
    !iconPath ||
    /^(?:https?:|data:|blob:|\/\/)/i.test(iconPath) ||
    !iconPath.includes(".")
  ) {
    return null;
  }

  const withoutQuery = iconPath.split(/[?#]/)[0];
  const relative = withoutQuery
    .replace(/^\/?icons\//, "")
    .replace(/^\/+/, "");
  const segments = relative.split("/");
  if (segments.length > 1 && KNOWN_ICON_THEMES.has(segments[0])) {
    return segments.slice(1).join("/");
  }
  return relative;
}

export function collectActiveThemeIconUrls({
  theme,
  manifest,
  iconPaths,
}: {
  theme: string;
  manifest: IconManifest;
  iconPaths: readonly string[];
}): string[] {
  const urls = new Set<string>();
  for (const iconPath of iconPaths) {
    const logicalName = getLogicalIconName(iconPath);
    if (!logicalName) continue;
    urls.add(
      pickIconPath(logicalName, {
        theme,
        manifest,
      })
    );
    urls.add(
      pickIconPath(logicalName, {
        theme: "default",
        manifest,
      })
    );
  }
  return [...urls];
}

/** Aqua is the only theme (CHECKLIST-35 §7); the argument is kept for callers. */
export function getThemeStaticAssetUrls(_theme?: string): string[] {
  return [
    "/assets/brushed-metal.jpg",
    "/assets/button.svg",
    "/assets/button-default.svg",
    "/assets/splash/hello.svg",
    "/assets/splash/macos.svg",
  ];
}

export function getAllThemeStaticAssetUrls(): string[] {
  return getThemeStaticAssetUrls();
}

export function getCoreSoundUrls(): string[] {
  return []; // no sound files ship (CHECKLIST-35 §5, Q16)
}
