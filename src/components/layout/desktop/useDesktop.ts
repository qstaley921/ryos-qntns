import type { AnyApp } from "@/apps/base/types";
import type { AppId } from "@/config/appRegistry";
import {
  useState,
  useRef,
  useCallback,
  useMemo,
  useEffect,
} from "react";
import type { DragEvent, MouseEvent as ReactMouseEvent } from "react";
import type { SortType } from "@/apps/finder/components/FinderMenuBar";
import { usePointerLongPress } from "@/hooks/usePointerLongPress";
import { isFolderTag } from "@/apps/finder/utils/ghostPlaces";
import { useThemeFlags } from "@/hooks/useThemeFlags";
import { useFilesStore, type FileSystemItem } from "@/stores/useFilesStore";
import { useShallow } from "zustand/react/shallow";
import { useLaunchApp } from "@/hooks/useLaunchApp";
import { useAppStore } from "@/stores/useAppStore";
import type { LaunchOriginRect } from "@/stores/useAppStore";
import { STORES, dbOperations } from "@/utils/indexedDB";
import { useTranslation } from "react-i18next";
import { useWallpaper } from "@/hooks/useWallpaper";
import { useShuffleWallpaper } from "@/hooks/useShuffleWallpaper";
import {
  createSelectionRect,
  getIntersectingSelectionIds,
  hasToggleModifier,
  mergeSelectionIds,
  resolveMultiSelection,
  type SelectableRect,
  type SelectionPoint,
} from "@/utils/selection";
import type { MenuItem } from "@/components/ui/right-click-menu";
import { hasDesktopWindowChrome } from "@/utils/platform";
import { getWallpaperStyles } from "./desktopWallpaperUtils";
import { openDesktopAlias } from "./openDesktopAlias";
import {
  getDesktopAppItemId,
  getDesktopShortcutItemId,
} from "./desktopConstants";
import { compareDesktopShortcuts } from "./desktopShortcutSort";
import {
  prefetchDesktopShortcutIntent,
  getDesktopShortcutDisplayName,
  getDesktopShortcutIcon,
} from "./desktopShortcutUtils";
import {
  useGhostList,
  ghostPlaces,
  RECENTS_PATH,
} from "@/apps/finder/utils/ghostPlaces";
import { useShortViewport } from "./desktopConstants";
import type { DesktopFolder } from "./DesktopIconGrid";
import { listHomeContent } from "@/lib/ghost";
import { createClientLogger } from "@/utils/logger";
import type {
  DesktopProps,
  DesktopItemId,
  DesktopItemDefinition,
} from "./desktopTypes";

const log = createClientLogger("Desktop");
import { useDesktopVideoWallpaper } from "./useDesktopVideoWallpaper";

