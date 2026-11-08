import { addDays, diffDays, todayKey } from "./fund.js";

/*
 * QNTNs family savings — a line over time through balances I report by hand.
 * CHECKLIST-16 items 16 and 114. No bank connection, ever: `entries` is
 * [{ date: "2026-09-01", balance: 12400 }, ...] in any order.
 *
 * THE BOX, all base 4 except where named. Height 240, padding 8 (item 119).
 *
 *   gutter   8 pad + 8px per character of the longest y label + 8 gap, so
 *            always a multiple of 8. 8px a character over-covers Josefin's
 *            12px digits (about 7px). The y labels end 8 short of the plot.
 *   plot x   gutter to width - 8. Gridlines, line and area span all of it.
 *   plot y   16 (the top tick) down to 212 (the baseline, $0), 196 tall.
 *            212 = 240 - 28: 4 gap, the 16 date row, 8 pad.
 *   y ticks  step = nice(max / 4), at least $1 (no cents); top = the first
 *            step at or above the max, so there is one step of headroom at
 *            most and a max on a step touches the top gridline (item 119).
 *            Each y = round(212 - 196 x value / top): data coordinates, not
 *            spacing, so they are whole px but not on the 4 grid.
 *   dates    a 16px row at 216-232: 4 under the baseline, 8 pad under it.
 *   ticks    one per entry, 1px ink, baseline up 8 (212 to 204).
 *   rule     the active entry's tick run full height (item 121): 1px ink from
 *            the baseline up to its point on the line, over the fill.
 *   chip     item 121. An HTML box over the svg, 24 tall, 8px a character
 *            of the amount + 16 wide (a multiple of 8, so its half is whole).
 *            Bottom 8 above the point, centred on its x, clamped to 0..width
 *            across and to the top; with no room above it goes 8 below.
 *
 * Text y values are baselines, not box edges: 227 is the 216 row top + 2
 * half-leading + 9 Josefin ascent (750/1000 of 12px). Type metric, exempt.
 *
 * THE X DOMAIN (item 114.8) runs past the entries on both sides, so the line
 * rises from $0 at the left edge and holds the last balance flat to the right:
 *
 *   lead  = max(7, ceil(span / 10)) days, span = last - first
 *   start = first - lead
 *   end   = max(today, last + 3 x lead)
 *
 * One entry sits 7 / 28 = 25% in. Ticks and dates are at entries only.
 *
 * y starts at 0, so growth reads at its true size. Every coordinate is a whole px.
 */
const H = 240;
const PAD = 8;
const TOP = 16;
const BASE = H - 28;
const TICK = 8;
const DATE_Y = 227;
const CHAR = 8;
const CHIP = 24;

const MONEY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const DAY = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
const SHORT = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const money = (n) => MONEY.format(n);
const day = (key) => DAY.format(new Date(`${key}T00:00:00Z`));
const short = (key) => SHORT.format(new Date(`${key}T00:00:00Z`));

const nice = (max) => {
    if (!(max > 0)) return 1;
    const power = 10 ** Math.floor(Math.log10(max));
    return [1, 2, 5, 10].map((m) => m * power).find((v) => v >= max);
};

/*
 * THINNING (item 114.5). Each date label is estimated at 8px a character,
 * centred on its tick and clamped inside the plot. Left to right, a label is
 * kept only if it starts 8 or more past the last kept one's end. The last
 * label always stays, dropping earlier kept ones it clashes with.
 */
const thin = (labels) => {
    const kept = [];
    const clear = (a, b) => b.left >= a.right + 8;
    labels.forEach((label, i) => {
        if (i === labels.length - 1) {
            while (kept.length && !clear(kept[kept.length - 1], label)) kept.pop();
            kept.push(label);
        } else if (!kept.length || clear(kept[kept.length - 1], label)) {
            kept.push(label);
        }
    });
    return kept;
};

// The y axis and x span. With no entries max is -Infinity, nice() gives 1, so
// the smallest range the rule yields is 0 to 1: "$0" and "$1" (item 152).
const frame = (entries, width, format) => {
    const max = Math.max(...entries.map((e) => e.balance));
    const step = Math.max(1, nice(max / 4));
    const top = Math.max(step, Math.ceil(max / step) * step);
    const ticks = Array.from({ length: top / step + 1 }, (_, i) => ({
        value: step * i,
        y: Math.round(BASE - (BASE - TOP) * step * i / top),
    }));
    const gutter = PAD + CHAR * Math.max(...ticks.map((t) => format(t.value).length)) + 8;
    return { top, ticks, gutter, x0: gutter, x1: Math.max(gutter, width - PAD) };
};

