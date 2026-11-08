import { create } from "zustand";
import { useStoreShallow } from "./helpers";
import { createJSONStorage, persist } from "zustand/middleware";
import { AppId, getWindowConfig, getMobileWindowSize } from "@/config/appRegistry";
import { prefetchAppChunk } from "@/config/lazyAppComponent";
import { useAppletStore } from "@/stores/useAppletStore";
import { AppState } from "@/apps/base/types";
import { migrateStoredAiModel } from "@/shared/aiModels";
import { AIModel } from "@/types/aiModels";
import { APP_ANALYTICS, track } from "@/utils/analytics";
import { requestCloudSyncCheck } from "@/utils/cloudSyncEvents";
import { shouldRequestCloudSyncOnAppLaunch } from "@/utils/cloudSyncLaunch";
import { createClientLogger } from "@/utils/logger";
import { playHaptic } from "@/utils/nativeShellBridge";
import { getRestorablePreviewInitialData } from "@/types/appInitialData";
import { measureMenubarSafeTop } from "@/components/layout/menu-bar/menubarEdgePadding";
import {
  applyUserWindowMove,
  layoutForViewport,
  MOBILE_VIEWPORT_BREAKPOINT,
  persistedRectIsDesktopLayout,
  toStoredRect,
  toWindowRect,
  windowRectChanged,
  type WindowRect,
} from "@/utils/constrainWindowToViewport";
import {
  getDesktopContentBounds,
  windowSnapEdges,
  type DesktopContentBounds,
} from "@/utils/desktopContentBounds";
import { APPLICATIONS_HIDDEN } from "@/components/layout/dock/dockConstants";
import { readLiveWindowInsets } from "@/utils/windowInsets";
import { SHORT_VIEWPORT_PX } from "@/components/layout/desktop/desktopConstants";
export type { AIModel } from "@/types/aiModels";

// ---------------- Types ---------------------------------------------------------
// Position rect for launch origin animation
export interface LaunchOriginRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AppInstance extends AppState {
  instanceId: string;
  appId: AppId;
  title?: string;
  displayTitle?: string; // Dynamic title for dock menu (updated by WindowFrame)
  createdAt: number; // stable ordering for taskbar (creation time)
  isLoading?: boolean;
  isMinimized?: boolean;
  launchOrigin?: LaunchOriginRect; // Position of the icon that launched this instance
  /** Desktop position and size. Phone clamping never writes this. */
  desktopRect?: {
    position: { x: number; y: number };
    size: { width: number; height: number };
  };
}

export interface RecentApp {
  appId: AppId;
  timestamp: number;
}

export interface RecentDocument {
  path: string;
  name: string;
  appId: AppId;
  icon?: string;
  timestamp: number;
}

interface AppStoreState {
  // Instance (window) management
  instances: Record<string, AppInstance>;
  instanceOrder: string[]; // END = TOP (foreground)
  foregroundInstanceId: string | null;
  nextInstanceId: number;

  // Version / migration
  version: number;

  // Instance methods
  createAppInstance: (
    appId: AppId,
    initialData?: unknown,
    title?: string,
    launchOrigin?: LaunchOriginRect
  ) => string;
  markInstanceAsLoaded: (instanceId: string) => void;
  closeAppInstance: (instanceId: string) => void;
  bringInstanceToForeground: (instanceId: string) => void;
  updateInstanceWindowState: (
    instanceId: string,
    position: { x: number; y: number },
    size: { width: number; height: number }
  ) => void;
  getInstancesByAppId: (appId: AppId) => AppInstance[];
  getForegroundInstance: () => AppInstance | null;
  navigateToNextInstance: (currentInstanceId: string) => void;
  navigateToPreviousInstance: (currentInstanceId: string) => void;
  minimizeInstance: (instanceId: string) => void;
  restoreInstance: (instanceId: string) => void;
  updateInstanceTitle: (instanceId: string, title: string) => void;
  launchApp: (
    appId: AppId,
    initialData?: unknown,
    title?: string,
    multiWindow?: boolean,
    launchOrigin?: LaunchOriginRect
  ) => string;

  // Misc state & helpers
  clearInstanceInitialData: (instanceId: string) => void;
  updateInstanceInitialData: (instanceId: string, initialData: unknown) => void;
  aiModel: AIModel;
  setAiModel: (m: AIModel) => void;
  isFirstBoot: boolean;
  setHasBooted: () => void;
  macAppToastShown: boolean;
  setMacAppToastShown: () => void;
  lastSeenDesktopVersion: string | null;
  setLastSeenDesktopVersion: (version: string) => void;
  _debugCheckInstanceIntegrity: () => void;

  // Expose/Mission Control mode
  exposeMode: boolean;
  setExposeMode: (v: boolean) => void;
  /** §54 Show Desktop: open windows slid off the side edges. Not persisted. */
  desktopRevealed: boolean;
  setDesktopRevealed: (v: boolean) => void;
  
  // ryOS version (fetched from version.json)
  ryOSVersion: string | null;
  ryOSBuildNumber: string | null;
  ryOSBuildTime: string | null;
  setRyOSVersion: (version: string, buildNumber: string, buildTime?: string) => void;

