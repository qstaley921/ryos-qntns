import {
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarItem,
  MenubarSeparator,
  MenubarCheckboxItem,
  MenubarSub,
  MenubarSubTrigger,
  MenubarSubContent,
} from "@/components/ui/menubar";
import { AppMenuBarShell } from "@/components/shared/menubar/AppMenuBarShell";
import { ShortcutHint } from "@/components/shared/menubar/ShortcutHint";
import { MENUBAR_SEPARATOR_CLASS } from "@/components/shared/menubar/menubarStyles";
import { useAppMenuBarChrome } from "@/hooks/useAppMenuBarChrome";
import { FileItem } from "./FileList";
import { useTranslation } from "react-i18next";
import { useInstanceUndoRedo } from "@/hooks/useUndoRedo";
import { isProtectedSystemPath } from "@/services/vfs/pathPolicy";

export type ViewType = "small" | "large" | "list";
export type SortType = "name" | "date" | "size" | "kind" | "viewed" | "liked";
export type ReadFilter = "all" | "unread" | "read";

export interface FinderMenuBarProps {
  onClose: () => void;
  onShowHelp: () => void;
  onShowAbout: () => void;
  viewType: ViewType;
  onViewTypeChange: (viewType: ViewType) => void;
  sortType: SortType;
  onSortTypeChange: (sortType: SortType) => void;
  readFilter?: ReadFilter;
  onReadFilterChange?: (f: ReadFilter) => void;
  selectedFile?: FileItem;
  onMoveToTrash: (file: FileItem) => void;
  onEmptyTrash: () => void;
  onRestore: () => void;
  isTrashEmpty: boolean;
  isInTrash: boolean;
  onImportFile?: () => void;
  onRename?: () => void;
  onDuplicate?: () => void;
  onNewFolder?: () => void;
  canCreateFolder?: boolean;
  onNewWindow?: () => void;
  instanceId?: string;
  showSidebar?: boolean;
  onToggleSidebar?: () => void;
}