export const plot = (entries, width, today = todayKey(), { format = money } = {}) => {
    const { top, ticks, gutter, x0, x1 } = frame(entries, width, format);

    const first = entries[0].date;
    const last = entries[entries.length - 1].date;
    const lead = Math.max(7, Math.ceil(diffDays(first, last) / 10));
    const start = addDays(first, -lead);
    const later = addDays(last, 3 * lead);
    const end = today > later ? today : later;
    const days = diffDays(start, end);
    const at = (key) => Math.round(x0 + (x1 - x0) * diffDays(start, key) / days);

    const points = entries.map((e) => ({
        ...e,
        x: at(e.date),
        y: Math.round(BASE - (BASE - TOP) * e.balance / top),
    }));
    const path = [{ x: x0, y: BASE }, ...points, { x: x1, y: points[points.length - 1].y }];

    const labels = points.map((p) => {
        const text = short(p.date);
        const half = CHAR * text.length / 2;
        const cx = Math.min(Math.max(p.x, x0 + half), x1 - half);
        return { text, x: cx, left: cx - half, right: cx + half };
    });
    return { top, ticks, gutter, x0, x1, start, end, points, path, labels, kept: thin(labels) };
};

export const chip = (p, width, { format = money } = {}) => {
    const text = format(p.balance);
    const w = CHAR * text.length + 16;
    const left = Math.min(Math.max(p.x - w / 2, 0), Math.max(0, width - w));
    const above = p.y - 8 - CHIP;
    const top = above >= 0 ? above : Math.min(p.y + 8, H - CHIP);
    return { text, left, top, width: w };
};

// The rule and chip for entry `i` of a plot, or "" for none. Used by the
// render and by attachSavings' in-place updates, so the state is one path.
const activeMarks = (pl, i, width, format) => {
    const p = pl && pl.points[i];
    if (!p) return { rule: "", tag: "" };
    const c = chip(p, width, { format });
    return {
        rule: `<line x1="${p.x}" y1="${BASE}" x2="${p.x}" y2="${p.y}"/>`,
        tag: `<div class="qntns-savings__chip" style="left: ${c.left}px; top: ${c.top}px; width: ${c.width}px">${c.text}</div>`,
    };
};

const clean = (entries) => entries
    .filter((e) => e && typeof e.date === "string" && Number.isFinite(Number(e.balance)))
    .map((e) => ({ date: e.date, balance: Number(e.balance) }))
    .sort((a, b) => (a.date < b.date ? -1 : (a.date > b.date ? 1 : 0)));

const said = (entries, format, title) => {
    const a = entries[0];
    const b = entries[entries.length - 1];
    const now = `${format(b.balance)} on ${day(b.date)}`;
    if (entries.length === 1) return `${title}: ${now}`;
    const way = b.balance > a.balance ? "up from" : (b.balance < a.balance ? "down from" : "same as");
    return `${title}: ${now}, ${way} ${format(a.balance)} on ${day(a.date)}`;
};

// Item 145: `format` writes every value, `title` names the chart, and
// `head: false` leaves out the head block. The defaults are the savings embed.
export const renderSavings = (entries = [], {
    width = null, today = todayKey(), active = null,
    format = money, title = "Family savings", head: withHead = true,
} = {}) => {
    const list = clean(entries);
    const latest = list[list.length - 1];
    const head = withHead ? `
      <div class="qntns-med__head">
        <div class="qntns-med__title">${title}</div>
        <div class="qntns-med__rate">${latest ? format(latest.balance) : "-"}</div>
      </div>` : "";
    if (!width) return `<div class="qntns-savings">${head}</div>`;

    // Item 152: no entries still draws the frame (baseline, gridline, y
    // labels), with no area, line, ticks, dates or chip.
    const pl = latest ? plot(list, width, today, { format }) : { ...frame(list, width, format), points: [], kept: [] };
    const { ticks, gutter, x0, x1, points, path, kept } = pl;
    const xy = (ps) => ps.map((p) => `${p.x},${p.y}`).join(" ");

    // Paint order (item 114.3): area, gridlines, line, baseline, ticks, the
    // active rule (item 121), labels.
    const area = latest ? `<polygon class="qntns-savings__area" points="${xy([...path, { x: x1, y: BASE }])}"/>` : "";
    const grid = ticks.slice(1).map((t) => `
        <line class="qntns-savings__grid" x1="${x0}" y1="${t.y}" x2="${x1}" y2="${t.y}"/>`).join("");
    const line = latest ? `<polyline class="qntns-savings__line" points="${xy(path)}"/>` : "";
    const base = `<line class="qntns-savings__base" x1="${x0}" y1="${BASE}" x2="${x1}" y2="${BASE}"/>`;
    const marks = points.map((p) => `
        <g class="qntns-savings__tick"><line x1="${p.x}" y1="${BASE}" x2="${p.x}" y2="${BASE - TICK}"/></g>`).join("");
    const { rule, tag } = activeMarks(pl, active, width, format);
    const yLabels = ticks.map((t) => `
        <text x="${gutter - 8}" y="${t.y}" text-anchor="end" dominant-baseline="central">${format(t.value)}</text>`).join("");
    const dates = kept.map((l) => `
        <text x="${l.x}" y="${DATE_Y}" text-anchor="middle">${l.text}</text>`).join("");

    return `
    <div class="qntns-savings" style="--plot-x: ${gutter}px">${head}
      <div class="qntns-savings__plot">
        <svg class="qntns-savings__chart" width="${width}" height="${H}" role="img" tabindex="0" aria-label="${latest ? said(list, format, title) : `${title}: no entries yet`}">
          ${area}${grid}
          ${line}
          ${base}${marks}<g class="qntns-savings__active">${rule}</g>${yLabels}${dates}
        </svg>
        <div class="qntns-savings__slot">${tag}</div>
      </div>
      <div class="qntns-savings__live" aria-live="polite"></div>
    </div>`;
};

