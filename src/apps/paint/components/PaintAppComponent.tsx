import React, { useEffect, useRef } from "react";
import { AppWindowShell } from "@/components/shared/AppWindowShell";
import { AppProps, PaintInitialData } from "../../base/types";
import { useThemeFlags } from "@/hooks/useThemeFlags";
import { OS_NATIVE_CHROME_SKIP_CLASS } from "@/lib/themeChrome";
import { MenuBar } from "@/components/layout/MenuBar";
import { MenubarMenu, MenubarTrigger, MenubarContent, MenubarItem } from "@/components/ui/menubar";
import { attachGraffiti, graffitiApi, renderGraffiti, wallOf } from "../wall/qntns/graffiti.js";
import "../wall/css/tokens.css";
import "../wall/css/views-menu.css";
import "../wall/css/graffiti.css";
import "../wall/css/toast.css";
import "../wall/css/postcard.css";
import "../wall/css/wall.css";

// CHECKLIST-36 §24: Paint is the theme's graffiti wall, hosted as-is. ryOS's
// own canvas, tools and filters (PaintCanvas, usePaintLogic) are not shown.
// The doc that opened Paint picks the wall page (§11's { ghost }); a slug that
// is not one of graffiti.js PAGES is Misc., as ?wall= is in the theme.
type WallData = PaintInitialData & { ghost?: { slug?: string } };

// connectGraffiti (graffiti-lazy.js's entry) minus its address-bar sync: the
// page comes from the doc, not ?wall=, and ryOS's URL is not the wall's.
const Wall: React.FC<{ slug?: string; host: React.RefObject<HTMLDivElement | null> }> = ({ slug, host }) => {
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    // Signed out until CHECKLIST-37 §29: renderGraffiti() with no name is see-only.
    el.innerHTML = renderGraffiti();
    const root = el.firstElementChild as HTMLElement;
    root.dataset.graffitiPage = wallOf(slug);
    const detach = attachGraffiti(root, {
      member: root.querySelector("[data-graffiti-name]") ? { id: null } : null,
      api: graffitiApi(),
      scrollRoot: el, // §24a: this div scrolls, not window
    });
    return () => {
      detach();
      el.innerHTML = "";
    };
  }, [slug]);
  return <div ref={host} className={`paint-wall h-full w-full overflow-auto ${OS_NATIVE_CHROME_SKIP_CLASS}`} />;
};

export const PaintAppComponent: React.FC<AppProps<PaintInitialData>> = ({
  isWindowOpen,
  onClose,
  isForeground = false,
  skipInitialSound,
  initialData,
  instanceId,
  onNavigateNext,
  onNavigatePrevious,
}) => {
  const { isWindowsTheme } = useThemeFlags();
  const host = useRef<HTMLDivElement>(null);
  return (
    <AppWindowShell
      isWindowOpen={isWindowOpen}
      isWindowsTheme={isWindowsTheme}
      isForeground={isForeground}
      menuBar={
        <MenuBar inWindowFrame={isWindowsTheme}>
          <MenubarMenu>
            <MenubarTrigger className="text-md px-2 py-1 border-none focus-visible:ring-0">File</MenubarTrigger>
            <MenubarContent align="start" sideOffset={1} className="px-0">
              {/* Clicks the wall's own (hidden) Postcard button, so the handler is unchanged. */}
              <MenubarItem
                className="text-md h-6 px-3"
                onClick={() => host.current?.querySelector<HTMLElement>("[data-graffiti-postcard]")?.click()}
              >
                Postcard…
              </MenubarItem>
            </MenubarContent>
          </MenubarMenu>
        </MenuBar>
      }
      windowFrameProps={{
        title: "Paint",
        onClose,
        isForeground,
        appId: "paint",
        skipInitialSound,
        instanceId,
        onNavigateNext,
        onNavigatePrevious,
        keepMountedWhenMinimized: true,
      }}
    >
      <Wall host={host} slug={(initialData as WallData | undefined)?.ghost?.slug} />
    </AppWindowShell>
  );
};
