import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { BookmarkSimple, Highlighter, SquaresFour } from "@phosphor-icons/react";
import type {
  AppProps,
  BooksInitialData,
  ChatsInitialData,
} from "@/apps/base/types";
import { useLaunchApp } from "@/hooks/useLaunchApp";
import { useResizeObserverWithRef } from "@/hooks/useResizeObserver";
import { AppWindowShell } from "@/components/shared/AppWindowShell";
import { AppHelpAboutDialogs } from "@/components/shared/AppHelpAboutDialogs";
import { appMetadata } from "../../metadata";
import { useBooksLogic } from "../../hooks/useBooksLogic";
import { BooksMenuBar } from "../BooksMenuBar";
import { BooksShelfView, type BooksShelfMode } from "../BooksShelfView";
import {
  BooksReaderPane,
  createInitialBooksNavigationState,
  type BooksNavigationState,
  type BooksReaderPaneHandle,
} from "../BooksReaderPane";
import { BookCloseZoom } from "../BookCloseZoom";
import { BooksCustomizePanel } from "../BooksCustomizePanel";
import { BooksHighlightsDrawer } from "../BooksHighlightsDrawer";
import {
  StoreCallout,
  useQntnsShelf,
  type ForSale,
} from "../QntnsBook";
import { buildQntnsEpub } from "../../utils/qntnsEpub";
import type { BookOriginRect } from "../../hooks/useBooksLogic";

