import {
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarItem,
  MenubarSeparator,
  MenubarSub,
  MenubarSubTrigger,
  MenubarSubContent,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarCheckboxItem,
} from "@/components/ui/menubar";
import { AppMenuBarShell } from "@/components/shared/menubar/AppMenuBarShell";
import { ShortcutHint } from "@/components/shared/menubar/ShortcutHint";
import { MENUBAR_SEPARATOR_CLASS } from "@/components/shared/menubar/menubarStyles";
import { useAppMenuBarChrome } from "@/hooks/useAppMenuBarChrome";
import { useTranslation } from "react-i18next";
import { READER_FONTS, useReaderPrefs, type ReaderFont } from "@/stores/useTextEditStore";
import type { PostLinks } from "@/lib/ghost/postLinks";

// The font control names the real face (§53): the store's "QNTNs" label is OpenDyslexic.
export const fontLabel = (k: ReaderFont) => (k === "site" ? "OpenDyslexic" : READER_FONTS[k].label);

// §53a: the post's own music links (postLinks), the same Share menu iPod has (§55a).
const SHARE: [keyof PostLinks, string][] = [
  ["spotify", "Open on Spotify"],
  ["apple", "Open on Apple Podcasts"],
  ["youtube", "Open on YouTube"],
];

// What the View menu holds beyond size and font: Storybook alts the user settles (§12a).
export type ViewAlt = "base" | "width" | "comments";

const ITEM = "text-md h-6 px-3";
const TRIGGER = "text-md px-2 py-1 border-none focus-visible:ring-0";

export function GhostReaderMenuBar({
  onClose,
  onPrint,
  viewAlt,
  onBigger,
  onSmaller,
  onActualSize,
  canComment,
  commentsOpen,
  onToggleComments,
  links,
}: {
  links: PostLinks;
  onClose: () => void;
  onPrint?: () => void; // poems only; for other posts File › Print is hidden
  viewAlt: ViewAlt;
  onBigger: () => void;
  onSmaller: () => void;
  onActualSize: () => void;
  canComment: boolean;
  commentsOpen: boolean;
  onToggleComments: () => void;
}) {
  const { t } = useTranslation();
  const chrome = useAppMenuBarChrome("textedit");
  const { font, wide, update } = useReaderPrefs();

  return (
    <AppMenuBarShell
      isWindowsTheme={chrome.isWindowsTheme}
      isMacOSTheme={chrome.isMacOSTheme}
      appId={chrome.appId}
      appName={chrome.appName}
      isShareDialogOpen={chrome.isShareDialogOpen}
      setIsShareDialogOpen={chrome.setIsShareDialogOpen}
      helpItemLabel={t("apps.textedit.menu.texteditHelp")}
      aboutItemLabel={t("apps.textedit.menu.aboutTextEdit")}
      onShowHelp={() => {}}
      onShowAbout={() => {}}
    >
      <MenubarMenu>
        <MenubarTrigger className={TRIGGER}>{t("common.menu.file")}</MenubarTrigger>
        <MenubarContent align="start" sideOffset={1} className="px-0">
          {onPrint && (
            <MenubarItem onClick={onPrint} className={ITEM}>
              Print…
            </MenubarItem>
          )}
          <MenubarSub>
            <MenubarSubTrigger className={ITEM}>Share</MenubarSubTrigger>
            <MenubarSubContent className="px-0">
              {SHARE.map(([k, label]) => (
                <MenubarItem key={k} disabled={!links[k]} onClick={() => window.open(links[k], "_blank", "noopener")} className={ITEM}>
                  {label}
                </MenubarItem>
              ))}
              <MenubarItem onClick={() => chrome.setIsShareDialogOpen(true)} className={ITEM}>
                {t("common.menu.shareApp")}
              </MenubarItem>
            </MenubarSubContent>
          </MenubarSub>
          <MenubarSeparator className={MENUBAR_SEPARATOR_CLASS} />
          <MenubarItem onClick={onClose} className={ITEM}>
            {t("common.menu.close")}
            <ShortcutHint id="close" />
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger className={TRIGGER}>{t("common.menu.edit")}</MenubarTrigger>
        <MenubarContent align="start" sideOffset={1} className="px-0">
          <MenubarItem onClick={() => document.execCommand("copy")} className={ITEM}>
            {t("common.menu.copy")}
            <ShortcutHint id="copy" />
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger className={TRIGGER}>View</MenubarTrigger>
        <MenubarContent align="start" sideOffset={1} className="px-0">
          <MenubarItem onClick={onBigger} className={ITEM}>Bigger</MenubarItem>
          <MenubarItem onClick={onSmaller} className={ITEM}>Smaller</MenubarItem>
          <MenubarItem onClick={onActualSize} className={ITEM}>Actual Size</MenubarItem>
          <MenubarSeparator className={MENUBAR_SEPARATOR_CLASS} />
          <MenubarSub>
            <MenubarSubTrigger className={ITEM}>Font</MenubarSubTrigger>
            <MenubarSubContent className="px-0">
              <MenubarRadioGroup value={font} onValueChange={(v) => update({ font: v as ReaderFont })}>
                {(Object.keys(READER_FONTS) as ReaderFont[]).map((k) => (
                  <MenubarRadioItem key={k} value={k} className="text-md h-6 pr-3">
                    {fontLabel(k)}
                  </MenubarRadioItem>
                ))}
              </MenubarRadioGroup>
            </MenubarSubContent>
          </MenubarSub>
          {viewAlt === "width" && (
            <>
              <MenubarSeparator className={MENUBAR_SEPARATOR_CLASS} />
              <MenubarRadioGroup value={wide ? "wide" : "narrow"} onValueChange={(v) => update({ wide: v === "wide" })}>
                <MenubarRadioItem value="narrow" className="text-md h-6 pr-3">Narrow Column</MenubarRadioItem>
                <MenubarRadioItem value="wide" className="text-md h-6 pr-3">Wide Column</MenubarRadioItem>
              </MenubarRadioGroup>
            </>
          )}
          {viewAlt === "comments" && canComment && (
            <>
              <MenubarSeparator className={MENUBAR_SEPARATOR_CLASS} />
              <MenubarCheckboxItem checked={commentsOpen} onCheckedChange={onToggleComments} className={ITEM}>
                Show Comments
              </MenubarCheckboxItem>
            </>
          )}
        </MenubarContent>
      </MenubarMenu>

    </AppMenuBarShell>
  );
}
