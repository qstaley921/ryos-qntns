import { motion } from "motion/react";
import { memo, useMemo, type MouseEvent as ReactMouseEvent } from "react";
import { OsIconLabel } from "@/components/shared/OsIconLabel";
import { cn } from "@/lib/utils";
import { OS_SHELL_TEXT_SCALE_CLASS } from "@/lib/themeChrome";
import { prefetchAppChunk } from "@/config/lazyAppComponent";
import {
  getDesktopAppItemId,
  getDesktopShortcutItemId,
} from "./desktopConstants";
import type { DesktopItemId } from "./desktopTypes";

// Same motion as the dock's LOADING_BOUNCE (dock/DockIconButton.tsx).
const LOADING_BOUNCE = {
  repeat: Infinity,
  duration: 0.8,
  ease: "easeInOut",
  repeatType: "loop",
} as const;

function BounceWhileLoading({
  loading,
  itemId,
  children,
}: {
  loading: boolean;
  itemId: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      data-desktop-item-id={itemId}
      animate={
        loading
          ? { y: [0, -20, 0], transition: { y: LOADING_BOUNCE } }
          : { y: 0 }
      }
    >
      {children}
    </motion.div>
  );
}

export interface DesktopFolder {
  name: string;
  path: string;
  icon: string;
}

export interface DesktopIconGridProps {
  isWindowsTheme: boolean;
  isMacOSTheme: boolean;
  hasWindowChrome: boolean;
  macintoshHdName: string;
  folders: DesktopFolder[];
  /** Stable selection list — per-icon `isSelected` is derived so memo skips. */
  selectedItemIds: DesktopItemId[];
  /** Items whose launched instance is still loading; they bounce. */
  loadingItemIds: DesktopItemId[];
  onDesktopItemClick: (
    itemId: DesktopItemId,
    event: ReactMouseEvent<HTMLDivElement>
  ) => void;
  onFinderOpen: (e: ReactMouseEvent<HTMLDivElement>) => void;
  onIconContextMenu: (appId: string, e: ReactMouseEvent) => void;
  onFolderOpen: (
    path: string,
    e: ReactMouseEvent<HTMLDivElement>
  ) => void;
}

const DesktopMacintoshHdIcon = memo(function DesktopMacintoshHdIcon({
  name,
  isWindowsTheme,
  isSelected,
  isLoading,
  onDesktopItemClick,
  onFinderOpen,
  onIconContextMenu,
}: {
  name: string;
  isWindowsTheme: boolean;
  isSelected: boolean;
  isLoading: boolean;
  onDesktopItemClick: DesktopIconGridProps["onDesktopItemClick"];
  onFinderOpen: DesktopIconGridProps["onFinderOpen"];
  onIconContextMenu: DesktopIconGridProps["onIconContextMenu"];
}) {
  return (
    <BounceWhileLoading
      loading={isLoading}
      itemId={getDesktopAppItemId("macintosh-hd")}
    >
      <OsIconLabel
        name={name}
        isDirectory={true}
        icon={
          isWindowsTheme ? "/icons/default/pc.png" : "/icons/default/disk.png"
        }
        onClick={(e) =>
          onDesktopItemClick(getDesktopAppItemId("macintosh-hd"), e)
        }
        onDoubleClick={onFinderOpen}
        onPointerDown={() => prefetchAppChunk("finder")}
        onContextMenu={(e: ReactMouseEvent<HTMLDivElement>) =>
          onIconContextMenu("macintosh-hd", e)
        }
        isSelected={isSelected}
        size="large"
      />
    </BounceWhileLoading>
  );
});