  // Recent items
  recentApps: RecentApp[];
  recentDocuments: RecentDocument[];
  addRecentApp: (appId: AppId) => void;
  addRecentDocument: (path: string, name: string, appId: AppId, icon?: string) => void;
  clearRecentItems: () => void;
}

const CURRENT_APP_STORE_VERSION = 6; // store foreground as foregroundInstanceId, not per-instance flags
const appStoreLog = createClientLogger("AppStore");

function describeInitialData(initialData: unknown): Record<string, unknown> {
  if (initialData === undefined) return { hasInitialData: false };
  if (initialData === null) return { hasInitialData: true, kind: "null" };
  if (Array.isArray(initialData)) {
    return { hasInitialData: true, kind: "array", length: initialData.length };
  }
  if (typeof initialData === "object") {
    return {
      hasInitialData: true,
      kind: "object",
      keys: Object.keys(initialData as Record<string, unknown>).sort(),
    };
  }
  if (typeof initialData === "string") {
    return {
      hasInitialData: true,
      kind: "string",
      length: initialData.length,
    };
  }
  return { hasInitialData: true, kind: typeof initialData };
}

function getDerivedForegroundInstanceId(state: Pick<AppStoreState, "foregroundInstanceId" | "instanceOrder" | "instances">): string | null {
  if (
    state.foregroundInstanceId &&
    state.instances[state.foregroundInstanceId]?.isOpen
  ) {
    return state.foregroundInstanceId;
  }

  for (let i = state.instanceOrder.length - 1; i >= 0; i--) {
    const id = state.instanceOrder[i];
    if (state.instances[id]?.isOpen) {
      return id;
    }
  }

  return null;
}

function withDerivedForeground(
  instance: AppInstance,
  foregroundInstanceId: string | null
): AppInstance {
  return {
    ...instance,
    isForeground: instance.instanceId === foregroundInstanceId,
  };
}

function stripInstanceForeground(instance: AppInstance): AppInstance {
  const { isForeground: _isForeground, ...rest } = instance;
  return rest as AppInstance;
}

export type WindowConstraintContext = {
  viewportWidth: number;
  viewportHeight: number;
  bounds: DesktopContentBounds;
  topInset: number;
  bottomInset: number;
};

function readWindowConstraintContext(): WindowConstraintContext | null {
  if (typeof window === "undefined") return null;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  if (
    !Number.isFinite(viewportWidth) ||
    !Number.isFinite(viewportHeight) ||
    viewportWidth <= 0 ||
    viewportHeight <= 0
  ) {
    return null;
  }
  try {
    const insets = readLiveWindowInsets();
    // §49b: below 600px the dock is momentary (it draws over windows), so
    // windows may use its area; at 600+ it is permanent and they stay above it.
    const bottomInset =
      viewportHeight < SHORT_VIEWPORT_PX
        ? insets.bottomInset - insets.dockHeight
        : insets.bottomInset;
    return {
      viewportWidth,
      viewportHeight,
      bounds: getDesktopContentBounds(),
      topInset: insets.topInset,
      bottomInset,
    };
  } catch {
    return null;
  }
}

function readInstanceWindowConfig(appId: AppInstance["appId"]) {
  try {
    return getWindowConfig(appId);
  } catch {
    return null;
  }
}

function defaultDesktopWindowRect(
  appId: AppInstance["appId"],
  index: number,
): WindowRect {
  const config = readInstanceWindowConfig(appId);
  const safeTop =
    typeof document === "undefined" ? 0 : measureMenubarSafeTop();
  return {
    x: 16 + index * 32,
    y: 40 + safeTop + index * 20,
    width: config?.defaultSize.width ?? 730,
    height: config?.defaultSize.height ?? 475,
  };
}

/** Fit one saved window to the viewport. Returns the same instance when nothing moves. */
/**
 * §55 reach rule, shared by drag end and the §43 viewport clamp: a window may
 * hang past the left, right and bottom edges, but TITLE_BAR_REACH (64) px of
 * its title bar stays on screen sideways, its top never goes above the menu
 * bar, and the bar stays TITLE_BAR_KEEP (32) px clear above the dock.
 */
export const TITLE_BAR_REACH = 64;
const TITLE_BAR_KEEP = 32;

export function clampTitleBarReach(
  rect: { x: number; y: number; width: number },
  ctx: WindowConstraintContext,
): { x: number; y: number } {
  const { left, right } = windowSnapEdges(ctx.viewportWidth, ctx.bounds);
  // A status-bar inset (iPhone Duo) still keeps windows out from under it.
  const minX = ctx.bounds.x > 0 ? ctx.bounds.x : left + TITLE_BAR_REACH - rect.width;
  const maxX = Math.max(minX, right - TITLE_BAR_REACH);
  const top = Math.max(0, ctx.topInset);
  const maxY = Math.max(top, ctx.viewportHeight - ctx.bottomInset - TITLE_BAR_KEEP);
  return {
    x: Math.min(Math.max(rect.x, minX), maxX),
    y: Math.min(Math.max(rect.y, top), maxY),
  };
}

/** Viewport the last §43 pass ran against, so a resize can tell a window that
 * was fully inside (§43 fits it back in) from one the user left hanging off
 * an edge (§55 only keeps its title bar reachable). */
let lastConstrainedViewport: { width: number; height: number } | null = null;

