import { RightClickMenu } from "@/components/ui/right-click-menu";
import { ConfirmDialog } from "@/components/dialogs/ConfirmDialog";
import type { DesktopProps } from "./desktopTypes";
import { useDesktop } from "./useDesktop";
import { DesktopIconGrid } from "./DesktopIconGrid";
import { DesktopDragRegion } from "./DesktopDragRegion";
import { DesktopDynamicWallpaper } from "./DesktopDynamicWallpaper";
import { DesktopStaticWallpaper } from "./DesktopStaticWallpaper";
import { useRef, type MouseEvent } from "react";
import { useAppStore } from "@/stores/useAppStore";

/**
 * §54 Show Desktop: a plain click on bare wallpaper (no icon, no drag-select,
 * no modifier) toggles desktopRevealed when a window is showing, or when the
 * desktop is already revealed. Focus, restore and launch clear it (store).
 */
function toggleRevealOnWallpaperClick(
  e: MouseEvent<HTMLDivElement>,
  down: { x: number; y: number } | null,
) {
  if (!down || e.button !== 0) return;
  if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
  if (Math.abs(e.clientX - down.x) > 3 || Math.abs(e.clientY - down.y) > 3) return;
  // Portaled menus/dialogs bubble through React but sit outside this DOM.
  if (!e.currentTarget.contains(e.target as Node)) return;
  if ((e.target as HTMLElement).closest("[data-desktop-icon]")) return;
  const s = useAppStore.getState();
  if (s.exposeMode) return;
  const anyShowing = Object.values(s.instances).some(
    (i) => i.isOpen && !i.isMinimized,
  );
  if (s.desktopRevealed || anyShowing) s.setDesktopRevealed(!s.desktopRevealed);
}

export function Desktop(props: DesktopProps) {
  const d = useDesktop(props);
  const downRef = useRef<{ x: number; y: number } | null>(null);

  return (
    <div
      ref={d.desktopRef}
      className="absolute inset-0 min-h-screen h-full z-[-1] desktop-background"
      onMouseDown={(e) => {
        downRef.current = { x: e.clientX, y: e.clientY };
        d.handleBlankMouseDown(e);
      }}
      onClick={(e) => {
        d.handleDesktopClick();
        toggleRevealOnWallpaperClick(e, downRef.current);
        downRef.current = null;
      }}
      onContextMenu={d.desktopContextMenuHandler}
      onDragOver={d.handleDragOver}
      onDragLeave={d.handleDragLeave}
      onDrop={d.handleDrop}
      style={d.finalStyles}
      {...d.longPressHandlers}
    >
      <DesktopStaticWallpaper />
      <video
        ref={d.videoRef}
        className="absolute inset-0 w-full h-full object-cover z-[-10]"
        src={d.isVideoWallpaper ? d.wallpaperSource || undefined : undefined}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        data-webkit-playsinline="true"
        style={{
          display: d.isVideoWallpaper ? "block" : "none",
        }}
      />
      <DesktopDynamicWallpaper />
      <DesktopDragRegion
        hasWindowChrome={d.hasWindowChrome}
        isWindowsTheme={d.isWindowsTheme}
      />
      <DesktopIconGrid
        isWindowsTheme={d.isWindowsTheme}
        isMacOSTheme={d.isMacOSTheme}
        hasWindowChrome={d.hasWindowChrome}
        macintoshHdName={d.macintoshHdName}
        folders={d.folders}
        selectedItemIds={d.selectedItemIds}
        loadingItemIds={d.loadingItemIds}
        onDesktopItemClick={d.handleDesktopItemClick}
        onFinderOpen={d.handleFinderOpen}
        onIconContextMenu={d.handleIconContextMenu}
        onFolderOpen={d.handleFolderOpen}
      />
      {d.isMarqueeSelecting ? (
        // Geometry is painted directly onto this element per pointer move
        // (see useDesktop) so the marquee never re-renders the desktop tree.
        <div
          ref={d.marqueeElementRef}
          className="pointer-events-none absolute z-[2] border"
          style={{
            left: 0,
            top: 0,
            width: 0,
            height: 0,
            borderColor: "rgba(128, 128, 128, 0.6)",
            backgroundColor: "rgba(128, 128, 128, 0.15)",
          }}
        />
      ) : null}
      <RightClickMenu
        position={d.contextMenuPos}
        onClose={d.closeContextMenu}
        items={d.getContextMenuItems()}
      />
      <ConfirmDialog
        isOpen={d.isEmptyTrashDialogOpen}
        onOpenChange={d.setIsEmptyTrashDialogOpen}
        onConfirm={d.confirmEmptyTrash}
        title={d.t("apps.finder.dialogs.emptyTrash.title")}
        description={d.t("apps.finder.dialogs.emptyTrash.description")}
      />
    </div>
  );
}