export function useDesktop({
  apps,
  toggleApp,
  onClick,
  desktopStyles,
}: DesktopProps) {
  const { t } = useTranslation();
  const [selectedItemIds, setSelectedItemIds] = useState<DesktopItemId[]>([]);
  const [selectionAnchorId, setSelectionAnchorId] =
    useState<DesktopItemId | null>(null);
  const { wallpaperSource, isVideoWallpaper } = useWallpaper();
  // Resolve shuffle wallpapers into a concrete rotating asset source.
  useShuffleWallpaper();
  const { videoRef } = useDesktopVideoWallpaper(isVideoWallpaper);
  const desktopRef = useRef<HTMLDivElement>(null);
  const marqueeStartRef = useRef<SelectionPoint | null>(null);
  const marqueeBaseSelectionRef = useRef<DesktopItemId[]>([]);
  const marqueeAdditiveRef = useRef(false);
  const suppressClickAfterMarqueeRef = useRef(false);
  // Marquee internals are ref-driven so pointer moves don't re-render the
  // desktop: the rect element is painted directly, item rects are captured
  // once on mousedown, and selection state only updates when the intersecting
  // set actually changes.
  const marqueeElementRef = useRef<HTMLDivElement | null>(null);
  const marqueeOriginRef = useRef<{ left: number; top: number } | null>(null);
  const marqueeItemRectsRef = useRef<SelectableRect<DesktopItemId>[]>([]);
  const lastMarqueeSelectionSigRef = useRef<string | null>(null);
  const [isMarqueeSelecting, setIsMarqueeSelecting] = useState(false);
  const [sortType, setSortType] = useState<SortType>("name");
  const [contextMenuPos, setContextMenuPos] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [contextMenuAppId, setContextMenuAppId] = useState<string | null>(null);
  const [contextMenuShortcutPath, setContextMenuShortcutPath] = useState<
    string | null
  >(null);
  const [isEmptyTrashDialogOpen, setIsEmptyTrashDialogOpen] = useState(false);

  const {
    currentTheme,
    isWindowsTheme,
    isMacOSTheme,
    isSystem7Theme,
  } = useThemeFlags();

  const hasWindowChrome = hasDesktopWindowChrome();

  const launchApp = useLaunchApp();

  // Desktop item id -> the instance that icon launched, so the icon bounces
  // while that instance's isLoading is true (CHECKLIST-35 §46b).
  const [launchedInstances, setLaunchedInstances] = useState<
    Record<DesktopItemId, string>
  >({});
  const loadingItemIds = useAppStore(
    useShallow((state) =>
      Object.entries(launchedInstances)
        .filter(([, id]) => state.instances[id]?.isLoading)
        .map(([itemId]) => itemId)
    )
  );
  /** Run a launch; the instance it newly creates is tied to `itemId`. */
  const trackLaunch = useCallback(
    async (itemId: DesktopItemId, launch: () => unknown) => {
      const before = new Set(Object.keys(useAppStore.getState().instances));
      await launch();
      const created = Object.keys(useAppStore.getState().instances).filter(
        (id) => !before.has(id)
      );
      const id = created[created.length - 1];
      if (id) setLaunchedInstances((prev) => ({ ...prev, [itemId]: id }));
    },
    []
  );

  const desktopAndTrashItems = useFilesStore(
    useShallow((state) => {
      const result: FileSystemItem[] = [];
      for (const [path, item] of Object.entries(state.items)) {
        if (path.startsWith("/Desktop/") || path === "/Trash") {
          result.push(item);
        }
      }
      return result;
    })
  );
  const getItem = useFilesStore((state) => state.getItem);

  const handlePrefetchShortcut = useCallback(
    (shortcut: FileSystemItem) => {
      prefetchDesktopShortcutIntent(shortcut, getItem);
    },
    [getItem]
  );

  const getItemsInPath = useFilesStore((state) => state.getItemsInPath);
  const updateItemMetadata = useFilesStore((state) => state.updateItemMetadata);
  const createAlias = useFilesStore((state) => state.createAlias);
  const removeItem = useFilesStore((state) => state.removeItem);
  const emptyTrash = useFilesStore((state) => state.emptyTrash);
  const getTrashItems = useFilesStore((state) => state.getTrashItems);
  const trashItem = desktopAndTrashItems.find((item) => item.path === "/Trash");
  const trashIcon = trashItem?.icon || "/icons/trash-empty.png";

  const desktopShortcuts = useMemo(
    () =>
      desktopAndTrashItems
        .filter(
          (item) =>
            item.status === "active" &&
            item.path.startsWith("/Desktop/") &&
            !item.isDirectory &&
            (!item.hiddenOnThemes ||
              !item.hiddenOnThemes.includes(currentTheme))
        )
        .sort((a, b) => compareDesktopShortcuts(a, b, isSystem7Theme)),
    [desktopAndTrashItems, currentTheme, isSystem7Theme]
  );

  const getDisplayName = useCallback(
    (shortcut: FileSystemItem) =>
      getDesktopShortcutDisplayName(shortcut, getItem),
    [getItem]
  );

  const getShortcutIcon = useCallback(
    (shortcut: FileSystemItem) =>
      getDesktopShortcutIcon(shortcut, getItem),
    [getItem]
  );

  const handleAliasOpen = useCallback(
    async (shortcut: FileSystemItem, launchOrigin?: LaunchOriginRect) => {
      await trackLaunch(getDesktopShortcutItemId(shortcut.path), () =>
        openDesktopAlias(shortcut, {
          toggleApp,
          launchApp,
          getItem,
          launchOrigin,
        })
      );
    },
    [toggleApp, launchApp, getItem, trackLaunch]
  );

  const handleDragOver = (e: DragEvent) => {
    if (e.dataTransfer.types.includes("application/json")) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      const jsonData = e.dataTransfer.getData("application/json");
      if (!jsonData) return;

      const { path, name, appId } = JSON.parse(jsonData);

      if (path && path.startsWith("/Desktop/")) {
        return;
      }

      const desktopItems = getItemsInPath("/Desktop");
      let aliasExists = false;

      if (appId || (path && path.startsWith("/Applications/"))) {
        const finalAppId = appId || getItem(path)?.appId;
        if (finalAppId) {
          const existingShortcut = desktopItems.find(
            (item) =>
              item.aliasType === "app" &&
              item.aliasTarget === finalAppId &&
              item.status === "active"
          );
          aliasExists = !!existingShortcut;

          if (aliasExists && existingShortcut) {
            if (
              existingShortcut.hiddenOnThemes &&
              existingShortcut.hiddenOnThemes.length > 0
            ) {
              updateItemMetadata(existingShortcut.path, {
                hiddenOnThemes: [],
              });
            }
          } else {
            createAlias(path || "", name, "app", finalAppId);
          }
        }
      } else if (path) {
        const sourceItem = getItem(path);
        if (sourceItem) {
          aliasExists = desktopItems.some(
            (item) =>
              item.aliasType === "file" &&
              item.aliasTarget === path &&
              item.status === "active"
          );

          if (!aliasExists) {
            createAlias(path, name, "file");
          }
        }
      }
    } catch (err) {
      console.error("[Desktop] Error handling drop:", err);
    }
  };

  const desktopLongPress = usePointerLongPress((event) => {
    const target = event.target as HTMLElement;
    const iconContainer = target.closest("[data-desktop-icon]");
    if (iconContainer) {
      return;
    }

    setContextMenuPos({ x: event.clientX, y: event.clientY });
    setContextMenuAppId(null);
  });
  const longPressHandlers = {
    onMouseMove: desktopLongPress.onMouseMove,
    onMouseUp: desktopLongPress.onMouseUp,
    onMouseLeave: desktopLongPress.onMouseLeave,
    onTouchStart: desktopLongPress.onTouchStart,
    onTouchMove: desktopLongPress.onTouchMove,
    onTouchEnd: desktopLongPress.onTouchEnd,
    onTouchCancel: desktopLongPress.onTouchCancel,
  };

  const finalStyles = {
    ...getWallpaperStyles(wallpaperSource, isVideoWallpaper),
    ...desktopStyles,
  };

  const clearSelection = useCallback(() => {
    setSelectedItemIds([]);
    setSelectionAnchorId(null);
  }, []);

  const applySelection = useCallback(
    (nextSelectedIds: DesktopItemId[], nextAnchorId: DesktopItemId | null) => {
      setSelectedItemIds(nextSelectedIds);
      setSelectionAnchorId(nextAnchorId);
    },
    []
  );

  const ghost = useGhostList();
  // Ids of #home-content posts (quotes, rules, notes: Journal only, no folder).
  // The baked list hides internal tags, so one read-only Content API call.
  const [homeIds, setHomeIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    let live = true;
    listHomeContent().then((r) => live && setHomeIds(new Set(r.map((p) => p.id))));
    return () => {
      live = false;
    };
  }, []);
  // One folder per public tag with >=1 non-home-content post, most posts first.
  const shortViewport = useShortViewport();
  const baseFolders = useMemo<DesktopFolder[]>(() => {
    const posts = ghost.docs.filter((d) => d.type === "post" && !homeIds.has(d.id));
    const count = (slug: string) =>
      posts.filter((d) => d.tags.some((t) => t.slug === slug)).length;
    return ghostPlaces(ghost)
      .filter((p) => p.path !== RECENTS_PATH)
      .filter((p) => !p.name.startsWith("#") && !p.path.startsWith("/Tag-hash-"))
      .filter((p) => isFolderTag({ name: p.name, slug: p.path.slice(5) }))
      .map((p) => ({
        ...p,
        n: count(p.path.startsWith("/Tag-") ? p.path.slice(5) : "poems"),
      }))
      .filter((p) => p.n > 0)
      .sort((a, b) => b.n - a.n)
      .map(({ name, path, icon }) => ({ name, path, icon }));
  }, [ghost, homeIds]);
  // §49: dock is hidden on a short viewport, so Applications sits on the desktop (after HD, before content folders).
  // §49a: on a short viewport the content folders are dropped too; only Applications stays.
  const folders = useMemo<DesktopFolder[]>(
    () =>
      shortViewport
        ? [
            {
              name: t("common.dock.applications"),
              path: "/Applications",
              icon: "/icons/default/applications.png",
            },
          ]
        : baseFolders,
    [shortViewport, baseFolders, t]
  );

  const handleFinderOpen = (
    e: ReactMouseEvent<HTMLDivElement>,
    path = "/"
  ) => {
    e.stopPropagation();
    localStorage.setItem("ryos:app:finder:initial-path", path);
    const finderApp = apps.find((app) => app.id === "finder");
    if (finderApp) {
      const rect = e.currentTarget.getBoundingClientRect();
      const launchOrigin: LaunchOriginRect = {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      };
      void trackLaunch(
        path === "/"
          ? getDesktopAppItemId("macintosh-hd")
          : getDesktopShortcutItemId(path),
        () => toggleApp(finderApp.id, undefined, launchOrigin)
      );
    }
    clearSelection();
  };

  const handleIconContextMenu = (appId: string, e: ReactMouseEvent) => {
    const itemId = getDesktopAppItemId(appId);
    e.preventDefault();
    e.stopPropagation();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setContextMenuAppId(appId);
    setContextMenuShortcutPath(null);
    if (!selectedItemIds.includes(itemId)) {
      applySelection([itemId], itemId);
    }
  };

  const handleShortcutContextMenu = (
    shortcutPath: string,
    e: ReactMouseEvent
  ) => {
    const itemId = getDesktopShortcutItemId(shortcutPath);
    e.preventDefault();
    e.stopPropagation();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setContextMenuShortcutPath(shortcutPath);
    setContextMenuAppId(null);
    if (!selectedItemIds.includes(itemId)) {
      applySelection([itemId], itemId);
    }
  };

  const handleShortcutDelete = () => {
    if (!contextMenuShortcutPath) return;
    const shortcut = getItem(contextMenuShortcutPath);
    if (shortcut) {
      removeItem(contextMenuShortcutPath);
    }
    clearSelection();
    setContextMenuPos(null);
    setContextMenuShortcutPath(null);
  };

  const handleOpenApp = (appId: string) => {
    if (appId === "macintosh-hd") {
      localStorage.setItem("ryos:app:finder:initial-path", "/");
      const finderApp = apps.find((app) => app.id === "finder");
      if (finderApp) {
        toggleApp(finderApp.id);
      }
    } else {
      toggleApp(appId as AppId);
    }
    clearSelection();
    setContextMenuPos(null);
  };

  const handleEmptyTrash = () => {
    setIsEmptyTrashDialogOpen(true);
  };

  const confirmEmptyTrash = async () => {
    const contentUUIDsToDelete = emptyTrash();

    try {
      for (const uuid of contentUUIDsToDelete) {
        await dbOperations.delete(STORES.TRASH, uuid);
      }
      log.debug("Cleared trash content from IndexedDB", {
        deletedContentCount: contentUUIDsToDelete.length,
      });
    } catch (err) {
      console.error("Error clearing trash content from IndexedDB:", err);
    }

    setIsEmptyTrashDialogOpen(false);
  };

  const sortedApps = [...apps]
    .filter(
      (app) =>
        app.id !== "finder" &&
        app.id !== "control-panels" &&
        app.id !== "applet-viewer"
    )
    .sort((a, b) => {
      switch (sortType) {
        case "name":
          return a.name.localeCompare(b.name);
        case "kind":
          return a.id.localeCompare(b.id);
        default:
          return 0;
      }
    });

  const displayedApps =
    isMacOSTheme
      ? sortedApps.filter(
          (app) => app.id === "ipod" || app.id === "applet-viewer"
        )
      : sortedApps;

  const desktopItemsInOrder = useMemo<DesktopItemDefinition[]>(() => {
    const items: DesktopItemDefinition[] = [
      {
        id: getDesktopAppItemId("macintosh-hd"),
        kind: "app",
      },
      ...folders.map((f) => ({
        id: getDesktopShortcutItemId(f.path),
        kind: "shortcut" as const,
      })),
    ];

    return items;
  }, [folders]);

  const handleFolderOpen = (
    path: string,
    e: ReactMouseEvent<HTMLDivElement>
  ) => handleFinderOpen(e, path);

  // Paint the marquee rect element directly (no React state per pointer move).
  const paintMarqueeRect = useCallback(
    (start: SelectionPoint, end: SelectionPoint) => {
      const element = marqueeElementRef.current;
      const origin = marqueeOriginRef.current;
      if (!element || !origin) return;

      const rect = createSelectionRect(start, end);
      element.style.left = `${rect.left - origin.left}px`;
      element.style.top = `${rect.top - origin.top}px`;
      element.style.width = `${rect.right - rect.left}px`;
      element.style.height = `${rect.bottom - rect.top}px`;
    },
    []
  );

  const updateSelectionFromMarquee = useCallback(
    (start: SelectionPoint, end: SelectionPoint) => {
      const intersectingIds = getIntersectingSelectionIds(
        createSelectionRect(start, end),
        marqueeItemRectsRef.current
      );

      const nextSelectedIds = marqueeAdditiveRef.current
        ? mergeSelectionIds(
            desktopItemsInOrder.map((item) => item.id),
            marqueeBaseSelectionRef.current,
            intersectingIds
          )
        : intersectingIds;

      // Only touch React state when the intersecting set actually changes.
      const signature = nextSelectedIds.join("\u0000");
      if (signature === lastMarqueeSelectionSigRef.current) return;
      lastMarqueeSelectionSigRef.current = signature;

      const nextAnchorId = nextSelectedIds[nextSelectedIds.length - 1] ?? null;
      applySelection(nextSelectedIds, nextAnchorId);
    },
    [applySelection, desktopItemsInOrder]
  );

  useEffect(() => {
    if (!isMarqueeSelecting || !marqueeStartRef.current) return;

    // Position the freshly-mounted marquee element at its zero-size origin.
    paintMarqueeRect(marqueeStartRef.current, marqueeStartRef.current);

    const handleMouseMove = (event: MouseEvent) => {
      const start = marqueeStartRef.current;
      if (!start) return;

      const end = { x: event.clientX, y: event.clientY };
      paintMarqueeRect(start, end);
      updateSelectionFromMarquee(start, end);
    };

    const handleMouseUp = (event: MouseEvent) => {
      const start = marqueeStartRef.current;
      if (!start) return;

      const end = { x: event.clientX, y: event.clientY };
      const movedEnough =
        Math.abs(end.x - start.x) > 3 || Math.abs(end.y - start.y) > 3;

      if (movedEnough) {
        updateSelectionFromMarquee(start, end);
      } else if (!marqueeAdditiveRef.current) {
        clearSelection();
      }

      suppressClickAfterMarqueeRef.current = movedEnough;
      marqueeStartRef.current = null;
      setIsMarqueeSelecting(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp, { once: true });

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [
    clearSelection,
    isMarqueeSelecting,
    paintMarqueeRect,
    updateSelectionFromMarquee,
  ]);

  const handleDesktopItemClick = (
    itemId: DesktopItemId,
    event: ReactMouseEvent<HTMLDivElement>
  ) => {
    event.stopPropagation();

    const nextSelection = resolveMultiSelection({
      orderedIds: desktopItemsInOrder.map((item) => item.id),
      currentSelectedIds: selectedItemIds,
      clickedId: itemId,
      anchorId: selectionAnchorId,
      modifiers: {
        shiftKey: event.shiftKey,
        toggleKey: hasToggleModifier(event),
      },
    });

    applySelection(nextSelection.selectedIds, nextSelection.anchorId);
  };

  const handleBlankMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    desktopLongPress.onMouseDown(event);
    const target = event.target as HTMLElement;
    if (target.closest("[data-desktop-icon]")) return;

    const start = { x: event.clientX, y: event.clientY };
    marqueeStartRef.current = start;
    marqueeBaseSelectionRef.current = selectedItemIds;
    marqueeAdditiveRef.current = event.shiftKey || hasToggleModifier(event);
    lastMarqueeSelectionSigRef.current = null;

    // Capture desktop origin + item rects once; the desktop doesn't scroll,
    // so per-move getBoundingClientRect calls are unnecessary.
    const desktop = desktopRef.current;
    const bounds = desktop?.getBoundingClientRect();
    marqueeOriginRef.current = bounds
      ? { left: bounds.left, top: bounds.top }
      : { left: 0, top: 0 };
    marqueeItemRectsRef.current = desktop
      ? Array.from(
          desktop.querySelectorAll<HTMLElement>("[data-desktop-item-id]")
        ).reduce<SelectableRect<DesktopItemId>[]>((acc, element) => {
          const id = element.dataset.desktopItemId;
          if (!id) return acc;
          const rect = element.getBoundingClientRect();
          acc.push({
            id: id as DesktopItemId,
            rect: {
              left: rect.left,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
            },
          });
          return acc;
        }, [])
      : [];

    setIsMarqueeSelecting(true);
  };

  const handleDesktopClick = () => {
    if (suppressClickAfterMarqueeRef.current) {
      suppressClickAfterMarqueeRef.current = false;
      onClick?.();
      return;
    }
    if (!marqueeStartRef.current) {
      clearSelection();
    }
    onClick?.();
  };

  const getContextMenuItems = (): MenuItem[] => {
    if (contextMenuShortcutPath) {
      return [
        {
          type: "item",
          label: t("apps.finder.contextMenu.open"),
          onSelect: () => {
            const shortcut = getItem(contextMenuShortcutPath);
            if (shortcut) {
              void handleAliasOpen(shortcut);
            }
            setContextMenuPos(null);
            setContextMenuShortcutPath(null);
          },
        },
        { type: "separator" },
        {
          type: "item",
          label: t("apps.finder.contextMenu.moveToTrash"),
          onSelect: handleShortcutDelete,
        },
      ];
    } else if (contextMenuAppId) {
      if (contextMenuAppId === "trash") {
        return [
          {
            type: "item",
            label: t("apps.finder.contextMenu.open"),
            onSelect: () => {
              localStorage.setItem("ryos:app:finder:initial-path", "/Trash");
              const finderApp = apps.find((app) => app.id === "finder");
              if (finderApp) {
                toggleApp(finderApp.id);
              }
              setContextMenuPos(null);
              setContextMenuAppId(null);
            },
          },
        ];
      }
      return [
        {
          type: "item",
          label: t("apps.finder.contextMenu.open"),
          onSelect: () => handleOpenApp(contextMenuAppId),
        },
      ];
    } else {
      const trashItems = getTrashItems();
      const isTrashEmpty = trashItems.length === 0;

      return [
        {
          type: "submenu",
          label: t("apps.finder.contextMenu.sortBy"),
          items: [
            {
              type: "radioGroup",
              value: sortType,
              onChange: (val) => setSortType(val as SortType),
              items: [
                { label: t("apps.finder.contextMenu.name"), value: "name" },
                { label: t("apps.finder.contextMenu.kind"), value: "kind" },
              ],
            },
          ],
        },
        { type: "separator" },
        {
          type: "item",
          label: t("apps.finder.contextMenu.emptyTrash"),
          onSelect: handleEmptyTrash,
          disabled: isTrashEmpty,
        },
        { type: "separator" },
        {
          type: "item",
          label: t("common.desktop.setWallpaper"),
          onSelect: () => toggleApp("control-panels"),
        },
      ];
    }
  };

  const macintoshHdName = useMemo(
    () =>
      isWindowsTheme
        ? t("common.desktop.myComputer")
        : t("apps.finder.window.macintoshHd"),
    [isWindowsTheme, t]
  );

  const handleShortcutDoubleClick = useCallback(
    (shortcut: FileSystemItem, e: ReactMouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      const launchOrigin: LaunchOriginRect = {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      };
      void handleAliasOpen(shortcut, launchOrigin);
      clearSelection();
    },
    [handleAliasOpen, clearSelection]
  );

  const handleAppDoubleClick = useCallback(
    (app: AnyApp, e: ReactMouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      const launchOrigin: LaunchOriginRect = {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      };
      void trackLaunch(getDesktopAppItemId(app.id), () =>
        toggleApp(app.id, undefined, launchOrigin)
      );
      clearSelection();
    },
    [toggleApp, clearSelection, trackLaunch]
  );

  const handleTrashDoubleClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      localStorage.setItem("ryos:app:finder:initial-path", "/Trash");
      const finderApp = apps.find((app) => app.id === "finder");
      if (finderApp) {
        const rect = e.currentTarget.getBoundingClientRect();
        const launchOrigin: LaunchOriginRect = {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        };
        toggleApp(finderApp.id, undefined, launchOrigin);
      }
      clearSelection();
    },
    [apps, toggleApp, clearSelection]
  );

  const closeContextMenu = useCallback(() => {
    setContextMenuPos(null);
    setContextMenuAppId(null);
    setContextMenuShortcutPath(null);
  }, []);

  return {
    t,
    desktopRef,
    videoRef,
    wallpaperSource,
    isVideoWallpaper,
    finalStyles,
    longPressHandlers,
    handleBlankMouseDown,
    handleDesktopClick,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    desktopContextMenuHandler: (e: ReactMouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      setContextMenuPos({ x: e.clientX, y: e.clientY });
      setContextMenuAppId(null);
      setContextMenuShortcutPath(null);
      clearSelection();
    },
    hasWindowChrome,
    isWindowsTheme,
    isMacOSTheme,
    currentTheme,
    macintoshHdName,
    trashName: t("common.menu.trash"),
    trashIcon,
    desktopShortcuts,
    displayedApps,
    getDisplayName,
    getShortcutIcon,
    selectedItemIds,
    handleDesktopItemClick,
    handleFinderOpen,
    handleFolderOpen,
    loadingItemIds,
    folders,
    handleIconContextMenu,
    handleShortcutContextMenu,
    handlePrefetchShortcut,
    handleShortcutDoubleClick,
    handleAppDoubleClick,
    handleTrashDoubleClick,
    contextMenuPos,
    closeContextMenu,
    getContextMenuItems,
    isMarqueeSelecting,
    marqueeElementRef,
    isEmptyTrashDialogOpen,
    setIsEmptyTrashDialogOpen,
    confirmEmptyTrash,
  };
}
