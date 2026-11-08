import { useEffect, useMemo, useRef, useState } from "react";
import { CaretDown, CaretUp, ShoppingCart } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useThemeFlags } from "@/hooks/useThemeFlags";
import { cn } from "@/lib/utils";
import {
  COST, FUND_BASE, PRICE_PER_DAY, MAX_DAYS, TIMEOUT_MS,
  addDays, buyLabel, clampDays, dateProse, dayKey, dayOfMonth, diffDays,
  fundColor, fundState, inkOn, monthShort, money, rangeText, weekdayIndex,
  type FundState, type Order,
} from "./fundState";

interface Props {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

// Calendar budget: 21 week columns x (12px square + 4px gap) - 4 = 332px, plus
// a 12px weekday column and 4px gap = 348px, inside the 368px content box
// (400px dialog - 2 x 16px padding). Eight weeks back, the rest ahead.
const WEEKS = 21;
const WEEKS_BACK = 8;
const ROWS = ["M", "T", "W", "R", "F", "S", "Y"];

const Chip = ({ k, color, ink }: { k: string | null; color?: string; ink?: string }) => (
  <span
    className="flex w-12 h-12 shrink-0 flex-col items-center justify-center rounded border border-black/20 leading-none"
    style={{ background: color, color: ink }}
  >
    <span className="text-[20px] font-bold tabular-nums">{k ? dayOfMonth(k) : "-"}</span>
    <span className="text-[11px] mt-1">{k ? monthShort(k) : " "}</span>
  </span>
);

export function FundDialog({ isOpen, onOpenChange }: Props) {
  const { isWindowsTheme, currentTheme } = useThemeFlags();
  // null = unknown: the Worker has not answered, so nothing is claimed.
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [days, setDays] = useState(1);
  const [picked, setPicked] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [thanks] = useState(() => new URLSearchParams(window.location.search).get("funded") === "1");
  const asked = useRef(false);

  useEffect(() => {
    if (!isOpen || asked.current) return;
    asked.current = true;
    // GET /fund: silent on failure, the tiles stay on dashes.
    fetch(`${FUND_BASE}/fund`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && Array.isArray(d.orders)) setOrders(d.orders); else asked.current = false; })
      .catch(() => { asked.current = false; });
  }, [isOpen]);

  const today = dayKey();
  const state: FundState = useMemo(() => fundState(orders ?? [], today), [orders, today]);
  const unknown = orders === null;
  const first = unknown ? null : state.firstOpenKey;
  const nextIdx = state.runs.length;

  const buy = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch(`${FUND_BASE}/fund/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: clampDays(days) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const d = r.ok ? await r.json() : null;
      if (d && typeof d.url === "string") { window.location.assign(d.url); return; }
    } catch { /* silent: the button comes back */ }
    setBusy(false);
  };

  const step = (n: number) => setDays((d) => clampDays(d + n));

  // A picked open day at or after the first open day sets the count to reach it.
  const pick = (k: string) => {
    if (k === picked || k === today) { setPicked(null); return; }
    setPicked(k);
    if (first && k >= first && !state.filled.has(k)) setDays(clampDays(diffDays(first, k) + 1));
  };

  const shown = picked ?? today;
  const now = (() => {
    if (unknown) return { k: null, name: "-", sub: " " };
    if (shown === today) {
      if (!state.current) return { k: null, name: "No one", sub: "is funding this site." };
      const n = state.remaining;
      return {
        k: today,
        idx: state.owner.get(today),
        name: state.current.name,
        sub: `is funding this site for ${n} more ${n === 1 ? "day" : "days"}.${state.next ? ` ${state.next.name} is next.` : ""}`,
      };
    }
    const ahead = shown > today;
    const c = Math.abs(diffDays(today, shown));
    const when = ahead ? `in ${c} ${c === 1 ? "day" : "days"}.` : `${c} ${c === 1 ? "day" : "days"} ago.`;
    const idx = state.owner.get(shown);
    const run = idx === undefined ? null : state.runs[idx];
    if (!run) return { k: shown, name: ahead ? "Maybe you" : "No one", sub: `${ahead ? "will fund" : "was funding"} this site ${when}` };
    let unbroken = true;
    for (let i = 0; i <= c && unbroken; i += 1) unbroken = state.filled.has(addDays(today, ahead ? i : -i));
    const verb = ahead ? (unbroken && state.current?.name === run.name ? "will continue funding" : "will fund") : "was funding";
    return { k: shown, idx, name: run.name, sub: `${verb} this site ${when}` };
  })();

  const count = clampDays(days);
  const startKey = addDays(today, -weekdayIndex(today) - WEEKS_BACK * 7);
  const selEnd = first ? addDays(first, count - 1) : null;

  const content = (
    <div className={cn("flex flex-col gap-4 p-4 max-h-[75vh] overflow-y-auto", currentTheme === "macosx" ? "font-os-ui text-[13px]" : "text-[11px]")}>
      {thanks && <p className="font-bold">Thank you. Your days are in the queue.</p>}

      <div className="flex flex-col gap-2 leading-snug">
        <p>
          Quentin pays $50/month to keep this site live. Hosting with{" "}
          <a className="text-os-link hover:underline" href="https://ghost.io" target="_blank" rel="noreferrer">Ghost.io</a>{" "}
          keeps it easy to edit, and that costs $35/month; add the domain name and the editing and coding software and it is a somewhat expensive passion project.
        </p>
        {expanded ? (
          <>
            <p>He could host it free on a social platform, but he wants something beautiful, free from ads, free from data-scraping. Something that makes him and others happy.</p>
            <p>This site is happily self-funded. If you want to support it, $2 keeps it live for one more day. Thank you for considering.</p>
          </>
        ) : (
          <button type="button" className="self-start text-os-link hover:underline" onClick={() => setExpanded(true)}>View more</button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-3 flex-1 overflow-hidden rounded-sm border border-black/20">
            {COST.segments.map((s, i) => (
              <span key={s.id} style={{ width: `${(s.amount / COST.total) * 100}%`, background: fundColor(i * 3) }} />
            ))}
          </div>
          <span className="font-bold tabular-nums">${COST.total}/year</span>
        </div>
        <ul className="flex flex-wrap gap-x-3 gap-y-1">
          {COST.segments.map((s, i) => (
            <li key={s.id} className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-sm" style={{ background: fundColor(i * 3) }} />
              {s.label}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex items-center gap-3">
        <Chip k={now.k} color={now.idx === undefined ? undefined : fundColor(now.idx)} ink={now.idx === undefined ? undefined : inkOn(now.idx)} />
        <div className="min-w-0">
          <div className="text-[15px] font-bold truncate">{now.name}</div>
          <div>{now.sub}</div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Chip k={first} color={first ? fundColor(nextIdx) : undefined} ink={first ? inkOn(nextIdx) : undefined} />
        <div className="min-w-0 flex-1">
          <label className="flex items-baseline gap-1">
            <input
              type="number" min={1} max={MAX_DAYS} step={1} inputMode="numeric" aria-label="Days to fund"
              value={days}
              onChange={(e) => setDays(Number(e.target.value) || 1)}
              onBlur={() => setDays(count)}
              className="text-[15px] font-bold tabular-nums bg-transparent outline-none focus-visible:underline [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
              style={{ width: `${String(count).length + 1}ch` }}
            />
            <span className="text-[15px] font-bold">{count === 1 ? "day" : "days"}</span>
          </label>
          <div>{first ? `of funding ${rangeText(first, count)}.` : " "}</div>
        </div>
        <div className="flex flex-col gap-1">
          <button type="button" aria-label="One more day" aria-disabled={count >= MAX_DAYS} onClick={() => step(1)}
            className="flex w-4 h-4 items-center justify-center rounded-sm border border-black/30 aria-disabled:opacity-40"><CaretUp size={8} weight="bold" /></button>
          <button type="button" aria-label="One fewer day" aria-disabled={count <= 1} onClick={() => step(-1)}
            className="flex w-4 h-4 items-center justify-center rounded-sm border border-black/30 aria-disabled:opacity-40"><CaretDown size={8} weight="bold" /></button>
        </div>
        <button
          type="button" onClick={buy} aria-disabled={busy}
          aria-label={unknown ? "Fund this site" : buyLabel(count, first)}
          className="flex h-8 items-center gap-1 rounded px-3 font-bold tabular-nums text-white aria-disabled:opacity-60"
          style={{ background: fundColor(0) }}
        >
          <ShoppingCart size={16} weight="bold" aria-hidden="true" />
          {money(count * PRICE_PER_DAY)}
        </button>
      </div>

      <div className="flex gap-1 select-none" role="grid" aria-label="Funding calendar">
        <div className="flex flex-col gap-1 pt-4 text-[9px] leading-3 opacity-60">
          {ROWS.map((r) => <span key={r} className="h-3 w-3 text-center">{r}</span>)}
        </div>
        {Array.from({ length: WEEKS }, (_, w) => {
          const col = addDays(startKey, w * 7);
          const firstOfMonth = Array.from({ length: 7 }, (_, d) => addDays(col, d)).find((k) => k.endsWith("-01"));
          return (
            <div key={col} className="flex flex-col gap-1">
              <span className="h-3 text-[9px] leading-3 opacity-60 whitespace-nowrap">{w === 0 || firstOfMonth ? monthShort(firstOfMonth ?? col) : ""}</span>
              {ROWS.map((_, d) => {
                const k = addDays(col, d);
                const idx = unknown ? undefined : state.owner.get(k);
                const sel = !unknown && first && selEnd && k >= first && k <= selEnd && !state.filled.has(k);
                const bg = idx !== undefined ? fundColor(idx) : sel ? fundColor(nextIdx) : undefined;
                const who = idx !== undefined ? state.runs[idx].name : sel ? "your days" : k < today ? "unfunded" : "open";
                return (
                  <button
                    key={k} type="button" onClick={() => pick(k)}
                    aria-label={`${dateProse(k)}: ${who}`}
                    aria-pressed={k === picked}
                    className={cn(
                      "h-3 w-3 rounded-[2px] border focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1",
                      bg ? "border-transparent" : "border-black/20",
                      sel && "opacity-60",
                      !bg && k < today && "opacity-40",
                      (k === today || k === picked) && "outline outline-1 outline-offset-1 outline-current",
                    )}
                    style={{ background: bg }}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-w-[400px]", isWindowsTheme && "p-0 overflow-hidden")} disableSheet>
        <DialogTitle className="sr-only">Fund</DialogTitle>
        <DialogDescription className="sr-only">Who is funding this site, and how to fund the next open days</DialogDescription>
        <DialogHeader>Fund</DialogHeader>
        {isWindowsTheme ? <div className="window-body">{content}</div> : content}
      </DialogContent>
    </Dialog>
  );
}
