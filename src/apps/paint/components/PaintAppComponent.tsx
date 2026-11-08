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

// Items mount when the menu opens, so `off` is read fresh from the wall's button each time.
const Item: React.FC<{ host: React.RefObject<HTMLDivElement | null>; text: string; sel: string }> = ({ host, text, sel }) => {
  const btn = () => host.current?.querySelector<HTMLButtonElement>(sel);
  const b = btn();
  const off = !b || b.disabled || b.getAttribute("aria-disabled") === "true";
  return (
    <MenubarItem className="text-md h-6 px-3" disabled={off} onClick={() => btn()?.click()}>
      {text}
    </MenubarItem>
  );
};
const Menu: React.FC<{ label: string; host: React.RefObject<HTMLDivElement | null>; items: [string, string][] }> = ({ label, host, items }) => (
  <MenubarMenu>
    <MenubarTrigger className="text-md px-2 py-1 border-none focus-visible:ring-0">{label}</MenubarTrigger>
    <MenubarContent align="start" sideOffset={1} className="px-0">
      {items.map(([t, sel]) => <Item key={t} host={host} text={t} sel={sel} />)}
    </MenubarContent>
  </MenubarMenu>
);

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
          {/* §63g: every item clicks a control the wall already has; disabled when that control is. */}
          <Menu label="File" host={host} items={[
            ["Postcard…", "[data-graffiti-postcard]"],
            ["Undo", "[data-graffiti-undo]"],
            ["Redo", "[data-graffiti-redo]"],
            // §57 TODO: nest Edit ▸ / Share ▸ here once author-A's helper lands.
          ]} />
          <Menu label="Tools" host={host} items={[
            ["Hand", '[data-graffiti-tool="hand"]'],
            ["Pen", '[data-graffiti-tool="pencil"]'],
            ["Fountain Pen", '[data-graffiti-tool="pen"]'],
            ["Pencil", '[data-graffiti-tool="graphite"]'],
            ["Smudge", '[data-graffiti-tool="smudge"]'],
            ["Watercolor", '[data-graffiti-tool="watercolor"]'],
            ["Water", '[data-graffiti-tool="water"]'],
            ["Lasso", '[data-graffiti-tool="lasso"]'],
            ["Eraser", '[data-graffiti-tool="eraser"]'],
          ]} />
          <Menu label="View" host={host} items={[
            ["Zoom In", '[data-graffiti-zoom="1"]'],
            ["Zoom Out", '[data-graffiti-zoom="-1"]'],
            ["Fit Wall", "[data-graffiti-fit]"],
          ]} />
          <Menu label="Insert" host={host} items={[
            ["Link Card", '[data-graffiti-tool="link"]'],
            ["Meme", '[data-graffiti-tool="image"]'],
          ]} />
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
