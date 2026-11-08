import type { Preview } from "@storybook/react-vite";
import "../src/index.css";
import { QntnsWallpaperLayer } from "../src/components/layout/desktop/DesktopDynamicWallpaper";
import { useThemeStore } from "../src/stores/useThemeStore";
import { initializeI18nForFirstPaint } from "../src/lib/i18n";

// Storybook always opens in Aqua Glass (§68c), whatever is saved: it is the review surface and should match qntns.com.
localStorage.setItem("ryos:theme:aqua-material", "glass");
// Aqua (§7), light (§41): hydrate() pins light; setTheme() would follow the OS dark preference.
useThemeStore.getState().hydrate();
void initializeI18nForFirstPaint();

const preview: Preview = {
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story, ctx) => (
      <div style={{ position: "relative", isolation: "isolate", width: "100vw", height: "100vh", overflow: "hidden" }}>
        {/* §35b: QNTNs wallpaper (WallSmall look) behind every app story; Desktop stories draw their own. */}
        {!ctx.id.startsWith("desktop--") && (
          <div style={{ ["--qntns-wall-size" as string]: "10vw" }}>
            <QntnsWallpaperLayer />
          </div>
        )}
        <Story />
      </div>
    ),
  ],
};
export default preview;
