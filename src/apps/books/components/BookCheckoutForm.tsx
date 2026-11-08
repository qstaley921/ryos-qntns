// Store's Buy as a native sheet (CHECKLIST-36 §14l): the site's gift form
// (theme assets/js/qntns/listing.js) rebuilt from ryOS parts. Go to Payment
// sends POST /book/checkout exactly as listing.js's postCheckout does and
// follows the Stripe URL at the top level (Stripe cannot be framed).
// Plain address fields: no /postcard/suggest lookup. The fields are a draft
// kept per book in localStorage, cleared only by a good checkout answer.
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { OsTextarea } from "@/components/ui/os-textarea";
import { bookTitle } from "../utils/qntnsEpub";
import type { ForSale } from "./QntnsBook";

const WORKER_BASE = "https://qntns-reads.qstaley921.workers.dev";
const QTY_MAX = 99;
const GIFT_MESSAGE_MAX = 500; // Stripe's metadata cap, as listing.js.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type CheckoutFields = {
  qty: string;
  gift: boolean;
  name: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  zip: string;
  message: string;
  email: string;
};

const EMPTY: CheckoutFields = {
  qty: "1",
  gift: false,
  name: "",
  line1: "",
  line2: "",
  city: "",
  state: "",
  zip: "",
  message: "",
  email: "",
};

const draftKey = (slug: string) => `ryos-books-checkout:${slug}`;
const readDraft = (slug: string): Partial<CheckoutFields> => {
  try {
    return JSON.parse(localStorage.getItem(draftKey(slug)) || "{}") ?? {};
  } catch {
    return {};
  }
};
export const saveDraft = (slug: string, f: Partial<CheckoutFields>) => {
  try {
    localStorage.setItem(draftKey(slug), JSON.stringify(f));
  } catch {
    /* private window: the draft just isn't kept */
  }
};
const clearDraft = (slug: string) => {
  try {
    localStorage.removeItem(draftKey(slug));
  } catch {
    /* ignore */
  }
};

const isoToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// listing.js's giftOrder(): no email means no send date. The site's calendar is
// not rebuilt here, so an email always sends today (the site's default).
const giftOrder = (f: CheckoutFields) => ({
  name: f.name.trim(),
  message: f.message.trim(),
  email: f.email.trim(),
  ...(f.email.trim() ? { sendDate: isoToday(), tzOffset: new Date().getTimezoneOffset() } : {}),
  address: {
    name: f.name.trim(),
    line1: f.line1.trim(),
    line2: f.line2.trim(),
    city: f.city.trim(),
    state: f.state.trim().toUpperCase(),
    zip: f.zip.trim(),
  },
});

// postcard.js's validateAddress plus listing.js's email shape; the Worker checks again.
const valid = (f: CheckoutFields) => {
  const n = Number(f.qty);
  if (!Number.isInteger(n) || n < 1 || n > QTY_MAX) return false;
  if (!f.gift) return true;
  const a = giftOrder(f).address;
  return (
    !!a.name &&
    !!a.line1 &&
    !!a.city &&
    /^[A-Z]{2}$/.test(a.state) &&
    /^\d{5}(-?\d{4})?$/.test(a.zip) &&
    (!f.email.trim() || EMAIL_SHAPE.test(f.email.trim()))
  );
};