function constrainInstanceGeometry(
  inst: AppInstance,
  ctx: WindowConstraintContext,
  index = 0,
  prev: { width: number; height: number } = {
    width: ctx.viewportWidth,
    height: ctx.viewportHeight,
  },
): AppInstance {
  if (!inst?.position || !inst.size) return inst;
  const config = readInstanceWindowConfig(inst.appId);
  const current = toWindowRect({ position: inst.position, size: inst.size });
  const mobileViewport = ctx.viewportWidth < MOBILE_VIEWPORT_BREAKPOINT;
  // On desktop the live rect is the source: a window the user sized stays
  // where it is when the viewport grows. The saved desktop rect only
  // restores a window coming back from the phone frame.
  const desktop =
    inst.desktopRect &&
    (mobileViewport || !persistedRectIsDesktopLayout(current))
      ? toWindowRect(inst.desktopRect)
      : null;
  let layout: { current: WindowRect; desktop: WindowRect };
  try {
    layout = layoutForViewport({
      ...current,
      desktop,
      defaultDesktop: defaultDesktopWindowRect(inst.appId, index),
      viewportWidth: ctx.viewportWidth,
      viewportHeight: ctx.viewportHeight,
      bounds: ctx.bounds,
      topInset: ctx.topInset,
      bottomInset: ctx.bottomInset,
      maxWidth: config?.maxSize?.width,
      defaultSize: config?.defaultSize,
      mobileDefaultSize: config?.mobileDefaultSize,
      mobileSquare: config?.mobileSquare,
    });
  } catch {
    return inst;
  }
  if (!mobileViewport) {
    // Position moves first (done by the layout), then size shrinks to the
    // area between menubar and dock, never below the app's minSize.
    const top = Math.max(0, ctx.topInset);
    const area = Math.max(0, ctx.viewportHeight - ctx.bottomInset - top);
    const minH = config?.minSize?.height ?? 0;
    const minW = config?.minSize?.width ?? 0;
    const r = layout.current;
    const height = Math.max(Math.min(r.height, area), Math.min(minH, current.height));
    const width = Math.max(r.width, Math.min(minW, current.width));
    let x = r.x;
    let y = Math.max(top, Math.min(r.y, top + area - height));
    const wasInside =
      current.x >= 0 &&
      current.x + current.width <= prev.width &&
      current.y + current.height <= prev.height - ctx.bottomInset;
    if (!wasInside) {
      ({ x, y } = clampTitleBarReach({ x: current.x, y: current.y, width }, ctx));
    }
    layout.current = { ...r, x, y, height, width };
    layout.desktop = layout.current;
  }
  const currentChanged = windowRectChanged(current, layout.current);
  const desktopChanged =
    !inst.desktopRect || windowRectChanged(toWindowRect(inst.desktopRect), layout.desktop);
  if (!currentChanged && !desktopChanged) return inst;
  return {
    ...inst,
    position: { x: layout.current.x, y: layout.current.y },
    size: { width: layout.current.width, height: layout.current.height },
    desktopRect: desktopChanged ? toStoredRect(layout.desktop) : inst.desktopRect,
  };
}

export const selectIsInstanceForeground = (
  state: { foregroundInstanceId: string | null },
  instanceId: string
) => state.foregroundInstanceId === instanceId;

