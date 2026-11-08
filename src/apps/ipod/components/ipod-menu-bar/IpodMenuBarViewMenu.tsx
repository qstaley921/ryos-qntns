import {
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarItem,
  MenubarSeparator,
} from "@/components/ui/menubar";
import { MediaLyricsViewMenuItems } from "@/components/shared/menubar/MediaLyricsViewMenuItems";
import { MENUBAR_SEPARATOR_CLASS } from "@/components/shared/menubar/menubarStyles";
import type { IpodMenuBarViewModel } from "./useIpodMenuBar";

export function IpodMenuBarViewMenu({ vm }: { vm: IpodMenuBarViewModel }) {
  return (
    <>
      <MenubarMenu>
        <MenubarTrigger className="px-2 py-1 text-md focus-visible:ring-0">
          {vm.t("apps.ipod.menu.view")}
        </MenubarTrigger>
        <MenubarContent align="start" sideOffset={1} className="px-0">
          <MediaLyricsViewMenuItems
            t={vm.t}
            showLyricsLabel={vm.t("apps.ipod.menu.showLyrics")}
            showLyrics={vm.showLyrics}
            onToggleLyrics={() => vm.toggleLyrics()}
            lyricsAlignment={vm.lyricsAlignment}
            setLyricsAlignment={vm.setLyricsAlignment}
            lyricsFont={vm.lyricsFont}
            setLyricsFont={vm.setLyricsFont}
            romanization={vm.romanization}
            setRomanization={vm.setRomanization}
            lyricsTranslationLanguage={vm.lyricsTranslationLanguage}
            setLyricsTranslationLanguage={vm.setLyricsTranslationLanguage}
            translationLanguages={vm.translationLanguages}
            displayMode={vm.effectiveDisplayMode}
            setDisplayMode={vm.setDisplayMode}
            hideVideoOption={vm.isAppleMusic}
            onRefreshLyrics={vm.onRefreshLyrics || vm.refreshLyrics}
            onAdjustTiming={vm.onAdjustTiming}
            clearLyricsCache={vm.clearLyricsCache}
            tracks={vm.tracks}
            currentIndex={vm.currentIndex}
            debugMode={vm.debugMode}
            isAdmin={vm.isAdmin}
          />

          {/* QNTNs §55c: backlight is always on; the UI theme and device theme pickers are gone (green mini only). */}
          <MenubarSeparator className={MENUBAR_SEPARATOR_CLASS} />

          <MenubarItem
            onClick={() => vm.onToggleCoverFlow?.()}
            className="text-md h-6 px-3"
            disabled={vm.tracks.length === 0}
          >
            {vm.t("apps.ipod.menu.coverFlow")}
          </MenubarItem>
          <MenubarItem
            onClick={() => vm.toggleFullScreen()}
            className="text-md h-6 px-3"
          >
            {vm.t("apps.ipod.menu.fullScreen")}
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>
    </>
  );
}
