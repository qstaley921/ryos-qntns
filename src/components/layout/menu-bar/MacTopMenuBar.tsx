import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Menubar } from "@/components/ui/menubar";
import { AppleMenu } from "../AppleMenu";
import { AppMenu } from "../AppMenu";
import { useAppStoreShallow } from "@/stores/useAppStore";
import { useDisplaySettingsStoreShallow } from "@/stores/useDisplaySettingsStore";
import { useThemeFlags } from "@/hooks/useThemeFlags";
import { useWallpaperMenubarText } from "@/hooks/useWallpaperMenubarText";
import { useIsPhone } from "@/hooks/useIsPhone";
import { hasDesktopWindowChrome, isDesktopWindows, isIosShell } from "@/utils/platform";
import { getTranslatedAppName } from "@/utils/i18n";
import { ScrollableMenuWrapper } from "./ScrollableMenuWrapper";
import { FinderAppMenu } from "./FinderAppMenu";
import { DefaultMenuItems } from "./DefaultMenuItems";
import { Clock } from "./MenuBarClock";
import { VolumeControl } from "./VolumeControl";
import { OfflineIndicator } from "./OfflineIndicator";
import { CloudSyncIndicator } from "./CloudSyncIndicator";
import { ExposeButton } from "./ExposeButton";
import { SpotlightMenuBarButton } from "./SpotlightMenuBarButton";
import { useDesktopFullscreen } from "./useDesktopFullscreen";
import { shouldShowDesktopDragDebugZone } from "./desktopDragDebug";
import { getMenubarWindowChromeLayout } from "./menubarWindowChrome";
import {
  menubarInnerPadding,
  menubarLeftEdge,
  menubarRightEdge,
  menubarSafeTop,
} from "./menubarEdgePadding";

const noDragRegionStyle = { WebkitAppRegion: "no-drag" } as CSSProperties;
const dragRegionStyle = { WebkitAppRegion: "drag" } as CSSProperties;

export interface MacTopMenuBarProps {
  children?: ReactNode;
}