export function BookCheckoutForm({
  sale,
  open,
  onOpenChange,
}: {
  sale: ForSale;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const slug = sale.book.slug;
  const [f, setFields] = useState<CheckoutFields>(() => ({ ...EMPTY, ...readDraft(slug) }));
  // Every change is saved, so the draft survives however the sheet closes.
  const setF = (next: (p: CheckoutFields) => CheckoutFields) =>
    setFields((p) => {
      const n = next(p);
      saveDraft(slug, n);
      return n;
    });
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  const set = (k: keyof CheckoutFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  const pay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid(f) || state === "busy") return;
    setState("busy");
    try {
      const answered = await fetch(`${WORKER_BASE}/book/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // No gift key is the ordinary sale (worker book.js).
        body: JSON.stringify({
          book: slug,
          qty: f.gift ? 1 : Number(f.qty),
          ...(f.gift ? { gift: giftOrder(f) } : {}),
        }),
      });
      if (!answered.ok) throw new Error(String(answered.status));
      const payload = await answered.json();
      if (!payload?.url) throw new Error("url");
      clearDraft(slug);
      window.location.href = payload.url;
    } catch {
      setState("failed");
    }
  };

  const title = bookTitle(sale.book);
  const row = (label: string, id: string, field: React.ReactNode) => (
    <>
      <label htmlFor={id} className="text-right leading-6">
        {label}
      </label>
      {field}
    </>
  );

  return (
    <Dialog open={open} onOpenChange={state === "busy" ? undefined : onOpenChange}>
      <DialogContent className="max-w-[400px]" onKeyDown={(e) => e.stopPropagation()}>
        <DialogTitle className="sr-only">Buy {title}</DialogTitle>
        <DialogDescription className="sr-only">Choose copies or send it as a gift, then go to payment.</DialogDescription>
        <DialogHeader>Buy {title}</DialogHeader>
        <form onSubmit={pay} noValidate aria-busy={state === "busy"} className="p-4 px-6 font-os-ui text-[12px]">
          {sale.book.custom_excerpt?.trim() && <p className="mb-3 leading-4">{sale.book.custom_excerpt.trim()}</p>}
          <div className="grid grid-cols-[96px_1fr] items-center gap-x-3 gap-y-2">
            {row(
              "Copies:",
              "books-buy-qty",
              <div className="flex items-center gap-3">
                <Input
                  id="books-buy-qty"
                  type="number"
                  min={1}
                  max={QTY_MAX}
                  value={f.gift ? "1" : f.qty}
                  disabled={f.gift}
                  onChange={set("qty")}
                  className="w-16"
                />
                <span className="text-neutral-500">{sale.price} each</span>
              </div>
            )}
            <span />
            <label className="flex items-center gap-2 leading-6">
              <Checkbox checked={f.gift} onCheckedChange={(c) => setF((p) => ({ ...p, gift: c === true }))} />
              Is a gift
            </label>
          </div>

          {f.gift && (
            <fieldset className="mt-3 border-t pt-3">
              <legend className="sr-only">Gift details</legend>
              <p className="mb-3 leading-4 text-neutral-500">
                Gifts are mailed first to Quentin, who handwrites and handwraps your present before sending it to
                your friend. Allow 2 weeks for printing and reshipping. +$5 gift wrap.
              </p>
              <div className="grid grid-cols-[96px_1fr] items-center gap-x-3 gap-y-2">
                {row("Recipient:", "books-buy-name", <Input id="books-buy-name" value={f.name} onChange={set("name")} maxLength={40} autoComplete="off" />)}
                {row("Address:", "books-buy-line1", <Input id="books-buy-line1" value={f.line1} onChange={set("line1")} maxLength={64} autoComplete="off" />)}
                <span />
                <Input aria-label="Address line 2" value={f.line2} onChange={set("line2")} maxLength={64} autoComplete="off" />
                {row("City:", "books-buy-city", <Input id="books-buy-city" value={f.city} onChange={set("city")} maxLength={200} autoComplete="off" />)}
                {row(
                  "State, ZIP:",
                  "books-buy-state",
                  <div className="flex gap-2">
                    <Input id="books-buy-state" value={f.state} onChange={set("state")} maxLength={2} placeholder="NY" autoComplete="off" className="w-12 uppercase" />
                    <Input aria-label="ZIP code" value={f.zip} onChange={set("zip")} maxLength={10} inputMode="numeric" placeholder="10001" autoComplete="off" className="w-24" />
                  </div>
                )}
                {row(
                  "Message:",
                  "books-buy-message",
                  <OsTextarea id="books-buy-message" value={f.message} onChange={set("message")} rows={3} maxLength={GIFT_MESSAGE_MAX} />
                )}
                {row(
                  "Email:",
                  "books-buy-email",
                  <Input id="books-buy-email" type="email" value={f.email} onChange={set("email")} maxLength={254} placeholder="Optional" autoComplete="off" />
                )}
              </div>
            </fieldset>
          )}

          <DialogFooter className="mt-4 gap-2 sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={state === "busy"}>
              Cancel
            </Button>
            <Button type="submit" variant="default" disabled={!valid(f) || state === "busy"}>
              {state === "busy" ? "Working…" : state === "failed" ? "Try again" : "Go to Payment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
