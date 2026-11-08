import {
  CaretLeft,
  CaretRight,
  SquaresFour,
  List,
  GearSix,
  CaretDown,
  ArrowsDownUp,
} from "@phosphor-icons/react";
import { SearchInput } from "@/components/ui/search-input";
import { ToolbarButton, ToolbarButtonGroup } from "@/components/ui/toolbar-button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import type { SortType, ViewType } from "../FinderMenuBar";
import type { TFunction } from "i18next";

// Same options and labels as FinderMenuBar's sort items.
const SORT_OPTIONS: [SortType, string, string][] = [
  ["name", "apps.finder.menu.byName", "By Name"],
  ["date", "apps.finder.menu.byDate", "By Date"],
  ["size", "apps.finder.menu.bySize", "By Size"],
  ["kind", "apps.finder.menu.byKind", "By Kind"],
  ["viewed", "apps.finder.menu.byViewed", "By Viewed"],
  ["liked", "apps.finder.menu.byLiked", "By Liked"],
];

export interface FinderMacToolbarProps {
  t: TFunction;
  isAirDropView: boolean;
  currentPath: string;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  viewType: ViewType;
  setViewType: (view: ViewType) => void;
  canNavigateBack: () => boolean;
  canNavigateForward: () => boolean;
  canCreateFolder: boolean;
  navigateBack: () => void;
  navigateForward: () => void;
  navigateAwayFromAirDrop: () => void;
  navigateUp: () => void;
  handleNewFolder: () => void;
  handleImportFile: () => void;
  handleNewWindow: () => void;
  sortType: SortType;
  onSortTypeChange: (sortType: SortType) => void;
}

export function FinderMacToolbar({
  t,
  isAirDropView,
  currentPath,
  searchQuery,
  setSearchQuery,
  viewType,
  setViewType,
  canNavigateBack,
  canNavigateForward,
  canCreateFolder,
  navigateBack,
  navigateForward,
  navigateAwayFromAirDrop,
  navigateUp,
  handleNewFolder,
  handleImportFile,
  handleNewWindow,
  sortType,
  onSortTypeChange,
}: FinderMacToolbarProps) {
  return (
    <div
      className="flex items-center justify-between py-1.5 gap-2 px-1"
      style={{ background: "transparent" }}
    >
      <div className="flex items-center gap-1.5">
        <ToolbarButtonGroup>
          <ToolbarButton
            icon
            onClick={() => {
              if (isAirDropView) {
                navigateAwayFromAirDrop();
              } else {
                navigateBack();
              }
            }}
            disabled={!isAirDropView && !canNavigateBack()}
          >
            <CaretLeft size={14} weight="fill" className="scale-x-150 scale-y-90" />
          </ToolbarButton>
          <ToolbarButton icon onClick={navigateForward} disabled={!canNavigateForward()}>
            <CaretRight size={14} weight="fill" className="scale-x-150 scale-y-90" />
          </ToolbarButton>
        </ToolbarButtonGroup>
        <ToolbarButtonGroup>
          <ToolbarButton
            icon
            data-state={viewType === "large" ? "on" : "off"}
            onClick={() => setViewType("large")}
          >
            <SquaresFour size={14} />
          </ToolbarButton>
          <ToolbarButton
            icon
            data-state={viewType === "list" ? "on" : "off"}
            onClick={() => setViewType("list")}
          >
            <List size={14} />
          </ToolbarButton>
        </ToolbarButtonGroup>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <ToolbarButtonGroup>
              <ToolbarButton icon className="gap-0.5">
                <GearSix size={14} weight="fill" style={{ transform: "rotate(30deg)" }} />
                <CaretDown size={8} weight="bold" />
              </ToolbarButton>
            </ToolbarButtonGroup>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              className="text-md h-6 px-3"
              onClick={handleNewFolder}
              disabled={!canCreateFolder}
            >
              {t("apps.finder.contextMenu.newFolder")}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-md h-6 px-3" onClick={handleImportFile}>
              {t("apps.finder.menu.import")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-md h-6 px-3"
              onClick={navigateUp}
              disabled={currentPath === "/"}
            >
              {t("apps.finder.menu.goUp")}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-md h-6 px-3" onClick={handleNewWindow}>
              {t("apps.finder.menu.newWindow")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <ToolbarButtonGroup>
              <ToolbarButton icon className="gap-0.5">
                <ArrowsDownUp size={14} weight="bold" />
                <CaretDown size={8} weight="bold" />
              </ToolbarButton>
            </ToolbarButtonGroup>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={sortType}
              onValueChange={(v) => onSortTypeChange(v as SortType)}
            >
              {SORT_OPTIONS.map(([value, key, fallback]) => (
                <DropdownMenuRadioItem key={value} value={value} className="text-md h-6 px-3">
                  {t(key, fallback)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex-1" />
      <SearchInput value={searchQuery} onChange={setSearchQuery} width="150px" />
    </div>
  );
}
