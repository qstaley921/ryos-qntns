import { MenubarMenu, MenubarTrigger, MenubarContent, MenubarItem } from "@/components/ui/menubar";
import { useIpodStore } from "@/stores/useIpodStore";
import { trackHtml } from "@/stores/ipodGhostTracks";
import { postLinks, type PostLinks } from "@/lib/ghost/postLinks";
import type { IpodMenuBarViewModel } from "./useIpodMenuBar";

const ITEMS: [keyof PostLinks, string, string][] = [
  ["spotify", "apps.ipod.menu.openOnSpotify", "Open on Spotify"],
  ["apple", "apps.ipod.menu.openOnApplePodcasts", "Open on Apple Podcasts"],
  ["youtube", "apps.ipod.menu.openOnYouTube", "Open on YouTube"],
];

// Share (CHECKLIST-36 §55a): the playing post's own links; a link it lacks is disabled.
export function IpodMenuBarShareMenu({ vm }: { vm: IpodMenuBarViewModel }) {
  const id = useIpodStore((s) => s.currentSongId);
  const links = postLinks(id ? trackHtml.get(id) : null);
  return (
    <MenubarMenu>
      <MenubarTrigger className="px-2 py-1 text-md focus-visible:ring-0">
        {vm.t("apps.ipod.menu.share", "Share")}
      </MenubarTrigger>
      <MenubarContent align="start" sideOffset={1} className="px-0">
        {ITEMS.map(([kind, key, label]) => (
          <MenubarItem
            key={kind}
            disabled={!links[kind]}
            onClick={() => window.open(links[kind], "_blank", "noopener")}
            className="text-md h-6 px-3 whitespace-nowrap"
          >
            {vm.t(key, label)}
          </MenubarItem>
        ))}
      </MenubarContent>
    </MenubarMenu>
  );
}
