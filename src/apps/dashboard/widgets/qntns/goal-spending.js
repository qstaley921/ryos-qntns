import { icon } from "../icon-set.js";
import { escapeHtml } from "./escape.js";
import { attachPopCues, popCues } from "./goal-log.js";
import { addDays, columnsThrough, diffDays, todayKey } from "./fund.js";
import { rampColor } from "./ramp.js";

/*
 * QNTNs spending — CHECKLIST-28 items 4, 4a–4f, reworked (§4 Rework 1).
 * The meditation heatmap at a bigger block: days run on as one grid across
 * months, a column per week-run, month names on top, M T W R F S Y down the
 * side, no day numbers. Each day with money shows its net; a click shows
 * the day's rows in the shared pop-up, as the pie and the (i)s do (R25).
 *
 * DATA, the planned GET /goals/spending reply (item 5):
 *   { rows: [{ date: "2026-09-14", kind: "spent" | "earned",
 *              category: "Groceries", description: "Aldi", amount: 84.12 }] }
 * `amount` is always positive; `kind` carries the sign.
 *
 * COLOUR (4f, confirmed by the user 2026-10-06). No money moved that day:
 * the open square. Otherwise green when the day's net (earned − spent) is
 * >= 0, an income-only day included, red when it is below. Intensity (4) is
 * |net| against the drawn range's top net-in day (green) or top net-out day
 * (red), 24% to 100% of the colour over the page.
 *
 * SIGNS (Rework 2, R6, superseding R2). A negative amount prints "-$84",
 * blocks included; a positive one is bare, never "+". A block's figure is the
 * day's net, in a dark shade of its own hue on a light block or a pale tint
 * on a dark one (the CSS, keyed on data-dark). In the day view a spent row
 * is negative. $/day prints its own sign (Rework 4, R15): "$54/day" green,
 * making money; "-$54/day" red, losing it.
 *
 * THE HEAD is the title and the pie toggle (stewardship's outline/fill
 * chart button, aria-pressed while the pie is open; R9). THE FOOT (R12),
 * every width: [trend] "27 days" (i) left, [trend] "$54/day" (i) right, in
 * stewardship's foot type. Figures ink; only the $/day amount green/red
 * (R5). Trend (R16): the meditation head's arrow, against the figure's last
 * different value (lastChange), up green, down red, for both figures; none
 * if it never changed.
 *
 * THE FIGURES. Both use the reader's whole history, not the drawn range.
 *   Age of money (4b): balance ÷ average daily spending. Balance is all
 *     earned − all spent; daily spending is all spent ÷ days from the first
 *     row through today, quiet days counting. $100 at $10/day = 10 days;
 *     $150 in debt at $50/day = −3 days (negative, not floored). null with
 *     nothing spent.
 *   $/day (4c, R15, R23): the mean of (earned − spent) a day over all
 *     time, first data day to last, quiet days counting as 0. Positive =
 *     making money = better.
 *
 * THE GRID is fund.css's, classes and all, as goal-meditation.js uses it;
 * goal-spending.css only sets the tokens: a 36px block, 4px gap, so a
 * 40px pitch (meditation's is 20, so this is twice the square), and the
 * 16px weekday label plus its 4px gap.
 *
 *   grid width = 40 x columns − 4 + 20 = 40 x columns + 16
 *
 * A month is at most 6 week-runs: 6 x 40 + 16 = 256, so one month fits a
 * 288 phone (320 − 2 x 16 gutters). Whole months are taken right to left
 * while they fit, ending on the current month, and always back to the first
 * row's month (R10): what does not fit scrolls sideways in fund.css's
 * .qntns-fund__calendar (no bar), opened on the newest month. Leftover width,
 * when it all fits, is split as side padding.
 */

const MONEY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const CENTS = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const MONTH = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", year: "numeric" });
const MONTH_LONG = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long" });
const LONG = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });
const utc = (key) => new Date(`${key}T00:00:00Z`);

