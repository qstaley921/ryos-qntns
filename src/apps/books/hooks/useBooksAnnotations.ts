import { useCallback, useEffect, useRef, useState } from "react";
import type { Contents, Rendition } from "epubjs";

/**
 * Injected into every section document so passages stay selectable on iOS:
 * some publisher stylesheets ship `user-select: none`, and WebKit needs
 * `-webkit-touch-callout` enabled for the long-press selection gesture.
 * (The parent-document side of the iOS fix lives on `.books-reader-selectable`
 * in index.css — WebKit also checks the iframe element's own styles.)
 */
export const BOOKS_SELECTION_CONTENT_CSS = `
html, body, body * {
  -webkit-user-select: text !important;
  user-select: text !important;
  -webkit-touch-callout: default !important;
}
`;

/** How long after a selectionchange the cleared-selection check runs. Kept
 * slightly above epub.js's own 250ms "selected" debounce so a clear never
 * races the selection event that preceded it. */
const SELECTION_CLEAR_DEBOUNCE_MS = 300;

/** The passage the selection toolbar (copy / ask Ryo) is acting on. */
export interface BooksActiveSelection {
  cfiRange: string;
  text: string;
}

interface UseBooksAnnotationsOptions {
  getRendition: () => Rendition | null;
  /** True once the reader has displayed the book (rendition is stable). */
  isReady: boolean;
}

interface BooksAnnotationsApi {
  activeSelection: BooksActiveSelection | null;
  /** Copy the active passage to the clipboard; resolves success. */
  copyActiveSelection: () => Promise<boolean>;
  /** Dismiss the toolbar and clear any in-document text selection. */
  clearActiveSelection: () => void;
}

function normalizeSelectionText(text: string | undefined | null): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function listContents(rendition: Rendition): Contents[] {
  const raw = rendition.getContents() as unknown;
  if (!raw) return [];
  return (Array.isArray(raw) ? raw : [raw]) as Contents[];
}

/**
 * Text selection for the Books reader.
 *
 * Listens for epub.js `selected` events (text selected inside the section
 * iframe) and clears the active selection when the document selection
 * collapses. Exposes the actions behind the selection toolbar (copy).
 */
export function useBooksAnnotations({
  getRendition,
  isReady,
}: UseBooksAnnotationsOptions): BooksAnnotationsApi {
  const [activeSelection, setActiveSelection] =
    useState<BooksActiveSelection | null>(null);
  const getRenditionRef = useRef(getRendition);
  getRenditionRef.current = getRendition;

  const clearDocumentSelections = useCallback(() => {
    const rendition = getRendition();
    if (!rendition) return;
    for (const contents of listContents(rendition)) {
      try {
        contents.window?.getSelection()?.removeAllRanges();
      } catch {
        // ignore
      }
    }
  }, [getRendition]);

  // epub.js emits `selected` (debounced selectionchange) with the selection's
  // CFI range; clearing is detected with our own per-document selectionchange
  // listener (epub.js stays silent on collapse).
  useEffect(() => {
    if (!isReady) return;
    const rendition = getRenditionRef.current();
    if (!rendition) return;

    let disposed = false;
    let clearTimer: number | null = null;
    const docsWithListener = new WeakSet<Document>();
    const cleanups: Array<() => void> = [];

    const handleSelected = (cfiRange: string, contents: Contents) => {
      if (disposed) return;
      let text = "";
      try {
        text = normalizeSelectionText(
          contents.window?.getSelection()?.toString()
        );
        if (!text) {
          text = normalizeSelectionText(rendition.getRange(cfiRange)?.toString());
        }
      } catch {
        text = "";
      }
      if (text) setActiveSelection({ cfiRange, text });
    };

    const attachSelectionClearListener = (contents: Contents) => {
      const doc = contents.document;
      const win = contents.window;
      if (!doc || !win || docsWithListener.has(doc)) return;
      docsWithListener.add(doc);
      const onSelectionChange = () => {
        if (clearTimer !== null) window.clearTimeout(clearTimer);
        clearTimer = window.setTimeout(() => {
          clearTimer = null;
          if (disposed) return;
          let collapsed = true;
          try {
            const selection = win.getSelection();
            collapsed =
              !selection || selection.rangeCount === 0 || selection.isCollapsed;
          } catch {
            collapsed = true;
          }
          if (collapsed) setActiveSelection(null);
        }, SELECTION_CLEAR_DEBOUNCE_MS);
      };
      doc.addEventListener("selectionchange", onSelectionChange);
      cleanups.push(() =>
        doc.removeEventListener("selectionchange", onSelectionChange)
      );
    };

    const attachToCurrentContents = () =>
      listContents(rendition).forEach(attachSelectionClearListener);

    rendition.on("selected", handleSelected);
    rendition.on("rendered", attachToCurrentContents);
    attachToCurrentContents();

    return () => {
      disposed = true;
      if (clearTimer !== null) window.clearTimeout(clearTimer);
      cleanups.forEach((cleanup) => cleanup());
      try {
        rendition.off("selected", handleSelected);
        rendition.off("rendered", attachToCurrentContents);
      } catch {
        // rendition may already be destroyed
      }
    };
  }, [isReady]);

  // Reset transient selection state when the book changes/unmounts.
  useEffect(() => () => setActiveSelection(null), []);

  const clearActiveSelection = useCallback(() => {
    clearDocumentSelections();
    setActiveSelection(null);
  }, [clearDocumentSelections]);

  const copyActiveSelection = useCallback(async (): Promise<boolean> => {
    const text = activeSelection?.text;
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }, [activeSelection]);

  return { activeSelection, copyActiveSelection, clearActiveSelection };
}
