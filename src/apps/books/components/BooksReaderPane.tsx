import { getFileContentSyncKey } from "@/utils/indexedDBOperations";
import { BookLoadingProgress } from "./BookLoadingProgress";
import { useFileAvailability } from "@/sync/fileAvailability";
import { useFilesStore } from "@/stores/useFilesStore";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  CaretLeft,
  CaretRight,
  Check,
  Copy,
  FastForward,
  Pause,
  Play,
  Rewind,
  Stop,
  TextAa,
  X,
} from "@phosphor-icons/react";
import ePub, {
  EpubCFI,
  type Book,
  type Contents,
  type NavItem,
  type Rendition,
} from "epubjs";
import { cn } from "@/lib/utils";
import { useResizeObserverWithRef } from "@/hooks/useResizeObserver";
import { readBookBlobContent } from "@/services/vfs/FileContentRepository";
import {
  clampBooksGutter,
  normalizeBooksSpeechRate,
  type BookBookmark,
  type BooksReaderSettings,
} from "@/stores/useBooksStore";
import { useDisplaySettingsStore } from "@/stores/useDisplaySettingsStore";
import { useThemeFlags } from "@/hooks/useThemeFlags";
import { useThemeStore } from "@/stores/useThemeStore";
import {
  applyEpubTheme,
  buildEpubTheme,
  buildFontFaceCss,
  columnModeToSpread,
  createEpubThemeContentHook,
  displayEpubTargetWithFallback,
  getReadingOverlayBackground,
  isLikelyEpubBuffer,
  reflowEpubAfterFontsSettle,
  resolveEpubDisplayFallbackTarget,
  resolveOsAccentBaseHex,
  resolveReadingPalette,
} from "../utils/booksReader";
import {
  normalizeBookLanguage,
  resolveEffectiveChineseScript,
  resolveEffectiveTextLayout,
} from "../utils/booksLanguage";
import {
  applyChineseScriptToDocument,
  createChineseScriptConversionSession,
  resolveChineseScriptReadingLanguage,
} from "../utils/chineseScriptConverter";
import {
  applyEpubTextLayout,
  resolveEpubPageDirection,
} from "../utils/booksTextLayout";
import { sanitizeEpubSectionDocument } from "../utils/booksContentSanitizer";
import {
  BOOKS_SPEECH_HIGHLIGHT_CSS,
  getVisiblePageRange,
} from "../utils/booksSpeech";
import { useBooksSpeech } from "../hooks/useBooksSpeech";
import {
  BOOKS_SELECTION_CONTENT_CSS,
  useBooksAnnotations,
} from "../hooks/useBooksAnnotations";
import {
  readVisiblePageCfi,
  reportedCfiOnVisiblePage,
  resolveSyncedPageProgress,
  type SyncedPageProgress,
} from "../utils/booksPageProgress";
import {
  BOOKS_SPEECH_BAR_AUTO_REVEAL_MS,
  useBooksSpeechBarVisibility,
} from "../hooks/useBooksSpeechBarVisibility";
import {
  ryOSLocaleToSpeechLanguage,
} from "@/utils/browserSpeech";
import { useBookCover } from "../utils/useBookCover";
import { BookCover } from "./BookCover";
import type {
  BooksLibraryEntry,
  BookOriginRect,
} from "../hooks/useBooksLogic";
import { createClientLogger, summarizeForLog } from "@/utils/logger";
import { Sounds, useSound } from "@/hooks/useSound";
import {
  BOOKS_EDGE_TAP_RATIO,
  resolveBooksEdgeTapDirection,
} from "../utils/booksEdgeTap";
import {
  resolveBooksSwipeDirection,
} from "../utils/booksSwipe";
import {
  cfiToKoXPath,
  koXPathToCfi,
} from "../utils/kosyncProgressAnchor";

const booksLog = createClientLogger("BooksReader");

interface BooksReaderPaneProps {
  entry: BooksLibraryEntry;
  /** EPUB bytes from somewhere other than the VFS (a qntns.com book built in
   *  memory, CHECKLIST-36 §14f). Null shows the reader's error screen. */
  loadBlob?: () => Promise<Blob | null>;
  settings: BooksReaderSettings;
  osIsDark: boolean;
  /** Page-space rect of the clicked shelf cover, to zoom in from. */
  originRect?: BookOriginRect | null;
  initialCfi?: string;
  /** CrossPoint KO-style XPath when CFI is unavailable (KOSync inbound). */
  initialKosyncProgress?: string;
  /** Cached reading progress (0..1) so the footer shows it without a 0% flash. */
  initialPercentage?: number;
  onProgress: (
    cfi: string,
    percentage: number,
    kosyncProgress?: string
  ) => void;
  onNavigationStateChange?: (state: BooksNavigationState) => void;
  onSpeechStateChange?: (isSpeaking: boolean) => void;
  /** EPUB metadata language once known (drives CJK-only menus / features). */
  onBookLanguageChange?: (language: string | null) => void;
  /** Opens the reading-appearance Customize panel (playback bar shortcut). */
  onShowCustomize?: () => void;
  /** Closes the reading-appearance Customize panel. */
  onHideCustomize?: () => void;
  /** Keeps the read-aloud toolbar expanded while Customize is open. */
  isCustomizeOpen?: boolean;
  /** Saved page bookmarks for this book. */
  bookmarks: BookBookmark[];
  onAddBookmark: (bookmark: BookBookmark) => void;
  onRemoveBookmark: (cfi: string) => void;
  /** Whether the current page holds a bookmark (drives the menu label). */
  onBookmarkStateChange?: (isBookmarked: boolean) => void;
  /** Leave the reader and return to the bookshelf (error-screen CTA). */
  onBackToShelf: () => void;
}

const clamp01 = (value: number): number =>
  Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

export interface BooksChapterNavigationItem {
  id: string;
  label: string;
  href: string;
  depth: number;
}

export interface BooksNavigationState {
  isReady: boolean;
  canGoPreviousPage: boolean;
  canGoNextPage: boolean;
  chapters: BooksChapterNavigationItem[];
  currentChapterIndex: number;
}

export interface BooksReaderPaneHandle {
  goToPreviousPage: () => void;
  goToNextPage: () => void;
  goToChapter: (href: string) => void;
  goToCfi: (cfi: string) => void;
  toggleBookmark: () => void;
  startSpeaking: () => void;
  stopSpeaking: () => void;
}

interface ZoomRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface FlipState {
  dir: "next" | "prev";
  id: number;
}

type BooksDebugLevel = "info" | "warn" | "error";
type BooksDebugSnapshot = Record<string, unknown>;

// Extra top clearance so the page never sits under the hover-revealed window
// titlebar (the window uses the full-bleed "notitlebar" material).
const TOP_CLEARANCE = 36;
// Footer that holds the reading-progress bar.
const FOOTER_HEIGHT = 30;
// The horizontal gutter around the text column comes from
// `settings.gutterPx` (user-adjustable in the Customize panel). It is applied
// as a left/right inset on the epub.js render host (rather than body padding)
// so epub.js's paginated column math stays correct — it computes columns from
// the host width.
// Width at which auto column mode switches to a two-page spread. epub.js
// defaults to 800; a lower value shows two columns on narrower windows.
const SPREAD_MIN_WIDTH = 560;

// Shared style for the read-aloud overlay control buttons.
// Disabled dimming lives on the inner SVG (not the button): the stagger
// variants leave an inline `opacity: 1` on the motion.button element, which
// would override a `disabled:opacity-*` class on the button itself.
const SPEECH_OVERLAY_BUTTON_CLASS =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors disabled:[&_svg]:opacity-40 disabled:hover:bg-transparent";
const SPEECH_BAR_COLLAPSED = { width: 72, height: 5 } as const;
const SPEECH_BAR_EXPANDED = { width: 130, height: 36 } as const;
// Selection toolbar (shown in place of the read-aloud controls while a passage
// is selected): copy only. Content is centered at this fixed width, so
// width = content (1 x 28px) + 6px padding per side = 40px (4px grid).
const SELECTION_BAR_WIDTH = 40;

// Bar rows stagger their controls in reading order when a row enters or the
// selection/speech rows swap; exits fade as one so the swap stays snappy.
// `custom` carries whether the bar was already open before the swap — when a
// row is replaced while the pill was still collapsed (e.g. selecting text with
// the read-aloud bar minimized), the outgoing row vanishes instantly so its
// controls never flash during the expansion.
const BAR_ROW_VARIANTS: Variants = {
  hidden: { opacity: 0, scale: 0.88 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: {
      duration: 0.16,
      ease: "easeOut",
      delayChildren: 0.02,
      staggerChildren: 0.03,
    },
  },
  exit: (barWasOpen: boolean) =>
    barWasOpen
      ? {
          opacity: 0,
          scale: 0.88,
          transition: { duration: 0.12, ease: "easeIn" },
        }
      : { opacity: 0, transition: { duration: 0 } },
};
const BAR_ITEM_VARIANTS: Variants = {
  hidden: { opacity: 0, y: 4, scale: 0.6 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring", stiffness: 640, damping: 32 },
  },
};

/** Animated icon swap for bar buttons (copy → check, customize → close):
 * the outgoing glyph blurs/shrinks away while the incoming one sharpens in. */
function BarIconSwap({
  iconKey,
  children,
}: {
  iconKey: string;
  children: ReactNode;
}) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={iconKey}
        className="flex items-center justify-center"
        initial={{ opacity: 0, scale: 0.4, filter: "blur(2px)" }}
        animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
        exit={{ opacity: 0, scale: 0.4, filter: "blur(2px)" }}
        transition={{ duration: 0.12, ease: "easeOut" }}
      >
        {children}
      </motion.span>
    </AnimatePresence>
  );
}

// Open transition timings. Keep the page reveal slightly after the cover zoom
// settles so the two never fight (which reads as a "pop"). Shared with the
// closing zoom (BookCloseZoom) so open + close mirror each other exactly.
export const ZOOM_DURATION = 0.45;
export const ZOOM_EASE = [0.32, 0.72, 0, 1] as const;
const REVEAL_DELAY_MS = 480;
const INITIAL_DISPLAY_TIMEOUT_MS = 6500;
const FALLBACK_DISPLAY_TIMEOUT_MS = 6500;
const DEFAULT_BOOK_ASSET_BY_PATH: Record<string, string> = {};

export function createInitialBooksNavigationState(): BooksNavigationState {
  return {
    isReady: false,
    canGoPreviousPage: false,
    canGoNextPage: false,
    chapters: [],
    currentChapterIndex: -1,
  };
}