const DesktopFolderIcon = memo(function DesktopFolderIcon({
  folder,
  isSelected,
  isLoading,
  onDesktopItemClick,
  onFolderOpen,
}: {
  folder: DesktopFolder;
  isSelected: boolean;
  isLoading: boolean;
  onDesktopItemClick: DesktopIconGridProps["onDesktopItemClick"];
  onFolderOpen: DesktopIconGridProps["onFolderOpen"];
}) {
  const id = getDesktopShortcutItemId(folder.path);
  return (
    <BounceWhileLoading loading={isLoading} itemId={id}>
      <OsIconLabel
        name={folder.name}
        isDirectory={true}
        icon={folder.icon}
        onClick={(e) => onDesktopItemClick(id, e)}
        onDoubleClick={(e) => onFolderOpen(folder.path, e)}
        onPointerDown={() => prefetchAppChunk("finder")}
        isSelected={isSelected}
        size="large"
      />
    </BounceWhileLoading>
  );
});

export const DesktopIconGrid = memo(function DesktopIconGrid({
  isWindowsTheme,
  isMacOSTheme,
  hasWindowChrome,
  macintoshHdName,
  folders,
  selectedItemIds,
  loadingItemIds,
  onDesktopItemClick,
  onFinderOpen,
  onIconContextMenu,
  onFolderOpen,
}: DesktopIconGridProps) {
  const selectedSet = useMemo(
    () => new Set(selectedItemIds),
    [selectedItemIds]
  );

  const loadingSet = useMemo(
    () => new Set(loadingItemIds),
    [loadingItemIds]
  );

  return (
    <div
      className={cn(
        "flex flex-col relative z-[1]",
        isMacOSTheme && OS_SHELL_TEXT_SCALE_CLASS,
        isWindowsTheme
          ? "items-start pt-2" // Reserve space via height, not padding, to avoid clipping
          : "items-end pt-8" // Account for top menubar - keep right alignment for other themes
      )}
      style={
        isWindowsTheme
          ? {
              // Exclude menubar, safe area, and an extra visual buffer to prevent clipping
              // Add extra top padding for desktop traffic lights on Windows themes
              height:
                "calc(100% - (30px + var(--menubar-safe-top, 0px) + var(--sat-safe-area-bottom) + 48px))",
              paddingTop: hasWindowChrome
                ? "calc(36px + var(--menubar-safe-top, 0px))"
                : "calc(0.5rem + var(--menubar-safe-top, 0px))",
              paddingLeft: "calc(0.25rem + var(--desktop-content-left, 0px))",
              paddingRight: "calc(0.5rem + var(--desktop-content-right, 0px))",
              paddingBottom: "env(safe-area-inset-bottom, 0px)",
            }
          : {
              height: "calc(100% - 2rem - var(--menubar-safe-top, 0px))",
              padding: "1rem",
              paddingTop: "calc(2rem + var(--menubar-safe-top, 0px))",
              paddingLeft: "calc(1rem + var(--desktop-content-left, 0px))",
              paddingRight: "calc(1rem + var(--desktop-content-right, 0px))",
              paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))",
            }
      }
    >
      <div
        className={
          isWindowsTheme
            ? "flex flex-col flex-wrap justify-start content-start h-full gap-x-3 gap-y-3"
            : "flex flex-col flex-wrap-reverse justify-start content-start h-full gap-x-3 gap-y-3"
        }
      >
        <DesktopMacintoshHdIcon
          name={macintoshHdName}
          isWindowsTheme={isWindowsTheme}
          isSelected={selectedSet.has(getDesktopAppItemId("macintosh-hd"))}
          isLoading={loadingSet.has(getDesktopAppItemId("macintosh-hd"))}
          onDesktopItemClick={onDesktopItemClick}
          onFinderOpen={onFinderOpen}
          onIconContextMenu={onIconContextMenu}
        />
        {folders.map((f) => (
          <DesktopFolderIcon
            key={f.path}
            folder={f}
            isSelected={selectedSet.has(getDesktopShortcutItemId(f.path))}
            isLoading={loadingSet.has(getDesktopShortcutItemId(f.path))}
            onDesktopItemClick={onDesktopItemClick}
            onFolderOpen={onFolderOpen}
          />
        ))}
      </div>
    </div>
  );
});