// ---------------- Store ---------------------------------------------------------
const createUseAppStore = () =>
  create<AppStoreState>()(
    persist(
      (set, get) => ({
      version: CURRENT_APP_STORE_VERSION,

      // AI model (kept here as it's core app functionality)
      aiModel: null,
      setAiModel: (m) => {
        const next = migrateStoredAiModel(m);
        const previousModel = get().aiModel;
        set({ aiModel: next });
        if (previousModel !== next) {
          appStoreLog.debug("AI model changed", {
            model: next || "auto",
            previousModel: previousModel || "auto",
          });
          track(APP_ANALYTICS.AI_MODEL_CHANGE, {
            model: next || "auto",
            previousModel: previousModel || "auto",
          });
        }
      },

      // Boot state
      isFirstBoot: true,
      setHasBooted: () => set({ isFirstBoot: false }),
      macAppToastShown: false,
      setMacAppToastShown: () => set({ macAppToastShown: true }),
      lastSeenDesktopVersion: null,
      setLastSeenDesktopVersion: (version) => set({ lastSeenDesktopVersion: version }),

      // Expose/Mission Control mode
      exposeMode: false,
      setExposeMode: (v) => {
        if (get().exposeMode !== v) {
          appStoreLog.debug("Expose mode changed", { isOpen: v });
          track(APP_ANALYTICS.APP_EXPOSE, { isOpen: v });
        }
        set({ exposeMode: v });
      },
      desktopRevealed: false,
      setDesktopRevealed: (v) => set({ desktopRevealed: v }),

      // ryOS version (fetched from version.json)
      ryOSVersion: null,
      ryOSBuildNumber: null,
      ryOSBuildTime: null,
      setRyOSVersion: (version, buildNumber, buildTime) =>
        set({
          ryOSVersion: version,
          ryOSBuildNumber: buildNumber,
          ryOSBuildTime: buildTime || null,
        }),

      // Recent items
      recentApps: [],
      recentDocuments: [],
      addRecentApp: (appId) =>
        set((state) => {
          // Remove existing entry for this app if present
          const filtered = state.recentApps.filter((r) => r.appId !== appId);
          // Add to front with current timestamp
          const newRecent: RecentApp = { appId, timestamp: Date.now() };
          // Keep only last 20 items
          return { recentApps: [newRecent, ...filtered].slice(0, 20) };
        }),
      addRecentDocument: (path, name, appId, icon) =>
        set((state) => {
          // Remove existing entry for this path if present
          const filtered = state.recentDocuments.filter((r) => r.path !== path);
          // Add to front with current timestamp
          const newRecent: RecentDocument = { path, name, appId, icon, timestamp: Date.now() };
          // Keep only last 20 items
          return { recentDocuments: [newRecent, ...filtered].slice(0, 20) };
        }),
      clearRecentItems: () => set({ recentApps: [], recentDocuments: [] }),

      clearInstanceInitialData: (instanceId: string) =>
        set((state) => {
          if (!state.instances[instanceId]?.initialData) return state;
          return {
            instances: {
              ...state.instances,
              [instanceId]: {
                ...state.instances[instanceId],
                initialData: undefined,
              },
            },
          };
        }),

      updateInstanceInitialData: (instanceId: string, initialData: unknown) =>
        set((state) => {
          if (!state.instances[instanceId]) return state;
          return {
            instances: {
              ...state.instances,
              [instanceId]: {
                ...state.instances[instanceId],
                initialData,
              },
            },
          };
        }),

      // Instance store
      instances: {},
      instanceOrder: [],
      foregroundInstanceId: null,
      nextInstanceId: 0,

      createAppInstance: (appId, initialData, title, launchOrigin) => {
        let createdId = "";
        // All app components are chunk-loaded so the shell can paint first.
        const isLazy = true;
        set((state) => {
          const nextNum = state.nextInstanceId + 1;
          createdId = nextNum.toString();
          // Stagger position based on total number of open instances (global), not per-app
          const openInstances = state.instanceOrder.length; // existing before adding new
          const baseOffset = 16;
          const offsetStep = 32;
          const isMobile =
            typeof window !== "undefined" && window.innerWidth < 768;
          const safeTop = measureMenubarSafeTop();
          const cfg = getWindowConfig(appId);
          let desktopSize = cfg.defaultSize;

          // If creating an Applet Viewer window and we have a path, prefer saved size
          if (appId === "applet-viewer") {
            try {
              const path = (initialData as { path?: string } | undefined)?.path;
              if (path) {
                const saved = useAppletStore
                  .getState()
                  .getAppletWindowSize(path);
                if (saved) desktopSize = saved;
              }
            } catch {
              // ignore and fall back to default size
            }
          }

          // Centre cascade (§42): area = viewport minus menubar (topInset) and dock
          // (bottomInset). n = open % 5, so the 6th window wraps back to centre.
          // x = (vw - w)/2 + 32n, y = top + (areaH - h)/2 + 32n, each clamped so the
          // frame stays inside the area (pinned to its top-left when larger than it).
          const ctx = readWindowConstraintContext();
          const n = openInstances % 5;
          const desktopPosition = ctx
            ? (() => {
                const top = ctx.topInset;
                const bottom = ctx.viewportHeight - ctx.bottomInset;
                const { width: w, height: h } = desktopSize;
                const clamp = (v: number, lo: number, hi: number) =>
                  Math.round(Math.max(lo, Math.min(v, hi)));
                return {
                  x: clamp((ctx.viewportWidth - w) / 2 + n * offsetStep, 0, ctx.viewportWidth - w),
                  y: clamp(top + (bottom - top - h) / 2 + n * offsetStep, top, bottom - h),
                };
              })()
            : {
                x: baseOffset + openInstances * offsetStep,
                y: 40 + safeTop + openInstances * 20,
              };

          const position = isMobile
            ? {
                x: 0,
                y: 28 + safeTop + openInstances * offsetStep,
              }
            : desktopPosition;
          const size = isMobile ? getMobileWindowSize(appId) : desktopSize;

          const instances = {
            ...state.instances,
            [createdId]: {
              instanceId: createdId,
              appId,
              isOpen: true,
              isLoading: isLazy,
              initialData,
              title,
              position,
              size,
              desktopRect: { position: desktopPosition, size: desktopSize },
              createdAt: Date.now(),
              launchOrigin, // Store the position of the icon that launched this instance
            },
          } as typeof state.instances;

          const instanceOrder = [
            ...state.instanceOrder.filter((id) => id !== createdId),
            createdId,
          ];
          return {
            instances,
            instanceOrder,
            foregroundInstanceId: isLazy ? state.foregroundInstanceId : createdId,
            nextInstanceId: nextNum,
          };
        });
        if (createdId) {
          appStoreLog.debug("Created app instance", {
            appId,
            instanceId: createdId,
            openWindowCount: get().instanceOrder.length,
            isLazy,
            hasLaunchOrigin: !!launchOrigin,
            hasTitle: !!title,
            initialData: describeInitialData(initialData),
          });
          // Track recent app
          get().addRecentApp(appId);
          
          // Track recent document if initialData has a path
          // Skip folders - Finder opens directories, not files
          // Also skip common system folder paths
          const dataWithPath = initialData as { path?: string; name?: string; icon?: string; isDirectory?: boolean } | undefined;
          const isFolder = 
            appId === "finder" || 
            dataWithPath?.isDirectory === true ||
            // Common folder paths that shouldn't be tracked as documents
            dataWithPath?.path === "/" ||
            dataWithPath?.path === "/Applications" ||
            dataWithPath?.path === "/Documents" ||
            dataWithPath?.path === "/Downloads" ||
            dataWithPath?.path === "/Desktop" ||
            dataWithPath?.path === "/Applets" ||
            dataWithPath?.path === "/Trash";
          
          if (dataWithPath?.path && !isFolder) {
            const fileName = dataWithPath.name || dataWithPath.path.split("/").pop() || dataWithPath.path;
            get().addRecentDocument(dataWithPath.path, fileName, appId, dataWithPath.icon);
          }
          
          window.dispatchEvent(
            new CustomEvent("instanceStateChange", {
              detail: {
                instanceId: createdId,
                isOpen: true,
                isForeground: false,
              },
            })
          );
          track(APP_ANALYTICS.APP_LAUNCH, {
            appId,
            openWindowCount: get().instanceOrder.length,
            hasInitialData: initialData !== undefined,
          });
          playHaptic("soft");
        }
        return createdId;
      },

      markInstanceAsLoaded: (instanceId) => {
        set((state) => {
          const inst = state.instances[instanceId];
          if (!inst || !inst.isLoading) return state;

          const instances = {
            ...state.instances,
            [instanceId]: { ...inst, isLoading: false },
          };

          const order = [
            ...state.instanceOrder.filter((id) => id !== instanceId),
            instanceId,
          ];

          window.dispatchEvent(
            new CustomEvent("instanceStateChange", {
              detail: {
                instanceId,
                isOpen: true,
                isForeground: true,
              },
            })
          );
          appStoreLog.debug("Marked app instance as loaded", {
            appId: inst.appId,
            instanceId,
            openWindowCount: Object.keys(instances).length,
            foregroundInstanceId: instanceId,
          });

          return {
            instances,
            instanceOrder: order,
            foregroundInstanceId: instanceId,
          };
        });
      },

      closeAppInstance: (instanceId) => {
        set((state) => {
          const inst = state.instances[instanceId];
          if (!inst?.isOpen) return state;
          const instances = { ...state.instances };
          delete instances[instanceId];
          let order = state.instanceOrder.filter((id) => id !== instanceId);
          let nextForeground: string | null = null;
          for (let i = order.length - 1; i >= 0; i--) {
            const id = order[i];
            if (instances[id]?.appId === inst.appId && instances[id].isOpen) {
              nextForeground = id;
              break;
            }
          }
          if (!nextForeground && order.length)
            nextForeground = order[order.length - 1];
          if (nextForeground) {
            order = [
              ...order.filter((id) => id !== nextForeground),
              nextForeground,
            ];
          }
          window.dispatchEvent(
            new CustomEvent("instanceStateChange", {
              detail: { instanceId, isOpen: false, isForeground: false },
            })
          );
          track(APP_ANALYTICS.APP_CLOSE, {
            appId: inst.appId,
            openWindowCount: Object.keys(instances).length,
          });
          playHaptic("light");
          appStoreLog.debug("Closed app instance", {
            appId: inst.appId,
            instanceId,
            nextForegroundInstanceId: nextForeground,
            openWindowCount: Object.keys(instances).length,
          });
          return {
            instances,
            instanceOrder: order,
            foregroundInstanceId: nextForeground,
          };
        });
      },

      bringInstanceToForeground: (instanceId) => {
        if (get().desktopRevealed) set({ desktopRevealed: false });
        set((state) => {
          if (instanceId && !state.instances[instanceId]) {
            console.warn(`[AppStore] focus missing instance ${instanceId}`);
            return state;
          }

          if (instanceId === state.foregroundInstanceId) return state;

          let order = state.instanceOrder;
          let foreground: string | null = null;
          if (instanceId) {
            order = [...order.filter((id) => id !== instanceId), instanceId];
            foreground = instanceId;
          }
          window.dispatchEvent(
            new CustomEvent("instanceStateChange", {
              detail: {
                instanceId,
                isOpen: !!state.instances[instanceId]?.isOpen,
                isForeground: !!foreground && foreground === instanceId,
              },
            })
          );
          if (foreground && state.instances[foreground]) {
            track(APP_ANALYTICS.APP_FOCUS, {
              appId: state.instances[foreground].appId,
              openWindowCount: Object.keys(state.instances).length,
            });
            appStoreLog.debug("Focused app instance", {
              appId: state.instances[foreground].appId,
              instanceId: foreground,
              previousForegroundInstanceId: state.foregroundInstanceId,
              openWindowCount: Object.keys(state.instances).length,
            });
          }
          return {
            instanceOrder: order,
            foregroundInstanceId: foreground,
          };
        });
      },

      updateInstanceWindowState: (instanceId, position, size) =>
        set((state) => {
          const inst = state.instances[instanceId];
          if (!inst) return state;
          const mobile =
            typeof window !== "undefined" && window.innerWidth < 768;
          const next = {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
          };
          const current = {
            x: inst.position?.x ?? next.x,
            y: inst.position?.y ?? next.y,
            width: inst.size?.width ?? next.width,
            height: inst.size?.height ?? next.height,
          };
          const desktop = inst.desktopRect
            ? toWindowRect(inst.desktopRect)
            : current;
          const moved = applyUserWindowMove({ mobile, desktop, next });
          if (
            !windowRectChanged(current, moved.current) &&
            !windowRectChanged(desktop, moved.desktop)
          ) {
            return state;
          }
          return {
            instances: {
              ...state.instances,
              [instanceId]: {
                ...inst,
                position: { x: moved.current.x, y: moved.current.y },
                size: { width: moved.current.width, height: moved.current.height },
                desktopRect: windowRectChanged(desktop, moved.desktop)
                  ? toStoredRect(moved.desktop)
                  : inst.desktopRect,
              },
            },
          };
        }),

      getInstancesByAppId: (appId) => {
        const state = get();
        return Object.values(state.instances)
          .filter((i) => i.appId === appId)
          .map((i) => withDerivedForeground(i, state.foregroundInstanceId));
      },
      getForegroundInstance: () => {
        const id = get().foregroundInstanceId;
        const instance = id ? get().instances[id] : null;
        return instance
          ? withDerivedForeground(instance, get().foregroundInstanceId)
          : null;
      },
      navigateToNextInstance: (currentId) => {
        const { instanceOrder } = get();
        if (instanceOrder.length <= 1) return;
        const idx = instanceOrder.indexOf(currentId);
        if (idx === -1) return;
        const next = instanceOrder[(idx + 1) % instanceOrder.length];
        get().bringInstanceToForeground(next);
      },
      navigateToPreviousInstance: (currentId) => {
        const { instanceOrder } = get();
        if (instanceOrder.length <= 1) return;
        const idx = instanceOrder.indexOf(currentId);
        if (idx === -1) return;
        const prev = (idx - 1 + instanceOrder.length) % instanceOrder.length;
        get().bringInstanceToForeground(instanceOrder[prev]);
      },
      minimizeInstance: (instanceId) => {
        set((state) => {
          const inst = state.instances[instanceId];
          if (!inst || inst.isMinimized) return state;

          const instances = { ...state.instances };
          instances[instanceId] = { ...inst, isMinimized: true };

          // Find next foreground from non-minimized windows
          let nextForeground: string | null = null;
          for (let i = state.instanceOrder.length - 1; i >= 0; i--) {
            const id = state.instanceOrder[i];
            if (id !== instanceId && instances[id]?.isOpen && !instances[id]?.isMinimized) {
              nextForeground = id;
              break;
            }
          }

          window.dispatchEvent(
            new CustomEvent("instanceStateChange", {
              detail: { instanceId, isOpen: true, isForeground: false, isMinimized: true },
            })
          );
          track(APP_ANALYTICS.APP_MINIMIZE, {
            appId: inst.appId,
            openWindowCount: Object.keys(instances).length,
          });
          appStoreLog.debug("Minimized app instance", {
            appId: inst.appId,
            instanceId,
            nextForegroundInstanceId: nextForeground,
            openWindowCount: Object.keys(instances).length,
          });

          return {
            instances,
            foregroundInstanceId: nextForeground,
          };
        });
      },
      restoreInstance: (instanceId) => {
        if (get().desktopRevealed) set({ desktopRevealed: false });
        set((state) => {
          const inst = state.instances[instanceId];
          if (!inst || !inst.isMinimized) return state;

          const ctx = readWindowConstraintContext();
          const fitted = ctx ? constrainInstanceGeometry(inst, ctx) : inst;
          const instances = {
            ...state.instances,
            [instanceId]: { ...fitted, isMinimized: false },
          };

          // Move to end of order
          const order = [
            ...state.instanceOrder.filter((id) => id !== instanceId),
            instanceId,
          ];

          window.dispatchEvent(
            new CustomEvent("instanceStateChange", {
              detail: { instanceId, isOpen: true, isForeground: true, isMinimized: false },
            })
          );
          track(APP_ANALYTICS.APP_RESTORE, {
            appId: inst.appId,
            openWindowCount: Object.keys(instances).length,
          });
          appStoreLog.debug("Restored app instance", {
            appId: inst.appId,
            instanceId,
            openWindowCount: Object.keys(instances).length,
          });

          return {
            instances,
            instanceOrder: order,
            foregroundInstanceId: instanceId,
          };
        });
      },
      updateInstanceTitle: (instanceId, title) => {
        set((state) => {
          const inst = state.instances[instanceId];
          if (!inst) return state;
          // Only update if displayTitle actually changed
          if (inst.displayTitle === title) return state;
          appStoreLog.debug("Updated app instance title", {
            appId: inst.appId,
            instanceId,
            titleLength: title.length,
          });
          return {
            instances: {
              ...state.instances,
              [instanceId]: { ...inst, displayTitle: title },
            },
          };
        });
      },
      launchApp: (appId, initialData, title, multiWindow = false, launchOrigin) => {
        if (get().desktopRevealed) set({ desktopRevealed: false });
        appStoreLog.debug("Launch requested", {
          appId,
          multiWindow,
          hasTitle: !!title,
          hasLaunchOrigin: !!launchOrigin,
          initialData: describeInitialData(initialData),
        });
        prefetchAppChunk(appId);

        const state = get();
        if (shouldRequestCloudSyncOnAppLaunch(appId)) {
          requestCloudSyncCheck();
        }
        
        // Check if all instances of this app are minimized
        // If so, restore them instead of creating a new instance
        const appInstances = Object.values(state.instances).filter(
          (inst) => inst.appId === appId && inst.isOpen
        );
        
        if (appInstances.length > 0) {
          // Check if all instances are minimized
          const allMinimized = appInstances.every((inst) => inst.isMinimized);
          
          if (allMinimized) {
            // Restore all minimized instances
            let lastRestoredId: string | null = null;
            appInstances.forEach((inst) => {
              if (inst.isMinimized) {
                state.restoreInstance(inst.instanceId);
                lastRestoredId = inst.instanceId;
              }
            });
            
            // Bring the most recently restored instance to foreground
            if (lastRestoredId) {
              state.bringInstanceToForeground(lastRestoredId);
              // Update initialData if provided
              if (initialData) {
                set((s) => ({
                  instances: {
                    ...s.instances,
                    [lastRestoredId!]: {
                      ...s.instances[lastRestoredId!],
                      initialData,
                    },
                  },
                }));
              }
              track(APP_ANALYTICS.APP_REOPEN, {
                appId,
                restoredFromMinimized: true,
              });
              appStoreLog.debug("Reopened minimized app instances", {
                appId,
                instanceId: lastRestoredId,
                restoredCount: appInstances.length,
                updatedInitialData: initialData !== undefined,
              });
              return lastRestoredId;
            }
          }
        }
        
        const supportsMultiWindow =
          multiWindow ||
          appId === "textedit" ||
          appId === "finder" ||
          appId === "preview" ||
          appId === "applet-viewer";
        if (!supportsMultiWindow) {
          const existing = Object.values(state.instances).find(
            (i) => i.appId === appId && i.isOpen
          );
          if (existing) {
            state.bringInstanceToForeground(existing.instanceId);
            if (initialData) {
              set((s) => ({
                instances: {
                  ...s.instances,
                  [existing.instanceId]: {
                    ...s.instances[existing.instanceId],
                    initialData,
                  },
                },
              }));
            }
            track(APP_ANALYTICS.APP_REOPEN, {
              appId,
              reusedExistingWindow: true,
              hasInitialData: initialData !== undefined,
            });
            appStoreLog.debug("Reused existing app instance", {
              appId,
              instanceId: existing.instanceId,
              supportsMultiWindow,
              updatedInitialData: initialData !== undefined,
            });
            return existing.instanceId;
          }
        }
        return state.createAppInstance(appId, initialData, title, launchOrigin);
      },

      _debugCheckInstanceIntegrity: () => {
        set((state) => {
          const openIds = Object.values(state.instances).reduce<string[]>((acc, instance) => {
            if (instance.isOpen) {
              acc.push(instance.instanceId);
            }
            return acc;
          }, []);
          const filtered = state.instanceOrder.filter((id) =>
            openIds.includes(id)
          );
          const missing = openIds.filter((id) => !filtered.includes(id));
          if (!missing.length && filtered.length === state.instanceOrder.length)
            return state;
          return { instanceOrder: [...filtered, ...missing] };
        });
      },
      }),
      {
        name: "ryos:app-store",
        version: CURRENT_APP_STORE_VERSION,
        storage: createJSONStorage(() => localStorage),
        // Clamp rects in onRehydrateStorage, after persist has committed the
        // saved instances. Doing it in `merge` runs before `set`; a throw
        // there aborts hydration and leaves the in-memory map empty.
        partialize: (state): Partial<AppStoreState> => ({
        version: state.version,
        
        // AI model
        aiModel: state.aiModel,
        
        // Boot/version state
        isFirstBoot: state.isFirstBoot,
        macAppToastShown: state.macAppToastShown,
        lastSeenDesktopVersion: state.lastSeenDesktopVersion,
        ryOSVersion: state.ryOSVersion,
        ryOSBuildNumber: state.ryOSBuildNumber,
        ryOSBuildTime: state.ryOSBuildTime,
        
        // Recent items
        recentApps: state.recentApps,
        recentDocuments: state.recentDocuments,
        
        // Instance management
        instances: Object.fromEntries(
          Object.entries(state.instances).reduce<[string, AppInstance][]>((acc, [id, inst]) => {
              if (!inst.isOpen) {
                return acc;
              }
              // Exclude launchOrigin from persisted state - restored windows should
              // animate from window center, not from the original icon position
              const {
                launchOrigin: _launchOrigin,
                isForeground: _isForeground,
                ...instWithoutRuntimeState
              } = inst;
              
              // For applet-viewer, exclude content from initialData to prevent localStorage storage
              if (inst.appId === "applet-viewer" && inst.initialData) {
                const appletData = inst.initialData as { path?: string; content?: string; shareCode?: string; icon?: string; name?: string };
                acc.push([id, {
                  ...instWithoutRuntimeState,
                  initialData: {
                    ...appletData,
                    content: "", // Exclude content - it should be loaded from IndexedDB
                  },
                } as AppInstance]);
                return acc;
              }
              if (inst.appId === "preview") {
                acc.push([id, {
                  ...instWithoutRuntimeState,
                  initialData: getRestorablePreviewInitialData(inst.initialData),
                } as AppInstance]);
                return acc;
              }
              acc.push([id, instWithoutRuntimeState as AppInstance]);
              return acc;
            }, [])
        ),
        instanceOrder: state.instanceOrder.filter(
          (id) => state.instances[id]?.isOpen
        ),
        foregroundInstanceId: state.foregroundInstanceId,
        nextInstanceId: state.nextInstanceId,
        }),
        onRehydrateStorage: () => (state) => {
        if (!state) return;
        // §62c: hidden apps never come back from a saved session.
        for (const id of Object.keys(state.instances || {})) {
          if (APPLICATIONS_HIDDEN.has(state.instances[id].appId)) delete state.instances[id];
        }
        const migratedModel = migrateStoredAiModel(state.aiModel);
        if (migratedModel !== state.aiModel) {
          state.aiModel = migratedModel;
        }
        // Clean instanceOrder after rehydrate
        if (
          (state as unknown as { instanceOrder?: string[] }).instanceOrder &&
          state.instances
        ) {
          (state as unknown as { instanceOrder?: string[] }).instanceOrder = (
            state as unknown as { instanceOrder?: string[] }
          ).instanceOrder!.filter((id: string) => state.instances[id]);
        }
        state.foregroundInstanceId = getDerivedForegroundInstanceId(state);
        // Fix nextInstanceId
        if (state.instances && Object.keys(state.instances).length) {
          const max = Math.max(
            ...Object.keys(state.instances).map((id) => parseInt(id, 10))
          );
          if (!isNaN(max) && max >= state.nextInstanceId)
            state.nextInstanceId = max + 1;
        }
        // Ensure positions & sizes
        Object.keys(state.instances || {}).forEach((id) => {
          const inst = stripInstanceForeground(state.instances[id]);
          state.instances[id] = inst;
          if (!inst.createdAt) {
            const numericId = parseInt(id, 10);
            inst.createdAt = !isNaN(numericId) ? numericId : Date.now();
          }
          if (!inst.position || !inst.size) {
            try {
              const cfg = getWindowConfig(inst.appId);
              const isMobile = window.innerWidth < 768;
              if (!inst.position)
                inst.position = {
                  x: isMobile ? 0 : 16,
                  y: (isMobile ? 28 : 40) + measureMenubarSafeTop(),
                };
              if (!inst.size)
                inst.size = isMobile
                  ? getMobileWindowSize(inst.appId)
                  : cfg.defaultSize;
            } catch {
              // An unknown app id must not abort restoration of the others.
            }
          }
        });
        // Saved instances are already in the store. Fit rects in place so a
        // clamp failure cannot drop the restored session.
        try {
          const ctx = readWindowConstraintContext();
          if (ctx && state.instances) {
            const ids = Object.keys(state.instances);
            for (let index = 0; index < ids.length; index++) {
              const id = ids[index];
              const inst = state.instances[id];
              if (!inst) continue;
              const fitted = constrainInstanceGeometry(inst, ctx, index);
              if (fitted === inst) continue;
              inst.position = fitted.position;
              inst.size = fitted.size;
              inst.desktopRect = fitted.desktopRect;
            }
          }
        } catch {
          // Keep the restored session even if viewport measurement fails.
        }
        },
      }
    )
  );

