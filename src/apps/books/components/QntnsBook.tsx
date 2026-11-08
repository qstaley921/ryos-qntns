// qntns.com books in the Books app (CHECKLIST-36 §14, §14d, §14f): the
// #password posts as shelf entries, and Store's Buy / Restore callout. They
// read as EPUBs built in memory (../utils/qntnsEpub.ts); lock logic is in
// ../utils/qntnsBook.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { listBooks, type GhostBook } from "@/lib/ghost";
import { parseBook, rememberPhrase, savedPhrase, unlock } from "../utils/qntnsBook";
import { bookTitle } from "../utils/qntnsEpub";
import { primeBookCover } from "../utils/useBookCover";
import type { BookOriginRect, BooksLibraryEntry } from "../hooks/useBooksLogic";
import { QNTNS_BOOK_PREFIX } from "./BookCover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useThemeFlags } from "@/hooks/useThemeFlags";
import { BookCheckoutForm } from "./BookCheckoutForm";

/** A book the reader can buy (CHECKLIST-36 §14d): a price tag, a lock and
 *  the post's page. */
export type ForSale = { book: GhostBook; price: string; draft: string; owned: boolean };

/** The #password posts as shelf entries, beside the EPUBs (CHECKLIST-36
 *  §14b). Empty on failure: the shelf shows the EPUBs alone. A book for sale
 *  with no saved phrase stands in Store; owned and free ones in Library
 *  (§14d). Owning is the site's own saved phrase, so a book unlocked on
 *  qntns.com is owned here too; a stale one is dropped when it is refused. */
export function useQntnsShelf(own?: { slug: string; phrase?: string }) {
  const [books, setBooks] = useState<GhostBook[]>([]);
  // Bumped when a phrase is saved or dropped here, so owned is read again.
  const [ownedTick, setOwnedTick] = useState(0);
  const markOwned = useCallback(() => setOwnedTick((n) => n + 1), []);
  useEffect(() => {
    let live = true;
    listBooks().then(
      (b) => live && setBooks(b),
      () => {}
    );
    return () => {
      live = false;
    };
  }, []);
  return useMemo(() => {
    const byPath = new Map<string, GhostBook>();
    const store: BooksLibraryEntry[] = [];
    const library: BooksLibraryEntry[] = [];
    const sale = new Map<string, ForSale>();
    for (const b of books) {
      const path = QNTNS_BOOK_PREFIX + b.slug;
      byPath.set(path, b);
      // Seeded before the shelf renders, so it never looks for an EPUB.
      // No author: the cover is the title alone (§14f).
      primeBookCover(path, { coverUrl: b.feature_image ?? null, title: bookTitle(b), author: null });
      const entry = { path, name: bookTitle(b), fileName: path };
      const { price, buy, draft } = parseBook(b);
      if (price && buy && draft) {
        // §14i: a bought book stays in Store (ribbon "Purchased", Buy again)
        // and sits in Library once.
        // Story seed (§14j): the given phrase is saved as a Restore would.
        if (own?.phrase && b.slug === own.slug) rememberPhrase(draft, own.phrase);
        const owned = !!savedPhrase(draft) || b.slug === own?.slug;
        sale.set(path, { book: b, price, draft, owned });
        store.push(entry);
        if (owned) library.push(entry);
      } else library.push(entry);
    }
    return { store, library, all: [...store, ...library], byPath, sale, markOwned };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [books, ownedTick, markOwned]);
}

const CALLOUT_W = 256;
const CALLOUT_GAP = 12;
const CALLOUT_INSET = 12;

/** Store's callout for one book (§14d): Buy opens the checkout sheet
 *  (§14l); Restore purchase takes the password and, once the Worker accepts
 *  it, the book moves to Library. Positioned beside the book inside `host`. */
export function StoreCallout({
  sale,
  anchor,
  host,
  onClose,
  onRestored,
}: {
  sale: ForSale;
  anchor: BookOriginRect;
  host: HTMLElement | null;
  onClose: () => void;
  onRestored: () => void;
}) {
  const { isMacOSTheme } = useThemeFlags();
  const ref = useRef<HTMLDivElement>(null);
  const [phrase, setPhrase] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // While the sheet is up its clicks and Escape belong to it, not the callout.
  const [buying, setBuying] = useState(false);
  const buyingRef = useRef(false);
  buyingRef.current = buying;

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!buyingRef.current && !ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => !buyingRef.current && e.key === "Escape" && onClose();
    // Next tick: the click that opened it must not close it.
    const t = window.setTimeout(() => document.addEventListener("pointerdown", down), 0);
    document.addEventListener("keydown", key);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [onClose]);

  // Right of the book when it fits, else left; never past the window edge.
  const box = host?.getBoundingClientRect();
  const hostW = box?.width ?? 0;
  const top = anchor.top - (box?.top ?? 0);
  const right = anchor.left - (box?.left ?? 0) + anchor.width + CALLOUT_GAP;
  const fitsRight = right + CALLOUT_W + CALLOUT_INSET <= hostW;
  const left = Math.max(CALLOUT_INSET, fitsRight ? right : anchor.left - (box?.left ?? 0) - CALLOUT_GAP - CALLOUT_W);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = phrase.trim();
    if (!p) return setError("Type the password first.");
    setBusy(true);
    const html = await unlock(sale.book.slug, sale.draft, p);
    setBusy(false);
    if (html === undefined) return setError("Couldn’t reach the server. Try again.");
    if (!html) return setError("That password isn’t right.");
    rememberPhrase(sale.draft, p);
    onRestored();
  };

  return (
    <motion.div
      ref={ref}
      role="dialog"
      aria-label={bookTitle(sale.book)}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.16 }}
      className="absolute z-30 rounded-md border bg-popover p-3 text-popover-foreground shadow-lg font-os-ui text-[12px]"
      style={{
        top: Math.max(CALLOUT_INSET, top),
        left,
        width: CALLOUT_W,
        transformOrigin: fitsRight ? "left top" : "right top",
        // Same Aqua chrome as ryOS's menus (dropdown-menu.tsx).
        ...(isMacOSTheme && {
          border: "none",
          borderRadius: 0,
          background: "var(--os-pinstripe-window)",
          boxShadow: "0 4px 16px rgba(0, 0, 0, 0.4)",
          fontFamily: "var(--os-font-ui)",
        }),
      }}
    >
      <p className="font-bold leading-4">{bookTitle(sale.book)}</p>
      <Button
        variant="default"
        className="mt-3 w-full"
        onClick={() => setBuying(true)}
      >
        {sale.owned ? "Buy again" : `Buy ${sale.price}`}
      </Button>
      <BookCheckoutForm sale={sale} open={buying} onOpenChange={setBuying} />
      {sale.owned ? (
        <p className="mt-3 border-t pt-3 leading-4">Already in your Library.</p>
      ) : (
      <form onSubmit={submit} noValidate aria-busy={busy} className="mt-3 border-t pt-3">
        <label htmlFor="books-restore" className="block leading-4">
          Already bought
        </label>
        <div className="mt-2 flex flex-col gap-2">
          <Input
            id="books-restore"
            type="password"
            placeholder="Enter the password from the first page"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            autoComplete="off"
            autoFocus
          />
          <Button type="submit" variant="secondary" disabled={busy || !phrase.trim()}>
            Restore purchase
          </Button>
        </div>
        {error && (
          <p role="status" className="mt-2 leading-4 text-red-600">
            {error}
          </p>
        )}
      </form>
      )}
    </motion.div>
  );
}