const clean = (rows) => (Array.isArray(rows) ? rows : [])
    .filter((r) => r && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && (r.kind === "spent" || r.kind === "earned") && Number(r.amount) > 0)
    .map((r) => ({ date: r.date, kind: r.kind, category: String(r.category ?? ""), description: String(r.description ?? ""), amount: Number(r.amount) }))
    // Earned before spent on the same day, so a payday's income can pay for it.
    .sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : (a.kind === "earned" ? -1 : 1)));

// { "2026-09-14": { spent, earned, rows } }
const byDay = (rows) => {
    const days = {};
    for (const r of rows) {
        const d = (days[r.date] ??= { spent: 0, earned: 0, rows: [] });
        d[r.kind] += r.amount;
        d.rows.push(r);
    }
    return days;
};

// "−3 days": real minus, singular by absolute value.
const daysText = (n) => `${n < 0 ? "−" : ""}${Math.abs(n)} day${Math.abs(n) === 1 ? "" : "s"}`;

// 4b. Whole days: balance (all earned − all spent) ÷ average daily spending (all spent ÷ days from the
// first row through `asOf`, default today, quiet days counting). Negative balance = negative age.
// null with no rows or nothing spent. `asOf` counts only rows up to that date, so R16's lastChange can
// read the figure on an earlier day.
export const ageOfMoney = (input, asOf = todayKey()) => {
    const rows = clean(input).filter((r) => r.date <= asOf);
    const spent = rows.reduce((n, r) => n + (r.kind === "spent" ? r.amount : 0), 0);
    if (!spent) return null;
    const earned = rows.reduce((n, r) => n + (r.kind === "earned" ? r.amount : 0), 0);
    return Math.round(((earned - spent) * (diffDays(rows[0].date, asOf) + 1)) / spent);
};

// 4c, R15, R23. Whole dollars a day, earned − spent, averaged over all
// time: the first data day to the last one up to `asOf` (R16 reads it on an
// earlier day). null with no rows.
export const perDay = (input, asOf = null) => {
    const rows = clean(input).filter((r) => !asOf || r.date <= asOf);
    if (!rows.length) return null;
    const net = rows.reduce((sum, r) => sum + (r.kind === "earned" ? r.amount : -r.amount), 0);
    return Math.round(net / (diffDays(rows[0].date, rows[rows.length - 1].date) + 1));
};

// R16. The arrow from `then` to `now`; null without both.
export const trend = (now, then) => (now == null || then == null ? null
    : now > then ? "arrow-up" : now < then ? "arrow-down" : "minus");

// R16. The figure's last different value: `figure(day)` recomputed a day
// further back each step until it differs from today's; null if it never
// did from `first` on.
// ponytail: recomputes from scratch each step, O(days × rows); fine for a
// person's ledger, keep running totals if it ever lags.
export const lastChange = (figure, today, first) => {
    const now = figure(today);
    for (let d = addDays(today, -1); d >= first; d = addDays(d, -1)) {
        const then = figure(d);
        if (then !== now) return then;
    }
    return null;
};

// Spend by category, biggest first.
export const categories = (rows) => {
    const sums = {};
    for (const r of rows) if (r.kind === "spent") sums[r.category || "Other"] = (sums[r.category || "Other"] ?? 0) + r.amount;
    return Object.entries(sums).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
};


// R3, R6: "$84", "-$84", "$1.2k". Whole dollars under a thousand.
export const short = (n) => {
    const a = Math.round(Math.abs(n));
    // From $10k whole thousands, so a block figure is never longer than
    // "-$1.2k" (30.22 measured, see goal-spending.css .qntns-spend__block).
    const k = a >= 10000 ? `${Math.round(a / 1000)}k` : a >= 1000 ? `${Number((a / 1000).toFixed(1))}k` : a;
    return `${n < 0 && a ? "-" : ""}$${k}`;
};

/*
 * 4e / R17. A LARGE PIE AND A KEY, no labels on the wheel. Slices run
 * clockwise from 12 o'clock, biggest first, each a ramp colour. The wheel is
 * `size` square (the view's width floored to 4, at most 240), r = size / 2.
 * The key under it is one row per category: swatch, name, total.
 */