/*
 * Render into `host` at its measured width, and again whenever that width
 * changes. Same shape as attachMeditation. Returns the teardown.
 *
 * Item 121: the svg is one tab stop. Mouse snaps to the nearest entry by x
 * and leaving hides; a tap shows the nearest, a tap outside hides. Keys:
 * ← / → step, Home / End jump, Escape hides; focus shows the latest, blur
 * hides. Listeners sit on host (the svg is replaced on every repaint) and on
 * document for the outside tap; the teardown removes both.
 */
export const attachSavings = (host, entries, options = {}) => {
    const list = clean(entries);
    let drawn = null;
    let pl = null;
    let active = options.active ?? null;
    const format = options.format ?? money;
    const svg = () => host.querySelector(".qntns-savings__chart");

    const show = (i, say = false) => {
        active = i;
        const g = host.querySelector(".qntns-savings__active");
        const slot = host.querySelector(".qntns-savings__slot");
        if (!g || !slot) return;
        const { rule, tag } = activeMarks(pl, i, drawn, format);
        g.innerHTML = rule;
        slot.innerHTML = tag;
        const p = pl && pl.points[i];
        if (say && p) host.querySelector(".qntns-savings__live").textContent = `${day(p.date)}: ${format(p.balance)}`;
    };
    const nearest = (event) => {
        const x = event.clientX - svg().getBoundingClientRect().left;
        let best = 0;
        pl.points.forEach((p, i) => {
            if (Math.abs(p.x - x) < Math.abs(pl.points[best].x - x)) best = i;
        });
        return best;
    };
    const inside = (event) => pl && svg() && svg().contains(event.target);

    const paint = (width) => {
        const w = Math.floor(width);
        if (w === drawn) return;
        drawn = w;
        const focused = host.contains(document.activeElement);
        host.innerHTML = renderSavings(list, { ...options, width: w, active });
        pl = list.length && w ? plot(list, w, options.today ?? todayKey(), { format }) : null;
        if (focused) svg()?.focus();
    };

    const move = (event) => {
        if (event.pointerType === "touch") return;
        if (inside(event)) show(nearest(event));
        else show(null);
    };
    const leave = (event) => {
        if (event.pointerType !== "touch") show(null);
    };
    const down = (event) => {
        if (inside(event)) show(nearest(event));
        else if (active !== null) show(null);
    };
    const key = (event) => {
        if (!pl) return;
        const last = pl.points.length - 1;
        const from = active ?? last;
        const to = {
            ArrowLeft: Math.max(0, from - 1),
            ArrowRight: Math.min(last, from + 1),
            Home: 0,
            End: last,
        }[event.key];
        if (event.key === "Escape") show(null);
        else if (to === undefined) return;
        else show(to, true);
        event.preventDefault();
    };
    // A click focuses the svg after pointerdown picked an entry; keep that one.
    const focus = () => {
        if (pl && active === null) show(pl.points.length - 1);
    };
    const blur = () => show(null);

    paint(host.clientWidth);
    const observer = new ResizeObserver(([entry]) => paint(entry.contentRect.width));
    observer.observe(host);
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", leave);
    host.addEventListener("keydown", key);
    host.addEventListener("focusin", focus);
    host.addEventListener("focusout", blur);
    document.addEventListener("pointerdown", down);
    return () => {
        observer.disconnect();
        host.removeEventListener("pointermove", move);
        host.removeEventListener("pointerleave", leave);
        host.removeEventListener("keydown", key);
        host.removeEventListener("focusin", focus);
        host.removeEventListener("focusout", blur);
        document.removeEventListener("pointerdown", down);
    };
};