// Preserve store across Vite HMR to prevent "split-brain" instances.
let useAppStore = createUseAppStore();
if (import.meta.hot) {
  const data = import.meta.hot.data as { useAppStore?: typeof useAppStore };
  if (data.useAppStore) {
    useAppStore = data.useAppStore;
  } else {
    data.useAppStore = useAppStore;
  }
}
export { useAppStore };

/**
 * Fit every open window to the current viewport in one store write.
 * Returns without notifying when every rect is already inside.
 */
export function constrainOpenWindowsToViewport(): void {
  const ctx = readWindowConstraintContext();
  if (!ctx) return;
  const prev = lastConstrainedViewport ?? {
    width: ctx.viewportWidth,
    height: ctx.viewportHeight,
  };
  lastConstrainedViewport = { width: ctx.viewportWidth, height: ctx.viewportHeight };
  useAppStore.setState((state) => {
    let changed = false;
    const instances: Record<string, AppInstance> = {};
    const ids = Object.keys(state.instances);
    for (let index = 0; index < ids.length; index++) {
      const id = ids[index];
      const inst = state.instances[id];
      if (!inst?.isOpen) {
        instances[id] = inst;
        continue;
      }
      const fitted = constrainInstanceGeometry(inst, ctx, index, prev);
      instances[id] = fitted;
      if (fitted !== inst) changed = true;
    }
    if (!changed) return state;
    return { instances };
  });
}

// Global helpers ---------------------------------------------------------------
export const clearAllAppStates = (): void => {
  try {
    localStorage.clear();
  } catch (e) {
    console.error("clearAllAppStates", e);
  }
};

/**
 * Shallow-equality selector hook for this store. Co-located with the store
 * (rather than a central helpers barrel) so importing it doesn't pull other
 * stores into the bundle.
 */
export function useAppStoreShallow<T>(
  selector: (state: ReturnType<typeof useAppStore.getState>) => T
): T {
  return useStoreShallow(useAppStore, selector);
}