function stripHrefFragment(href?: string): string {
  return (href ?? "").split("#")[0].replace(/^\.\//, "");
}

function hrefMatches(activeHref: string | undefined, chapterHref: string): boolean {
  const active = stripHrefFragment(activeHref);
  const chapter = stripHrefFragment(chapterHref);
  if (!active || !chapter) return false;
  return (
    active === chapter ||
    active.endsWith(`/${chapter}`) ||
    chapter.endsWith(`/${active}`)
  );
}

function findCurrentChapterIndex(
  chapters: BooksChapterNavigationItem[],
  activeHref: string | undefined
): number {
  if (!activeHref) return -1;
  return chapters.findIndex((chapter) => hrefMatches(activeHref, chapter.href));
}

function flattenBookChapters(
  items: NavItem[] | undefined,
  depth = 0,
  parentKey = "chapter"
): BooksChapterNavigationItem[] {
  if (!items?.length) return [];
  return items.flatMap((item, index) => {
    const key = item.id || `${parentKey}-${index}`;
    const label = item.label?.trim() || `Chapter ${index + 1}`;
    const current = item.href
      ? [{ id: key, label, href: item.href, depth }]
      : [];
    return [
      ...current,
      ...flattenBookChapters(item.subitems, depth + 1, key),
    ];
  });
}

function getBooksDebugEnvironment() {
  if (typeof window === "undefined") return {};
  return {
    href: window.location.href,
    userAgent: window.navigator.userAgent,
    platform: window.navigator.platform,
    language: window.navigator.language,
    viewport: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
    standalone:
      "standalone" in window.navigator
        ? Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone)
        : undefined,
  };
}

function getElementSnapshot(element: HTMLElement | null): BooksDebugSnapshot | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return {
    clientWidth: element.clientWidth,
    clientHeight: element.clientHeight,
    offsetWidth: element.offsetWidth,
    offsetHeight: element.offsetHeight,
    rect: {
      width: rect.width,
      height: rect.height,
      top: rect.top,
      left: rect.left,
    },
    isConnected: element.isConnected,
    childElementCount: element.childElementCount,
  };
}

export const BooksReaderPane = forwardRef<
  BooksReaderPaneHandle,
  BooksReaderPaneProps
