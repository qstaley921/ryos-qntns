import { useTranslation } from "react-i18next";
import {
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarItem,
  MenubarSeparator,
  MenubarCheckboxItem,
} from "@/components/ui/menubar";
import { ShortcutHint } from "@/components/shared/menubar/ShortcutHint";
import { useLaunchApp } from "@/hooks/useLaunchApp";
import { useAppStoreShallow } from "@/stores/useAppStore";
import { useUndoRedoStore } from "@/stores/useUndoRedoStore";

export function DefaultMenuItems() {
  const { t } = useTranslation();
  const launchApp = useLaunchApp();

  const foregroundId = useAppStoreShallow((s) => s.foregroundInstanceId);
  const undoRedoEntry = useUndoRedoStore(
    (s) => (foregroundId ? s.handlers[foregroundId] : null)
  );

  const handleLaunchFinder = (path: string) => {
    launchApp("finder", { initialPath: path });
  };

  return (
    <>
      {/* File Menu */}
      <MenubarMenu>
        <MenubarTrigger className="text-md px-2 py-1 border-none focus-visible:ring-0">
          {t("common.menu.file")}
        </MenubarTrigger>
        <MenubarContent align="start" sideOffset={1} className="px-0">
          <MenubarItem
            onClick={() => handleLaunchFinder("/")}
            className="text-md h-6 px-3"
          >
            {t("apps.finder.menu.newFinderWindow")}
          </MenubarItem>
          <MenubarItem
            disabled
            className="text-md h-6 px-3"
          >
            {t("apps.finder.menu.newFolder")}
          </MenubarItem>
          <MenubarSeparator className="h-[2px] bg-black my-1" />
          <MenubarItem
            disabled
            className="text-md h-6 px-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t("apps.finder.menu.moveToTrash")}
          </MenubarItem>
          <MenubarItem
            disabled
            className="text-md h-6 px-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t("apps.finder.menu.emptyTrash")}
          </MenubarItem>
          <MenubarSeparator className="h-[2px] bg-black my-1" />
          <MenubarItem
            disabled
            className="text-md h-6 px-3"
          >
            {t("common.menu.close")}
            <ShortcutHint id="close" />
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      {/* Edit Menu */}
      <MenubarMenu>
        <MenubarTrigger className="text-md px-2 py-1 border-none focus-visible:ring-0">
          {t("common.menu.edit")}
        </MenubarTrigger>
        <MenubarContent align="start" sideOffset={1} className="px-0">
          <MenubarItem
            onClick={() => undoRedoEntry?.undo()}
            disabled={!undoRedoEntry?.canUndo}
            className={`text-md h-6 px-3 ${!undoRedoEntry?.canUndo ? "text-neutral-500" : ""}`}
          >
            {t("common.menu.undo")}
            <ShortcutHint id="undo" />
          </MenubarItem>
          <MenubarItem
            onClick={() => undoRedoEntry?.redo()}
            disabled={!undoRedoEntry?.canRedo}
            className={`text-md h-6 px-3 ${!undoRedoEntry?.canRedo ? "text-neutral-500" : ""}`}
          >
            {t("common.menu.redo")}
            <ShortcutHint id="redo" />
          </MenubarItem>
          <MenubarSeparator className="h-[2px] bg-black my-1" />
          <MenubarItem
            disabled
            className="text-md h-6 px-3"
          >
            {t("common.menu.cut")}
            <ShortcutHint id="cut" />
          </MenubarItem>
          <MenubarItem
            disabled
            className="text-md h-6 px-3"
          >
            {t("common.menu.copy")}
            <ShortcutHint id="copy" />
          </MenubarItem>
          <MenubarItem
            disabled
            className="text-md h-6 px-3"
          >
            {t("common.menu.paste")}
            <ShortcutHint id="paste" />
          </MenubarItem>
          <MenubarItem
            disabled
            className="text-md h-6 px-3"
          >
            {t("common.menu.clear")}
          </MenubarItem>
          <MenubarSeparator className="h-[2px] bg-black my-1" />
          <MenubarItem
            disabled
            className="text-md h-6 px-3"
          >
            {t("common.menu.selectAll")}
            <ShortcutHint id="selectAll" />
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      {/* View Menu */}
      <MenubarMenu>
        <MenubarTrigger className="text-md px-2 py-1 border-none focus-visible:ring-0">
          {t("common.menu.view")}
        </MenubarTrigger>
        <MenubarContent align="start" sideOffset={1} className="px-0">
          <MenubarCheckboxItem
            checked={false}
            disabled
            className="text-md h-6 px-3"
          >
            {t("apps.finder.menu.bySmallIcon")}
          </MenubarCheckboxItem>
          <MenubarCheckboxItem
            checked={true}
            disabled
            className="text-md h-6 px-3"
          >
            {t("apps.finder.menu.byIcon")}
          </MenubarCheckboxItem>
          <MenubarCheckboxItem
            checked={false}
            disabled
            className="text-md h-6 px-3"
          >
            {t("apps.finder.menu.byList")}
          </MenubarCheckboxItem>
          <MenubarSeparator className="h-[2px] bg-black my-1" />
          <MenubarCheckboxItem
            checked={true}
            disabled
            className="text-md h-6 px-3"
          >
            {t("apps.finder.menu.byName")}
          </MenubarCheckboxItem>
          <MenubarCheckboxItem
            checked={false}
            disabled
            className="text-md h-6 px-3"
          >
            {t("apps.finder.menu.byDate")}
          </MenubarCheckboxItem>
          <MenubarCheckboxItem
            checked={false}
            disabled
            className="text-md h-6 px-3"
          >
            {t("apps.finder.menu.bySize")}
          </MenubarCheckboxItem>
          <MenubarCheckboxItem
            checked={false}
            disabled
            className="text-md h-6 px-3"
          >
            {t("apps.finder.menu.byKind")}
          </MenubarCheckboxItem>
        </MenubarContent>
      </MenubarMenu>
    </>
  );
}