export function BooksAppComponent({
  isWindowOpen,
  onClose,
  isForeground,
  skipInitialSound,
  initialData,
  instanceId,
  onNavigateNext,
  onNavigatePrevious,
}: AppProps<BooksInitialData>) {
  // qntns.com books stand on the shelf with the EPUBs and open in their own
  // reader, as EPUBs built in memory (CHECKLIST-36 §14, §14b, §14f).
  const qntnsShelf = useQntnsShelf();
  const {
    t,
    translatedHelpItems,
    isWindowsTheme,
    isMacOSTheme,
    isDarkMode,
    isHelpDialogOpen,
    setIsHelpDialogOpen,
    isAboutDialogOpen,
    setIsAboutDialogOpen,
    library,
    viewMode,
    activeBook,
    activeBookTitle,
    activeBookAuthor,
    openOriginRect,
    closingBook,
    openBook,
    closeBook,
    finishClosing,
    deleteBook,
    moveBookToTop,
    moveBookToBottom,
    settings,
    updateSettings,
    shelfView,
    setShelfView,
    progressByPath,
    saveProgress,
    activeBookHighlights,
    activeBookBookmarks,
    addHighlight,
    setHighlightColor,
    removeHighlight,
    addBookmark,
    removeBookmark,
    handleImport,
    fileInputRef,
    handleFileInputChange,
  } = useBooksLogic({
    extraLibrary: qntnsShelf.all,
    isWindowOpen,
    isForeground,
    instanceId,
    initialData,
  });

  // Positioning box for the transient closing-zoom overlay.
  const contentRef = useRef<HTMLDivElement>(null);
  const readerRef = useRef<BooksReaderPaneHandle>(null);
  const [isCustomizeOpen, setIsCustomizeOpen] = useState(false);
  // Store | Library (CHECKLIST-36 §14d); Store first, each time Books opens.
  const [shelfMode, setShelfMode] = useState<BooksShelfMode>("store");
  const [callout, setCallout] = useState<{
    sale: ForSale;
    anchor: BookOriginRect;
  } | null>(null);
  const closeCallout = useCallback(() => setCallout(null), []);
  // A post opens as an EPUB built from its HTML; afterwards the shelf is
  // re-sorted, since a refused phrase sends the book back to Store.
  const activeQntns = activeBook && qntnsShelf.byPath.get(activeBook.path);
  const { markOwned } = qntnsShelf;
  const loadQntnsBlob = useMemo(
    () =>
      activeQntns
        ? () => buildQntnsEpub(activeQntns).finally(markOwned)
        : undefined,
    [activeQntns, markOwned]
  );
  const shelfLibrary =
    shelfMode === "store"
      ? qntnsShelf.store
      : qntnsShelf.library.length
        ? [...qntnsShelf.library, ...library]
        : library;
  const ribbons = useMemo(
    () =>
      new Map([...qntnsShelf.sale].map(([path, s]) => [path, s.price])),
    [qntnsShelf.sale]
  );
  const [highlightsOpen, setHighlightsOpen] = useState(false);
  // Narrow windows (mobile / small desktop windows) get a bottom-sheet
  // Customize panel instead of the floating top-right card.
  const [isCompactPanel, setIsCompactPanel] = useState(false);
  useResizeObserverWithRef(contentRef, (entry) => {
    setIsCompactPanel(entry.contentRect.width < 500);
  });
  const [readerNavigationState, setReaderNavigationState] =
    useState<BooksNavigationState>(createInitialBooksNavigationState);
  const handleReaderNavigationStateChange = useCallback(
    (state: BooksNavigationState) => setReaderNavigationState(state),
    []
  );
  const [isSpeaking, setIsSpeaking] = useState(false);
  const handleSpeechStateChange = useCallback(
    (speaking: boolean) => setIsSpeaking(speaking),
    []
  );
  const [bookLanguage, setBookLanguage] = useState<string | null>(null);
  const handleBookLanguageChange = useCallback((language: string | null) => {
    setBookLanguage(language);
  }, []);
  // Drop language capability flags when returning to the shelf.
  useEffect(() => {
    if (viewMode !== "reader") {
      setBookLanguage(null);
      setHighlightsOpen(false);
    }
  }, [viewMode]);

  // Whether the visible page holds a bookmark (reported by the reader pane;
  // drives the Go menu label and the titlebar ribbon state).
  const [isCurrentPageBookmarked, setIsCurrentPageBookmarked] =
    useState(false);
  const handleBookmarkStateChange = useCallback(
    (bookmarked: boolean) => setIsCurrentPageBookmarked(bookmarked),
    []
  );

  const launchApp = useLaunchApp();
  // "Continue in Chats" from the Ask Ryo bubble: open Chats with the passage
  // quoted alongside the book's metadata (title / author / chapter).
  const handleAskRyo = useCallback(
    (passage: string) => {
      const title = activeBookTitle || activeBook?.name || null;
      const chapter =
        readerNavigationState.currentChapterIndex >= 0
          ? readerNavigationState.chapters[
              readerNavigationState.currentChapterIndex
            ]?.label
          : undefined;
      const source = [
        title,
        activeBookAuthor ? `by ${activeBookAuthor}` : null,
        chapter ? `(${chapter})` : null,
      ]
        .filter(Boolean)
        .join(" ");
      const message = [
        `“${passage}”`,
        source ? `— ${source}` : null,
        t("apps.books.selection.askRyoQuestion"),
      ]
        .filter(Boolean)
        .join("\n\n");
      launchApp("chats", {
        initialData: {
          prefillMessage: message,
          prefillRequestId: `books-ask-ryo-${Date.now()}`,
        } satisfies ChatsInitialData,
      });
    },
    [
      activeBook,
      activeBookAuthor,
      activeBookTitle,
      launchApp,
      readerNavigationState,
      t,
    ]
  );

  const menuBar = (
    <BooksMenuBar
      onClose={onClose}
      onShowHelp={() => setIsHelpDialogOpen(true)}
      onShowAbout={() => setIsAboutDialogOpen(true)}
      onImport={handleImport}
      onBackToShelf={closeBook}
      onShowCustomize={() => setIsCustomizeOpen(true)}
      isReading={viewMode === "reader"}
      bookLanguage={bookLanguage}
      settings={settings}
      updateSettings={updateSettings}
      navigationState={readerNavigationState}
      onGoToChapter={(href) => readerRef.current?.goToChapter(href)}
      isSpeaking={isSpeaking}
      onStartSpeaking={() => readerRef.current?.startSpeaking()}
      onStopSpeaking={() => readerRef.current?.stopSpeaking()}
    />
  );

  if (!isWindowOpen) return null;

  const isReading = viewMode === "reader";
  // macOS X notitlebar uses a dark glass titlebar: light icon + shadow.
  // Classic/Windows themes use a dark icon with no shadow.
  const isDarkTitlebar = isMacOSTheme;
  const highlightsTitleBarButton = isReading ? (
    <button
      type="button"
      aria-label={t("apps.books.highlights.title")}
      title={t("apps.books.highlights.title")}
      aria-pressed={highlightsOpen}
      onClick={(e) => {
        e.stopPropagation();
        setHighlightsOpen((open) => !open);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      className={`shrink-0 w-5 h-5 min-h-5 max-h-5 flex items-center justify-center transition-colors cursor-pointer ${
        highlightsOpen
          ? "text-amber-400 hover:text-amber-300"
          : isDarkTitlebar
            ? "text-white/80 hover:text-white"
            : "text-neutral-600 hover:text-neutral-800"
      }`}
      style={{
        filter: isDarkTitlebar
          ? "drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6))"
          : undefined,
      }}
    >
      <Highlighter size={14} weight={highlightsOpen ? "fill" : "bold"} />
    </button>
  ) : null;
  const bookmarkTitleBarButton = isReading ? (
    <button
      type="button"
      aria-label={
        isCurrentPageBookmarked
          ? t("apps.books.bookmarks.remove")
          : t("apps.books.bookmarks.add")
      }
      title={
        isCurrentPageBookmarked
          ? t("apps.books.bookmarks.remove")
          : t("apps.books.bookmarks.add")
      }
      onClick={(e) => {
        e.stopPropagation();
        readerRef.current?.toggleBookmark();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      className={`shrink-0 w-5 h-5 min-h-5 max-h-5 flex items-center justify-center transition-colors cursor-pointer ${
        isCurrentPageBookmarked
          ? "text-red-500 hover:text-red-400"
          : isDarkTitlebar
            ? "text-white/80 hover:text-white"
            : "text-neutral-600 hover:text-neutral-800"
      }`}
      style={{
        filter: isDarkTitlebar
          ? "drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6))"
          : undefined,
      }}
    >
      <BookmarkSimple
        size={14}
        weight={isCurrentPageBookmarked ? "fill" : "bold"}
      />
    </button>
  ) : null;
  const shelfButton = (
    <button
      type="button"
      aria-label={t("apps.books.reader.backToShelf")}
      title={t("apps.books.reader.backToShelf")}
      onClick={(e) => {
        e.stopPropagation();
        if (isReading) closeBook();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      className={`shrink-0 w-5 h-5 min-h-5 max-h-5 flex items-center justify-center transition-colors ${
        !isReading
          ? "text-transparent cursor-default"
          : isDarkTitlebar
            ? "text-white/80 hover:text-white cursor-pointer"
            : "text-neutral-600 hover:text-neutral-800 cursor-pointer"
      }`}
      style={{
        filter:
          isReading && isDarkTitlebar
            ? "drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6))"
            : undefined,
      }}
      disabled={!isReading}
    >
      <SquaresFour size={14} weight="bold" />
    </button>
  );

  return (
    <AppWindowShell
      isWindowOpen={isWindowOpen}
      isWindowsTheme={isWindowsTheme}
      isForeground={isForeground}
      menuBar={menuBar}
      windowFrameProps={{
        // Shelf has its own header, so the window titlebar shows nothing there;
        // while reading, the book title appears in hover-revealed chrome.
        title: isReading && activeBook
            ? activeBookTitle || activeBook.name
            : "",
        onClose,
        isForeground,
        appId: "books",
        material: "notitlebar",
        disableTitlebarAutoHide: !isReading,
        skipInitialSound,
        instanceId,
        onNavigateNext,
        onNavigatePrevious,
        titleBarRightContent: (
          <div className="flex items-center gap-1">
            {highlightsTitleBarButton}
            {bookmarkTitleBarButton}
            {shelfButton}
          </div>
        ),
        drawer: isReading ? (
          <BooksHighlightsDrawer
            isOpen={highlightsOpen}
            highlights={activeBookHighlights}
            onClose={() => setHighlightsOpen(false)}
            onSelect={(highlight) => {
              readerRef.current?.goToCfi(highlight.cfiRange);
              setHighlightsOpen(false);
            }}
          />
        ) : null,
      }}
      leading={
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileInputChange}
          accept=".epub,application/epub+zip"
          className="hidden"
        />
      }
      trailing={
        <AppHelpAboutDialogs
          appId="books"
          helpItems={translatedHelpItems}
          metadata={appMetadata}
          isHelpOpen={isHelpDialogOpen}
          onHelpOpenChange={setIsHelpDialogOpen}
          isAboutOpen={isAboutDialogOpen}
          onAboutOpenChange={setIsAboutDialogOpen}
        />
      }
    >
      <div
        ref={contentRef}
        className="books-app-shell relative flex h-full w-full flex-col overflow-hidden bg-os-window-bg font-os-ui"
      >
        {viewMode === "reader" && activeBook ? (
          <BooksReaderPane
            ref={readerRef}
            key={activeBook.path}
            entry={activeBook}
            loadBlob={loadQntnsBlob}
            settings={settings}
            osIsDark={isDarkMode}
            originRect={openOriginRect}
            initialCfi={progressByPath[activeBook.path]?.cfi}
            initialKosyncProgress={
              progressByPath[activeBook.path]?.kosyncProgress
            }
            initialPercentage={progressByPath[activeBook.path]?.percentage}
            onProgress={(cfi, percentage, kosyncProgress) =>
              saveProgress(activeBook.path, cfi, percentage, kosyncProgress)
            }
            onNavigationStateChange={handleReaderNavigationStateChange}
            onSpeechStateChange={handleSpeechStateChange}
            onBookLanguageChange={handleBookLanguageChange}
            onShowCustomize={() => setIsCustomizeOpen(true)}
            onHideCustomize={() => setIsCustomizeOpen(false)}
            isCustomizeOpen={isCustomizeOpen}
            highlights={activeBookHighlights}
            onAddHighlight={addHighlight}
            onSetHighlightColor={setHighlightColor}
            onRemoveHighlight={removeHighlight}
            bookmarks={activeBookBookmarks}
            onAddBookmark={addBookmark}
            onRemoveBookmark={removeBookmark}
            onBookmarkStateChange={handleBookmarkStateChange}
            onAskRyo={handleAskRyo}
            onBackToShelf={closeBook}
          />
        ) : (
          <BooksShelfView
            library={shelfLibrary}
            progressByPath={progressByPath}
            shelfView={shelfView}
            onSetShelfView={setShelfView}
            mode={shelfMode}
            onSetMode={(m) => {
              setCallout(null);
              setShelfMode(m);
            }}
            ribbons={shelfMode === "store" ? ribbons : undefined}
            onOpenBook={(entry, originRect) => {
              const sale = qntnsShelf.sale.get(entry.path);
              if (shelfMode === "store" && sale && originRect) {
                return setCallout({ sale, anchor: originRect });
              }
              openBook(entry.path, originRect);
            }}
            // A post is not a file: nothing to trash or reorder.
            onDeleteBook={(entry) =>
              qntnsShelf.byPath.has(entry.path) || deleteBook(entry)
            }
            onMoveToTop={moveBookToTop}
            onMoveToBottom={moveBookToBottom}
          />
        )}
        {callout && viewMode === "shelf" && (
          <StoreCallout
            key={callout.sale.book.slug}
            sale={callout.sale}
            anchor={callout.anchor}
            host={contentRef.current}
            onClose={closeCallout}
            onRestored={() => {
              setCallout(null);
              qntnsShelf.markOwned();
              setShelfMode("library");
            }}
          />
        )}
        {/* Floating reading-appearance customization panel (View ▸ Theme ▸ Customize…). */}
        <AnimatePresence>
          {isCustomizeOpen && (
            <BooksCustomizePanel
              settings={settings}
              updateSettings={updateSettings}
              osIsDark={isDarkMode}
              compact={isCompactPanel}
              bookLanguage={bookLanguage}
              onClose={() => setIsCustomizeOpen(false)}
            />
          )}
        </AnimatePresence>
        {/* Reverse zoom: full-bleed cover shrinks back onto the shelf book. */}
        {viewMode === "shelf" && closingBook && (
          <BookCloseZoom
            key={closingBook.path}
            entry={closingBook}
            containerRef={contentRef}
            settings={settings}
            osIsDark={isDarkMode}
            onDone={finishClosing}
          />
        )}
      </div>
    </AppWindowShell>
  );
}