>(function BooksReaderPane(
  {
    entry,
    loadBlob,
    settings,
    osIsDark,
    originRect,
    initialCfi,
    initialKosyncProgress,
    initialPercentage,
    onProgress,
    onNavigationStateChange,
    onSpeechStateChange,
    onBookLanguageChange,
    onShowCustomize,
    onHideCustomize,
    isCustomizeOpen = false,
    bookmarks,
    onAddBookmark,
    onRemoveBookmark,
    onBookmarkStateChange,
    onBackToShelf,
  },
  ref
) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const renderHostRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const bookLanguageRef = useRef<string | null>(null);
  const [bookLanguage, setBookLanguage] = useState<string | null>(null);
  const publisherPageDirectionRef = useRef<"ltr" | "rtl">("ltr");
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // Raw preferences; application uses resolved (language-gated) values below.
  const textLayoutSettingRef = useRef(settings.textLayout);
  textLayoutSettingRef.current = settings.textLayout;
  const chineseScriptSettingRef = useRef(settings.chineseScript);
  chineseScriptSettingRef.current = settings.chineseScript;
  // Vertical / simp-trad only apply for qualifying book languages.
  const effectiveTextLayout = resolveEffectiveTextLayout(
    settings.textLayout,
    bookLanguage
  );
  const effectiveChineseScript = resolveEffectiveChineseScript(
    settings.chineseScript,
    bookLanguage
  );
  const appliedTextLayoutRef = useRef<BooksReaderSettings["textLayout"] | null>(
    null
  );
  const speechRateRef = useRef(settings.speechRate);
  speechRateRef.current = settings.speechRate;
  // Lets the rendition's `relocated` handler (created once per book) notify
  // the speech controller declared further down.
  const speechRelocatedRef = useRef<() => void>(() => {});
  const chineseScriptSessionRef = useRef(
    createChineseScriptConversionSession()
  );
  const flipLockRef = useRef(false);
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  const initialCfiRef = useRef(initialCfi);
  const initialKosyncProgressRef = useRef(initialKosyncProgress);
  const initialPercentageRef = useRef(initialPercentage);
  const activeSectionHrefRef = useRef<string | undefined>(undefined);

  const { t, i18n } = useTranslation();
  const contentKey = useFilesStore(state => getFileContentSyncKey(entry.path, state.items[entry.path]));
  const transfer = useFileAvailability(state => state.files[contentKey ?? ""]);
  const loadingPercentage = transfer?.status === "downloading" ? transfer.percentage : undefined;
  const uiLanguage = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const uiLanguageRef = useRef(uiLanguage);
  uiLanguageRef.current = uiLanguage;
  const [isReady, setIsReady] = useState(false);
  const [coverVisible, setCoverVisible] = useState(true);
  // Set when the EPUB can't be opened (missing blob or display failure) so the
  // user sees a message instead of being stuck on the loading shim / cover.
  const [loadError, setLoadError] = useState<string | null>(null);
  // Zoom-in geometry for the cover overlay: animates from the clicked shelf
  // cover (`from`) to full-bleed (`to`), both in viewport-local coordinates.
  const [zoom, setZoom] = useState<{ from: ZoomRect; to: ZoomRect } | null>(
    null
  );
  const [flip, setFlip] = useState<FlipState | null>(null);
  const [navigationState, setNavigationState] = useState(
    createInitialBooksNavigationState
  );
  const navigationStateRef = useRef(navigationState);
  navigationStateRef.current = navigationState;
  // Seed from cached progress so the footer shows the real value immediately
  // (keyed by path, so this re-seeds per book). Refined once epub.js has real
  // locations and fires `relocated`.
  const [progressPct, setProgressPct] = useState(() =>
    clamp01(initialPercentage ?? 0)
  );
  // Latest progress, so the relocated handler can avoid clobbering a known-good
  // value with a transient 0 (epub.js reports 0 until locations are generated).
  const progressPctRef = useRef(progressPct);
  progressPctRef.current = progressPct;
  // Latest page-flip sample. The rendition's `relocated` handler is created
  // once per book and reads this so a flip can publish after epub.js reports
  // the section start instead of the column on screen.
  const publishReadingProgressRef = useRef<
    (reported?: {
      cfi?: string;
      percentage?: number;
      atStart?: boolean;
    }) => SyncedPageProgress | null
  >(() => null);
  publishReadingProgressRef.current = (reported = {}) => {
    const rendition = renditionRef.current;
    const visibleCfi = rendition ? readVisiblePageCfi(rendition) : null;
    const reportedCfi = reported.cfi?.trim() ?? "";
    const reportedOnVisiblePage = Boolean(
      rendition &&
        reportedCfi &&
        reportedCfiOnVisiblePage(rendition, reportedCfi)
    );
    const chosen = resolveSyncedPageProgress({
      reportedCfi,
      visibleCfi,
      reportedOnVisiblePage,
      reportedPercentage: reported.percentage,
      atStart: reported.atStart,
      seededPercentage: progressPctRef.current,
    });
    if (!chosen) return null;
    let locationsPercentage: number | null = null;
    const book = rendition?.book;
    if (book) {
      try {
        const total = book.locations?.length?.() ?? 0;
        if (total > 0) {
          const pct = book.locations.percentageFromCfi(chosen.cfi);
          if (typeof pct === "number" && Number.isFinite(pct)) {
            locationsPercentage = pct;
          }
        }
      } catch {
        locationsPercentage = null;
      }
    }
    const resolved =
      locationsPercentage === null
        ? chosen
        : resolveSyncedPageProgress({
            reportedCfi: chosen.cfi,
            reportedOnVisiblePage: true,
            reportedPercentage: reported.percentage,
            locationsPercentage,
            atStart: reported.atStart,
            seededPercentage: progressPctRef.current,
          }) ?? chosen;
    if (!resolved) return null;
    if (resolved.percentage > 0 || reported.atStart) {
      setProgressPct(resolved.percentage);
    }
    const kosyncProgress = rendition
      ? (cfiToKoXPath(rendition, resolved.cfi) ?? undefined)
      : undefined;
    onProgressRef.current(resolved.cfi, resolved.percentage, kosyncProgress);
    return resolved;
  };
  // Start/end CFIs of the visible page(s), for bookmark membership checks.
  const [pageCfis, setPageCfis] = useState<{
    startCfi: string;
    endCfi?: string;
  } | null>(null);

  const { info: coverInfo, loading: coverLoading } = useBookCover(
    entry.path,
    entry.modifiedAt
  );

  const displayDebugMode = useDisplaySettingsStore((s) => s.debugMode);
  const displayDebugModeRef = useRef(displayDebugMode);
  displayDebugModeRef.current = displayDebugMode;

  useEffect(() => {
    onNavigationStateChange?.(navigationState);
  }, [navigationState, onNavigationStateChange]);

  useEffect(
    () => () => onNavigationStateChange?.(createInitialBooksNavigationState()),
    [onNavigationStateChange]
  );

  const appendDebugEvent = useCallback(
    (step: string, data?: unknown, level: BooksDebugLevel = "info") => {
      if (!displayDebugModeRef.current) return;
      const debugData = summarizeForLog(data);
      if (level === "error") {
        booksLog.error(step, debugData);
      } else if (level === "warn") {
        booksLog.warn(step, debugData);
      } else {
        booksLog.debug(step, debugData);
      }
    },
    []
  );

  const readActiveBookBlob = useCallback(async (): Promise<Blob | null> => {
    if (loadBlob) return loadBlob().catch(() => null);
    const fallbackAssetUrl = DEFAULT_BOOK_ASSET_BY_PATH[entry.path];
    try {
      appendDebugEvent("content:vfs:read", {
        path: entry.path,
        modifiedAt: entry.modifiedAt,
      });
      const storedBlob = await readBookBlobContent(entry.path);
      if (storedBlob) {
        appendDebugEvent("content:vfs:hit", {
          path: entry.path,
          size: storedBlob.size,
          type: storedBlob.type,
        });
        return storedBlob;
      }
      appendDebugEvent(
        "content:vfs:missing",
        {
          path: entry.path,
          fallbackAssetUrl,
          // Help diagnose orphan-UUID / cloud-tombstone cases in debug mode.
          note: "IndexedDB miss after cloud hydrate attempt; see [CloudSync] logs",
        },
        "warn"
      );
    } catch (error) {
      appendDebugEvent("content:vfs:failed", error, "error");
    }

    if (!fallbackAssetUrl) return null;

    appendDebugEvent("content:fallbackFetch:start", { fallbackAssetUrl });
    let response: Response;
    try {
      response = await fetch(fallbackAssetUrl, { credentials: "same-origin" });
    } catch (error) {
      // Offline / server unreachable — surface the regular "missing book"
      // error instead of an unhandled open failure.
      appendDebugEvent("content:fallbackFetch:failed", error, "error");
      return null;
    }
    appendDebugEvent("content:fallbackFetch:response", {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get("content-type"),
      contentLength: response.headers.get("content-length"),
    });
    if (!response.ok) return null;

    const blob = await response.blob();
    appendDebugEvent("content:fallbackFetch:success", { blob });
    return blob;
  }, [appendDebugEvent, entry.modifiedAt, entry.path, loadBlob]);

  const accentBaseHex = useThemeStore((state) => resolveOsAccentBaseHex(state));
  const palette = resolveReadingPalette(settings, osIsDark, accentBaseHex);
  const paletteRef = useRef(palette);
  paletteRef.current = palette;
  const { isAquaGlass } = useThemeFlags();
  const speechOverlayButtonClass = cn(
    SPEECH_OVERLAY_BUTTON_CLASS,
    isAquaGlass ? null : "hover:bg-white/20"
  );
  const overlayBackground = getReadingOverlayBackground(palette);
  const isVerticalText = effectiveTextLayout === "vertical";
  const sideClearance = clampBooksGutter(settings.gutterPx);

  // Measure the zoom-in geometry before first paint so the cover overlay starts
  // exactly on top of the clicked shelf book and grows to full-bleed. Runs once
  // per book (the pane is keyed by path), so the captured origin stays stable.
  useLayoutEffect(() => {
    const host = viewportRef.current;
    if (!host) return;
    const hostRect = host.getBoundingClientRect();
    const to: ZoomRect = {
      top: 0,
      left: 0,
      width: hostRect.width,
      height: hostRect.height,
    };
    // Fall back to a plain full-bleed reveal (no fly-in) when there is no
    // origin, e.g. opened via deep link / "last opened" rather than a tap.
    const from: ZoomRect =
      originRect && originRect.width > 0 && originRect.height > 0
        ? {
            top: originRect.top - hostRect.top,
            left: originRect.left - hostRect.left,
            width: originRect.width,
            height: originRect.height,
          }
        : to;
    setZoom({ from, to });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!displayDebugMode) return;
    const onError = (event: ErrorEvent) => {
      appendDebugEvent(
        "window.error",
        {
          message: event.message,
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          error: event.error,
        },
        "error"
      );
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      appendDebugEvent(
        "window.unhandledrejection",
        { reason: event.reason },
        "error"
      );
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, [appendDebugEvent, displayDebugMode]);

  // Create the book + rendition for the active EPUB.
  useEffect(() => {
    let cancelled = false;
    let book: Book | null = null;
    let rendition: Rendition | null = null;
    let displayedContentFontsReady: Promise<unknown> | undefined;
    // epub.js resolves display() before rendition content hooks run, so the
    // post-display font/axis reflow must wait for this signal from the hook.
    let resolveContentHooksReady: (() => void) | null = null;
    let contentHooksReady: Promise<void> = Promise.resolve();
    setIsReady(false);
    setCoverVisible(true);
    setLoadError(null);
    bookLanguageRef.current = null;
    setBookLanguage(null);
    onBookLanguageChange?.(null);
    publisherPageDirectionRef.current = "ltr";
    appliedTextLayoutRef.current = null;
    activeSectionHrefRef.current = undefined;
    setPageCfis(null);
    setNavigationState(createInitialBooksNavigationState());
    appendDebugEvent("open:start", {
      path: entry.path,
      fileName: entry.fileName,
      name: entry.name,
      modifiedAt: entry.modifiedAt,
      initialCfi: initialCfiRef.current,
      settings,
      environment: getBooksDebugEnvironment(),
    });

    const nextFrame = () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve())
      );

    const getReaderDebugSnapshot = (
      step: string,
      startedAt?: number
    ): BooksDebugSnapshot => {
      const debugBook = book as unknown as
        | {
            archived?: boolean;
            container?: { packagePath?: string };
            package?: { metadata?: unknown };
            settings?: unknown;
          }
        | null;
      const debugRendition = rendition as unknown as
        | {
            location?: unknown;
            manager?: { constructor?: { name?: string } };
            settings?: unknown;
            views?: () => unknown;
          }
        | null;
      let viewCount: number | undefined;
      try {
        const views = debugRendition?.views?.();
        viewCount = Array.isArray(views) ? views.length : undefined;
      } catch {
        viewCount = undefined;
      }
      return {
        step,
        elapsedMs: startedAt ? Date.now() - startedAt : undefined,
        entry: {
          path: entry.path,
          fileName: entry.fileName,
          name: entry.name,
          modifiedAt: entry.modifiedAt,
        },
        initialCfi: initialCfiRef.current,
        activeSectionHref: activeSectionHrefRef.current,
        host: getElementSnapshot(renderHostRef.current),
        book: book
          ? {
              archived: debugBook?.archived,
              packagePath: debugBook?.container?.packagePath,
              metadata: debugBook?.package?.metadata,
              settings: debugBook?.settings,
            }
          : null,
        rendition: rendition
          ? {
              location: debugRendition?.location,
              managerName: debugRendition?.manager?.constructor?.name,
              settings: debugRendition?.settings,
              viewCount,
            }
          : null,
      };
    };

    const watch = async <T,>(step: string, promise: Promise<T>): Promise<T> => {
      const startedAt = Date.now();
      const timeout = window.setTimeout(() => {
        appendDebugEvent(
          `${step}:stillPending`,
          getReaderDebugSnapshot(step, startedAt),
          "warn"
        );
      }, 8000);
      try {
        return await promise;
      } finally {
        window.clearTimeout(timeout);
      }
    };

    const cleanupInstance = () => {
      try {
        rendition?.destroy();
      } catch {
        // ignore
      }
      try {
        book?.destroy();
      } catch {
        // ignore
      }
      if (renditionRef.current === rendition) renditionRef.current = null;
      if (bookRef.current === book) bookRef.current = null;
      rendition = null;
      book = null;
    };

    (async () => {
      try {
        appendDebugEvent("content:read:start");
        const blob = await readActiveBookBlob();
        if (cancelled) return;
        if (!blob) {
          // No readable EPUB bytes — surface an error instead of hanging on the
          // loading shim / zoom cover forever.
          setLoadError(t("apps.books.reader.error"));
          setCoverVisible(false);
          setIsReady(true);
          appendDebugEvent("content:read:missing", undefined, "error");
          return;
        }
        appendDebugEvent("content:read:success", {
          blob,
          isBlobInstance: blob instanceof Blob,
          hasArrayBuffer: typeof blob.arrayBuffer === "function",
        });
        appendDebugEvent("blob:arrayBuffer:start");
        const buffer = await blob.arrayBuffer();
        if (cancelled) return;
        const magic = Array.from(new Uint8Array(buffer, 0, 4)).map((byte) =>
          byte.toString(16).padStart(2, "0")
        );
        appendDebugEvent("blob:arrayBuffer:success", {
          byteLength: buffer.byteLength,
          magic,
        });
        // The stored blob isn't a valid EPUB (zip). This happens when a cloud
        // content download failed and an error payload (e.g. a 404
        // `{"error":"Not found"}` JSON body) got saved as the book's bytes —
        // show the error instead of feeding garbage to epub.js (which would
        // otherwise render the raw error text as the "book").
        if (!isLikelyEpubBuffer(buffer)) {
          setLoadError(t("apps.books.reader.error"));
          setCoverVisible(false);
          setIsReady(true);
          appendDebugEvent("epub:magic:invalid", { magic }, "error");
          return;
        }
        appendDebugEvent("epub:magic:valid", { magic });

        const host = renderHostRef.current;
        if (!host) {
          setLoadError(t("apps.books.reader.error"));
          setCoverVisible(false);
          setIsReady(true);
          appendDebugEvent("renderHost:missing", undefined, "error");
          return;
        }
        // Wait until the host has a measurable size so epub.js can lay out.
        for (let i = 0; i < 40 && host.clientHeight < 2; i++) {
          await nextFrame();
          if (cancelled) return;
        }
        appendDebugEvent("renderHost:measured", {
          clientWidth: host.clientWidth,
          clientHeight: host.clientHeight,
          rect: host.getBoundingClientRect().toJSON?.() ?? {
            width: host.getBoundingClientRect().width,
            height: host.getBoundingClientRect().height,
            top: host.getBoundingClientRect().top,
            left: host.getBoundingClientRect().left,
          },
        });
        if (host.clientWidth < 2 || host.clientHeight < 2) {
          setLoadError(t("apps.books.reader.error"));
          setCoverVisible(false);
          setIsReady(true);
          appendDebugEvent(
            "renderHost:zeroSize",
            { clientWidth: host.clientWidth, clientHeight: host.clientHeight },
            "error"
          );
          return;
        }

        appendDebugEvent("epubjs:createBook:start");
        book = ePub(buffer);
        bookRef.current = book;
        appendDebugEvent("epubjs:createBook:success", {
          archived: book.archived,
          settings: book.settings,
        });

        const bookEvents = book as unknown as {
          on?: (eventName: string, handler: (...args: unknown[]) => void) => void;
        };
        bookEvents.on?.("openFailed", (error) => {
          appendDebugEvent(
            "epubjs:book:openFailed",
            {
              error,
              snapshot: getReaderDebugSnapshot("epubjs:book:openFailed"),
            },
            "error"
          );
          if (!cancelled) {
            setLoadError(t("apps.books.reader.error"));
            setCoverVisible(false);
            setIsReady(true);
          }
        });

        appendDebugEvent("epubjs:bookReady:start");
        await watch("epubjs:bookReady", book.ready);
        const readyBook = book as unknown as {
          container?: { packagePath?: string };
          package?: {
            metadata?: {
              direction?: unknown;
              language?: string;
              title?: string;
              creator?: string;
            };
          };
        };
        // Normalize legacy tags ("jpn", "zho", …) so downstream consumers
        // (layout gates, font stacks, TTS, lang attributes) all agree.
        const nextBookLanguage = normalizeBookLanguage(
          readyBook.package?.metadata?.language
        );
        bookLanguageRef.current = nextBookLanguage;
        setBookLanguage(nextBookLanguage);
        onBookLanguageChange?.(nextBookLanguage);
        publisherPageDirectionRef.current = resolveEpubPageDirection(
          "book",
          readyBook.package?.metadata?.direction
        );
        const readingLanguage = resolveChineseScriptReadingLanguage(
          resolveEffectiveChineseScript(
            chineseScriptSettingRef.current,
            nextBookLanguage
          ),
          nextBookLanguage ?? uiLanguage
        );
        book.spine.hooks.content.register((document: Document) => {
          // Strip active content (scripts, inline handlers, javascript: URLs)
          // BEFORE epub.js serializes the section into its iframe — required
          // because the rendition runs with `allowScriptedContent: true` (see
          // booksContentSanitizer.ts for the iOS selection rationale).
          try {
            const removedCount = sanitizeEpubSectionDocument(document);
            if (removedCount > 0) {
              appendDebugEvent("epubjs:section:sanitized", { removedCount });
            }
          } catch (error) {
            appendDebugEvent("epubjs:section:sanitizeFailed", error, "warn");
          }
          const textLayout = resolveEffectiveTextLayout(
            textLayoutSettingRef.current,
            bookLanguageRef.current
          );
          applyEpubTextLayout(document, textLayout);
          appliedTextLayoutRef.current = textLayout;
        });
        appendDebugEvent("epubjs:bookReady:success", {
          packagePath: readyBook.container?.packagePath,
          metadata: readyBook.package?.metadata,
        });
        const chapters = flattenBookChapters(book.navigation?.toc);
        setNavigationState((state) => ({
          ...state,
          chapters,
          currentChapterIndex: findCurrentChapterIndex(
            chapters,
            activeSectionHrefRef.current
          ),
        }));
        appendDebugEvent("epubjs:navigation:loaded", {
          chapterCount: chapters.length,
        });
        if (cancelled) {
          cleanupInstance();
          return;
        }

        const fontFaceCss = buildFontFaceCss(window.location.origin);
        const activeBook = book;

        const createRendition = (reason: "initial" | "fallback"): Rendition => {
          const renderStep =
            reason === "initial" ? "epubjs:renderTo" : "epubjs:renderToFallback";
          displayedContentFontsReady = undefined;
          contentHooksReady = new Promise<void>((resolve) => {
            resolveContentHooksReady = resolve;
          });
          const textLayout = resolveEffectiveTextLayout(
            textLayoutSettingRef.current,
            bookLanguageRef.current
          );
          appendDebugEvent(`${renderStep}:start`, {
            width: host.clientWidth,
            height: host.clientHeight,
            spread: columnModeToSpread(settings.columnMode),
            textLayout,
          });
          const pageDirection = resolveEpubPageDirection(
            textLayout,
            publisherPageDirectionRef.current
          );
          const nextRendition = activeBook.renderTo(host, {
            width: host.clientWidth || "100%",
            height: host.clientHeight || "100%",
            flow: "paginated",
            spread: columnModeToSpread(settings.columnMode),
            minSpreadWidth: SPREAD_MIN_WIDTH,
            manager: "default",
            defaultDirection: pageDirection,
            // WebKit blocks the long-press text-selection gesture (and
            // events generally) inside `sandbox="allow-same-origin"` iframes
            // without `allow-scripts`, killing selection/highlights on iOS.
            // Safe because sections are sanitized in the spine content hook
            // (booksContentSanitizer.ts) before they reach the iframe.
            allowScriptedContent: true,
          });
          rendition = nextRendition;
          renditionRef.current = nextRendition;
          appendDebugEvent(`${renderStep}:success`);

          nextRendition.on("started", () => {
            const layout = resolveEffectiveTextLayout(
              textLayoutSettingRef.current,
              bookLanguageRef.current
            );
            const direction = resolveEpubPageDirection(
              layout,
              publisherPageDirectionRef.current
            );
            nextRendition.direction(direction);
            appendDebugEvent("epubjs:rendition:started", {
              direction,
              textLayout: layout,
            });
          });
          nextRendition.on("attached", () =>
            appendDebugEvent("epubjs:rendition:attached")
          );
          nextRendition.on(
            "rendered",
            (section: { href?: string; idref?: string }) =>
              appendDebugEvent("epubjs:rendition:rendered", {
                href: section?.href,
                idref: section?.idref,
              })
          );
          nextRendition.on(
            "displayed",
            (section: { href?: string; idref?: string }) =>
              appendDebugEvent("epubjs:rendition:displayed", {
                href: section?.href,
                idref: section?.idref,
              })
          );
          nextRendition.on("displayError", (error: unknown) =>
            appendDebugEvent(
              "epubjs:rendition:displayError",
              {
                error,
                snapshot: getReaderDebugSnapshot("epubjs:rendition:displayError"),
              },
              "error"
            )
          );
          nextRendition.on(
            "layout",
            (props: unknown, changed: unknown) =>
              appendDebugEvent("epubjs:rendition:layout", { props, changed })
          );
          nextRendition.on("resized", (size: unknown) =>
            appendDebugEvent("epubjs:rendition:resized", size)
          );

          nextRendition.hooks.content.register(
            createEpubThemeContentHook(() => {
              const currentBookLanguage = bookLanguageRef.current;
              const readingLanguage = resolveChineseScriptReadingLanguage(
                resolveEffectiveChineseScript(
                  chineseScriptSettingRef.current,
                  currentBookLanguage
                ),
                currentBookLanguage ?? uiLanguageRef.current
              );
              return buildEpubTheme(
                settingsRef.current,
                paletteRef.current,
                readingLanguage,
                currentBookLanguage
              );
            })
          );

          nextRendition.hooks.content.register(
            async (contents: {
              addStylesheetCss: (css: string, key: string) => void;
              document?: Document;
            }) => {
              try {
                try {
                  contents.addStylesheetCss(fontFaceCss, "ryos-book-fonts");
                  appendDebugEvent("epubjs:contentHook:fonts:success");
                } catch {
                  appendDebugEvent(
                    "epubjs:contentHook:fonts:failed",
                    undefined,
                    "warn"
                  );
                }

                try {
                  contents.addStylesheetCss(
                    BOOKS_SPEECH_HIGHLIGHT_CSS,
                    "ryos-books-speech"
                  );
                } catch {
                  appendDebugEvent(
                    "epubjs:contentHook:speechCss:failed",
                    undefined,
                    "warn"
                  );
                }

                // Keep passages selectable (iOS long-press + publisher CSS).
                try {
                  contents.addStylesheetCss(
                    BOOKS_SELECTION_CONTENT_CSS,
                    "ryos-books-selection"
                  );
                } catch {
                  appendDebugEvent(
                    "epubjs:contentHook:selectionCss:failed",
                    undefined,
                    "warn"
                  );
                }

                const document = contents.document;
                if (!document) return;
                const textLayout = resolveEffectiveTextLayout(
                  textLayoutSettingRef.current,
                  bookLanguageRef.current
                );
                applyEpubTextLayout(document, textLayout);
                appliedTextLayoutRef.current = textLayout;

                // `hyphens: auto` and locale-specific CJK glyph forms depend on the
                // content language. Prefer EPUB metadata, then the ryOS UI locale.
                try {
                  const docEl = document.documentElement;
                  if (docEl && !docEl.getAttribute("lang")) {
                    docEl.setAttribute(
                      "lang",
                      bookLanguageRef.current ?? uiLanguageRef.current
                    );
                  }
                } catch {
                  // ignore
                }

                // Strip publisher inline `color` styles so the themed reading color
                // always wins. A stylesheet (even `!important`) can't beat an inline
                // `color: … !important`, so removing the inline declaration is the
                // only reliable way to guarantee legibility (e.g. dark-on-dark).
                try {
                  document
                    .querySelectorAll<HTMLElement>("[style]")
                    .forEach((el) => {
                      if (el.style?.color) {
                        el.style.removeProperty("color");
                      }
                    });
                } catch {
                  // ignore
                }

                // Capture fonts.ready before Chinese-script work so the settle
                // reflow can start waiting even while conversion continues.
                if (renditionRef.current === nextRendition) {
                  displayedContentFontsReady =
                    document.fonts?.ready ?? Promise.resolve();
                }

                const target = resolveEffectiveChineseScript(
                  chineseScriptSettingRef.current,
                  bookLanguageRef.current
                );
                try {
                  const changedNodeCount = await applyChineseScriptToDocument(
                    document,
                    target,
                    chineseScriptSessionRef.current,
                    () =>
                      !cancelled &&
                      resolveEffectiveChineseScript(
                        chineseScriptSettingRef.current,
                        bookLanguageRef.current
                      ) === target &&
                      renditionRef.current === nextRendition
                  );
                  appendDebugEvent("epubjs:contentHook:chineseScript:success", {
                    target,
                    changedNodeCount,
                  });
                } catch (error) {
                  appendDebugEvent(
                    "epubjs:contentHook:chineseScript:failed",
                    error,
                    "warn"
                  );
                }
              } finally {
                // Unblock the settle reflow even when the section document is
                // missing or Chinese-script conversion throws.
                resolveContentHooksReady?.();
                resolveContentHooksReady = null;
              }
            }
          );

          applyEpubTheme(
            nextRendition.themes,
            buildEpubTheme(
              settings,
              palette,
              readingLanguage,
              bookLanguageRef.current
            )
          );
          nextRendition.themes.fontSize(`${settings.fontSizePct}%`);
          appendDebugEvent("epubjs:theme:applied");

          nextRendition.on(
            "relocated",
            (location: {
              start?: { cfi?: string; href?: string; percentage?: number };
              end?: { cfi?: string };
              atStart?: boolean;
              atEnd?: boolean;
            }) => {
              const cfi = location?.start?.cfi;
              const atStartNow = !!location?.atStart;
              const atEndNow = !!location?.atEnd;
              const activeHref = location?.start?.href;
              activeSectionHrefRef.current = activeHref;
              setNavigationState((state) => ({
                ...state,
                canGoPreviousPage: !atStartNow,
                canGoNextPage: !atEndNow,
                currentChapterIndex: findCurrentChapterIndex(
                  state.chapters,
                  activeHref
                ),
              }));
              // The visible column is the synced place. epub.js `location.start`
              // is often the section start after an in-chapter page flip.
              const saved = publishReadingProgressRef.current({
                cfi,
                percentage: location?.start?.percentage,
                atStart: atStartNow,
              });
              const pageStartCfi = saved?.cfi || cfi;
              setPageCfis(
                pageStartCfi
                  ? { startCfi: pageStartCfi, endCfi: location?.end?.cfi }
                  : null
              );
              speechRelocatedRef.current();
            }
          );

          nextRendition.on("keyup", (event: KeyboardEvent) => handleKey(event));
          return nextRendition;
        };

        rendition = createRendition("initial");

        try {
          let initialDisplayTarget = initialCfiRef.current?.trim() || undefined;
          if (!initialDisplayTarget) {
            const koProgress = initialKosyncProgressRef.current?.trim();
            if (koProgress) {
              try {
                const cfiFromKo = await koXPathToCfi(activeBook, koProgress);
                if (cfiFromKo) {
                  initialDisplayTarget = cfiFromKo;
                  appendDebugEvent("epubjs:display:kosync-xpath", {
                    kosyncProgress: koProgress,
                  });
                }
              } catch (error) {
                appendDebugEvent(
                  "epubjs:display:kosync-xpath:failed",
                  { error, kosyncProgress: koProgress },
                  "warn"
                );
              }
            }
          }
          const fallbackDisplayTarget = resolveEpubDisplayFallbackTarget(
            activeBook,
            initialDisplayTarget
          );
          appendDebugEvent("epubjs:display:start", {
            initialCfi: initialCfiRef.current,
            initialKosyncProgress: initialKosyncProgressRef.current,
            initialDisplayTarget,
            fallbackTarget: fallbackDisplayTarget,
          });
          const displayResult = await watch(
            "epubjs:display",
            displayEpubTargetWithFallback({
              rendition,
              target: initialDisplayTarget,
              fallbackTarget: fallbackDisplayTarget,
              initialTimeoutMs: INITIAL_DISPLAY_TIMEOUT_MS,
              fallbackTimeoutMs: FALLBACK_DISPLAY_TIMEOUT_MS,
              isActive: () =>
                !cancelled &&
                bookRef.current === activeBook &&
                renditionRef.current !== null,
              onTimeout: () =>
                appendDebugEvent(
                  "epubjs:display:timeout",
                  {
                    initialCfi: initialDisplayTarget,
                    fallbackTarget: fallbackDisplayTarget,
                    timeoutMs: INITIAL_DISPLAY_TIMEOUT_MS,
                    snapshot: getReaderDebugSnapshot("epubjs:display:timeout"),
                  },
                  "warn"
                ),
              resetAfterTimeout: () => {
                if (cancelled || bookRef.current !== activeBook) return null;
                const timedOutRendition = rendition;
                appendDebugEvent("epubjs:display:fallback:resetRendition", {
                  fallbackTarget: fallbackDisplayTarget,
                });
                try {
                  timedOutRendition?.destroy();
                } catch {
                  // ignore
                }
                if (renditionRef.current === timedOutRendition) {
                  renditionRef.current = null;
                }
                rendition = null;
                return createRendition("fallback");
              },
            })
          );
          if (displayResult.status === "inactive") return;
          appendDebugEvent("epubjs:display:success", {
            recovered: displayResult.status === "fallback-displayed",
            target: displayResult.target,
          });
          const displayedRendition = displayResult.rendition;
          // display() resolves before content hooks assign fontsReady. Wait for
          // the hook (with a timeout so a stuck hook can't pin the cover open).
          await Promise.race([
            contentHooksReady,
            new Promise<void>((resolve) => {
              window.setTimeout(resolve, FALLBACK_DISPLAY_TIMEOUT_MS);
            }),
          ]);
          if (cancelled || renditionRef.current !== displayedRendition) return;
          const textLayout = resolveEffectiveTextLayout(
            textLayoutSettingRef.current,
            bookLanguageRef.current
          );
          const isVerticalTextLayout = textLayout === "vertical";
          const reflowedAfterFonts = await reflowEpubAfterFontsSettle({
            fontsReady: displayedContentFontsReady ?? Promise.resolve(),
            rendition: displayedRendition,
            // Vertical writing mode never uses facing-page spreads; forcing
            // `auto`/`always` after the axis is already vertical sizes columns
            // against half-width and produces the stacked "tiers" layout.
            spread: isVerticalTextLayout
              ? "none"
              : columnModeToSpread(settings.columnMode),
            minSpreadWidth: SPREAD_MIN_WIDTH,
            target: displayResult.target,
            displayTimeoutMs: FALLBACK_DISPLAY_TIMEOUT_MS,
            // Must clear+rebuild — resize() no-ops when the host size is
            // unchanged, which is exactly the first-load case.
            rebuildViews: isVerticalTextLayout,
            isActive: () =>
              !cancelled && renditionRef.current === displayedRendition,
          });
          if (reflowedAfterFonts) {
            appendDebugEvent("epubjs:fonts:reflowed", {
              textLayout,
              rebuilt: isVerticalTextLayout,
            });
          }
        } catch (err) {
          // Corrupt / incompatible EPUB — show an error instead of revealing an
          // empty reader shell. Do not proceed to setIsReady / cover hide.
          if (!cancelled) {
            const snapshot = getReaderDebugSnapshot("epubjs:display:failed");
            booksLog.error("epubjs:display:failed", { error: err, snapshot });
            appendDebugEvent(
              "epubjs:display:failed",
              { error: err, snapshot },
              "error"
            );
            setLoadError(t("apps.books.reader.error"));
            setCoverVisible(false);
            setIsReady(true);
          }
          cleanupInstance();
          return;
        }
        if (cancelled) {
          cleanupInstance();
          return;
        }
        setIsReady(true);
        setNavigationState((state) => ({ ...state, isReady: true }));
        appendDebugEvent("reader:ready");
        // Reveal the page shortly after the zoom-in cover settles.
        window.setTimeout(() => {
          if (!cancelled) setCoverVisible(false);
        }, REVEAL_DELAY_MS);

        // Generate locations for accurate progress percentages (best-effort).
        // When kosync/Books progress arrived with percentage but no CFI, try the
        // stored CrossPoint XPath first, then fall back to percentage.
        activeBook.ready
          .then(() => activeBook.locations.generate(1600))
          .then(async () => {
            if (cancelled) return;
            appendDebugEvent("epubjs:locations:generated");
            const pct = clamp01(initialPercentageRef.current ?? 0);
            const hasCfi = Boolean(initialCfiRef.current?.trim());
            const koProgress = initialKosyncProgressRef.current?.trim();
            // display() reports its own location when it lands. Publishing
            // here would sample the page still on screen.
            let navigating = false;
            if (!hasCfi && koProgress) {
              try {
                const cfiFromKo = await koXPathToCfi(activeBook, koProgress);
                if (cfiFromKo && !cancelled) {
                  const rendition = renditionRef.current;
                  if (!rendition) return;
                  appendDebugEvent("epubjs:display:kosync-xpath:late", {
                    kosyncProgress: koProgress,
                  });
                  void rendition.display(cfiFromKo);
                  navigating = true;
                }
              } catch (error) {
                appendDebugEvent(
                  "epubjs:display:kosync-xpath:late:failed",
                  { error, kosyncProgress: koProgress },
                  "warn"
                );
              }
            }
            if (!hasCfi && !navigating && pct > 0) {
              try {
                const cfiFromPct = activeBook.locations.cfiFromPercentage(pct);
                if (cfiFromPct && !cancelled) {
                  const rendition = renditionRef.current;
                  if (!rendition) return;
                  appendDebugEvent("epubjs:display:percentage", {
                    percentage: pct,
                  });
                  void rendition.display(cfiFromPct);
                  navigating = true;
                }
              } catch (error) {
                appendDebugEvent(
                  "epubjs:display:percentage:failed",
                  { error, percentage: pct },
                  "warn"
                );
              }
            }
            if (navigating || cancelled || !renditionRef.current) return;
            const located = renditionRef.current.location;
            publishReadingProgressRef.current({
              cfi: located?.start?.cfi,
              percentage: located?.start?.percentage,
              atStart: located?.atStart,
            });
          })
          .catch((error) =>
            appendDebugEvent("epubjs:locations:failed", error, "warn")
          );
      } catch (err) {
        if (!cancelled) {
          const snapshot = getReaderDebugSnapshot("reader:open:failed");
          booksLog.error("reader:open:failed", { error: err, snapshot });
          appendDebugEvent(
            "reader:open:failed",
            { error: err, snapshot },
            "error"
          );
          setLoadError(t("apps.books.reader.error"));
          setCoverVisible(false);
          setIsReady(true);
        }
        cleanupInstance();
      }
    })();

    return () => {
      cancelled = true;
      cleanupInstance();
    };
    // Only re-create when the book changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.path]);

  // Convert the already-rendered section immediately when the reader setting
  // (or book language) changes. Non-Chinese books always stay on original text.
  // Each section retains its original text so switching directions or returning
  // to Original never requires reloading the chapter.
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!isReady || !rendition) return;
    let cancelled = false;
    const target = effectiveChineseScript;
    const renditionContents = rendition.getContents() as unknown;
    const contentsList = (
      Array.isArray(renditionContents)
        ? renditionContents
        : renditionContents
          ? [renditionContents]
          : []
    ) as Array<{ document?: Document }>;

    void Promise.all(
      contentsList.map(async (contents) => {
        if (!contents.document) return;
        const changedNodeCount = await applyChineseScriptToDocument(
          contents.document,
          target,
          chineseScriptSessionRef.current,
          () =>
            !cancelled &&
            resolveEffectiveChineseScript(
              chineseScriptSettingRef.current,
              bookLanguageRef.current
            ) === target
        );
        appendDebugEvent("reader:chineseScript:applied", {
          target,
          changedNodeCount,
        });
      })
    ).catch((error) =>
      appendDebugEvent("reader:chineseScript:failed", error, "warn")
    );

    return () => {
      cancelled = true;
    };
  }, [appendDebugEvent, isReady, effectiveChineseScript]);

  // Apply vertical text to source and rendered section documents, then let
  // epub.js clear and redisplay the current CFI with the matching page axis.
  // Vertical writing mode is only allowed for CJK books.
  useEffect(() => {
    const rendition = renditionRef.current;
    const book = bookRef.current;
    if (
      !isReady ||
      !rendition ||
      !book ||
      appliedTextLayoutRef.current === effectiveTextLayout
    ) {
      return;
    }

    book.spine.each((section: { document?: Document }) => {
      if (section.document) {
        applyEpubTextLayout(section.document, effectiveTextLayout);
      }
    });

    const renditionContents = rendition.getContents() as unknown;
    const contentsList = (
      Array.isArray(renditionContents)
        ? renditionContents
        : renditionContents
          ? [renditionContents]
          : []
    ) as Array<{ document?: Document }>;
    for (const contents of contentsList) {
      if (contents.document) {
        applyEpubTextLayout(contents.document, effectiveTextLayout);
      }
    }

    appliedTextLayoutRef.current = effectiveTextLayout;
    const direction = resolveEpubPageDirection(
      effectiveTextLayout,
      publisherPageDirectionRef.current
    );
    rendition.direction(direction);
    appendDebugEvent("reader:textLayout:applied", {
      direction,
      textLayout: effectiveTextLayout,
    });
  }, [appendDebugEvent, isReady, effectiveTextLayout]);

  // Apply theme (colors, font family, line height) live.
  useEffect(() => {
    if (!isReady || !renditionRef.current) return;
    const readingLanguage = resolveChineseScriptReadingLanguage(
      effectiveChineseScript,
      bookLanguageRef.current ?? uiLanguage
    );
    applyEpubTheme(
      renditionRef.current.themes,
      buildEpubTheme(
        settings,
        palette,
        readingLanguage,
        bookLanguageRef.current
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isReady,
    settings.fontId,
    settings.themeOverride,
    settings.customThemeBackground,
    settings.customThemeText,
    effectiveChineseScript,
    bookLanguage,
    settings.customThemeTransparent,
    settings.lineHeight,
    // Live OS accent seed — page colors track wallpaper/Control Panels changes.
    accentBaseHex,
    osIsDark,
    uiLanguage,
  ]);

  // Apply font size live.
  useEffect(() => {
    if (!isReady || !renditionRef.current) return;
    renditionRef.current.themes.fontSize(`${settings.fontSizePct}%`);
  }, [isReady, settings.fontSizePct]);

  // Apply column/spread mode live.
  useEffect(() => {
    if (!isReady || !renditionRef.current) return;
    try {
      renditionRef.current.spread(columnModeToSpread(settings.columnMode));
    } catch {
      // ignore
    }
  }, [isReady, settings.columnMode]);

  // Keep the rendition sized to the render host (which is inset below the top
  // clearance and above the progress footer).
  useResizeObserverWithRef(
    renderHostRef,
    (resizeEntry) => {
      const rendition = renditionRef.current;
      if (!rendition) return;
      const { width, height } = resizeEntry.contentRect;
      if (width > 0 && height > 0) {
        try {
          rendition.resize(width, height);
        } catch {
          // ignore
        }
      }
    },
    { debounce: 80 }
  );

  const turnPage = useCallback((dir: "next" | "prev") => {
    const rendition = renditionRef.current;
    if (!rendition || flipLockRef.current) return;
    const state = navigationStateRef.current;
    if (dir === "prev" && !state.canGoPreviousPage) return;
    if (dir === "next" && !state.canGoNextPage) return;
    flipLockRef.current = true;
    setFlip({ dir, id: Date.now() });
    const action = dir === "next" ? rendition.next() : rendition.prev();
    void Promise.resolve(action).finally(() => {
      // The flip scrolls synchronously; read the visible column on the next
      // frame so synced progress follows the page the reader just turned to,
      // even when `relocated` still describes the section start.
      requestAnimationFrame(() => {
        publishReadingProgressRef.current({});
      });
    });
  }, []);

  // Read-aloud (browser TTS). Utterances use the book's language (falling
  // back to the UI locale), honoring the Chinese-script conversion setting.
  const getSpeechLanguage = useCallback(
    () =>
      ryOSLocaleToSpeechLanguage(
        resolveChineseScriptReadingLanguage(
          resolveEffectiveChineseScript(
            chineseScriptSettingRef.current,
            bookLanguageRef.current
          ),
          bookLanguageRef.current ?? uiLanguageRef.current
        )
      ),
    []
  );
  const {
    isSpeaking,
    isPaused,
    startSpeaking,
    stopSpeaking,
    pauseSpeaking,
    resumeSpeaking,
    skipToPreviousSentence,
    skipToNextSentence,
    handleRelocated: handleSpeechRelocated,
  } = useBooksSpeech({
    getRendition: () => renditionRef.current,
    getSpeechLanguage,
    getSpeechRate: () => normalizeBooksSpeechRate(speechRateRef.current),
    canAdvancePage: () => navigationStateRef.current.canGoNextPage,
    advancePage: () => turnPage("next"),
  });
  speechRelocatedRef.current = handleSpeechRelocated;

  // Text selection: the selection toolbar replaces the read-aloud controls in
  // the bottom pill while a passage is active.
  const getRendition = useCallback(() => renditionRef.current, []);
  const { activeSelection, copyActiveSelection } =
    useBooksAnnotations({ getRendition, isReady });

  // Edge-hover chevrons (desktop only): hovering a page-turn gutter fades in
  // a directional hint. Mobile/touch never hovers, so the media query gates
  // the synthetic mousemoves some touch browsers emit after taps.
  const [hoverSide, setHoverSide] = useState<"left" | "right" | null>(null);
  const supportsHover = useMemo(
    () =>
      typeof window !== "undefined" &&
      !!window.matchMedia?.("(hover: hover)").matches,
    []
  );
  const updateEdgeHover = useCallback(
    (hostX: number, hostY: number) => {
      if (!supportsHover) return;
      const host = viewportRef.current;
      if (!host) {
        setHoverSide(null);
        return;
      }
      const rect = host.getBoundingClientRect();
      if (hostY < TOP_CLEARANCE || hostY > rect.height - FOOTER_HEIGHT) {
        setHoverSide(null);
        return;
      }
      const edgeWidth = rect.width * BOOKS_EDGE_TAP_RATIO;
      const side =
        hostX <= edgeWidth
          ? "left"
          : hostX >= rect.width - edgeWidth
            ? "right"
            : null;
      if (!side) {
        setHoverSide(null);
        return;
      }
      const isVertical =
        resolveEffectiveTextLayout(
          textLayoutSettingRef.current,
          bookLanguageRef.current
        ) === "vertical";
      const direction =
        side === "left"
          ? isVertical
            ? "next"
            : "prev"
          : isVertical
            ? "prev"
            : "next";
      const canTurn =
        direction === "prev"
          ? navigationStateRef.current.canGoPreviousPage
          : navigationStateRef.current.canGoNextPage;
      setHoverSide(canTurn ? side : null);
    },
    [supportsHover]
  );
  const clearEdgeHover = useCallback(() => setHoverSide(null), []);

  // Handle page-turn taps and swipes inside the EPUB iframe instead of
  // covering its text with parent-document buttons. A live selection or
  // interactive target wins, so dragging / long-pressing near an edge
  // remains selectable.
  useEffect(() => {
    if (!isReady) return;
    const rendition = getRendition();
    if (!rendition) return;

    const attachedDocuments = new WeakSet<Document>();
    const cleanups: Array<() => void> = [];

    const attachPageTurnListeners = (contents: Contents) => {
      const document = contents.document;
      const contentWindow = contents.window;
      if (!document || !contentWindow || attachedDocuments.has(document)) {
        return;
      }
      attachedDocuments.add(document);

      const readSelectionState = () => {
        try {
          const selection = contentWindow.getSelection();
          return (
            !!selection && selection.rangeCount > 0 && !selection.isCollapsed
          );
        } catch {
          return false;
        }
      };

      const handleClick = (event: MouseEvent) => {
        if (event.defaultPrevented || event.button !== 0) return;

        const hasSelection = readSelectionState();

        const target =
          event.target &&
          typeof (event.target as Element).closest === "function"
            ? (event.target as Element)
            : null;
        // In paginated mode epub.js makes the iframe as wide as the whole
        // section (every column) and clips it with the parent host, so iframe
        // coordinates don't map to what's visible. Convert the click into the
        // parent host's coordinate space and measure edges there.
        const host = viewportRef.current;
        const frame = contentWindow.frameElement;
        if (!host || !frame) return;
        const hostRect = host.getBoundingClientRect();
        const frameRect = frame.getBoundingClientRect();
        const isInteractiveTarget =
          target?.closest(
            'a, button, input, textarea, select, [role="button"]'
          ) !== null ||
          target?.namespaceURI === "http://www.w3.org/2000/svg";
        const clientXInHost = frameRect.left + event.clientX - hostRect.left;
        const direction = resolveBooksEdgeTapDirection({
          clientX: clientXInHost,
          viewportWidth: hostRect.width,
          isVerticalText:
            resolveEffectiveTextLayout(
              textLayoutSettingRef.current,
              bookLanguageRef.current
            ) === "vertical",
          hasSelection,
          isInteractiveTarget,
        });
        if (!direction) return;

        event.preventDefault();
        turnPage(direction);
      };

      document.addEventListener("click", handleClick);
      cleanups.push(() => document.removeEventListener("click", handleClick));

      // Swipe-to-flip: a mostly-horizontal single-finger swipe anywhere on
      // the page turns it, mirroring the edge taps (vertical text reverses
      // the physical direction). Long-press selection drags carry a live
      // selection by the time the finger lifts, so they never flip.
      let swipeStart: { x: number; y: number } | null = null;

      const handleTouchStart = (event: TouchEvent) => {
        if (event.touches.length !== 1) {
          swipeStart = null;
          return;
        }
        const touch = event.touches[0];
        swipeStart = { x: touch.clientX, y: touch.clientY };
      };

      const handleTouchMove = (event: TouchEvent) => {
        if (event.touches.length !== 1) swipeStart = null;
      };

      const handleTouchCancel = () => {
        swipeStart = null;
      };

      const handleTouchEnd = (event: TouchEvent) => {
        const start = swipeStart;
        swipeStart = null;
        if (!start || event.changedTouches.length !== 1) return;
        const touch = event.changedTouches[0];
        const direction = resolveBooksSwipeDirection({
          deltaX: touch.clientX - start.x,
          deltaY: touch.clientY - start.y,
          isVerticalText:
            resolveEffectiveTextLayout(
              textLayoutSettingRef.current,
              bookLanguageRef.current
            ) === "vertical",
          hasSelection: readSelectionState(),
        });
        if (!direction) return;
        turnPage(direction);
      };

      document.addEventListener("touchstart", handleTouchStart, {
        passive: true,
      });
      document.addEventListener("touchmove", handleTouchMove, {
        passive: true,
      });
      document.addEventListener("touchend", handleTouchEnd, { passive: true });
      document.addEventListener("touchcancel", handleTouchCancel, {
        passive: true,
      });
      cleanups.push(() => {
        document.removeEventListener("touchstart", handleTouchStart);
        document.removeEventListener("touchmove", handleTouchMove);
        document.removeEventListener("touchend", handleTouchEnd);
        document.removeEventListener("touchcancel", handleTouchCancel);
      });

      // Parent mousemoves stop at the iframe boundary, so hover tracking for
      // the edge chevrons needs an in-document listener converting to host
      // coordinates (same mapping as the click handler above).
      const handlePointerMove = (event: PointerEvent) => {
        if (event.pointerType !== "mouse") return;
        const host = viewportRef.current;
        const frame = contentWindow.frameElement;
        if (!host || !frame) return;
        const hostRect = host.getBoundingClientRect();
        const frameRect = frame.getBoundingClientRect();
        updateEdgeHover(
          frameRect.left + event.clientX - hostRect.left,
          frameRect.top + event.clientY - hostRect.top
        );
      };
      document.addEventListener("pointermove", handlePointerMove);
      cleanups.push(() =>
        document.removeEventListener("pointermove", handlePointerMove)
      );
    };

    const attachToCurrentContents = () => {
      const renditionContents = rendition.getContents() as unknown;
      const contentsList = (
        Array.isArray(renditionContents)
          ? renditionContents
          : renditionContents
            ? [renditionContents]
            : []
      ) as Contents[];
      contentsList.forEach(attachPageTurnListeners);
    };

    const handleRendered = () => attachToCurrentContents();
    rendition.on("rendered", handleRendered);
    attachToCurrentContents();

    return () => {
      cleanups.forEach((cleanup) => cleanup());
      try {
        rendition.off("rendered", handleRendered);
      } catch {
        // rendition may already be destroyed
      }
    };
  }, [getRendition, isReady, turnPage, updateEdgeHover]);

  // Copy feedback: the copy glyph swaps to a check for a beat instead of
  // raising a toast. Failure still surfaces as a toast.
  const [showCopyCheck, setShowCopyCheck] = useState(false);
  const copyCheckTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copyCheckTimerRef.current !== null) {
        window.clearTimeout(copyCheckTimerRef.current);
      }
    },
    []
  );
  const handleCopySelection = useCallback(async () => {
    const copied = await copyActiveSelection();
    if (!copied) {
      toast.error(t("apps.books.selection.copyFailed"));
      return;
    }
    setShowCopyCheck(true);
    if (copyCheckTimerRef.current !== null) {
      window.clearTimeout(copyCheckTimerRef.current);
    }
    copyCheckTimerRef.current = window.setTimeout(() => {
      copyCheckTimerRef.current = null;
      setShowCopyCheck(false);
    }, 1200);
  }, [copyActiveSelection, t]);

  // UI sounds: toolbar buttons click.
  const { play: playClickSound } = useSound(Sounds.BUTTON_CLICK, 0.3);

  // Bookmark for the visible page: a saved CFI counts as "on this page" when
  // it falls between the page's start and end CFIs.
  const activeBookmark = useMemo<BookBookmark | null>(() => {
    if (!pageCfis || bookmarks.length === 0) return null;
    const comparator = new EpubCFI();
    for (const bookmark of bookmarks) {
      if (bookmark.cfi === pageCfis.startCfi) return bookmark;
      if (!pageCfis.endCfi) continue;
      try {
        if (
          comparator.compare(bookmark.cfi, pageCfis.startCfi) >= 0 &&
          comparator.compare(bookmark.cfi, pageCfis.endCfi) <= 0
        ) {
          return bookmark;
        }
      } catch {
        // Unparseable CFI — exact match already handled above.
      }
    }
    return null;
  }, [bookmarks, pageCfis]);

  useEffect(() => {
    onBookmarkStateChange?.(!!activeBookmark);
  }, [activeBookmark, onBookmarkStateChange]);
  useEffect(
    () => () => onBookmarkStateChange?.(false),
    [onBookmarkStateChange]
  );

  const toggleBookmark = useCallback(() => {
    if (activeBookmark) {
      onRemoveBookmark(activeBookmark.cfi);
      return;
    }
    if (!pageCfis) return;
    let snippet = "";
    const rendition = renditionRef.current;
    if (rendition) {
      try {
        snippet = (getVisiblePageRange(rendition)?.toString() ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 80);
      } catch {
        snippet = "";
      }
    }
    onAddBookmark({
      cfi: pageCfis.startCfi,
      text: snippet || undefined,
      percentage: progressPctRef.current,
      createdAt: Date.now(),
    });
  }, [activeBookmark, pageCfis, onAddBookmark, onRemoveBookmark]);

  useEffect(() => {
    onSpeechStateChange?.(isSpeaking);
  }, [isSpeaking, onSpeechStateChange]);
  useEffect(
    () => () => onSpeechStateChange?.(false),
    [onSpeechStateChange]
  );

  // Read-aloud bar: stays expanded while playing; idle / paused collapses to
  // the home-indicator pill (hover or tap grows it again).
  const isSpeechPlaying = isSpeaking && !isPaused;
  const {
    isOpen: speechBarVisibilityOpen,
    handlePointerEnter: handleSpeechBarPointerEnter,
    handlePointerLeave: handleSpeechBarPointerLeave,
    handlePointerDown: handleSpeechBarPointerDown,
    handleFocus: handleSpeechBarFocus,
    handleBlur: handleSpeechBarBlur,
    revealTemporarily: revealSpeechBarTemporarily,
  } = useBooksSpeechBarVisibility({ isPlaying: isSpeechPlaying });
  // Auto-reveal the controls once the book is displayed so new readers see
  // them, then tuck the pill away after a couple of seconds.
  useEffect(() => {
    if (!isReady) return;
    revealSpeechBarTemporarily(BOOKS_SPEECH_BAR_AUTO_REVEAL_MS);
  }, [isReady, revealSpeechBarTemporarily]);
  const speechBarOpen = isCustomizeOpen || speechBarVisibilityOpen;
  // Active text selection swaps the bottom pill to the selection toolbar
  // (copy) and keeps it open.
  const selectionBarActive = !!activeSelection;
  const barOpen = selectionBarActive || speechBarOpen;
  // Bar visibility from the previous render: when a row swap happens while
  // the pill was still collapsed, the outgoing row exits instantly (see
  // BAR_ROW_VARIANTS) so its controls never flash mid-expansion.
  const barWasOpenRef = useRef(barOpen);
  const barWasOpen = barWasOpenRef.current;
  useEffect(() => {
    barWasOpenRef.current = barOpen;
  });

  const displayTarget = useCallback(
    (target: string, step: string) => {
      const rendition = renditionRef.current;
      if (!rendition || !target) return;
      flipLockRef.current = false;
      setFlip(null);
      Promise.resolve(rendition.display(target)).catch((error) =>
        appendDebugEvent(step, error, "error")
      );
    },
    [appendDebugEvent]
  );

  useImperativeHandle(
    ref,
    () => ({
      goToPreviousPage: () => turnPage("prev"),
      goToNextPage: () => turnPage("next"),
      goToChapter: (href: string) =>
        displayTarget(href, "epubjs:chapterDisplay:failed"),
      goToCfi: (cfi: string) =>
        displayTarget(cfi, "epubjs:bookmarkDisplay:failed"),
      toggleBookmark,
      startSpeaking,
      stopSpeaking,
    }),
    [displayTarget, startSpeaking, stopSpeaking, toggleBookmark, turnPage]
  );

  const handleKey = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "PageDown") {
        turnPage("next");
      } else if (event.key === "PageUp") {
        turnPage("prev");
      } else if (event.key === "ArrowRight") {
        turnPage(
          resolveEffectiveTextLayout(
            textLayoutSettingRef.current,
            bookLanguageRef.current
          ) === "vertical"
            ? "prev"
            : "next"
        );
      } else if (event.key === "ArrowLeft") {
        turnPage(
          resolveEffectiveTextLayout(
            textLayoutSettingRef.current,
            bookLanguageRef.current
          ) === "vertical"
            ? "next"
            : "prev"
        );
      }
    },
    [turnPage]
  );

  // Window-level keyboard navigation (in addition to the iframe keyup).
  useEffect(() => {
    const host = viewportRef.current;
    if (!host) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "ArrowRight" ||
        e.key === "ArrowLeft" ||
        e.key === "PageDown" ||
        e.key === "PageUp"
      ) {
        e.preventDefault();
        handleKey(e);
      }
    };
    host.addEventListener("keydown", onKeyDown);
    return () => host.removeEventListener("keydown", onKeyDown);
  }, [handleKey]);

  return (
    <div
      ref={viewportRef}
      tabIndex={0}
      className={cn(
        "relative h-full w-full overflow-hidden outline-none",
        // Transparent custom background: the reader becomes the frosted pane
        // under Aqua Glass (see books-reader-glass in aqua-glass.css).
        palette.background === "transparent" && "books-reader-glass"
      )}
      style={{ backgroundColor: palette.background }}
      onMouseMove={(event) => {
        const rect = viewportRef.current?.getBoundingClientRect();
        if (!rect) return;
        updateEdgeHover(event.clientX - rect.left, event.clientY - rect.top);
      }}
      onMouseLeave={clearEdgeHover}
    >
      {/* The epub.js render target, inset below the top clearance, above the
          progress footer, and with side gutters for a comfortable measure.
          `books-reader-selectable` re-enables text selection on the epub.js
          iframe element — required for iOS long-press selection. */}
      <div
        ref={renderHostRef}
        className="books-reader-selectable absolute"
        style={{
          top: TOP_CLEARANCE,
          bottom: FOOTER_HEIGHT,
          left: sideClearance,
          right: sideClearance,
        }}
      />

      {/* Reading-progress footer — right-aligned percentage, no bar. */}
      <div
        className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-end px-4"
        style={{ height: FOOTER_HEIGHT }}
      >
        <span
          className={cn(
            "font-os-ui text-[10px] tabular-nums",
            palette.isDark ? "text-white/65" : "text-black/55"
          )}
        >
          {Math.round(progressPct * 100)}%
        </span>
      </div>

      {/* Edge-hover chevrons (desktop): fade in a page-turn hint over the
          hovered gutter; hidden on touch (no hover) and at book boundaries. */}
      <AnimatePresence>
        {hoverSide && (
          <motion.div
            key={hoverSide}
            className={cn(
              "pointer-events-none absolute z-10 flex items-center justify-center",
              hoverSide === "left" ? "left-0" : "right-0"
            )}
            style={{
              top: TOP_CLEARANCE,
              bottom: FOOTER_HEIGHT,
              // Center the caret within the reading gutter (with a floor so
              // it doesn't hug the window edge on very tight gutters).
              width: Math.max(sideClearance, 28),
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
          >
            {hoverSide === "left" ? (
              <CaretLeft
                size={20}
                weight="bold"
                className={palette.isDark ? "text-white/45" : "text-black/35"}
              />
            ) : (
              <CaretRight
                size={20}
                weight="bold"
                className={palette.isDark ? "text-white/45" : "text-black/35"}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Read-aloud overlay: home-indicator pill when idle/paused; stays
          expanded while playing. Hover or tap grows it otherwise. */}
      <motion.div
        className="pointer-events-none absolute inset-x-0 z-30 flex justify-center"
        style={{ bottom: 6 }}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
      >
        <div
          className="pointer-events-auto flex w-full items-end justify-center"
          style={{ height: SPEECH_BAR_EXPANDED.height }}
          onPointerEnter={(event) =>
            handleSpeechBarPointerEnter(event.pointerType)
          }
          onPointerLeave={(event) =>
            handleSpeechBarPointerLeave(event.pointerType)
          }
          onPointerDown={(event) =>
            handleSpeechBarPointerDown(event.pointerType)
          }
          onFocusCapture={handleSpeechBarFocus}
          onBlurCapture={(event) => {
            const next = event.relatedTarget;
            if (next instanceof Node && event.currentTarget.contains(next)) {
              return;
            }
            handleSpeechBarBlur();
          }}
        >
          <motion.div
            role={barOpen ? "toolbar" : "button"}
            aria-label={
              selectionBarActive
                ? t("apps.books.selection.controls", {
                    defaultValue: "Selection controls",
                  })
                : t("apps.books.speech.controls", {
                    defaultValue: "Read-aloud controls",
                  })
            }
            aria-expanded={barOpen ? undefined : false}
            className={cn(
              "books-speech-overlay flex items-center justify-center overflow-hidden rounded-full",
              barOpen ? "gap-0.5 px-1.5 py-1" : "cursor-pointer",
              isAquaGlass
                ? null
                : cn(
                    "border shadow-lg backdrop-blur-md",
                    palette.isDark
                      ? "border-white/15 bg-white/10 text-white"
                      : "border-black/10 bg-black/60 text-white"
                  )
            )}
            initial={false}
            animate={
              selectionBarActive
                ? {
                    width: SELECTION_BAR_WIDTH,
                    height: SPEECH_BAR_EXPANDED.height,
                  }
                : speechBarOpen
                  ? {
                      width: SPEECH_BAR_EXPANDED.width,
                      height: SPEECH_BAR_EXPANDED.height,
                    }
                  : {
                      width: SPEECH_BAR_COLLAPSED.width,
                      height: SPEECH_BAR_COLLAPSED.height,
                    }
            }
            transition={{
              type: "spring",
              stiffness: 520,
              damping: 34,
              mass: 0.7,
            }}
            onClick={() => {
              if (barOpen) return;
              revealSpeechBarTemporarily();
            }}
            // One capture-phase handler clicks for every toolbar button
            // (speech, copy) without wiring each.
            onClickCapture={(event) => {
              const target = event.target as Element | null;
              if (target?.closest?.("button:not(:disabled)")) {
                playClickSound();
              }
            }}
          >
            <motion.div
              className="relative flex items-center justify-center"
              initial={false}
              animate={{
                opacity: barOpen ? 1 : 0,
                scale: barOpen ? 1 : 0.85,
              }}
              transition={{ duration: 0.14, ease: "easeOut" }}
              style={{
                pointerEvents: barOpen ? "auto" : "none",
              }}
            >
              {/* Crossfade between the selection toolbar and the read-aloud
                  controls; popLayout keeps the exiting row out of the flex
                  flow so the pill's width spring never fights it. */}
              <AnimatePresence
                mode="popLayout"
                initial={false}
                custom={barWasOpen}
              >
              {selectionBarActive ? (
                <motion.div
                  key="selection"
                  className="flex items-center gap-0.5"
                  variants={BAR_ROW_VARIANTS}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  <motion.button
                    type="button"
                    variants={BAR_ITEM_VARIANTS}
                    aria-label={
                      showCopyCheck
                        ? t("apps.books.selection.copied")
                        : t("apps.books.selection.copy")
                    }
                    title={
                      showCopyCheck
                        ? t("apps.books.selection.copied")
                        : t("apps.books.selection.copy")
                    }
                    onClick={handleCopySelection}
                    className={speechOverlayButtonClass}
                    tabIndex={0}
                  >
                    <BarIconSwap iconKey={showCopyCheck ? "check" : "copy"}>
                      {showCopyCheck ? (
                        <Check weight="bold" size={16} />
                      ) : (
                        <Copy weight="bold" size={16} />
                      )}
                    </BarIconSwap>
                  </motion.button>
                </motion.div>
              ) : (
                <motion.div
                  key="speech"
                  className="flex items-center gap-0.5"
                  variants={BAR_ROW_VARIANTS}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
              <motion.button
                type="button"
                variants={BAR_ITEM_VARIANTS}
                aria-label={t("apps.books.speech.rewind")}
                title={t("apps.books.speech.rewind")}
                onClick={skipToPreviousSentence}
                disabled={!isSpeaking}
                className={speechOverlayButtonClass}
                tabIndex={speechBarOpen ? 0 : -1}
              >
                <Rewind weight="fill" size={16} />
              </motion.button>
              <motion.button
                type="button"
                variants={BAR_ITEM_VARIANTS}
                aria-label={
                  !isSpeaking
                    ? t("apps.books.menu.startSpeaking")
                    : isPaused
                      ? t("apps.books.speech.resume")
                      : t("apps.books.speech.pause")
                }
                title={
                  !isSpeaking
                    ? t("apps.books.menu.startSpeaking")
                    : isPaused
                      ? t("apps.books.speech.resume")
                      : t("apps.books.speech.pause")
                }
                onClick={() => {
                  if (!isSpeaking) startSpeaking();
                  else if (isPaused) resumeSpeaking();
                  else pauseSpeaking();
                }}
                disabled={!isSpeaking && !isReady}
                className={speechOverlayButtonClass}
                tabIndex={speechBarOpen ? 0 : -1}
              >
                <BarIconSwap
                  iconKey={!isSpeaking || isPaused ? "play" : "pause"}
                >
                  {!isSpeaking || isPaused ? (
                    <Play weight="fill" size={16} />
                  ) : (
                    <Pause weight="fill" size={16} />
                  )}
                </BarIconSwap>
              </motion.button>
              <motion.button
                type="button"
                variants={BAR_ITEM_VARIANTS}
                aria-label={t("apps.books.speech.skip")}
                title={t("apps.books.speech.skip")}
                onClick={skipToNextSentence}
                disabled={!isSpeaking}
                className={speechOverlayButtonClass}
                tabIndex={speechBarOpen ? 0 : -1}
              >
                <FastForward weight="fill" size={16} />
              </motion.button>
              {/* Playback off → the stop slot becomes a Customize shortcut.
                  One button so the glyph swap (stop / close / customize)
                  animates instead of remounting. */}
              <motion.button
                type="button"
                variants={BAR_ITEM_VARIANTS}
                aria-label={
                  isSpeaking
                    ? t("apps.books.speech.stop")
                    : isCustomizeOpen
                      ? t("common.menu.close")
                      : t("apps.books.customize.title")
                }
                title={
                  isSpeaking
                    ? t("apps.books.speech.stop")
                    : isCustomizeOpen
                      ? t("common.menu.close")
                      : t("apps.books.customize.title")
                }
                onClick={
                  isSpeaking
                    ? stopSpeaking
                    : isCustomizeOpen
                      ? onHideCustomize
                      : onShowCustomize
                }
                className={speechOverlayButtonClass}
                tabIndex={speechBarOpen ? 0 : -1}
              >
                <BarIconSwap
                  iconKey={
                    isSpeaking
                      ? "stop"
                      : isCustomizeOpen
                        ? "close"
                        : "customize"
                  }
                >
                  {isSpeaking ? (
                    <Stop weight="fill" size={16} />
                  ) : isCustomizeOpen ? (
                    <X weight="bold" size={14} />
                  ) : (
                    <TextAa weight="bold" size={16} />
                  )}
                </BarIconSwap>
              </motion.button>
                </motion.div>
              )}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        </div>
      </motion.div>

      {/* Page-turn animation. epub.js only ever has the single current page
          rendered, so a true two-page slide (or a curl showing the outgoing
          page) would require expensive DOM snapshotting (html2canvas), which is
          too slow/janky to be worth it. Instead an opaque "page" sheet slides
          off in the reading direction, revealing the freshly-rendered next/prev
          page underneath — so the transition shows real content, cheaply. */}
      <AnimatePresence
        onExitComplete={() => {
          flipLockRef.current = false;
        }}
      >
        {flip && (
          <motion.div
            key={flip.id}
            className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
          >
            <motion.div
              className="absolute inset-0"
              style={{
                backgroundColor: overlayBackground,
                // Subtle fold shading along the sheet's leading edge.
                backgroundImage:
                  flip.dir === (isVerticalText ? "prev" : "next")
                    ? "linear-gradient(to right, rgba(0,0,0,0) 86%, rgba(0,0,0,0.08))"
                    : "linear-gradient(to left, rgba(0,0,0,0) 86%, rgba(0,0,0,0.08))",
                // Drop shadow cast onto the page being revealed.
                boxShadow:
                  flip.dir === (isVerticalText ? "prev" : "next")
                    ? "10px 0 26px rgba(0,0,0,0.28)"
                    : "-10px 0 26px rgba(0,0,0,0.28)",
              }}
              initial={{ x: "0%" }}
              animate={{
                x:
                  flip.dir === (isVerticalText ? "prev" : "next")
                    ? "-100%"
                    : "100%",
              }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
              transition={{ duration: 0.42, ease: [0.4, 0, 0.2, 1] }}
              onAnimationComplete={() => {
                // Release the lock as soon as the slide settles (not after the
                // exit fade) so fast page-turning stays responsive.
                flipLockRef.current = false;
                setFlip(null);
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading shim shown behind the cover while the EPUB lays out. */}
      {!isReady && !loadError && (
        <div
          className={cn(
            "absolute inset-0 z-50 flex items-center justify-center",
            palette.isDark ? "text-white/70" : "text-black/50"
          )}
          style={{ backgroundColor: overlayBackground }}
        >
          <BookLoadingProgress label={t("common.loading.default")} percentage={loadingPercentage} />
        </div>
      )}

      {/* Error message shown when the EPUB can't be opened. Cover zoom
          intros are dismissed on error, so include an explicit shelf CTA —
          the auto-hiding titlebar control is easy to miss. */}
      {loadError && (
        <div
          className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 px-6 text-center"
          style={{ backgroundColor: overlayBackground }}
        >
          <span
            className={cn(
              "font-os-ui text-sm",
              palette.isDark ? "text-white/70" : "text-black/55"
            )}
          >
            {loadError}
          </span>
          <button
            type="button"
            onClick={onBackToShelf}
            className={cn(
              "font-os-ui text-sm px-4 py-1.5 rounded-full transition-colors",
              palette.isDark
                ? "bg-white/15 text-white/85 hover:bg-white/25"
                : "bg-black/10 text-black/70 hover:bg-black/15"
            )}
          >
            {t("apps.books.menu.backToShelf")}
          </button>
        </div>
      )}

      {/* Zoom-in cover overlay: grows from the clicked shelf cover to full-bleed.
          Animating width/height (not transform-scale) keeps the object-cover
          image from distorting during the zoom. */}
      <AnimatePresence>
        {coverVisible && zoom && (
          <motion.div
            className="pointer-events-none absolute z-40 overflow-hidden"
            style={{ backgroundColor: overlayBackground }}
            initial={{
              top: zoom.from.top,
              left: zoom.from.left,
              width: zoom.from.width,
              height: zoom.from.height,
              borderRadius: 4,
            }}
            animate={{
              top: zoom.to.top,
              left: zoom.to.left,
              width: zoom.to.width,
              height: zoom.to.height,
              borderRadius: 0,
            }}
            exit={{ opacity: 0 }}
            transition={{
              default: { duration: ZOOM_DURATION, ease: ZOOM_EASE },
              opacity: { duration: 0.3 },
            }}
          >
            <BookCover
              title={entry.name}
              fileName={entry.fileName}
              info={coverInfo}
              loading={coverLoading}
              large
              fit="contain"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
