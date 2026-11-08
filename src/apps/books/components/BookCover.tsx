import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { colorFromString } from "../utils/booksReader";
import type { BookCoverInfo } from "../utils/useBookCover";
import "@/apps/textedit/qntns/fonts.css";

/** Shelf paths of qntns.com books (no EPUB behind them). */
export const QNTNS_BOOK_PREFIX = "qntns:";
// The theme's own values (textedit/qntns/tokens.css: --color-text,
// --color-background, --font-display).
const QNTNS_COVER = {
  navy: "#182952",
  cream: "#fffaf4",
  display: '"Gill Sans Ultra", "Arial Black", sans-serif',
};

/**
 * Shelf grid cover is 104×160px with a 14px title — every fallback cover
 * (list row 36×52, zoom overlay, close overlay) derives its type scale from
 * that reference so the design stays proportional at any size. All inner
 * measures (author size, padding, gaps) are in `em` so they ride along.
 */
const REFERENCE_HEIGHT_PX = 160;
const REFERENCE_TITLE_PX = 14;

/**
 * Keeps the element's `font-size` proportional to its live height (14px at
 * 160px). Static covers just need a ResizeObserver; the zoom overlays animate
 * width/height imperatively every frame (Framer Motion inline styles), where
 * observer delivery lags behind paint — so `animated` switches to a
 * requestAnimationFrame loop that re-measures per frame. Both write straight
 * to the DOM: no React state, nothing to snap.
 */
function useHeightScaledFontSize(animated: boolean) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    let lastHeight = 0;
    const apply = () => {
      const height = el.getBoundingClientRect().height;
      if (height > 0 && height !== lastHeight) {
        lastHeight = height;
        el.style.fontSize = `${(height / REFERENCE_HEIGHT_PX) * REFERENCE_TITLE_PX}px`;
      }
    };

    apply();

    if (animated) {
      let raf = 0;
      const tick = () => {
        apply();
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }

    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, [animated]);

  return ref;
}

interface BookCoverProps {
  /** Display title used for the fallback cover. */
  title: string;
  fileName: string;
  info: BookCoverInfo | null;
  loading: boolean;
  className?: string;
  /** Larger typography for the full-size (zoomed) cover. */
  large?: boolean;
  /**
   * How the cover image fills its box. `"cover"` (default) crops to fill;
   * `"contain"` shows the full cover centered (used by the zoom overlay so the
   * whole book is visible as it grows).
   */
  fit?: "cover" | "contain";
  /** Reserve space above the shelf progress badge (grid covers with reading %). */
  progressInset?: boolean;
}

/**
 * Renders an EPUB cover image, or a generated spine-colored fallback cover
 * with the title/author when the book has no embedded cover.
 */
export function BookCover({
  title,
  fileName,
  info,
  loading,
  className,
  large = false,
  fit = "cover",
  progressInset = false,
}: BookCoverProps) {
  const displayTitle = info?.title || title;
  const author = info?.author || null;
  const scaledRef = useHeightScaledFontSize(large);

  if (info?.coverUrl) {
    return (
      <img
        src={info.coverUrl}
        alt={displayTitle}
        draggable={false}
        className={cn(
          "h-full w-full select-none object-center",
          fit === "contain" ? "object-contain" : "object-cover",
          className
        )}
      />
    );
  }

  const qntns = fileName.startsWith(QNTNS_BOOK_PREFIX);
  const { bg, fg } = colorFromString(fileName);
  // Garamond via inline style, NOT the `font-apple-garamond` class: the Aqua
  // theme forces `font-size: 1.5rem !important` on that class (About dialog
  // styling), which would break the em-based proportional type scale here.
  const coverStyle = qntns
    ? { background: QNTNS_COVER.cream, color: QNTNS_COVER.navy }
    : {
        background: `linear-gradient(135deg, ${bg} 0%, rgba(0,0,0,0.35) 130%)`,
        color: fg,
        fontFamily: "var(--font-apple-garamond)",
      };

  // Identical layout at every size: em paddings/margins reproduce the grid
  // cover's 10/16/12px box at 160px height and scale with the type, so the
  // zoom overlay lines up exactly with the shelf cover at the handoff.
  const content = qntns ? (
    // QNTNs typeset cover (CHECKLIST-36 §14f): cream, the title alone, no
    // author. Base 4 at the 104x160 shelf size, where 1em = 14px: title 20 on
    // a 24 line (1.429em, 1.2), line box top 40, so its centre sits
    // at 52 — the top third is 53.3, rounded to the 4 grid. Inset 12 each side.
    // top/inset are in the title's own em (20px): 2em = 40, 0.6em = 12.
    <div className="relative h-full w-full overflow-hidden">
      <div
        className="absolute inset-x-[0.6em] top-[2em] text-center text-[1.429em] leading-[1.2] line-clamp-3 break-words"
        style={{ fontFamily: QNTNS_COVER.display }}
      >
        {displayTitle}
      </div>
    </div>
  ) : (
    <div className="flex h-full w-full flex-col justify-between overflow-hidden px-[0.714em] pt-[1.143em] pb-[0.857em] text-center">
      <div className="text-[1em] line-clamp-5 font-semibold leading-tight">
        {loading ? "" : displayTitle}
      </div>
      {author && (
        <div
          className={cn(
            "text-[0.643em] line-clamp-2 opacity-80",
            progressInset && "mb-[1.778em]"
          )}
        >
          {author}
        </div>
      )}
    </div>
  );

  if (large) {
    // Zoom overlay: keep the book's aspect ratio and center it in the
    // (window-shaped) overlay, like `object-contain` does for image covers.
    return (
      <div
        className={cn(
          "flex h-full w-full items-center justify-center select-none",
          className
        )}
      >
        <div
          ref={scaledRef}
          className="aspect-[13/20] h-full max-h-full w-auto max-w-full overflow-hidden"
          style={coverStyle}
        >
          {content}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scaledRef}
      className={cn("h-full w-full overflow-hidden select-none", className)}
      style={coverStyle}
    >
      {content}
    </div>
  );
}