export function FinderMenuBar({
  onClose,
  onShowHelp,
  onShowAbout,
  viewType,
  onViewTypeChange,
  sortType,
  onSortTypeChange,
  readFilter = "all",
  onReadFilterChange,
  selectedFile,
  onMoveToTrash,
  onEmptyTrash,
  onRestore,
  isTrashEmpty,
  isInTrash,
  onImportFile,
  onRename,
  onDuplicate,
  onNewFolder,
  canCreateFolder = false,
  onNewWindow,
  instanceId,
  showSidebar,
  onToggleSidebar,
}: FinderMenuBarProps) {
  const { t } = useTranslation();
  const {
    isShareDialogOpen,
    setIsShareDialogOpen,
    isWindowsTheme,
    isMacOSTheme,
    appId,
    appName,
  } = useAppMenuBarChrome("finder");
  const { canUndo, canRedo, undo, redo } = useInstanceUndoRedo(instanceId || "");

  const canMoveToTrash =
    selectedFile &&
    selectedFile.path !== "/Trash" &&
    !selectedFile.path.startsWith("/Trash/") &&
    // Prevent system-managed root folders from being moved to trash
    // (user-created root folders remain trashable)
    !isProtectedSystemPath(selectedFile.path) &&
    // Prevent virtual items (apps, songs, sites) from being moved to trash
    !selectedFile.type?.includes("virtual") &&
    // Prevent applications from being moved to trash
    !selectedFile.path.startsWith("/Applications/");

  const canRename = selectedFile && onRename && canMoveToTrash;
  const canDuplicate =
    canCreateFolder && selectedFile && onDuplicate && !selectedFile.isDirectory;

  return (
    <AppMenuBarShell
      isWindowsTheme={isWindowsTheme}
      isMacOSTheme={isMacOSTheme}
      appId={appId}
      appName={appName}
      isShareDialogOpen={isShareDialogOpen}
      setIsShareDialogOpen={setIsShareDialogOpen}
      helpItemLabel={t("apps.finder.menu.finderHelp")}
      aboutItemLabel={t("apps.finder.menu.aboutFinder")}
      onShowHelp={onShowHelp}
      onShowAbout={onShowAbout}
    >
      {/* File Menu */}
      <MenubarMenu>
        <MenubarTrigger className="text-md px-2 py-1 border-none focus-visible:ring-0">
          {t("common.menu.file")}
        </MenubarTrigger>
        <MenubarContent align="start" sideOffset={1} className="px-0">
          <MenubarItem
            onClick={onNewWindow}
            className="text-md h-6 px-3"
          >
            {t("apps.finder.menu.newFinderWindow")}
            <ShortcutHint id="newWindow" />
          </MenubarItem>
          <MenubarItem
            onClick={onNewFolder}
            disabled={!canCreateFolder}
            className="text-md h-6 px-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t("apps.finder.menu.newFolder")}
            <ShortcutHint id="newFolder" />
          </MenubarItem>
          <MenubarItem
            onClick={onImportFile}
            disabled={!canCreateFolder}
            className="text-md h-6 px-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t("apps.finder.menu.importFromDevice")}
          </MenubarItem>
          <MenubarSeparator className={MENUBAR_SEPARATOR_CLASS} />
          <MenubarItem
            onClick={onRename}
            disabled={!canRename}
            className="text-md h-6 px-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t("apps.finder.menu.rename")}
          </MenubarItem>
          <MenubarItem
            onClick={onDuplicate}
            disabled={!canDuplicate}
            className="text-md h-6 px-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t("apps.finder.menu.duplicate")}
          </MenubarItem>
          <MenubarSeparator className={MENUBAR_SEPARATOR_CLASS} />
          {isInTrash ? (
            <MenubarItem
              onClick={onRestore}
              className="text-md h-6 px-3"
            >
              {t("apps.finder.menu.putBack")}
            </MenubarItem>
          ) : (
            <MenubarItem
              onClick={() => canMoveToTrash && onMoveToTrash(selectedFile!)}
              disabled={!canMoveToTrash}
              className="text-md h-6 px-3 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t("apps.finder.menu.moveToTrash")}
            </MenubarItem>
          )}
          <MenubarItem
            onClick={onEmptyTrash}
            disabled={isTrashEmpty}
            className="text-md h-6 px-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t("apps.finder.menu.emptyTrash")}
          </MenubarItem>
          <MenubarSeparator className={MENUBAR_SEPARATOR_CLASS} />
          <MenubarSub>
            <MenubarSubTrigger className="text-md h-6 px-3">
              {t("common.menu.edit")}
            </MenubarSubTrigger>
            <MenubarSubContent>
              <MenubarItem
                onClick={undo}
                disabled={!canUndo}
                className="text-md h-6 px-3 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t("common.menu.undo")}
                <ShortcutHint id="undo" />
              </MenubarItem>
              <MenubarItem
                onClick={redo}
                disabled={!canRedo}
                className="text-md h-6 px-3 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t("common.menu.redo")}
                <ShortcutHint id="redo" />
              </MenubarItem>
            </MenubarSubContent>
          </MenubarSub>
          <MenubarSeparator className={MENUBAR_SEPARATOR_CLASS} />
          <MenubarItem
            onClick={onClose}
            className="text-md h-6 px-3"
          >
            {t("common.menu.close")}
            <ShortcutHint id="close" />
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      {/* View Menu */}
      <MenubarMenu>
        <MenubarTrigger className="text-md px-2 py-1 border-none focus-visible:ring-0">
          {t("common.menu.view")}
        </MenubarTrigger>
        <MenubarContent align="start" sideOffset={1} className="px-0">
          {isMacOSTheme && onToggleSidebar && (
            <>
              <MenubarCheckboxItem
                checked={showSidebar}
                onCheckedChange={() => onToggleSidebar()}
                className="text-md h-6 px-3"
              >
                {t("apps.finder.menu.sidebar")}
              </MenubarCheckboxItem>
              <MenubarSeparator className={MENUBAR_SEPARATOR_CLASS} />
            </>
          )}
          <MenubarCheckboxItem
            checked={viewType === "small"}
            onCheckedChange={(checked) => {
              if (checked) onViewTypeChange("small");
            }}
            className="text-md h-6 px-3"
          >
            {t("apps.finder.menu.bySmallIcon")}
          </MenubarCheckboxItem>
          <MenubarCheckboxItem
            checked={viewType === "large"}
            onCheckedChange={(checked) => {
              if (checked) onViewTypeChange("large");
            }}
            className="text-md h-6 px-3"
          >
            {t("apps.finder.menu.byIcon")}
          </MenubarCheckboxItem>
          <MenubarCheckboxItem
            checked={viewType === "list"}
            onCheckedChange={(checked) => {
              if (checked) onViewTypeChange("list");
            }}
            className="text-md h-6 px-3"
          >
            {t("apps.finder.menu.byList")}
          </MenubarCheckboxItem>
          <MenubarSeparator className={MENUBAR_SEPARATOR_CLASS} />
          <MenubarCheckboxItem
            checked={sortType === "name"}
            onCheckedChange={(checked) => {
              if (checked) onSortTypeChange("name");
            }}
            className="text-md h-6 px-3"
          >
            {t("apps.finder.menu.byName")}
          </MenubarCheckboxItem>
          <MenubarCheckboxItem
            checked={sortType === "date"}
            onCheckedChange={(checked) => {
              if (checked) onSortTypeChange("date");
            }}
            className="text-md h-6 px-3"
          >
            {t("apps.finder.menu.byDate")}
          </MenubarCheckboxItem>
          <MenubarCheckboxItem
            checked={sortType === "size"}
            onCheckedChange={(checked) => {
              if (checked) onSortTypeChange("size");
            }}
            className="text-md h-6 px-3"
          >
            {t("apps.finder.menu.bySize")}
          </MenubarCheckboxItem>
          <MenubarCheckboxItem
            checked={sortType === "kind"}
            onCheckedChange={(checked) => {
              if (checked) onSortTypeChange("kind");
            }}
            className="text-md h-6 px-3"
          >
            {t("apps.finder.menu.byKind")}
          </MenubarCheckboxItem>
          <MenubarCheckboxItem
            checked={sortType === "viewed"}
            onCheckedChange={(checked) => {
              if (checked) onSortTypeChange("viewed");
            }}
            className="text-md h-6 px-3"
          >
            {t("apps.finder.menu.byViewed", "By Viewed")}
          </MenubarCheckboxItem>
          <MenubarCheckboxItem
            checked={sortType === "liked"}
            onCheckedChange={(checked) => {
              if (checked) onSortTypeChange("liked");
            }}
            className="text-md h-6 px-3"
          >
            {t("apps.finder.menu.byLiked", "By Liked")}
          </MenubarCheckboxItem>
          {onReadFilterChange && (
            <>
              <MenubarSeparator className={MENUBAR_SEPARATOR_CLASS} />
              <MenubarCheckboxItem
                checked={readFilter === "all"}
                onCheckedChange={(checked) => {
                  if (checked) onReadFilterChange("all");
                }}
                className="text-md h-6 px-3"
              >
                {t("apps.finder.menu.showAll", "Show All")}
              </MenubarCheckboxItem>
              <MenubarCheckboxItem
                checked={readFilter === "unread"}
                onCheckedChange={(checked) => {
                  if (checked) onReadFilterChange("unread");
                }}
                className="text-md h-6 px-3"
              >
                {t("apps.finder.menu.showUnread", "Show Unread")}
              </MenubarCheckboxItem>
              <MenubarCheckboxItem
                checked={readFilter === "read"}
                onCheckedChange={(checked) => {
                  if (checked) onReadFilterChange("read");
                }}
                className="text-md h-6 px-3"
              >
                {t("apps.finder.menu.showRead", "Show Read")}
              </MenubarCheckboxItem>
            </>
          )}
        </MenubarContent>
      </MenubarMenu>

    </AppMenuBarShell>
  );
}
