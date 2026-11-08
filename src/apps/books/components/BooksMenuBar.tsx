import { useTranslation } from "react-i18next";
import { AppMenuBarShell } from "@/components/shared/menubar/AppMenuBarShell";
import {
  AppMenuBarMenus,
  type MenuDescriptor,
} from "@/components/shared/menubar/AppMenuBarMenus";
import { useAppMenuBarChrome } from "@/hooks/useAppMenuBarChrome";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import {
  BOOK_FONTS,
  type BookFontOption,
} from "../utils/booksReader";
import {
  isChineseBookLanguage,
  isCjkBookLanguage,
} from "../utils/booksLanguage";
import { buildBooksMenuLayout } from "../utils/booksMenuLayout";
import {
  BOOKS_SPEECH_RATE_OPTIONS,
  normalizeBooksSpeechRate,
  type BooksReaderSettings,
} from "@/stores/useBooksStore";
import type { BooksNavigationState } from "./BooksReaderPane";

interface BooksMenuBarProps {
  onClose: () => void;
  onShowHelp: () => void;
  onShowAbout: () => void;
  onImport: () => void;
  onBackToShelf: () => void;
  onShowCustomize: () => void;
  isReading: boolean;
  /** EPUB package language; gates CJK-only reader options. */
  bookLanguage?: string | null;
  settings: BooksReaderSettings;
  updateSettings: (partial: Partial<BooksReaderSettings>) => void;
  navigationState: BooksNavigationState;
  onGoToChapter: (href: string) => void;
  isSpeaking: boolean;
  onStartSpeaking: () => void;
  onStopSpeaking: () => void;
}

