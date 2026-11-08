import { useLayoutEffect } from "react";
import { App } from "@/App";
import { useAppStore } from "@/stores/useAppStore";
import { useDisplaySettingsStore } from "@/stores/useDisplaySettingsStore";
import { AQUA_BLUE_ALTS, setAquaDefaultBlue } from "@/stores/useThemeStore";
import { QNTNS_WALLPAPER } from "@/utils/wallpapers";

// App's initial-route cleanup (src/apps/base/app-manager/useAppManager.ts:209) rewrites the
// preview iframe's URL /iframe.html → "/", so any reload of the canvas loads the Storybook manager.
// Drop that one rewrite here; every other replaceState goes through.
const replaceState = history.replaceState.bind(history);
history.replaceState = (data, unused, url) => {
  if (url !== "/") replaceState(data, unused, url);
};

export default { title: "Desktop", component: App };
export const Default = () => {
  setAquaDefaultBlue(AQUA_BLUE_ALTS.nudge30);
  // §62a: the store itself only ever loads the welcome note, so just launch Stickies.
  useLayoutEffect(() => {
    useAppStore.getState().launchApp("stickies");
  }, []);
  return <App />;
};

// §35 alts for the QNTNs wallpaper. Every alt sets every token, since stories share one document.
const BASE = {
  "--qntns-wall-bg": "#cdbba4",
  "--qntns-wall-size": "16vw",
  "--qntns-wall-place": "center",
  "--qntns-wall-pad": "32px",
};
const apply = (vars: Partial<typeof BASE>) => {
  setAquaDefaultBlue(AQUA_BLUE_ALTS.nudge30);
  for (const [k, v] of Object.entries({ ...BASE, ...vars }))
    document.documentElement.style.setProperty(k, v);
  useDisplaySettingsStore.setState({
    currentWallpaper: QNTNS_WALLPAPER,
    wallpaperSource: QNTNS_WALLPAPER,
  });
};
const wall = (vars: Partial<typeof BASE> = {}) => () => {
  apply(vars);
  return <App />;
};

export const WallBeige = wall();
// --color-beige-dark, the theme's assets/css/qntns/tokens.css:29.
export const WallBeigeDark = wall({ "--qntns-wall-bg": "hsl(32 25% 75%)" });
// Controls panel: beige (--qntns-wall-bg) and ink (--qntns-wall-ink) live. Defaults from tokens.css:7-8.
export const WallSmall = ({ beige, ink }: { beige: string; ink: string }) => {
  // Not during render: apply() setState()s a store App subscribes to ("Cannot update a component
  // while rendering a different component"). Controls can also hand undefined mid-drag; fall back to defaults.
  useLayoutEffect(() => {
    apply({
      "--qntns-wall-size": "10vw",
      "--qntns-wall-bg": String(beige || BASE["--qntns-wall-bg"]),
      "--qntns-wall-ink": String(ink || "#182952"),
    });
  }, [beige, ink]);
  return <App />;
};
WallSmall.args = { beige: "#cdbba4", ink: "#182952" };
WallSmall.argTypes = { beige: { control: "color" }, ink: { control: "color" } };
export const WallLarge = wall({ "--qntns-wall-size": "22vw" });
export const WallBottomLeft = wall({ "--qntns-wall-place": "end start" });
export const WallTopRight = wall({ "--qntns-wall-place": "start end", "--qntns-wall-pad": "64px" });

// §36 alts: Aqua's default blue (selection, default buttons, highlights) nudged toward
// #182952. Stock = the unmodified stylesheet. Shipped default is nudge30 (useThemeStore.ts).
const blue = (hex: string | null) => () => {
  apply({});
  setAquaDefaultBlue(hex);
  return <App />;
};
export const AquaBlueStock = blue(AQUA_BLUE_ALTS.stock);
export const AquaBlue15 = blue(AQUA_BLUE_ALTS.nudge15);
export const AquaBlue30 = blue(AQUA_BLUE_ALTS.nudge30);
export const AquaBlue45 = blue(AQUA_BLUE_ALTS.nudge45);