const f2 = (n) => n.toFixed(2);
const wheel = (cats, size) => {
    const total = cats.reduce((a, c) => a + c.amount, 0);
    const r = size / 2;
    const pt = (a) => `${f2(r + r * Math.sin(a))} ${f2(r - r * Math.cos(a))}`;
    let turn = 0;
    const body = cats.map((c, i) => {
        const a0 = turn * 2 * Math.PI;
        turn += c.amount / total;
        const a1 = turn * 2 * Math.PI;
        const fill = rampColor(i, cats.length);
        const shape = cats.length === 1
            ? `<circle cx="${r}" cy="${r}" r="${r}" fill="${fill}"/>`
            : `<path d="M${r} ${r}L${pt(a0)}A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${pt(a1)}Z" fill="${fill}"/>`;
        return `<g class="qntns-spend__slice" data-cat="${escapeHtml(c.name)}" tabindex="0" role="button" aria-label="${escapeHtml(c.name)}, ${MONEY.format(c.amount)}">${shape}</g>`;
    }).join("");
    return `<svg class="qntns-spend__pie" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;
};

// R17. The key: one button row per category, in the slices' colours.
export const pieKey = (cats) => `
      <ul class="qntns-spend__key">${cats.map((c, i) => `
        <li><button type="button" class="qntns-spend__key-row" data-cat="${escapeHtml(c.name)}"><span class="qntns-spend__swatch" style="background: ${rampColor(i, cats.length)}"></span><span>${escapeHtml(c.name)}</span><span>${MONEY.format(c.amount)}</span></button></li>`).join("")}
      </ul>`;

// R17. A category's line items, newest first: Date, Description, Amount
// (spent, so "-$", R6).
const SHORT_DATE = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
export const pieItems = (rows, name) => {
    const items = rows.filter((r) => r.kind === "spent" && (r.category || "Other") === name)
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((r) => `<tr class="is-spent"><td>${SHORT_DATE.format(utc(r.date))}</td><td>${escapeHtml(r.description)}</td><td>${CENTS.format(-r.amount)}</td></tr>`).join("");
    return `
      <div class="qntns-med__title qntns-spend__view-title">${escapeHtml(name)}</div>
      <table class="qntns-spend__rows">
        <thead><tr><th scope="col">Date</th><th scope="col">Description</th><th scope="col">Amount</th></tr></thead>
        <tbody>${items}</tbody>
      </table>`;
};

// Lucide has no pie in the vendored set; this is Lucide's chart-pie, 18px
// like stewardship's chart glyph. R9: its outline + fill layers, as
// goal-stewardship.js's chart toggle; the fill wipes in while pressed.
const PIE_GLYPH = `<svg class="qntns-steward__chart-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M21 12A9 9 0 1 1 12 3v9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/></svg>`;
const PIE_BUTTON = `<button type="button" class="qntns-steward__chart" data-spend-pop="pie" aria-pressed="false" aria-label="Spending by category">`
    + `<span class="qntns-steward__chart-layer qntns-steward__chart-layer--outline">${PIE_GLYPH}</span>`
    + `<span class="qntns-steward__chart-layer qntns-steward__chart-layer--fill">${PIE_GLYPH}</span></button>`;

// 4d, R12, R22: one (i) per figure, each explaining only its own, verbatim.
const INFO = {
    age: ["Age of money (days)", "Age of money is your balance divided by what you spend on average each day: how many days your money would last. Negative means you have spent more than you have earned. The true goal is to have your life funded. That’s when income can stop."],
    cost: ["Dollars per day ($/day)", "Average spending per day is the average amount of money spent or earned per day. Positive means you’re saving more than you’re spending."],
};

// R25. A day and an (i) open in the pie's pop-up: their title takes the
// range control's place, the content the scrolling body.
const X = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
const infoView = (which) => `<p class="qntns-spend__info">${INFO[which][1]}</p>`;

// 4a / R4. The day's rows; a spent row is negative (R6), coloured by kind.
const detail = (key, day) => {
    const rows = day.rows.map((r) => `
        <tr class="is-${r.kind}"><td>${escapeHtml(r.category)}</td><td>${escapeHtml(r.description)}</td><td>${CENTS.format(r.kind === "spent" ? -r.amount : r.amount)}</td></tr>`).join("");
    return `
      <table class="qntns-spend__rows">
        <thead><tr><th scope="col">Category</th><th scope="col">Description</th><th scope="col">Amount</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
};

// R19. The months that have data, oldest first, as "2026-08".
export const dataMonths = (rows) => [...new Set(rows.map((r) => r.date.slice(0, 7)))];

// R26. Every month from `first` to `last`, as "2026-08", gaps included.
// (The 1st plus 31 days always lands in the next month.)
export const monthList = (first, last) => {
    const out = [];
    for (let m = first; m <= last; m = addDays(`${m}-01`, 31).slice(0, 7)) out.push(m);
    return out;
};

// R26. The closed control's text: "All time" for the whole list, else
// "Sep 2026", "Aug – Oct 2026", or both years when the range spans two.
const MONTH_ONLY = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short" });
export const rangeLabel = (from, to, all) => {
    if (from === all[0] && to === all[all.length - 1]) return "All time";
    const [a, b] = [utc(`${from}-01`), utc(`${to}-01`)];
    if (from === to) return MONTH.format(b);
    return `${from.slice(0, 4) === to.slice(0, 4) ? MONTH_ONLY.format(a) : MONTH.format(a)} – ${MONTH.format(b)}`;
};

const inRange = (rows, from, through) => rows.filter((r) => r.date >= from && r.date <= through);
// The From month's first day to the To month's last (or today).
const span = (rows, state, today) => {
    const from = `${state.from}-01`;
    const through = [monthEnd(`${state.to}-01`), today].sort()[0];
    return { from, through, shown: inRange(rows, from, through) };
};

/*
 * R26. THE MONTH-RANGE MENU: views-menu.js's rows (24 box, fill rising
 * behind the check) under a 32 trigger that shows rangeLabel(). "All time"
 * first, then every month oldest first; a month with no data is disabled
 * (gray, skipped by the arrows). First month clicked = start (the menu
 * stays open), second = end, swapped if picked backwards; then it closes.
 * A row is checked while its month is in the range.
 */
const menuRow = (key, label, on = true) => `
          <button type="button" class="qntns-views__row" role="menuitemcheckbox" aria-checked="false" tabindex="-1" data-spend-month="${key}"${on ? "" : " disabled"}>
            <span class="qntns-views__box"><span class="qntns-views__box-fill"></span>${icon("check", { size: 16, className: "qntns-views__box-check" })}</span>
            <span class="qntns-views__label">${label}</span>
          </button>`;
const rangeMenu = (all, has) => `
      <div class="qntns-spend__range">
        <button type="button" class="qntns-spend__range-button" data-spend-range aria-haspopup="menu" aria-expanded="false" aria-label="Months shown">
          <span data-spend-range-label></span>${icon("chevron-down", { size: 16 })}
        </button>
        <div class="qntns-spend__range-menu" role="menu" aria-label="Months shown" data-spend-menu hidden>${menuRow("all", "All time")}${all.map((m) => menuRow(m, MONTH.format(utc(`${m}-01`)), has.has(m))).join("")}
        </div>
      </div>`;

/*
 * R25. THE POP-UP, for the pie, a day and each (i): the shared footnote pop-up (footnotes.css
 * .qntns-fn-pop*, as goal-projects.js uses it, over the window). Inside, top
 * to bottom: the range menu, the pie, then the key / line items in
 * .qntns-fn-pop__body, the only part that scrolls (R20), with goal-log.js's
 * popCues. A day or an (i) shows a title in the range's place, no pie, and
 * its table or text in the body. It lives beside the calendar, not in it, so a repaint on resize
 * leaves it alone.
 */
const piePop = (all, has) => `
    <div class="qntns-fn-pop qntns-spend__pop" data-spend-pie hidden>
      <div class="qntns-fn-pop__scrim" data-spend-pie-close></div>
      <div class="qntns-fn-pop__panel" role="dialog" aria-modal="true" aria-label="Spending by category">
        <button type="button" class="qntns-fn-pop__close" data-spend-pie-close aria-label="Close">${X}</button>
        ${rangeMenu(all, has)}
        <div class="qntns-med__title qntns-spend__pop-title" data-spend-title hidden></div>
        <div class="qntns-spend__charts" data-spend-chart></div>
        <div class="qntns-fn-pop__body" data-spend-items tabindex="0" aria-live="polite"></div>${popCues()}
      </div>
    </div>`;

// meditation's layout() at a 40px pitch; see the head of this file.
const LABELS = ["M", "T", "W", "R", "F", "S", "Y"];
const PITCH = 40;
const GUTTER = 16;
const monthStart = (key) => `${key.slice(0, 7)}-01`;
const monthEnd = (key) => addDays(monthStart(addDays(monthStart(key), 31)), -1);

// R10: and back to the first row's month whatever the width, so a narrow
// column scrolls sideways (fund.css's .qntns-fund__calendar) instead of
// dropping months; attach scrolls the newest month into view. Padding only
// when everything fits.
export const layout = (today, width, first = today) => {
    const through = monthEnd(today);
    let from = monthStart(today);
    let columns = columnsThrough(from, through).length;
    for (let months = 1; ; months += 1) {
        const earlier = monthStart(addDays(from, -1));
        const more = columnsThrough(earlier, addDays(from, -1)).length;
        const fits = width == null ? months < 2 : PITCH * (columns + more) + GUTTER <= width;
        if (!fits) break;
        from = earlier;
        columns += more;
    }
    if (first < from) {
        from = monthStart(first);
        columns = columnsThrough(from, through).length;
    }
    const spare = width == null ? 0 : Math.max(0, width - (PITCH * columns + GUTTER));
    const left = Math.floor(spare / 8) * 4;
    const right = Math.floor((spare - left) / 4) * 4;
    return { from, through, left, right };
};

export const renderSpending = (input = [], { today = todayKey(), width = null } = {}) => {
    const rows = clean(input);
    const days = byDay(rows);
    const age = ageOfMoney(rows, today);
    const cost = perDay(rows, today);
    const first = rows[0]?.date ?? today;
    const { from, through, left, right } = layout(today, width, first);
    const built = columnsThrough(from, through);

    // 4f: each colour is scaled on its own top, so a payday does not wash out
    // every red day. net = earned − spent.
    const net = (k) => days[k].earned - days[k].spent;
    const nets = Object.keys(days).filter((k) => k >= from && k <= through).map(net);
    const topIn = Math.max(0, ...nets);
    const topOut = Math.max(0, ...nets.map((x) => -x));

    const groups = [];
    for (const column of built) {
        const last = groups[groups.length - 1];
        if (last && last.month === column.month) last.columns.push(column);
        else groups.push({ month: column.month, columns: [column] });
    }
    const months = groups
        .map((g) => `<span class="qntns-fund__month" style="--weeks: ${g.columns.length}">${MONTH_LONG.format(utc(g.columns[0].keys[0]))}</span>`)
        .join("");

    const cell = (k) => {
        if (!k) return `<span class="qntns-fund__day is-blank"></span>`;
        const when = LONG.format(utc(k));
        if (k < first || k > today) return `<span class="qntns-fund__day is-out" role="img" aria-label="${when}: no entry"></span>`;
        const d = days[k];
        if (!d) return `<span class="qntns-fund__day is-zero" role="img" aria-label="${when}: nothing">$0</span>`;
        const n = net(k);
        const up = n >= 0;
        const top = up ? topIn : topOut;
        const mix = Math.round(24 + 76 * (top ? Math.abs(n) / top : 0));
        const label = `${when}: spent ${MONEY.format(d.spent)}, earned ${MONEY.format(d.earned)}`;
        return `<button type="button" class="qntns-fund__day qntns-spend__block ${up ? "is-up" : "is-down"}" style="--mix: ${mix}%"${mix > 56 ? " data-dark" : ""} data-day="${k}" aria-label="${label}">${short(n)}</button>`;
    };
    // R13: the weekday axis is its own column, outside the scroller.
    const axis = LABELS.map((label) => `<div class="qntns-fund__row"><span class="qntns-fund__weekday">${label}</span></div>`).join("");
    const grid = LABELS.map((label, row) => `
        <div class="qntns-fund__row">${built.map((c) => cell(c.keys[row - c.startRow])).join("")}</div>`).join("");

    const tone = cost > 0 ? "is-up" : cost < 0 ? "is-down" : "";
    const money = short(cost ?? 0);
    // R16. Up green, down red, for both; lastChange never returns an equal
    // value, so no "minus".
    const arrow = (now, then, said) => {
        const dir = trend(now, then);
        return dir ? `<span class="qntns-med__trend ${dir === "arrow-up" ? "is-improving" : "is-worsening"}" role="img" aria-label="${dir === "arrow-up" ? "Up" : "Down"} from ${said(then)}">${icon(dir, { size: 16 })}</span>` : "";
    };
    const ageTrend = arrow(age, lastChange((d) => ageOfMoney(rows, d), today, first), daysText);
    const costTrend = arrow(cost, lastChange((d) => perDay(rows, d), today, first), (n) => `${short(n)}/day`);
    const info = (which, label) => `<button type="button" class="qntns-proj__info" data-spend-pop="${which}" aria-label="${label}">${icon("info", { size: 16 })}</button>`;
    return `
    <div class="qntns-spend" style="--pad: 0 ${right}px 0 ${left}px">
      <div class="qntns-med__head">
        <div class="qntns-med__title">Spending</div>
        ${PIE_BUTTON}
      </div>
      <div class="qntns-spend__cal">
        <div class="qntns-spend__axis" aria-hidden="true">
          <div class="qntns-fund__months"><span class="qntns-fund__month">&nbsp;</span></div>
          <div class="qntns-fund__grid">${axis}</div>
        </div>
        <div class="qntns-spend__days">
          <div class="qntns-spend__scroll" data-spend-cal>
            <div class="qntns-fund__months">${months}</div>
            <div class="qntns-fund__grid">${grid}
            </div>
          </div>
          <button type="button" class="qntns-log__more qntns-spend__step" data-spend-step="-1" aria-label="Earlier days" hidden>${icon("chevron-left", { size: 18 })}</button>
          <button type="button" class="qntns-log__more qntns-spend__step" data-spend-step="1" aria-label="Later days" hidden>${icon("chevron-right", { size: 18 })}</button>
        </div>
      </div>
      <div class="qntns-spend__foot">
        <div class="qntns-spend__fig">${ageTrend}<span>${age === null ? "-" : daysText(age)}</span>${info("age", "What is age of money?")}</div>
        <div class="qntns-spend__fig">${costTrend}<span>${cost === null ? "-" : `<span class="${tone}">${money}</span>/day`}</span>${info("cost", "What is dollars per day?")}</div>
      </div>
    </div>`;
};

/*
 * Draws at the host's measured width and again when it changes (meditation's
 * attach). A day, an (i) or the pie toggle opens the one pop-up (R25); the
 * toggle is filled while the pie is in it. Enter and Space on a day arrive as
 * clicks. Escape closes the month menu, then deselects a category, then
 * closes the pop-up; focus goes back to what opened it. Returns teardown.
 */
export const attachSpending = (host, input, options = {}) => {
    const rows = clean(input);
    const today = options.today ?? todayKey();
    const days = byDay(rows);
    // No data: this month alone, disabled, so the pop-up still draws.
    const has = new Set(dataMonths(rows));
    const all = rows.length ? monthList(rows[0].date.slice(0, 7), rows[rows.length - 1].date.slice(0, 7)) : [today.slice(0, 7)];
    let drawn = null;
    // The pop-up: { kind: "pie", from, to, anchor, name } | { kind: "day",
    // key } | { kind: "info", which } | null.
    let open = null;
    let opener = null;

    host.innerHTML = `<div data-spend-view></div>${piePop(all, has)}`;
    const view = host.querySelector("[data-spend-view]");
    const pop = host.querySelector("[data-spend-pie]");
    const panel = pop.querySelector(".qntns-fn-pop__panel");
    const button = pop.querySelector("[data-spend-range]");
    const menu = pop.querySelector("[data-spend-menu]");
    const title = pop.querySelector("[data-spend-title]");
    const chart = pop.querySelector("[data-spend-chart]");
    const items = pop.querySelector("[data-spend-items]");
    const syncCues = attachPopCues(panel);
    const toggle = () => view.querySelector('[data-spend-pop="pie"]');
    const isPie = () => open?.kind === "pie";

    // R13. Which sides have more: the fade (mask) and the chevron square on
    // each. 2px of slack, as goal-log.js: fractional scroll stops a hair short.
    const edges = () => {
        const cal = view.querySelector("[data-spend-cal]");
        const left = cal.scrollLeft > 2;
        const right = cal.scrollLeft + cal.clientWidth < cal.scrollWidth - 2;
        cal.classList.toggle("is-more-left", left);
        cal.classList.toggle("is-more-right", right);
        view.querySelector('[data-spend-step="-1"]').hidden = !left;
        view.querySelector('[data-spend-step="1"]').hidden = !right;
    };
    const paint = (width) => {
        const w = Math.floor(width);
        if (w === drawn) return;
        drawn = w;
        view.innerHTML = renderSpending(rows, { today, width: w });
        toggle().setAttribute("aria-pressed", String(isPie()));
        const cal = view.querySelector("[data-spend-cal]");
        cal.scrollLeft = cal.scrollWidth;
        cal.addEventListener("scroll", edges, { passive: true });
        edges();
    };

    // R25, R26. Redraw the pie for the range: the trigger's text, the rows'
    // checks (set, never rebuilt, so the fill transition runs), the pie at
    // the panel's width less its 48 of padding (at most 240), the key.
    const fill = () => {
        button.querySelector("[data-spend-range-label]").textContent = rangeLabel(open.from, open.to, all);
        menu.querySelectorAll("[data-spend-month]").forEach((el) => {
            const m = el.dataset.spendMonth;
            el.setAttribute("aria-checked", String(m === "all" ? rangeLabel(open.from, open.to, all) === "All time" : has.has(m) && m >= open.from && m <= open.to));
        });
        const cats = categories(span(rows, open, today).shown);
        chart.innerHTML = cats.length ? wheel(cats, Math.min(240, Math.floor((chart.clientWidth - 48) / 4) * 4)) : "";
        items.innerHTML = cats.length ? pieKey(cats) : "<p>Nothing spent.</p>";
        open.name = null;
        items.scrollTop = 0;
        syncCues();
    };
    // R17. pick(name) selects a category (its slice marked, the items in the
    // key's place); pick(null) brings the key back. Returns whether it acted.
    const pick = (name) => {
        if (!isPie() || open.name === name) return false;
        open.name = name;
        pop.querySelectorAll(".qntns-spend__slice").forEach((x) => x.classList.toggle("is-active", x.dataset.cat === name));
        const ranged = span(rows, open, today).shown;
        items.innerHTML = name ? pieItems(ranged, name) : pieKey(categories(ranged));
        items.scrollTop = 0;
        syncCues();
        return true;
    };
    const menuOpen = () => !menu.hidden;
    const showMenu = (on, focus = true) => {
        menu.hidden = !on;
        button.setAttribute("aria-expanded", String(on));
        if (isPie()) open.anchor = null;
        if (on) (menu.querySelector('[aria-checked="true"]:not([disabled])') ?? menu.querySelector("button"))?.focus();
        else if (focus) button.focus();
    };
    // Open the pop-up on `next` from the button `from`. The pie shows the
    // range control and the wheel; a day or an (i) a title instead.
    const openPop = (next, from) => {
        open = next;
        opener = from;
        const pie = isPie();
        const head = next.kind === "day" ? LONG.format(utc(next.key)) : next.kind === "info" ? INFO[next.which][0] : "Spending by category";
        button.parentElement.hidden = !pie;
        chart.hidden = !pie;
        title.hidden = pie;
        title.textContent = head;
        panel.setAttribute("aria-label", head);
        pop.hidden = false;
        toggle().setAttribute("aria-pressed", String(pie));
        if (pie) {
            fill();
            button.focus();
            return;
        }
        items.innerHTML = next.kind === "day" ? detail(next.key, days[next.key]) : infoView(next.which);
        items.scrollTop = 0;
        syncCues();
        items.focus();
    };
    const closePop = () => {
        if (!open) return;
        showMenu(false, false);
        open = null;
        pop.hidden = true;
        toggle().setAttribute("aria-pressed", "false");
        // A repaint may have replaced the button that opened it.
        (opener?.isConnected ? opener : opener?.dataset.day ? view.querySelector(`[data-day="${opener.dataset.day}"]`) : view.querySelector(`[data-spend-pop="${opener?.dataset.spendPop}"]`))?.focus();
        opener = null;
    };
    // R26. All time resets and closes; a month is the start, the next the end.
    const choose = (m) => {
        if (m === "all") [open.from, open.to] = [all[0], all[all.length - 1]];
        else if (!open.anchor) [open.from, open.to] = [m, m];
        else [open.from, open.to] = [open.anchor, m].sort();
        const end = m === "all" || open.anchor;
        fill();
        if (end) showMenu(false);
        else open.anchor = m;
    };

    const onClick = (event) => {
        const t = event.target;
        const step = t.closest?.("[data-spend-step]");
        const day = t.closest?.("[data-day]");
        const which = t.closest?.("[data-spend-pop]");
        const month = t.closest?.("[data-spend-month]");
        if (step) {
            const cal = view.querySelector("[data-spend-cal]");
            cal.scrollBy({ left: Number(step.dataset.spendStep) * (cal.clientWidth - 48), behavior: "smooth" });
        } else if (day) openPop({ kind: "day", key: day.dataset.day }, day);
        else if (which?.dataset.spendPop === "pie") openPop({ kind: "pie", from: all[0], to: all[all.length - 1], anchor: null, name: null }, which);
        else if (which) openPop({ kind: "info", which: which.dataset.spendPop }, which);
        else if (t.closest?.("[data-spend-pie-close]")) closePop();
        else if (t.closest?.("[data-spend-range]")) showMenu(!menuOpen());
        else if (month) choose(month.dataset.spendMonth);
        else if (t.closest?.("[data-cat]")) pick(t.closest("[data-cat]").dataset.cat);
        // R17: empty space in the pie's pop-up (not a line item) deselects.
        else if (pop.contains(t) && !t.closest("[data-spend-items] table, [data-spend-menu]")) pick(null);
    };
    // A press outside the open menu closes it (views-menu.js), focus left be.
    const onDown = (event) => {
        if (menuOpen() && !event.target.closest?.(".qntns-spend__range")) showMenu(false, false);
    };
    const onKey = (event) => {
        const t = event.target;
        if (menuOpen() && menu.contains(t)) {
            // views-menu.js's keys: arrows walk the enabled rows and wrap,
            // Home / End jump, Tab leaves and closes.
            const list = [...menu.querySelectorAll("button:not([disabled])")];
            const at = list.indexOf(t);
            const to = (i) => list[(i + list.length) % list.length].focus();
            if (event.key === "ArrowDown") to(at + 1);
            else if (event.key === "ArrowUp") to(at - 1);
            else if (event.key === "Home") to(0);
            else if (event.key === "End") to(list.length - 1);
            else if (event.key === "Escape") showMenu(false);
            else if (event.key === "Tab") return showMenu(false, false);
            else return;
            event.preventDefault();
            return;
        }
        if (event.key === "Escape" && open) {
            event.preventDefault();
            if (menuOpen()) showMenu(false);
            else if (!pick(null)) closePop();
        } else if ((event.key === "Enter" || event.key === " ") && t.closest?.(".qntns-spend__slice")) {
            event.preventDefault();
            pick(t.closest(".qntns-spend__slice").dataset.cat);
        }
    };

    paint(host.clientWidth);
    const observer = new ResizeObserver(([entry]) => paint(entry.contentRect.width));
    observer.observe(host);
    host.addEventListener("click", onClick);
    host.addEventListener("pointerdown", onDown);
    host.addEventListener("keydown", onKey);
    return () => {
        observer.disconnect();
        host.removeEventListener("click", onClick);
        host.removeEventListener("pointerdown", onDown);
        host.removeEventListener("keydown", onKey);
        host.innerHTML = "";
    };
};