export function BooksMenuBar({
  onClose,
  onShowHelp,
  onShowAbout,
  onImport,
  onBackToShelf,
  onShowCustomize,
  isReading,
  bookLanguage = null,
  settings,
  updateSettings,
  navigationState,
  onGoToChapter,
  isSpeaking,
  onStartSpeaking,
  onStopSpeaking,
}: BooksMenuBarProps) {
  const { t } = useTranslation();
  const isCompactMenu = useMediaQuery("(max-width: 768px)");
  const {
    isShareDialogOpen,
    setIsShareDialogOpen,
    isWindowsTheme,
    isMacOSTheme,
    appId,
    appName,
  } = useAppMenuBarChrome("books");

  const fileMenu: MenuDescriptor = {
      label: t("common.menu.file"),
      items: [
        {
          type: "action",
          label: t("apps.books.menu.import"),
          onClick: onImport,
        },
        {
          type: "action",
          label: t("apps.books.menu.backToShelf"),
          onClick: onBackToShelf,
          disabled: !isReading,
        },
        { type: "separator" },
        {
          type: "action",
          label: t("common.menu.close"),
          onClick: onClose,
          shortcutId: "close",
        },
      ],
    };

  // Vertical writing mode is CJK-only; simp/trad conversion is Chinese-only.
  const supportsVerticalText =
    isReading && isCjkBookLanguage(bookLanguage);
  const supportsChineseScript =
    isReading && isChineseBookLanguage(bookLanguage);

  const canNavigateReader = isReading && navigationState.isReady;
  const chapters = navigationState.chapters ?? [];
  const viewMenu: MenuDescriptor = {
      label: t("common.menu.view"),
      items: [
        // Contents moved here from the dropped Go menu (CHECKLIST-36 §14e, §14f).
        {
          type: "submenu",
          label: "Contents",
          disabled: !canNavigateReader || chapters.length === 0,
          contentClassName:
            "max-w-[260px] sm:max-w-[320px] max-h-[400px] overflow-y-auto",
          items: [
            {
              type: "radioGroup",
              value:
                navigationState.currentChapterIndex >= 0
                  ? String(navigationState.currentChapterIndex)
                  : "",
              onValueChange: (value) => {
                const chapter = chapters[Number(value)];
                if (chapter) onGoToChapter(chapter.href);
              },
              options: chapters.map((chapter, index) => ({
                value: String(index),
                label: (
                  <span
                    className="truncate min-w-0"
                    style={{ paddingLeft: `${chapter.depth * 12}px` }}
                  >
                    {chapter.label}
                  </span>
                ),
                className:
                  "text-md h-6 pr-3 truncate max-w-[260px] sm:max-w-[320px]",
              })),
            },
          ],
        },
        { type: "separator" },
        {
          type: "submenu",
          label: t("apps.books.menu.font"),
          items: [
            {
              type: "radioGroup",
              value: settings.fontId,
              onValueChange: (value) => updateSettings({ fontId: value }),
              options: BOOK_FONTS.map((font: BookFontOption) => ({
                label: t(`apps.books.fonts.${font.id}`),
                value: font.id,
              })),
            },
          ],
        },
        ...(supportsVerticalText
          ? ([
              {
                type: "submenu",
                label: t("apps.books.menu.textLayout"),
                items: [
                  {
                    type: "radioGroup",
                    value: settings.textLayout,
                    onValueChange: (value) => {
                      if (value === "book" || value === "vertical") {
                        updateSettings({ textLayout: value });
                      }
                    },
                    options: [
                      {
                        label: t("apps.books.textLayout.book"),
                        value: "book",
                      },
                      {
                        label: t("apps.books.textLayout.vertical"),
                        value: "vertical",
                      },
                    ],
                  },
                ],
              },
            ] as MenuDescriptor["items"])
          : []),
        ...(supportsChineseScript
          ? ([
              {
                type: "submenu",
                label: t("apps.books.menu.chineseScript"),
                items: [
                  {
                    type: "radioGroup",
                    value: settings.chineseScript,
                    onValueChange: (value) =>
                      updateSettings({
                        chineseScript:
                          value as BooksReaderSettings["chineseScript"],
                      }),
                    options: [
                      {
                        label: t("apps.books.chineseScript.original"),
                        value: "original",
                      },
                      {
                        label: t("apps.books.chineseScript.simplified"),
                        value: "simplified",
                      },
                      {
                        label: t("apps.books.chineseScript.traditional"),
                        value: "traditional",
                      },
                    ],
                  },
                ],
              },
            ] as MenuDescriptor["items"])
          : []),
        {
          type: "submenu",
          label: t("apps.books.menu.theme"),
          items: [
            {
              type: "radioGroup",
              value: settings.themeOverride,
              onValueChange: (value) =>
                updateSettings({
                  themeOverride:
                    value as BooksReaderSettings["themeOverride"],
                }),
              options: [
                { label: t("apps.books.theme.auto"), value: "auto" },
                { label: t("apps.books.theme.accent"), value: "accent" },
                { label: t("apps.books.theme.light"), value: "light" },
                { label: t("apps.books.theme.sepia"), value: "sepia" },
                { label: t("apps.books.theme.dark"), value: "dark" },
                { label: t("apps.books.theme.custom"), value: "custom" },
              ],
            },
          ],
        },
        { type: "separator" },
        {
          type: "action",
          label: t("apps.books.menu.customizeTheme"),
          onClick: onShowCustomize,
        },
      ],
    };

  const speechRateLabels: Record<string, string> = {
    "0.8": t("apps.books.speechRate.slow"),
    "1": t("apps.books.speechRate.normal"),
    "1.2": t("apps.books.speechRate.fast"),
    "1.5": t("apps.books.speechRate.veryFast"),
  };
  const speechMenu: MenuDescriptor = {
    label: t("apps.books.menu.speech"),
    items: [
      {
        type: "action",
        label: t("apps.books.menu.startSpeaking"),
        onClick: onStartSpeaking,
        disabled: !canNavigateReader || isSpeaking,
      },
      {
        type: "action",
        label: t("apps.books.menu.stopSpeaking"),
        onClick: onStopSpeaking,
        disabled: !isSpeaking,
      },
      { type: "separator" },
      {
        type: "submenu",
        label: t("apps.books.menu.speechRate"),
        items: [
          {
            type: "radioGroup",
            value: String(normalizeBooksSpeechRate(settings.speechRate)),
            onValueChange: (value) => {
              const rate = Number(value);
              if (Number.isFinite(rate) && rate > 0) {
                updateSettings({ speechRate: rate });
              }
            },
            options: BOOKS_SPEECH_RATE_OPTIONS.map((rate) => ({
              label: speechRateLabels[String(rate)] ?? `${rate}×`,
              value: String(rate),
            })),
          },
        ],
      },
    ],
  };

  const menus = buildBooksMenuLayout({
    fileMenu,
    viewMenu,
    speechMenu,
    isCompact: isCompactMenu,
  });

  return (
    <AppMenuBarShell
      isWindowsTheme={isWindowsTheme}
      isMacOSTheme={isMacOSTheme}
      appId={appId}
      appName={appName}
      isShareDialogOpen={isShareDialogOpen}
      setIsShareDialogOpen={setIsShareDialogOpen}
      helpItemLabel={t("apps.books.menu.booksHelp")}
      aboutItemLabel={t("apps.books.menu.aboutBooks")}
      onShowHelp={onShowHelp}
      onShowAbout={onShowAbout}
    >
      <AppMenuBarMenus menus={menus} />
    </AppMenuBarShell>
  );
}