export function MacTopMenuBar({ children }: MacTopMenuBarProps) {
  const { foregroundAppId, foregroundInstanceId, exposeMode } =
    useAppStoreShallow((s) => {
      const id = s.foregroundInstanceId;
      const inst = id ? s.instances[id] : null;
      return {
        // Subscribe to the id values, not the getter: a function reference
        // never changes, so the bar would not re-render on a focus switch.
        foregroundAppId: inst?.isOpen ? inst.appId : null,
        foregroundInstanceId: inst?.isOpen ? id : null,
        exposeMode: s.exposeMode,
      };
    });

  const { debugMode, showResizers } = useDisplaySettingsStoreShallow((s) => ({
    debugMode: s.debugMode,
    showResizers: s.showResizers,
  }));
  const foregroundInstance =
    foregroundAppId && foregroundInstanceId
      ? { appId: foregroundAppId, instanceId: foregroundInstanceId }
      : null;
  const hasActiveApp = !!foregroundInstance;

  const { isMacOSTheme, isMacTheme, isAquaGlass } = useThemeFlags();
  const iosShell = isIosShell();
  const { textColor: glassMenubarText, tone: glassMenubarTone } =
    useWallpaperMenubarText(isAquaGlass || iosShell);
  // Status-bar glyphs sit on the wallpaper, so they follow its tone, not the
  // system appearance. The menubar's own text keeps the theme colour except
  // in Aqua, where the bar is transparent.
  useEffect(() => {
    if (!iosShell) return;
    const bridge = window.ryosDesktop;
    const setTone = bridge?.setStatusBarTone;
    if (typeof setTone !== "function") return;
    try {
      const result: unknown = setTone.call(bridge, glassMenubarTone);
      if (result && typeof (result as Promise<unknown>).catch === "function") {
        (result as Promise<unknown>).catch(() => {});
      }
    } catch {
      // An older shell has no such method.
    }
  }, [iosShell, glassMenubarTone]);
  const isPhone = useIsPhone();
  // Right side collapses to Search only once the left menus would overflow.
  // fullRightWidth is cached from the last full render, since the compact
  // right side is too narrow to say how much room the full one needs.
  const barRef = useRef<HTMLDivElement>(null);
  const menusRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const fullRightWidth = useRef(0);
  const [compact, setCompact] = useState(false);
  const hasWindowChrome = hasDesktopWindowChrome();
  const showDesktopDragDebugZone = shouldShowDesktopDragDebugZone({
    isDesktopApp: hasWindowChrome,
    debugMode,
    showResizers,
  });
  const isFullscreen = useDesktopFullscreen();
  const { showWindowDragRegion, needsTrafficLightClearance } =
    getMenubarWindowChromeLayout({
      hasWindowChrome,
      isPhone,
      isWindowsPlatform: isDesktopWindows(),
      isMacTheme,
      isFullscreen,
    });
  const menuBarHeight = needsTrafficLightClearance
    ? "32px"
    : "var(--os-metrics-menubar-height)";

  useLayoutEffect(() => {
    const bar = barRef.current;
    const menus = menusRef.current;
    if (!bar || !menus) return;
    const measure = () => {
      if (rightRef.current && !compact) {
        fullRightWidth.current = rightRef.current.offsetWidth;
      }
      const cs = getComputedStyle(bar);
      const inner =
        bar.clientWidth -
        (parseFloat(cs.paddingLeft) || 0) -
        (parseFloat(cs.paddingRight) || 0);
      setCompact(menus.offsetWidth > inner - fullRightWidth.current);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(bar);
    ro.observe(menus); // fires when the front app swaps its menus
    return () => ro.disconnect();
  }, [compact, foregroundAppId]);

  return (
    <div
      ref={barRef}
      className={`mac-top-menubar fixed top-0 left-0 right-0 flex items-center font-os-ui ${isAquaGlass ? "border-transparent" : "border-b-[length:var(--os-metrics-border-width)] border-os-menubar"} ${exposeMode ? "z-[9997]" : "z-[10002]"}`}
      data-menubar-text-tone={isAquaGlass ? glassMenubarTone : undefined}
      style={{
        background: isAquaGlass
          ? "transparent"
          : isMacOSTheme
            ? "var(--os-color-menubar-surface, rgba(248, 248, 248, 0.85))"
            : "var(--os-color-menubar-bg)",
        backgroundImage: isAquaGlass
          ? undefined
          : isMacOSTheme
            ? "var(--os-pinstripe-menubar)"
            : undefined,
        backdropFilter: isAquaGlass
          ? undefined
          : isMacOSTheme
            ? "blur(20px)"
            : undefined,
        WebkitBackdropFilter: isAquaGlass
          ? undefined
          : isMacOSTheme
            ? "blur(20px)"
            : undefined,
        boxShadow: isAquaGlass
          ? undefined
          : isMacOSTheme
            ? "0 2px 8px rgba(0, 0, 0, 0.15)"
            : undefined,
        fontFamily: "var(--os-font-ui)",
        fontSize: isMacOSTheme ? "var(--os-typography-button)" : undefined,
        ...(isAquaGlass
          ? {
              ["--os-color-menubar-text" as string]: glassMenubarText,
              color: glassMenubarText,
            }
          : { color: "var(--os-color-menubar-text)" }),
        top: menubarSafeTop(),
        left: menubarLeftEdge(),
        right: menubarRightEdge(),
        paddingLeft: menubarInnerPadding({
          side: "left",
          trafficLightClearance: needsTrafficLightClearance,
        }),
        paddingRight: menubarInnerPadding({
          side: "right",
          trafficLightClearance: needsTrafficLightClearance,
        }),
        height: menuBarHeight,
        minHeight: menuBarHeight,
        maxHeight: menuBarHeight,
      }}
    >
      <ScrollableMenuWrapper style={noDragRegionStyle} contentRef={menusRef}>
        <Menubar className="flex items-stretch border-none bg-transparent space-x-0 p-0 rounded-none h-full">
          <div className="flex flex-shrink-0 items-stretch h-full">
            <AppleMenu />
          </div>
          {isMacOSTheme && hasActiveApp && foregroundInstance && (
            <AppMenu
              appId={foregroundInstance.appId}
              appName={
                getTranslatedAppName(foregroundInstance.appId) ||
                foregroundInstance.appId
              }
              instanceId={foregroundInstance.instanceId}
            />
          )}
          {isMacOSTheme && !hasActiveApp && <FinderAppMenu />}
          {hasActiveApp ? children : <DefaultMenuItems />}
        </Menubar>
      </ScrollableMenuWrapper>
      {showWindowDragRegion && (
        <div
          className="flex-1"
          style={{
            ...dragRegionStyle,
            background: showDesktopDragDebugZone
              ? "rgba(255, 0, 0, 0.3)"
              : undefined,
            minHeight: "100%",
          }}
          onDoubleClick={() => {
            void window.ryosDesktop?.toggleMaximize();
          }}
        />
      )}
      <div
        ref={rightRef}
        className={`menubar-status-controls ${compact ? "pl-1 pr-0.5" : ""} ml-auto flex-shrink-0 flex items-center h-full`}
        style={noDragRegionStyle}
      >
        {!compact && (
          <>
            <OfflineIndicator />
            <CloudSyncIndicator />
            <ExposeButton />
            <VolumeControl />
            <Clock enableCalendarOpen />
          </>
        )}
        <SpotlightMenuBarButton />
      </div>
    </div>
  );
}
