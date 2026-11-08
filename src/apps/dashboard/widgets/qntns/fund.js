// The button's accessible name. Its visible label is now only a number, so this
// is the only place that says what pressing it does. Revision 3, item 3.
//
// With no known start day — the UNKNOWN state — the range clause is dropped
// rather than left dangling after a comma. The button still works there: it
// asks the Worker to mint a Checkout Session for whatever count is in the box,
// and the Worker knows which days those are even when this page does not.
const buyLabel = (count, firstOpenKey) => {
    const unit = count === 1 ? "day" : "days";
    const head = `Fund ${count} ${unit} for ${money(count * PRICE_PER_DAY)}`;
    const span = rangeText(firstOpenKey, count).replace(/^of funding /, "").replace(/\.$/, "");
    return span ? `${head}, ${span}` : head;
};

/*
 * QNTNs funding — who is paying for this site today, who is next, and how to
 * buy the next open days.
 *
 * Settled with the user on 2026-08-28 (CHECKLIST-v4.md, DECISIONS SETTLED).
 * The four rules below are closed, not open, and everything in this file falls
 * out of them:
 *
 *   1. THE QUEUE IS FIRST-IN-FIRST-OUT AND NOBODY EVER SPLITS A RUN. Buy 30
 *      days and you own the next 30 CALENDAR days outright; the person behind
 *      you starts on day 31. The alternative — interleaving, or splitting a run
 *      around someone else's — makes "who is funding this site today" a
 *      question with more than one answer, and that sentence is the whole
 *      feature.
 *   2. $2.00 A DAY. One price, no tiers, no subscription. The price is one
 *      multiplication and it happens in the input handler; asking a server what
 *      7 x 2 is would be slower and could fail.
 *   3. EASTERN TIME IS THE DAY BOUNDARY. Not the reader's local time, not UTC.
 *      The site has one owner in one timezone, so "whose midnight" gets
 *      answered once here rather than differently for every reader. A reader in
 *      California at 10pm and a reader in New York at 1am see the same funder.
 *   4. AN EMPTY QUEUE OPENS TODAY, AND A GAP IS SKIPPED, NEVER BACKFILLED.
 *      Settled with the user on 2026-08-28, and both halves of it are about the
 *      same thing: NOBODY IS EVER SOLD A DAY THAT HAS ALREADY HAPPENED.
 *        - With no orders at all, the first open day is TODAY. Not tomorrow.
 *          Today is a day this site is running and nobody is paying for it, so
 *          it is the first thing for sale; deferring to tomorrow would mean the
 *          calendar could never be fully funded from a standing start.
 *        - When the queue has DRAINED — a quiet stretch nobody funded — the next
 *          order starts TODAY. It does not resume from the day after the old run
 *          and it does not close the gap behind it. Those skipped days stay
 *          permanently unfunded and draw as OPEN squares in the calendar
 *          forever, which is the honest record: nobody paid for them, so nobody
 *          gets billed for them and nobody's name goes on them.
 *      A run is still strictly contiguous WITHIN itself; the gap sits BETWEEN
 *      runs and never inside one.
 *
 *   5. THERE ARE THREE STATES, AND ONLY TWO OF THEM ARE ANSWERS.
 *
 *        unknown   nobody has told us yet. Dashes: "-" in the chip day, "-" in
 *                  the name, a blank sub line. This is what Ghost emits from
 *                  partials/fund-section.hbs, because a Handlebars template
 *                  cannot fetch and genuinely does not know — and it is also
 *                  where the section STAYS if the Worker never answers.
 *        empty     GET /fund answered and the queue really is empty.
 *                  "No one is funding this site."
 *        funded    GET /fund answered with a name.
 *
 *      THE BUG THIS EXISTS TO PREVENT: the empty state used to be the default,
 *      so with JavaScript off or the Worker down the footer read "No one is
 *      funding this site" on a day somebody had paid for. That is not missing
 *      information, it is FALSE information, and it is false about the one
 *      person the whole section exists to credit. Dashes cost the same nothing
 *      and claim nothing; they also match the date chip, which already uses "-"
 *      to mean "no day to show".
 *
 *      `data-fund-unknown` on `.qntns-fund__tiles` is the hook that keeps the
 *      three apart, and applyQueue is the ONLY thing that removes it.
 *
 *   6. THE ONLY NETWORK IS THIS THEME'S OWN WORKER, AND NEVER TO PAINT.
 *      This rule used to read "no network in this file" and that is no longer
 *      true — see THE NETWORK at the bottom, added when the funding Worker went
 *      up. What survives of it is the part that mattered: the page loads NO
 *      third-party asset and no Stripe script. GET /fund and POST /fund/checkout
 *      both go to qntns-reads.qstaley921.workers.dev, the same Worker the read
 *      receipts already use, so funding adds no new third party. Stripe is
 *      reached by NAVIGATION only — the Worker mints a hosted Checkout URL and
 *      the button goes there — which is what keeps CLAUDE.md's
 *      one-third-party-runtime-call rule intact.
 *
 * WHY THE DAY MATH IS EXPORTED AS PURE FUNCTIONS. Four render functions each
 * working out "today" for themselves is exactly how the tile ends up saying
 * "6 more days" while the calendar fills a different square, on the one night a
 * year it matters. So `fundState` derives the whole story once and every
 * renderer takes that one object. None of them calls todayKey().
 *
 * WHY THERE IS NO MILLISECOND ARITHMETIC ANYWHERE BELOW. Adding 24 hours seven
 * times crosses a 23-hour day in March and a 25-hour day in November, so a
 * seven-day run bought in early March would silently be six and a bit. Every
 * date step in this file goes through `addDays`, which does its arithmetic on a
 * UTC midnight — a plain civil-date counter with no offsets in it at all — and
 * only ever touches a timezone at the two edges: reading a real Date into a key
 * (`dayKey`) and formatting a key for display. Those are the only two places
 * America/New_York appears.
 *
 * THE ONE EXEMPTION, NAMED HERE BECAUSE IT HAS TO BE. A run is 24 hours from
 * the moment it was paid for, not a calendar day (see layQueue), so the day
 * math needs a TIME as well as a day. It gets one WITHOUT breaking the rule
 * above: `dayOffset` reads the Eastern wall-clock time of day as a scalar and
 * the code compares (day key, time of day) PAIRS. Nothing is ever added to a
 * timestamp, so a run bought at 1 PM still ends at 1 PM on the far side of a
 * changeover — a spring-forward week is still seven days and not six and a bit.
 * The scalar is a position within a day, never a duration across one.
 */
import { icon } from "../icon-set.js";
import { escapeHtml } from "./escape.js";
import { playError } from "./sound.js";
import { fundColor } from "./ramp.js";

const ZONE = "America/New_York";

// $2.00 a day. See rule 2 above.
export const PRICE_PER_DAY = 2;

/*
 * THE COST BAR NUMBERS ARE REAL AND HAND-EDITED.
 *
 * $682/year, itemised. These are not derived from anything and no code updates
 * them — when the real bill changes, EDIT THIS CONSTANT and nothing else. The
 * split below is a plausible placeholder standing in until the user corrects
 * the three figures against the actual invoices; the total is the number the
 * user gave and the three parts sum to it exactly.
 *
 *   432 + 22 + 228 = 682   <- keep this true
 *
 * The percentages are computed rather than written down, because two numbers
 * that have to agree are two numbers that can disagree. The LAST segment takes
 * the remainder of 100 rather than its own rounded share, so the three widths
 * always sum to exactly 100% and the bar can never come up a hairline short.
 */
export const COST = {
    total: 682,
    segments: [
        { id: "hosting", label: "Website hosting", amount: 432 },
        { id: "domain", label: "Domain name", amount: 22 },
        { id: "tools", label: "Build tools", amount: 228 }
    ]
};

/*
 * ONE YEAR, AND THIS NUMBER IS NOT A UI GUESS — IT IS THE WORKER'S.
 *
 * worker/src/fund.js declares the same cap and clamps every checkout to it
 * server-side. THE TWO MUST BE CHANGED TOGETHER: the client must never quote a
 * number the server will not honour, or someone types 400, reads "$800.00" over
 * a 400-day range here, and is charged for 365.
 *
 * It was 90 — a quarter — on the reasoning that the queue is strictly
 * first-in-first-out, so a cap is what keeps the NAME changing, which is the
 * whole point of the section. The user settled it at 365 on 2026-08-28: a year
 * is the ceiling a reader recognises, and one funder holding a year is a
 * problem worth having.
 *
 * It is no longer a LAYOUT constant. The day field used to be a fixed 48px
 * sized to hold the largest reachable value, which tied its width to this
 * number; it sizes itself to its own digits now (see paint below), so 365 costs
 * the layout nothing.
 *
 * `max` goes on the input as well, so the native control agrees: the keyboard
 * arrow keys stop there too, and a typed 400 is :out-of-range rather than
 * silently accepted and quietly re-priced.
 */
const MAX_DAYS = 365;

/* -------------------------------------------------------------------------
 * Day keys
 * ---------------------------------------------------------------------- */

const KEY_FORMAT = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
});

// en-CA formats a date as YYYY-MM-DD, which is the key shape, so this is one
// call rather than formatToParts and a join. The keys are also LEXICALLY
// ORDERED — "2026-09-05" < "2026-09-12" as strings — which is why every
// comparison below is a plain string compare and no Date is constructed to
// answer "is this day inside that run".
export const dayKey = (date = new Date()) => KEY_FORMAT.format(date);

export const todayKey = () => dayKey(new Date());

/*
 * THE TIME OF DAY, EASTERN, AS MILLISECONDS PAST THAT DAY'S MIDNIGHT.
 *
 * The second half of a MOMENT — a `{ key, ms }` pair naming a civil day and a
 * position inside it. Two moments compare by key first and by ms only within
 * the same key, which is why this is a scalar and not a timestamp: no offset,
 * no changeover, nothing to add. See the exemption note at the head.
 *
 * `hourCycle: "h23"` rather than `hour12: false`, deliberately — the latter
 * renders midnight as 24 on some ICU builds, which would make a midnight
 * purchase sort after every other moment on its own day instead of before.
 */
const TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONE,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
});

export const dayOffset = (date = new Date()) => {
    const [h, m, sec] = TIME_FORMAT.format(date).split(":").map(Number);
    return ((h * 60 + m) * 60 + sec) * 1000;
};

// Strictly before. Keys are lexically ordered (see dayKey) so this is a string
// compare and then a number compare, and never a Date.
const before = (a, b) => a.key < b.key || (a.key === b.key && a.ms < b.ms);

// A key parsed to a UTC midnight. UTC deliberately: this instant is never
// shown to anyone and never converted back to a zone, it exists only so days
// can be counted. See the note at the head about why nothing adds milliseconds.
const keyToUTC = (key) => {
    const [y, m, d] = key.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
};

const DAY_MS = 86400000;

const utcToKey = (ms) => {
    const date = new Date(ms);
    const y = String(date.getUTCFullYear()).padStart(4, "0");
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
};

// Advance a CALENDAR day count. Date.UTC normalises an out-of-range day
// (September 31st becomes October 1st) so month and year rollover is free, and
// a UTC day is always exactly 86400000ms so there is no changeover to cross.
export const addDays = (key, n) => utcToKey(keyToUTC(key) + n * DAY_MS);

// Inclusive-exclusive: diffDays(k, k) === 0.
export const diffDays = (from, to) => Math.round((keyToUTC(to) - keyToUTC(from)) / DAY_MS);

// 0 = Monday … 6 = Sunday. The calendar's rows are M T W R F S Y in that order
// (Y is Sunday and R is Thursday — deliberate, see renderFundCalendar), so
// Monday-first is the index the grid actually wants, not Sunday-first.
const weekdayIndex = (key) => (new Date(keyToUTC(key)).getUTCDay() + 6) % 7;

// Display formatters. These read a key back as a date and MUST be told UTC,
// because keyToUTC put the civil date at UTC midnight; formatting it in
// Eastern would land on the previous evening and print the day before.
const partFormat = (options) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...options });
const MONTH_SHORT = partFormat({ month: "short" });
const MONTH_LONG = partFormat({ month: "long" });

const monthShort = (key) => MONTH_SHORT.format(new Date(keyToUTC(key))).toUpperCase();
const monthLong = (key) => MONTH_LONG.format(new Date(keyToUTC(key)));
const dayOfMonth = (key) => key.slice(8, 10);

/* -------------------------------------------------------------------------
 * The queue
 * ---------------------------------------------------------------------- */

/*
 * WHERE A RUN STARTS. This is the mechanism behind rule 4 at the head, so read
 * that first — this is only how it is implemented.
 *
 * A run starts on the LATER of two days: the day after the run in front of it
 * ends, and the day the order was PAID. Back-to-back is the ordinary case and
 * is rule 1. The paid-day floor is what implements rule 4's second half: when
 * the queue has drained, the previous run's cursor is already in the past, so
 * an order paid now is floored to its own paid day — TODAY — and starts there.
 * The empty stretch between the two runs is simply never assigned to anybody,
 * so it draws as open squares and stays that way.
 *
 * WHY THE FLOOR IS `paidAt` AND NOT LITERALLY `today`. Those two are the same
 * number for every order that can actually arrive, because an order exists only
 * once it has been paid for. They come apart on ORDERS ALREADY IN FLIGHT, and
 * there `today` is wrong:
 *
 *   Ellis  paid 08-10, 7 days   -> 08-10 .. 08-16   (queue drains, gap opens)
 *   Marcus paid 08-20, 20 days  -> 08-20 .. 09-08   (contains today, 09-05)
 *
 * Marcus is mid-run. Flooring him at today would restart his run on 09-05,
 * hand him twenty fresh days he has already been having, and make "is funding
 * this site for N more days" read as the full length of the purchase every
 * single day of it — the tile would never count down. The paid day is the only
 * anchor that keeps an in-progress run in progress, and it produces exactly
 * rule 4's behaviour for every order paid at the moment it is placed.
 *
 * `fromKey` is therefore NOT where the walk starts. It is the floor on the
 * FIRST OPEN DAY — the thing that is for sale — which is what rule 4 is
 * actually about. An empty queue reopens at fromKey (rule 4's first half), and
 * an exhausted one reopens at fromKey rather than at whenever it ran dry.
 */
export const layQueue = (orders = [], fromKey = todayKey()) => {
    const sorted = [...orders]
        .map((order) => {
            const paid = new Date(order.paidAt);
            return { ...order, paidKey: dayKey(paid), paidMs: dayOffset(paid) };
        })
        .sort((a, b) => new Date(a.paidAt) - new Date(b.paidAt));

    const filled = new Set();
    const runs = [];
    let cursor = null;

    for (const order of sorted) {
        const days = Math.max(1, Math.floor(Number(order.days) || 1));
        const paid = { key: order.paidKey, ms: order.paidMs };
        const start = cursor === null || before(cursor, paid) ? paid : cursor;

        /*
         * A DAY IS 24 HOURS FROM THE PAID MOMENT, NOT A CALENDAR SQUARE. The
         * end is the SAME TIME OF DAY, `days` calendar days later, and it is
         * EXCLUSIVE — a run bought at 1 PM on Monday for one day ends at 1 PM
         * Tuesday, so Tuesday's 1 PM belongs to whoever is next and not to it.
         */
        const end = { key: addDays(start.key, days), ms: start.ms };

        /*
         * THE LAST DAY THE RUN TOUCHES, which is normally one MORE calendar day
         * than was bought: 1 PM Monday to 1 PM Tuesday is a name on two squares.
         * The exception is the purchase made exactly at Eastern midnight — its
         * end lands on a midnight, and an exclusive end at midnight does not
         * reach into that day at all, so it takes the squares it paid for and
         * no more.
         */
        const endKey = end.ms === 0 ? addDays(end.key, -1) : end.key;
        const span = diffDays(start.key, endKey) + 1;
        for (let i = 0; i < span; i += 1) filled.add(addDays(start.key, i));

        // `days` is what was BOUGHT and `span` is what is DRAWN. They differ by
        // one for every purchase not made at midnight and they are not
        // interchangeable — the calendar wants span, a receipt wants days.
        runs.push({ order, name: order.name, days, span, startKey: start.key, endKey, start, end });
        cursor = end;
    }

    // Rule 4, both halves, in one expression: no orders at all (cursor null)
    // and a queue that ran dry before today (its last day is behind us) both
    // reopen at fromKey, which is today. Nothing is ever offered for sale in
    // the past. A cursor landing mid-way through today still opens TODAY —
    // that is the handoff day, shared with the run going out.
    const firstOpenKey = cursor === null || cursor.key < fromKey ? fromKey : cursor.key;
    return { runs, filled, firstOpenKey };
};

/*
 * WHOSE DAY IS THIS. Maps a day key to a run index, walking the runs in queue
 * order so a later run overwrites an earlier one on a shared key — the handoff
 * day belongs to the incoming name, the same tie-break fundState makes with its
 * start-inclusive, end-exclusive test.
 *
 * It is built once per paint rather than searched per square: the drawing loop
 * runs once per cell over a year-wide grid, so a scan of the run list inside it
 * would be quadratic, and this is linear in the days drawn — what `filled`
 * already costs.
 *
 * fundState and calendarState both return one and renderCalendarInner takes it
 * off state without a fallback. There is one loop here rather than a copy in
 * each feed, so the two shapes cannot drift and the renderer never has to ask
 * which feed it was handed.
 */
const ownerMap = (runs = []) => {
    const owner = new Map();
    (runs || []).forEach((run, index) => {
        for (let i = 0; i < run.span; i += 1) owner.set(addDays(run.startKey, i), index);
    });
    return owner;
};

/*
 * The one object every renderer takes. `today` rides along with it on purpose:
 * a renderer that called todayKey() itself could disagree with this one across
 * a midnight, and the section would show a funder the calendar had already
 * moved past.
 *
 * `remaining` counts TODAY as one of the days. "is funding this site for 1 more
 * day" on someone's last day is right; "0 more days" while their name is still
 * the largest text in the footer is not.
 */
export const fundState = (orders = [], today = todayKey(), nowMs = dayOffset()) => {
    const { runs, filled, firstOpenKey } = layQueue(orders, today);

    /*
     * THE CURRENT RUN IS THE ONE THIS MOMENT FALLS IN, not the one this DAY
     * falls in. Two runs share the handoff day — the 1 PM Monday buyer holds
     * Tuesday until 1 PM and the next name takes it after — so a day-only test
     * would find the first of the two and leave the outgoing name up all day.
     * Start inclusive, end exclusive, which is what makes the handoff instant
     * belong to exactly one of them.
     */
    const now = { key: today, ms: nowMs };
    const index = runs.findIndex((run) => !before(now, run.start) && before(now, run.end));
    const current = index === -1 ? null : runs[index];
    const next = index === -1 ? null : runs[index + 1] || null;

    /*
     * `remaining` COUNTS THE DAYS STILL OWED, ROUNDED UP, and it is deliberately
     * NOT the number of squares left. Someone who buys one day at 1 PM sees
     * "1 more day" that afternoon and "1 more day" the next morning, never the
     * "2 more days" the two lit squares would suggest. The `+1` is the part of
     * the final day still to come: it is there whenever this moment is earlier
     * in the day than the moment the run ends, and it is what keeps the tile
     * off zero while a name is still the largest text in the footer.
     */
    return {
        today,
        runs,
        filled,
        owner: ownerMap(runs),
        firstOpenKey,
        current,
        next,
        remaining: current ? diffDays(today, current.end.key) + (nowMs < current.end.ms ? 1 : 0) : 0
    };
};

/* -------------------------------------------------------------------------
 * Rendering
 * ---------------------------------------------------------------------- */

// No cart glyph exists in assets/js/icon-set.js, and that file is generated
// from assets/icons/lucide/*.svg by tools/build-icons.mjs — adding one there is
// a build step, not an edit. So the cart is inlined here in exactly the shape
// icon() emits (24-box, no fill, currentColor stroke, aria-hidden), which is
// also how partials/site-footer.hbs carries the send arrow. Lucide
// "shopping-cart", ISC licence, same source as the rest.
/*
 * THE STEPPER'S CHEVRONS COME FROM THE VENDORED SET, like every other glyph in
 * the theme — icon-set.js is generated from assets/icons/lucide/*.svg by
 * tools/build-icons.mjs, and chevron-up/chevron-down were added there for this.
 * They are NOT hand-inlined here: an inline copy is a copy that stops matching
 * the other chevrons in the theme the first time the source set is regenerated.
 * (The cart below is the exception and says why.)
 *
 * 8px, down from revision 2's 12. Revision 3 item 6 puts each chevron inside a
 * 16px FILLED square, and the glyph has to clear the square's edges:
 *
 *   16px square - 8px glyph = 8px of slack, 4px inset on every side
 *
 * 8 and 4 are both on the base-4 grid, and 4px is the floor the grid allows —
 * so 8px is the LARGEST glyph that still leaves a legal inset inside a 16px
 * box. A 12px glyph would leave 2px, which is off-grid and touches the edge.
 */
const CHEVRON_UP = icon("chevron-up", { size: 8, className: "qntns-fund__chevron" });
const CHEVRON_DOWN = icon("chevron-down", { size: 8, className: "qntns-fund__chevron" });

const CART = `<svg class="qntns-fund__cart" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>`;

const money = (amount) => `$${amount.toFixed(2)}`;

// "Sep", title case — the prose form. The chip's month is the same three
// letters uppercased; this is not, because it sits inside a sentence.
const MONTH_PROSE = partFormat({ month: "short" });
const monthProse = (key) => MONTH_PROSE.format(new Date(keyToUTC(key)));

// "Sep 5", not "Sep 05". The chip pads to two digits because it is a label in a
// box and the digits have to sit still; this is running text and does not.
const dateProse = (key) => `${monthProse(key)} ${Number(dayOfMonth(key))}`;

/*
 * THE SPAN THE BUYER WOULD BE PURCHASING. Revision 3, item 5.
 *
 * THE WORDING IS UNCONFIRMED. It is the team lead's guess at the user's intent,
 * not the user's own words — short month, no year, "to" between the two dates,
 * full stop at the end. The single-day form is a further guess on top of that:
 * "from Sep 12 to Sep 12" reads as a mistake, so one day says "on Sep 12"
 * instead. Both are flagged for the user to correct; do not treat either as
 * settled copy.
 *
 * Derived from firstOpenKey and the live count, so it moves with the stepper.
 * The end day is start + count - 1 because the first day is one of the days
 * bought — the same inclusive count `remaining` uses in the now tile.
 */
const rangeText = (firstOpenKey, count) => {
    if (!firstOpenKey) return "";
    const endKey = addDays(firstOpenKey, count - 1);
    return count === 1
        ? `of funding on ${dateProse(firstOpenKey)}.`
        : `of funding from ${dateProse(firstOpenKey)} to ${dateProse(endKey)}.`;
};

/*
 * THE CHIP HAS THREE FORMS, one per state — see THE THREE STATES above.
 *
 *   a key      the day itself, "05" over "SEP"
 *   empty      "-" over the CURRENT month. The queue answered and is empty, so
 *              the month is known even though the day is not.
 *   unknown    "-" over a non-breaking space. Nothing is known, including which
 *              month, so nothing is claimed. The nbsp rather than an empty
 *              string keeps the chip's second line occupying its own height, so
 *              the tile does not change size when real data lands.
 */
const renderChip = (key, today, unknown = false) => `
        <span class="qntns-fund__chip">
          <span class="qntns-fund__chip-day">${key ? dayOfMonth(key) : "-"}</span>
          <span class="qntns-fund__chip-month">${unknown ? "&nbsp;" : monthShort(key || today)}</span>
        </span>`;

/*
 * THE LEFT TILE — who is funding the site right now.
 *
 * The name is the largest type in the block because the whole point of the
 * section is that a HUMAN is paying for this today, and a progress bar or a
 * count does not read as a person. It is a first name off a Stripe receipt and
 * nothing else — see CHECKLIST-v4 3.2, the Worker never stores more.
 *
 * The "{Next} is next." sentence is dropped entirely when nobody is behind
 * them, rather than being softened to "nobody is next", because an empty queue
 * behind the current funder is the normal state and does not need announcing.
 */
export const renderFundNow = (state, { unknown = false } = {}) => {
    const { current, next, remaining, today } = state;

    /*
     * UNKNOWN IS NOT EMPTY, and this branch is why the distinction exists.
     * Dashes and a blank line claim nothing. "No one is funding this site."
     * is a claim, and it is one this branch has no way to check — see THE
     * THREE STATES at the head of the file.
     *
     * The sub line is a non-breaking space rather than empty so it keeps its
     * own line box; without it the tile is shorter in the unknown state than
     * in the two answered ones, and the footer jumps when the queue lands.
     */
    if (unknown) {
        return `
      <div class="qntns-fund__tile qntns-fund__tile--now">
        ${renderChip(null, today, true)}
        <span class="qntns-fund__now">
          <span class="qntns-fund__name">-</span>
          <span class="qntns-fund__sub">&nbsp;</span>
        </span>
      </div>`;
    }

    if (!current) {
        return `
      <div class="qntns-fund__tile qntns-fund__tile--now">
        ${renderChip(null, today)}
        <span class="qntns-fund__now">
          <span class="qntns-fund__name">No one</span>
          <span class="qntns-fund__sub">is funding this site.</span>
        </span>
      </div>`;
    }

    const unit = remaining === 1 ? "more day" : "more days";
    const nextClause = next
        ? ` <strong class="qntns-fund__next-name">${escapeHtml(next.name)}</strong> is next.`
        : "";

    return `
      <div class="qntns-fund__tile qntns-fund__tile--now">
        ${renderChip(today, today)}
        <span class="qntns-fund__now">
          <span class="qntns-fund__name">${escapeHtml(current.name)}</span>
          <span class="qntns-fund__sub">
            is funding this site for <strong class="qntns-fund__count">${remaining}</strong> ${unit}.${nextClause}
          </span>
        </span>
      </div>`;
};

/*
 * THE LEFT TILE, RE-READ FOR A DAY THE READER PRESSED. Revision 4, item 4.1.
 *
 * Same tile, same three nodes — chip, name, sub line — because the press must
 * not change the SHAPE of the block, only what it says. Anything else and the
 * footer jumps every time a square is clicked.
 *
 * A PRESS ON TODAY IS NOT A FOURTH SENTENCE. It hands straight back to
 * renderFundNow, so the selected reading of today and the live reading of today
 * are the same string by construction rather than by two copies agreeing. The
 * user settled this on 2026-09-09.
 *
 * The three forms are the user's own words, verbatim:
 *
 *   past      was funding this site X days ago.
 *   future    will fund this site in X days.
 *   future    will continue funding this site in X days.
 *
 * The third is the person funding TODAY seen further down their own stretch —
 * "continue" is only true when nothing interrupts between here and there, so it
 * needs BOTH that the name matches the current run's and that every day in
 * between is filled. A same-name run on the far side of a gap is a second
 * purchase, not a continuation, and reads with the plain future form.
 *
 * Singular mirrors the pattern already in renderFundNow — "1 day ago", "in
 * 1 day", never "in 1 days".
 *
 * AN UNFUNDED DAY NAMES WHOEVER COULD STILL BE IN THAT SLOT, and that depends
 * on the tense. Asked for by the user on 2026-09-09: "when clicking to a future
 * date change the name to Maybe you so it would read Maybe you will fund this
 * site in X days."
 *
 *   future unfunded   "Maybe you"  will fund this site in 12 days.
 *   past unfunded     "No one"     was funding this site 30 days ago.
 *
 * A future unfunded day is a day that is FOR SALE — every unfunded day after
 * today is at or after the first open day, because the first open day is the
 * earliest unfilled one — so "maybe you" is a true offer. A PAST unfunded day
 * is not for sale and never will be: rule 4 at the head of this file says a
 * skipped day is never backfilled, so "Maybe you was funding this site 30 days
 * ago" would be an offer nobody can take. "No one" stays there, and it stays
 * the same string the empty branch of renderFundNow uses. Gaps are permanent,
 * so both lines are real answers rather than missing ones.
 *
 * A future day that IS funded keeps its funder's name — it is not for sale.
 * "will continue funding" cannot be reached with this subject either: it lives
 * in the branch below, which only runs when a run owns the day.
 *
 * NOT ESCAPED, exactly like the "No one" it replaces. This is copy authored in
 * this file, not a name that arrived from Stripe; escapeHtml guards `run.name`
 * and `current.name` and has nothing to do here.
 */
export const renderFundDay = (state, key) => {
    const { today, runs, owner, filled, current } = state;
    if (!key || key === today) return renderFundNow(state);

    const ahead = key > today;
    const count = Math.abs(diffDays(today, key));
    const unit = count === 1 ? "day" : "days";
    const when = ahead ? `in ${count} ${unit}.` : `${count} ${unit} ago.`;

    const run = runs[owner.get(key)] || null;
    if (!run) {
        return `
      <div class="qntns-fund__tile qntns-fund__tile--now">
        ${renderChip(key, today)}
        <span class="qntns-fund__now">
          <span class="qntns-fund__name">${ahead ? "Maybe you" : "No one"}</span>
          <span class="qntns-fund__sub">${ahead ? "will fund" : "was funding"} this site ${when}</span>
        </span>
      </div>`;
    }

    // Unbroken from today to the pressed day: every day between the two is
    // filled, ends included. `filled` is the same set the squares are drawn
    // from, so "no gap" here means exactly "no open square in between".
    let unbroken = true;
    for (let i = 0; i <= count && unbroken; i += 1) {
        unbroken = filled.has(addDays(today, ahead ? i : -i));
    }
    const continues = ahead && unbroken && !!current && run.name === current.name;

    const verb = ahead ? (continues ? "will continue funding" : "will fund") : "was funding";
    return `
      <div class="qntns-fund__tile qntns-fund__tile--now">
        ${renderChip(key, today)}
        <span class="qntns-fund__now">
          <span class="qntns-fund__name">${escapeHtml(run.name)}</span>
          <span class="qntns-fund__sub">${verb} this site ${when}</span>
        </span>
      </div>`;
};

/*
 * THE RIGHT TILE — buy the next open days.
 *
 * The chip is the FIRST OPEN DAY and it does not move when the count changes.
 * That is deliberate and it is why attachFund repaints it from a stored key
 * rather than recomputing it: the queue is first-in-first-out, so the day your
 * money starts buying is fixed by the people in front of you, and only the
 * length of what you buy is yours to change.
 *
 * `data-fund-first` on the tile is an ADDITION to the shared markup contract,
 * not a rename of anything in it — the contract gives the chip no machine
 * readable date, and attachFund has to know the first open day to compute the
 * price, the range line and the button's label without re-deriving today inside
 * a handler. It is inert to the CSS.
 *
 * THE BUTTON'S VISIBLE LABEL IS THE PRICE. Revision 3, item 3 — the word "Fund"
 * came out to save horizontal space, so the button is the cart glyph and a
 * dollar amount. There is exactly ONE price node in this tile and it is inside
 * the button: the standalone `$2.00` beside it was removed rather than left as
 * a second node for attachFund to keep in step, because two nodes showing the
 * same number is one node that can be forgotten. The price span sits INSIDE the
 * anchor rather than the anchor itself carrying data-fund-price, so updating
 * the text cannot wipe the cart SVG out of the button.
 *
 * Because the visible label is now only a number, the anchor carries an
 * aria-label — "Fund 7 days for $14.00, from Sep 12 to Sep 18" — and attachFund
 * keeps it in step with the count. Without it the button announces as "$14.00",
 * which is a price and not an action.
 *
 * THE RANGE LINE under the stepper (revision 3 item 5) reuses
 * `.qntns-fund__sub`, the now tile's subtext class, because the user asked for
 * the same treatment and a second class that had to be kept identical to it is
 * a second class that drifts. `data-fund-range` is the hook. Its WORDING IS
 * UNCONFIRMED — see rangeText.
 *
 * The input is a real <input type="number" min="1" max="90" step="1">. A div
 * dressed as a field loses the mobile numeric keypad, the held-down arrow key,
 * and every other behaviour a number input ships with. The two arrows are the
 * theme's own because the native spinner renders differently in every browser,
 * hides until hover, and cannot be styled to match a hard-edged navy control.
 *
 * THE ARROWS AND THE BUTTON ARE ONE GROUP: `.qntns-fund__actions`.
 * Revision 8 item 3 moved the chevron pair out of `.qntns-fund__stepper` — it
 * no longer sits beside the number — and put it directly above the Fund button,
 * right-aligned with it. They are WRAPPED rather than left as loose siblings,
 * and the wrapper is what gets positioned into the tile's bottom-right corner.
 *
 * WHY A WRAPPER AND NOT TWO SIBLINGS. Revision 6 positioned the button out of
 * flow at a 16px inset. Two things that must stay 8px apart and share a right
 * edge, where only one of them is in flow, is the drift the spec warned about:
 * the arrows would be laid out by the stepper's flow and the button by the
 * tile's corner, and nothing would hold the 8px. One wrapper means ONE
 * positioned box and the 8px is an ordinary gap inside it — the two can no
 * longer disagree because only one of them is placed.
 *
 * `data-fund-step` is untouched by the move. wireStepper binds with
 * `section.querySelectorAll("[data-fund-step]")`, which does not care where in
 * the tile the buttons live, so the hooks survive the reparenting unchanged.
 *
 * THE DAY COUNT IS DISPLAY TYPE WITH NO UNDERLINE (item 4), which means the
 * ARROWS ARE NOW THE ONLY THING MARKING THE FIELD EDITABLE — and they have just
 * moved away from it to the other side of the tile. That is flagged for the
 * user rather than compensated for here: nothing has been added back, because
 * whether the affordance still reads is their judgement and not this file's.
 */
export const renderFundNext = (state, { days = 1, unknown = false } = {}) => {
    const count = Math.min(MAX_DAYS, Math.max(1, Math.floor(days)));
    /*
     * IN THE UNKNOWN STATE THE TILE STILL WORKS, it just does not claim a start
     * day. There is no `data-fund-first`, so wireStepper reads a null key, the
     * chip stays dashed and the range line stays blank while the count and the
     * price still move. The button still functions: the Worker mints the
     * Checkout Session and it knows which days those are even when this page
     * does not.
     */
    const firstAttr = unknown ? "" : ` data-fund-first="${state.firstOpenKey}"`;
    return `
      <div class="qntns-fund__tile qntns-fund__tile--buy"${firstAttr}>
        ${unknown ? renderChip(null, state.today, true) : renderChip(state.firstOpenKey, state.today)}
        <span class="qntns-fund__buy">
          <span class="qntns-fund__buy-text">
            <span class="qntns-fund__stepper">
              <input class="qntns-fund__days" type="number" min="1" max="${MAX_DAYS}" step="1" value="${count}"
                     inputmode="numeric" aria-label="Days to fund" data-fund-days>
              <span class="qntns-fund__unit" data-fund-unit>${count === 1 ? "day" : "days"}</span>
            </span>
            <span class="qntns-fund__sub" data-fund-range>${unknown ? "" : rangeText(state.firstOpenKey, count)}</span>
          </span>
          <span class="qntns-fund__actions">
            <span class="qntns-fund__arrows">
              <button class="qntns-fund__arrow qntns-fund__arrow--up" type="button"
                      aria-label="One more day" data-fund-step="1">${CHEVRON_UP}</button>
              <button class="qntns-fund__arrow qntns-fund__arrow--down" type="button"
                      aria-label="One fewer day" data-fund-step="-1">${CHEVRON_DOWN}</button>
            </span>
            <a class="qntns-fund__button" href="#" data-fund-buy aria-label="${unknown ? "Fund this site" : escapeHtml(buyLabel(count, state.firstOpenKey))}">
              ${CART}
              <span class="qntns-fund__price" data-fund-price>${money(count * PRICE_PER_DAY)}</span>
            </a>
          </span>
        </span>
      </div>`;
};

/* -------------------------------------------------------------------------
 * The calendar
 * ---------------------------------------------------------------------- */

/*
 * A COLUMN IS NOT A WEEK ANY MORE. Revision 1, item 2, settled with the user.
 *
 * A column is A CONTIGUOUS RUN OF DAYS THAT SHARE A WEEK AND A MONTH. A week
 * that straddles a month boundary is therefore SPLIT INTO TWO COLUMNS: the
 * earlier month keeps the rows it actually covers and the later month starts a
 * fresh column at the row its first day falls on. The rest of each column is
 * `is-blank`, so the grid RAGS at every month edge the way a wall calendar
 * does. Before this, every month was a solid seven-row rectangle and the
 * boundaries were invisible.
 *
 *   Mon 28 Sep .. Sun 4 Oct, one week, becomes two columns:
 *
 *          col N (Sep)   col N+1 (Oct)
 *     M    28 Sep        (blank)
 *     T    29 Sep        (blank)
 *     W    30 Sep        (blank)
 *     R    (blank)       1 Oct
 *     F    (blank)       2 Oct
 *     S    (blank)       3 Oct
 *     Y    (blank)       4 Oct
 *
 * THE POINT OF THE SPLIT is that every column now belongs to exactly ONE
 * month. That is what lets a month label span a whole number of columns and
 * still sit over its own days — with shared columns there is no honest span to
 * give a boundary week, and the labels drift a cell out of true.
 *
 * THE COLUMN BUDGET, and how a month reconciles against the days it holds. A
 * column holds `min(7 - startRow, daysLeftInMonth)` days, so:
 *
 *   sum of every column's day count, over one whole month === days in month
 *   a whole month spans 4 columns when its 28..31 days fit 4 week-runs,
 *   5 when they spill into a fifth, 6 for a 31-day month starting on a Sunday
 *
 *   September 2026 (30 days, 1st is a Tuesday):
 *     col 0  rows T..Y   1..6     6 days
 *     col 1  rows M..Y   7..13    7
 *     col 2  rows M..Y  14..20    7
 *     col 3  rows M..Y  21..27    7
 *     col 4  rows M..W  28..30    3
 *                                --  6+7+7+7+3 = 30  = days in September
 *
 * That identity is asserted by the stories; if a change breaks it the month
 * labels and the days underneath them have silently come apart.
 */

// Days in the month a key falls in. Day 0 of the NEXT month is the last day of
// this one — the same trick renderFundCalendar uses for the last visible day.
const daysInMonth = (key) => {
    const [y, m] = key.split("-").map(Number);
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/*
 * WALK COLUMNS UNTIL A DATE IS COVERED, RATHER THAN UNTIL A COUNT IS REACHED.
 *
 * buildColumns below takes a count, which is the right shape when the caller
 * knows how many columns fit in a box. Since the strip became a scroll
 * container the caller knows a DATE instead — the far edge of the funded queue
 * — and the number of columns that spans cannot be computed from it: a week
 * straddling a month boundary is two columns, so the count depends on where
 * the month edges fall inside the range.
 *
 * Guessing it and trimming afterwards was the alternative, and it needs slack
 * that is either wrong or generous. Asking the walk to stop on a date needs
 * neither, and the walk already knows the keys it has emitted.
 *
 * The LAST column is the one containing `endKey`, whole. Stopping mid-column
 * would leave a partial week at the right edge, which the month-label spans
 * above are not able to describe.
 *
 * A GUARD ON THE ITERATION COUNT, because this loop's exit is a date
 * comparison and every other loop in this file exits on a count. bounds()
 * clamps the forward reach to a year and change, so 400 columns is roughly
 * five times the largest legitimate span; reaching it means a malformed key
 * has made `cursor` stop advancing, and returning a short strip is better than
 * hanging the page.
 */
export const columnsThrough = (startKey, endKey) => {
    const columns = [];
    let cursor = startKey;
    while (columns.length < 400) {
        const startRow = weekdayIndex(cursor);
        const left = daysInMonth(cursor) - Number(dayOfMonth(cursor)) + 1;
        const span = Math.min(7 - startRow, left);
        const keys = [];
        for (let i = 0; i < span; i += 1) keys.push(addDays(cursor, i));
        columns.push({ month: cursor.slice(0, 7), startRow, keys });
        if (keys[keys.length - 1] >= endKey) break;
        cursor = addDays(cursor, span);
    }
    return columns;
};

/*
 * Walk columns forward from `startKey`. Each step takes as many days as the
 * week has rows left AND the month has days left, whichever runs out first —
 * that single `min` is the whole ragging rule.
 */
const buildColumns = (startKey, count) => {
    const columns = [];
    let cursor = startKey;
    while (columns.length < count) {
        const startRow = weekdayIndex(cursor);
        const left = daysInMonth(cursor) - Number(dayOfMonth(cursor)) + 1;
        const span = Math.min(7 - startRow, left);
        const keys = [];
        for (let i = 0; i < span; i += 1) keys.push(addDays(cursor, i));
        columns.push({ month: cursor.slice(0, 7), startRow, keys });
        cursor = addDays(cursor, span);
    }
    return columns;
};

/*
 * HOW FAR THE STRIP REACHES, AS A PURE FUNCTION OF THE STATE.
 *
 * Item 2.4's arithmetic, lifted out of attachCalendar's closure at revision 13
 * because it now has TWO readers and they must not disagree: the pager, which
 * marks an arrow dead at the edge, and paint(), which renders the strip out to
 * exactly this span so the scroll can reach it. Two copies of a bound is two
 * bounds.
 *
 *   back    = weeks to the first funded day - 13, never above 0
 *   forward = max(52, weeks to the furthest filled-or-previewed day + 4)
 *
 * The 13 is a quarter behind the first funded day, so the queue arrives with
 * its own history in front of it rather than starting at a hard edge. The 52
 * is a year forward whatever the queue holds, and the max is because a preview
 * can legitimately reach further than a year: `press` clamps a span at
 * MAX_DAYS = 365, so the furthest previewable day is today + 364, and the +4
 * weeks is the margin that keeps the last previewed square off the right edge
 * rather than flush against it. `selected` is in the max for exactly that
 * reason — the preview IS the selection with a bigger span, so one term covers
 * both it and the funded queue.
 *
 * BASE 4: 52, 13 and 4 are week counts, not pixels; the grid pitch is
 * untouched by anything here.
 */
const pageBounds = (state) => {
    let furthest = 0;
    [...state.filled, ...state.selected].forEach((key) => {
        furthest = Math.max(furthest, diffDays(state.today, key));
    });
    // Keys are `YYYY-MM-DD`, so the smallest string is the earliest day. Runs
    // arrive in whatever order the attribute lists them, so this is a scan and
    // not runs[0].
    const firstFunded = state.runs.reduce(
        (earliest, run) => (earliest === null || run.startKey < earliest ? run.startKey : earliest),
        null
    );
    // floor, not ceil: for a day in the past this rounds AWAY from today, so a
    // first funded day mid-week keeps its own week whole before the 13 are
    // counted off it.
    const startWeeks = Math.floor(diffDays(state.today, firstFunded ?? state.today) / 7);
    return {
        back: Math.min(0, startWeeks - 13),
        forward: Math.max(52, Math.ceil(furthest / 7) + 4),
    };
};

/*
 * THE STRIP'S TWO END KEYS, from the bounds above. Written once here because
 * paint() renders between them and reveal() scrolls within them, and a
 * disagreement would be a day the reader can select and cannot see.
 *
 * The start is pulled BACK TO ITS MONDAY. buildColumns and columnsThrough both
 * begin a column at whatever weekday their start key falls on, so a start
 * mid-week would make the first column short and put the whole strip's rows
 * out of step with the weekday labels beside them.
 */
const stripEnds = (state) => {
    const { back, forward } = pageBounds(state);
    const first = addDays(state.today, back * 7);
    return {
        from: addDays(first, -weekdayIndex(first)),
        through: addDays(state.today, forward * 7),
    };
};

/*
 * THE DEFAULT COLUMN COUNT, for a first paint that has measured nothing.
 *
 *   column width = --fund-cell + --fund-gap   = 16 + 4 = 20px
 *   available    = 720 - --fund-label - gap   = 720 - 16 - 4 = 700px
 *   columns      = floor(700 / 20)            = 35
 *
 * 720 is --footer-inner-max, the width the subscribe form uses and the width
 * this section is capped at. attachFund replaces this with a real measurement
 * as soon as it runs; this is what a reader sees for the one frame before it
 * does, and what Ghost serves to a reader with JavaScript off.
 */
const DEFAULT_COLUMNS = 35;

/*
 * A MONTH PRINTS ITS NAME ONLY IF EVERY ONE OF ITS COLUMNS IS ON SCREEN.
 * Revision 1, item 5. A partly visible month emits its span — the grid's column
 * arithmetic depends on it — with `data-clipped` and NO TEXT, so a truncated
 * month name can never appear. `Au…` at the left edge was the bug.
 *
 * This catches BOTH ends, and the leading one is not an oversight. The grid
 * now starts about half its width BEFORE today, so the month at the left edge
 * is almost always entered part-way through — it is clipped by definition and
 * prints nothing.
 */
const monthIsWhole = (group) => {
    const first = group.columns[0].keys[0];
    const lastColumn = group.columns[group.columns.length - 1];
    const last = lastColumn.keys[lastColumn.keys.length - 1];
    return dayOfMonth(first) === "01" && Number(dayOfMonth(last)) === daysInMonth(last);
};

/*
 * The grid's inner markup, without the container. attachFund re-renders THIS
 * on resize and leaves the container's own attributes — and the whole of the
 * rest of the section, the stepper included — untouched.
 *
 * ROW ORDER IS M T W R F S Y. R is Thursday and Y is Sunday. That is the user's
 * own shorthand and it is deliberate, not a typo — do not "fix" it to T/S.
 * Monday-first is why weekdayIndex() rotates getUTCDay().
 *
 * TODAY ENDS UP IN THE MIDDLE EITHER WAY, BY ONE OF TWO MECHANISMS. On the
 * live path the whole funded span is rendered and attachCalendar's centreOn()
 * scrolls today into the middle of the box; on the server and story path a
 * fixed count is centred by the slice arithmetic below. Past squares are drawn
 * honestly rather than blanked in both, because blanking them would leave a
 * run of empty rows looking like a month boundary, which MEANS something
 * here.
 *
 * THE MONTH ROW'S LEADING OFFSET. `.qntns-fund__months` has to start where the
 * grid's first DAY starts, not where the row starts, or every label sits one
 * cell left of its days. That offset is the weekday label column plus its gap:
 *
 *   --fund-label + --fund-gap = 16 + 4 = 20px
 *
 * The CSS owns the rule; the arithmetic is written here because it is the same
 * 20px the column-count measurement subtracts, and the two must not drift.
 */
const renderCalendarInner = (state, columns, { from = null, through = null } = {}) => {
    const { today, filled, offset = 0, selected = new Set() } = state;

    /*
     * ONE COLOUR PER CONTIGUOUS SEGMENT, NOT PER PERSON. `runs` holds one entry
     * per order in paid order and same-name orders are never merged, so
     * `runs.length` is already the segment count: Bob, Sally, Bob, Sally is four
     * runs and four colours. A funder who buys twice with someone else in
     * between gets two different colours, because the colour marks a stretch of
     * days rather than a person.
     *
     * Eight fixed stops, dark to light: run n wears stop n % 8 (`fundColor`), so
     * the 9th run wraps to the darkest and an added funder never recolours an
     * earlier run.
     */
    const { runs, owner } = state;
    const runColor = (index) => (index === undefined ? null : fundColor(index));

    /*
     * THE PREVIEW HAS NO VISUAL STATE OF ITS OWN. Revision 12, items 5.1/5.3.
     *
     * A previewed day is an ordinary `.is-selected` day carrying the colour the
     * NEXT run would be handed. The rule that paints funded cells already reads
     * `--fund-run` off `.is-selected` too (fund.css:1282), so there is no
     * `is-preview` class and no second rule that could fall out of step with the
     * first.
     *
     * THE THRESHOLD IS THE SPAN, AND IT IS MEASURED WHERE THE SPAN IS DRAWN.
     * Two days or more is a preview; a span of one is the plain selection 3.2
     * already draws, which emits no `--fund-run` and so falls back to
     * transparent. That one comparison is the whole of 5.3, and because it reads
     * the span rather than the buy tile's count it decides the same way for a
     * click that produced a one-day span and for a stepper wound back down to
     * one — the two cannot disagree about whether a preview exists.
     *
     * Index `runs.length` is the segment the purchase would add, so its colour
     * is `fundColor(runs.length)`. An empty queue gives the darkest navy.
     */
    const nextColor = selected.size >= 2 ? fundColor(runs.length) : null;

    /*
     * TODAY SITS IN THE MIDDLE. Revision 2, item 2.1.
     *
     * The target slot is `floor((count - 1) / 2)`: with 35 columns today's
     * column is index 17, seventeen behind it and seventeen ahead. An even
     * count puts today one left of dead centre, which is the only honest
     * choice when there is no middle column.
     *
     * CENTRING IS ON THE COLUMN, NOT THE WEEK, and those are not the same
     * thing — buildColumns splits a week that crosses a month boundary into
     * two columns, so counting back N weeks from today lands up to one column
     * off true. So: build a longer strip from a start well before the target,
     * find the column today actually fell in, and slice `count` columns from
     * `hit - target`.
     *
     * THE PAD. Each week contributes one column, or two when it straddles a
     * month edge, so `target + PAD` weeks of build always yields at least
     * `target + PAD` columns before today's — more than the `target` the slice
     * needs. PAD is slack against a start key landing mid-column; 2 is plenty
     * and costs nothing but a few unused array entries.
     */
    /*
     * TWO WAYS TO DECIDE WHAT IS BUILT, AND THE CALLER PICKS BY WHAT IT KNOWS.
     * Revision 13, when the strip became a scroll container.
     *
     *   from / through   A DATE RANGE, and everything below the `if` is
     *                    skipped. This is the live path: attachFund renders the
     *                    WHOLE funded span between stripEnds()' two keys and
     *                    lets scrollLeft be the reader's position, so there is
     *                    nothing to centre and no window to slide. See paint().
     *   columns          A COUNT, centred on today, which is everything below.
     *                    This is the SERVER path and the story path: Ghost
     *                    renders a fixed 35-column window because a reader with
     *                    no JavaScript has no scroll position to restore and no
     *                    arrows that work, and a story that pins a count is
     *                    asking for exactly that count.
     *
     * THE CENTRED PATH IS UNCHANGED, DELIBERATELY. It is the no-JS fallback and
     * every story's fixture; rewriting it to be a special case of the range
     * would put both of those behind the new arithmetic for no gain.
     */
    const ranged = Boolean(from && through);

    const count = Math.max(1, Math.floor(columns) || 1);
    const target = Math.floor((count - 1) / 2);
    const PAD = 2;
    /*
     * THE OFFSET PAGES BY MOVING WHAT IS CENTRED, NOT BY SLIDING THE SLICE.
     * Revision 2, item 2.2.
     *
     * `offset` is signed WEEKS from centred, so the day the grid centres on is
     * `today + offset * 7` — the pivot — and everything below is the 2.1
     * arithmetic with `pivot` where `today` was. Offset 0 makes pivot === today
     * and the two are then the same expression, character for character, which
     * is the only way "offset 0 lands exactly where the grid sits today" can be
     * guaranteed rather than hoped for.
     *
     * It is NOT a column shift. A week straddling a month edge is two columns
     * here, so nudging the slice index by `offset` would page by a week in some
     * places and by half a week in others. Pivoting on a real date pages by a
     * real week every time; the centring stays on the COLUMN the pivot fell in.
     *
     * The pad grows by |offset| weeks so the built strip still reaches the
     * pivot in either direction. A few unused array entries, no other cost.
     */
    const centred = () => {
        const pivot = addDays(today, (Math.trunc(offset) || 0) * 7);
        const reach = target + PAD + Math.abs(Math.trunc(offset) || 0);
        const anchor = addDays(pivot, -weekdayIndex(pivot) - reach * 7);
        const strip = buildColumns(anchor, count + reach * 2);
        const hit = strip.findIndex((column) => column.keys.includes(pivot));
        return strip.slice(Math.max(0, hit - target), Math.max(0, hit - target) + count);
    };

    /* THE ONLY FORK, AND EVERYTHING PAST IT IS SHARED. Both paths produce the
       same shape — an array of columns — so the roving tabindex, the month
       grouping and the markup below are written once and neither path can
       drift from the other. */
    const built = ranged ? columnsThrough(from, through) : centred();

    /*
     * THE ONE CELL THAT HOLDS THE TAB STOP. Revision 12, item 3.4.
     *
     * Every real day is a <button> (item 3.1), and at 35 columns that put 203
     * of them in the tab order — measured at 04befe6 — so reaching the pager
     * below the grid meant two hundred presses. A roving `tabindex` makes the
     * whole grid ONE stop: this cell holds 0, every other holds -1, and the
     * arrow keys in attachCalendar move which one that is.
     *
     * IT MATTERS MORE SINCE REVISION 13, NOT LESS. The live strip is no longer
     * the columns that fit but the whole funded span — sixty-five weeks at the
     * minimum bound, so roughly 460 day buttons rather than 203, and more when
     * a preview reaches further. The tab order is unchanged at ONE stop
     * because this rule is a count of zeroes and not a count of cells; without
     * it the same change would have quadrupled a number that was already the
     * reason this exists.
     *
     * IT IS AN ATTRIBUTE, `data-fund-roving`, FOR THE SAME REASON THE OFFSET
     * AND THE SELECTION ARE. `paint()` reassigns `calendar.innerHTML`, so a
     * rover held in a closure would describe a button that no longer exists on
     * the first resize or the first page. Re-read here on every paint, the tab
     * stop restores itself and attachCalendar only has to put focus back.
     *
     * PAGED OFF THE STRIP CLAMPS TO THE NEAREST SURVIVING DAY. `days` is
     * contiguous — consecutive columns of consecutive keys — so a rover before
     * the first key or after the last is pinned to that end, and anything in
     * between is still rendered. No rover yet means today, which is always on
     * the strip at offset 0 and clamps to an edge once the reader has paged
     * away from it.
     */
    const days = built.flatMap((column) => column.keys);
    const wanted = state.roving || today;
    const rover = wanted < days[0]
        ? days[0]
        : (wanted > days[days.length - 1] ? days[days.length - 1] : wanted);

    const groups = [];
    for (const column of built) {
        const last = groups[groups.length - 1];
        if (last && last.month === column.month) last.columns.push(column);
        else groups.push({ month: column.month, columns: [column] });
    }

    const monthLabels = groups
        .map((group) => {
            const span = ` style="--weeks: ${group.columns.length}"`;
            return monthIsWhole(group)
                ? `<span class="qntns-fund__month"${span}>${monthLong(group.columns[0].keys[0])}</span>`
                // A month the grid only shows a slice of prints an ELLIPSIS,
                // not its name and not nothing. Its name would be a lie — the
                // squares under it are a fraction of that month — and an empty
                // label reads as a rendering fault rather than as "there is
                // more of this off the end". THREE FULL STOPS WITH SPACES,
                // not the &hellip; character: at 12px a real ellipsis is three
                // dots inside one glyph's width and reads as a smudge over a
                // block of squares. Spacing them out is the whole point, and it
                // is a typed mark rather than a character now, so it is styled
                // up in size by [data-clipped] in fund.css.
                // The span still carries its --weeks
                // so the columns keep adding up. Settled with the user
                // 2026-08-28.
                : `<span class="qntns-fund__month" data-clipped${span}>. . .</span>`;
        })
        .join("");

    const LABELS = ["M", "T", "W", "R", "F", "S", "Y"];
    const rows = LABELS.map((label, row) => {
        const cells = built.map((column) => {
            const offset = row - column.startRow;
            const key = offset >= 0 && offset < column.keys.length ? column.keys[offset] : null;
            // A PLACEHOLDER STAYS A SPAN. It reserves a grid position and holds
            // nothing to press, so making it a button would put an empty,
            // focusable stop in the tab order for every ragged month edge.
            if (!key) return `<span class="qntns-fund__day is-blank"></span>`;
            const classes = ["qntns-fund__day"];
            if (filled.has(key)) classes.push("is-funded");
            if (key === today) classes.push("is-today");
            // Every cell in the span carries it, one day or many — the dim in
            // fund.css keys off the class and does not count them.
            if (selected.has(key)) classes.push("is-selected");
            // Inline custom property, the same shape card.js uses for
            // --card-accent. An open square emits nothing and the CSS falls
            // back to --color-ink, so a calendar with no runs is unchanged.
            // Funded keeps its own run colour; an unfunded day inside a preview
            // span wears the next one. Everything else emits nothing.
            const color = filled.has(key)
                ? runColor(owner.get(key))
                : (selected.has(key) ? nextColor : null);
            const paint = color ? ` style="--fund-run: ${color}"` : "";
            // A REAL DAY IS A BUTTON, not a span with a click on it. A span
            // cannot be focused or fired with the enter key, so a calendar
            // built from spans is mouse-only; a button is reachable, pressable
            // and announced as pressable without a line of ARIA. The classes,
            // `data-key` and the inline --fund-run are unchanged — only the tag
            // differs, and fund.css strips the button's own box so the 20px
            // pitch is untouched.
            // `tabindex` is the whole of item 3.4 in the markup: one 0, the rest
            // -1. Rendered rather than applied afterwards so a grid drawn with
            // no JS running is a single stop too, and so a repaint cannot leave
            // two cells holding 0.
            const stop = key === rover ? 0 : -1;
            return `<button type="button" class="${classes.join(" ")}" data-key="${key}" tabindex="${stop}"${paint}></button>`;
        });
        return `
        <div class="qntns-fund__row">
          <span class="qntns-fund__weekday">${label}</span>
          ${cells.join("\n          ")}
        </div>`;
    }).join("");

    return `
      <div class="qntns-fund__months">${monthLabels}</div>
      <div class="qntns-fund__grid">${rows}
      </div>`;
};

/*
 * THE `data-fund-runs` ENCODING, AND THE ONLY TWO FUNCTIONS THAT KNOW IT.
 *
 * One run is `startKey+span+encodeURIComponent(name)`, runs joined by commas.
 * The name is percent-encoded and NOT raw, for two reasons that are both
 * fatal without it:
 *
 *   - the separators. Names come from strangers via Stripe, so "Ann, Jr." or
 *     "Lou+Kim" would otherwise split the attribute into the wrong number of
 *     fields and blank the whole calendar. encodeURIComponent escapes both
 *     `,` (%2C) and `+` (%2B), so a decoded name can never contain either.
 *   - the attribute. This string is interpolated straight into HTML, and
 *     encodeURIComponent also escapes `"` (%22), `<` (%3C) and `&` (%26),
 *     so the value cannot close its own attribute. That is why no escapeHtml
 *     call is needed on this path — the encoding already covers it.
 *
 * A name is allowed to be absent: the third field is then empty and decodes
 * back to "". Trailing empties are kept rather than trimmed so the field
 * count is fixed at three and the parse never has to guess.
 */
const serialiseRuns = (runs = []) =>
    (runs || [])
        .map((run) => `${run.startKey}+${run.span}+${encodeURIComponent(run.name || "")}`)
        .join(",");

/*
 * The inverse. `decodeURIComponent` THROWS on a malformed percent sequence
 * (a hand-edited attribute, a truncated one), and a throw here would take the
 * whole repaint with it, so a name that will not decode comes back as the raw
 * text instead of killing the calendar.
 */
const decodeName = (text) => {
    try {
        return decodeURIComponent(text || "");
    } catch {
        return text || "";
    }
};

const parseRuns = (text) =>
    (text || "")
        .split(",")
        .filter(Boolean)
        .map((entry) => {
            // `span`, not days bought — see renderFundCalendar's note.
            const [startKey, span, name] = entry.split("+");
            return { startKey, span: Number(span) || 0, name: decodeName(name) };
        });

/*
 * THE SELECTION IS A SPAN, AND IT IS A SPAN EVEN WHEN IT IS ONE DAY LONG.
 * Revision 2, item 3.2.
 *
 * `data-fund-selected` is `startKey+span` — the run encoding minus the name,
 * because a selection has no owner. Item 5 previews a multi-day purchase by
 * lighting the days from the first open day through the clicked one, and that
 * preview is NOT a second visual state: it is this same selection with a
 * bigger number in the second field. Writing a single key here and growing it
 * into a span later would be two mechanisms where the file only needs one, so
 * a one-day press stores `+1` from the start.
 *
 * IT LIVES ON THE CONTAINER FOR THE SAME REASON THE OFFSET DOES: `paint()`
 * assigns `calendar.innerHTML`, so anything held on a cell dies on the first
 * resize. The attribute is re-read on every paint, so the selection survives
 * a repaint without anyone re-applying it. It doubles as the CSS hook — the
 * dim rule is `[data-fund-selected] .qntns-fund__day:not(.is-selected)` — so
 * one attribute both carries the span and switches the dim on.
 *
 * A missing, blank or unparseable attribute is an EMPTY SET, which is the
 * Ghost partial and every calendar nobody has pressed yet.
 */
const serialiseSelection = (startKey, span) => `${startKey}+${Math.max(1, Math.trunc(span) || 1)}`;

const parseSelection = (text) => {
    const keys = new Set();
    const [startKey, span] = (text || "").split("+");
    if (!startKey) return keys;
    const length = Math.trunc(Number(span)) || 0;
    for (let i = 0; i < length; i += 1) keys.add(addDays(startKey, i));
    return keys;
};

/*
 * `columns` is EXPLICIT and there is no measuring in here. A render function
 * that measured could not run in a story deterministically, could not run
 * before layout, and would need a resize observer to draw itself once. The
 * measurement lives in attachFund, which is the only place that has a box to
 * measure. The current-month floor is applied inside, so a caller cannot ask
 * for fewer columns than item 4 allows.
 *
 * The container carries the state the re-render needs: `data-fund-today` and
 * `data-fund-runs`, the latter a compact `startKey+span+name` list rather than
 * every filled key — SPAN, the days the run is drawn across, not the days it
 * bought, because a year of keys is four kilobytes of attribute and the
 * runs rebuild it exactly. This is what lets attachFund widen the grid to days
 * the first paint never drew, and it is what will let the hand-transcribed
 * Ghost partial work without being handed a state object.
 */
export const renderFundCalendar = (state, { columns = null } = {}) => {
    const runs = serialiseRuns(state.runs);
    /*
     * AN EXPLICIT COUNT IS A PIN, AND `data-fund-columns` IS HOW attachFund
     * FINDS OUT. Revision 2, item 7: a story that asks for 14 columns must
     * still have 14 after the section is attached, or the resize measurement
     * silently recomputes the very thing the story exists to hold still.
     *
     * `null` — the default, and what the real page uses — means AUTO: paint at
     * DEFAULT_COLUMNS for the one frame before attachFund measures, then let
     * the measurement take over. So the attribute is emitted only when a caller
     * pinned it, and its presence is the whole signal.
     */
    const pinned = Number.isFinite(columns) && columns > 0;
    const pin = pinned ? ` data-fund-columns="${Math.floor(columns)}"` : "";
    return `
    <div class="qntns-fund__calendar" data-fund-calendar data-fund-today="${state.today}" data-fund-runs="${runs}" data-fund-offset="0"${pin}>${renderCalendarInner(state, pinned ? columns : DEFAULT_COLUMNS)}
    </div>
    ${renderFundPager()}`;
};

/*
 * THE PAGER IS A SIBLING OF THE CALENDAR CONTAINER, NEVER A CHILD OF IT.
 *
 * `paint()` in attachCalendar assigns `calendar.innerHTML` on every resize.
 * Anything inside that container is destroyed by the first drag of a window
 * edge and takes its listeners with it. So the two arrows sit AFTER the
 * container, in markup nothing re-renders, and are bound exactly once.
 *
 * EACH BUTTON IS ALSO A .qntns-pagination__step, and that is not decoration.
 * Revision 10: the user asked for the same square button group the sections
 * use. Rather than restate 32px, the card border, the navy fill and the 20%
 * disabled state in fund.css, the buttons take pagination.css's own class, so
 * there is one definition of that control and it cannot drift. The dot strip
 * is deliberately absent — no .qntns-pagination wrapper, no dots, two buttons.
 * The fund class stays on them as the hook this file's own JS and the story
 * selectors already use.
 *
 * Glyphs come from the generated set via icon(), not hand-inlined SVG — the
 * same route the stepper's chevron-up/chevron-down take. See DECISIONS-LOG #5.
 * 16px, because these sit under a grid whose whole unit is the 16px day
 * square; a 20px default arrow would out-measure the thing it pages. A section
 * pager's glyph is 18px, which is off the 4-grid; this one stays 16.
 *
 * NO BOUNDS HERE, AND THAT IS NOT THE WHOLE STORY — attachCalendar CLAMPS.
 * This function emits both arrows enabled because it has no state to judge a
 * bound with. attachCalendar's `markPager` sets aria-disabled from the live
 * offset on bind and on every repaint, and its `page` handler refuses a press
 * that would cross. The limits are -52 weeks back and
 * max(52, weeks to the furthest filled-or-previewed day + 4) forward; see the
 * long note beside `bounds` in attachCalendar for why each is what it is.
 *
 * Markup from this function that is never attached pages nowhere, because
 * nothing is listening — which is the correct no-JS behaviour.
 */
const renderFundPager = () => `
    <div class="qntns-fund__pager" data-fund-pager>
      <button type="button" class="qntns-fund__page qntns-pagination__step" data-fund-page="-1" aria-label="Show the previous week">${icon("chevron-left", { size: 16, className: "qntns-fund__page-icon" })}</button>
      <button type="button" class="qntns-fund__page qntns-pagination__step" data-fund-page="1" aria-label="Show the next week">${icon("chevron-right", { size: 16, className: "qntns-fund__page-icon" })}</button>
    </div>`;

/*
 * THE COST BAR. Segments and legend come off the SAME constant, in the same
 * order, so the three bands and the three swatches cannot end up describing
 * different things. See COST above for why the last width is a remainder.
 */
export const renderFundCost = () => {
    const total = COST.segments.reduce((sum, seg) => sum + seg.amount, 0);
    let used = 0;
    const widths = COST.segments.map((seg, i) => {
        if (i === COST.segments.length - 1) return Math.round((100 - used) * 100) / 100;
        const pct = Math.round((seg.amount / total) * 10000) / 100;
        used += pct;
        return pct;
    });

    const bars = COST.segments
        .map((seg, i) => `<span class="qntns-fund__seg" data-seg="${seg.id}" style="--seg: ${widths[i]}%"></span>`)
        .join("");
    const legend = COST.segments
        .map((seg) => `<li class="qntns-fund__key"><span class="qntns-fund__swatch" data-seg="${seg.id}"></span>${escapeHtml(seg.label)}</li>`)
        .join("");

    return `
    <div class="qntns-fund__cost">
      <div class="qntns-fund__bar">${bars}</div>
      <span class="qntns-fund__total">$${COST.total}/year</span>
      <ul class="qntns-fund__legend">${legend}</ul>
    </div>`;
};

/*
 * THE PITCH, IN THE USER'S OWN WORDS. VERBATIM — DO NOT EDIT THIS COPY.
 *
 * Revision 1, item 7. Every character below is the user's, including the
 * CURLY QUOTES around “Self-hosted” and the DOUBLE SPACE after "live." Both
 * have been left exactly as written and neither is a typo to tidy: a
 * straightened quote and a collapsed space are the two edits a well-meaning
 * pass makes automatically, so they are called out here to stop it happening.
 *
 * NOTE FOR WHOEVER UPDATES COST: this copy says $50/month and the cost bar says
 * $682/year, which are different numbers ($50/month is $600). The copy is the
 * user's and is not derived from COST, so the two can drift. If the bill
 * changes, BOTH have to be edited by hand — there is deliberately no
 * interpolation here that would silently rewrite the user's sentence.
 *
 * Ghost.io and GoDaddy are ordinary links a reader may press. They are NOT a
 * runtime network call and do not touch CLAUDE.md's one-third-party-call rule,
 * which is about what the page fetches in order to render itself. A plain href
 * is the whole thing: no rel theatre, no tracking parameter.
 *
 * This is HTML, not text, and it is NOT escaped on the way out — it is authored
 * copy held in this file, not anything a reader or a payload can reach. The
 * funder names beside it are still escaped, because those come from strangers.
 */
const BLURB = [
    `Quentin pays $50/month to keep this site live.  Hosting a website costs money. “Self-hosted” websites cost about $10-30/month. The problem with self-hosted is they can be fickle to edit and maintain. To keep things easy, Quentin hosts with <a class="qntns-fund__link" href="https://ghost.io">Ghost.io</a>. Sadly, that costs $35/month. Then add the <a class="qntns-fund__link" href="https://www.godaddy.com">GoDaddy</a> domain name and the editing and coding software and you arrive at a somewhat expensive passion project.`,
    `Quentin could host his site for free on a social platform, but he wants to make something beautiful, free from ads, free from data-scraping. He wants to build something that makes him and others happy.`,
    `This site is happily self-funded. AND, if you want to support the cause, you can guarantee this site stays live for one more day by contributing just $2. Thank you for considering.`
];

/*
 * "View more" LIVES AT THE START OF THE FIRST PARAGRAPH, AND ONLY EXISTS WHEN
 * THE BLURB IS COLLAPSED. Revision 3, items 1 and 2 together; the start rather
 * than the end is 2026-08-29 — see renderBlurb below for why a float has to be
 * emitted ahead of the text it sits after.
 *
 * THERE IS NO COLLAPSE CONTROL AT ALL. Expanded, the button is GONE from the
 * DOM — not relabelled to its opposite, not hidden. The blurb opens once and stays open, so there is
 * nothing to toggle back to and no state for `aria-expanded` to flip between.
 * It is emitted with aria-expanded="false", which is an honest statement of the
 * one state it is ever rendered in, and the click handler removes it.
 *
 * WHY THE FIRST PARAGRAPH AND NOT THE LAST. Revision 2 put it at the end of the
 * last paragraph, because back then the button survived into the expanded state
 * and had to flow after the final sentence. Item 2 deletes that state. The only
 * state the button now exists in is COLLAPSED, where the blurb is capped at two
 * lines and the only paragraph on screen is the first — so the last paragraph
 * is exactly where the button can never be seen. It has to be in paragraph one.
 *
 * That is also what item 1's mechanism requires. The background pad is gone —
 * the user looked at it and rejected the lighter rectangle behind the text —
 * so the button can no longer cover the text running underneath it and the text
 * has to genuinely stop short instead. The float-shim that reserves that room
 * only works on text in the SAME block formatting context as the float, and
 * collapsed, that block is paragraph one. A float sitting in paragraph three
 * would reserve nothing on the lines actually being shown.
 *
 * DO NOT RE-ADD A BACKGROUND to make an overlap go away. The overlap is the
 * symptom of the reserve failing, and painting over it is the fix the user has
 * already seen and turned down.
 */
const renderMore = (expanded) => expanded
    ? ""
    : `<button class="qntns-fund__more" type="button" data-fund-more aria-expanded="false">View more</button>`;

/* THE BUTTON IS THE FIRST CHILD OF PARAGRAPH ONE, NOT THE LAST, AND THE
   ORDERING IS THE WHOLE LAYOUT. It is a right float that has to land on the
   SECOND of the two visible lines, and a float is never placed above its own
   position in the flow — emitted last, its flow position is already several
   lines below the 56px clip window and `clear` can only push it further down.
   Emitted first, the spacer float in fund.css can drop it exactly one line.

   It reads backwards in the source and it is correct: a float is taken out of
   flow, so nothing between here and the closing tag shifts because of it, and
   the rendered result is the button at the END of the last visible line with
   the text wrapping above and before it.

   This is why the previous revision reserved a 104px column down BOTH lines
   instead — it kept the button last and paid for it with a two-column blurb,
   which the user rejected on 2026-08-29. Moving it here is the fix; see THE
   BLURB in fund.css, which carries the other half. */
const renderBlurb = (paragraphs, expanded) => paragraphs
    .map((para, i) => {
        const head = i === 0 ? renderMore(expanded) : "";
        return `\n      <p class="qntns-fund__para">${head}${para}</p>`;
    })
    .join("");

/*
 * THE WHOLE SECTION.
 *
 * `data-empty` rather than a separate template: the empty state is the SAME
 * tile with different words in it, plus the buy tile removed from the DOM
 * entirely. Removed, not hidden — there is nothing to sell into an empty queue
 * that the left tile does not already say, and a hidden tile is still in the
 * tab order.
 *
 * THE COST BAR LIVES INSIDE THE BLURB, after the last paragraph. Revision 4,
 * item 1 — it moved up from the bottom of the section, under the calendar.
 *
 * THE CONSEQUENCE, WRITTEN DOWN BECAUSE IT IS REAL: the blurb is clipped to two
 * lines when collapsed, so THE COST BAR AND LEGEND ARE INVISIBLE UNTIL "View
 * more" IS PRESSED. That follows from where the user put it and is probably the
 * intent — the bar is the evidence for the argument the blurb is making, so it
 * belongs with the argument rather than stranded under the calendar. But it is
 * a behaviour change, not just a move, and if the user meant "always visible,
 * just higher up" the fix is to put it back outside the blurb, between the
 * blurb and the tiles.
 *
 * THE "View more" BUTTON IS STILL AT THE END OF THE FIRST PARAGRAPH, which
 * leaves it ABOVE the cost bar in document order rather than after it. That is
 * a deliberate departure from revision 4's stated order and the reason is that
 * the two requirements cannot both hold:
 *
 *   - Revisions 2 and 3 require the button to sit INLINE on the last visible
 *     line of the clipped blurb, reflowed around by the text. That only works
 *     if it is in the same block formatting context as the text being shown,
 *     which collapsed is paragraph one and nothing else.
 *   - Revision 4 puts it after the cost bar, which collapsed is far below the
 *     two-line cap — so it would be clipped away with everything else, and the
 *     blurb could never be expanded at all.
 *
 * The second reading breaks the control outright, so the first wins. Revision
 * 4's line reads as a guard against accidental reordering rather than a new
 * visual, but it is flagged rather than quietly resolved.
 *
 * THE BUY TILE IS ALWAYS RENDERED, INCLUDING WHEN NOBODY IS FUNDING.
 *
 * It used to be dropped in the empty state, because the original contract said
 * so — read off a reference image where the empty tile spans the full width.
 * That was a bug and it was backwards: an empty queue is the state where the
 * buy tile matters MOST, and omitting it meant a reader looking at "No one is
 * funding this site." had no way to do anything about it. The one screen that
 * most needed a call to action was the only one without one.
 *
 * It is also what CHECKLIST-v4 1.4's open question was settled to. The user was
 * asked what the right tile shows on an empty queue, today or tomorrow, and
 * answered TODAY — an answer that only means anything if the tile is on screen.
 * `fundState` already returns firstOpenKey = today for an empty queue (rule 4
 * at the head), so the chip is correct without any special case here.
 *
 * `data-empty` STAYS, but it now only drives the NOW tile's wording — "No one"
 * and "is funding this site." — and no longer removes anything from the DOM.
 * Nothing in this file may go back to keying layout off the buy tile's absence.
 */
export const renderFund = (state, { heading = "Fund", blurb = BLURB, expanded = false, days = 1, columns = null, unknown = false } = {}) => `
  <section class="qntns-fund" data-fund${!unknown && !state.current ? " data-empty" : ""}${expanded ? ' data-expanded=""' : ""}>
    <h2 class="qntns-fund__heading">${escapeHtml(heading)}</h2>

    <div class="qntns-fund__blurb" data-fund-blurb>${renderBlurb(blurb, expanded)}
      ${renderFundCost()}
    </div>

    <div class="qntns-fund__tiles"${unknown ? " data-fund-unknown" : ""}>
      ${renderFundNow(state, { unknown })}
      ${renderFundNext(state, { days, unknown })}
    </div>

    ${renderFundCalendar(state, { columns })}
  </section>
`;

/* -------------------------------------------------------------------------
 * Behaviour
 * ---------------------------------------------------------------------- */

/*
 * AN ARROW AT THE BOUND REFUSES OUT LOUD — the same shake and the same
 * error sound a face-down card and a dead pagination step give, sharing the
 * one qntns-refuse keyframe in card-group.css rather than copying it, so
 * the theme's three refusals cannot drift into three gestures.
 *
 * MODULE SCOPE, not inside wireStepper, because item 2.4 gave the section a
 * second refusable control — the pager arrows under the grid — and two copies
 * of a four-line gesture is exactly how the drift this comment warns about
 * starts.
 *
 * Restarting a CSS animation on an element that never left the DOM needs
 * the class removed, a reflow forced, and the class re-added. Reading
 * offsetWidth is the reflow; nothing uses the value.
 */
const REFUSE = "is-refused";

const refuse = (button) => {
    playError();
    button.classList.remove(REFUSE);
    void button.offsetWidth;
    button.classList.add(REFUSE);
};

/*
 * PRESS AND HOLD, FOUR STEPS A SECOND. Asked for by the user on 2026-09-09:
 * "holding down the button will also accept multi steps at 4 clicks per
 * second." Both repeating controls in this section use THIS function — the
 * week pager under the calendar and the day-count stepper in the buy tile —
 * for the same reason refuse() is at module scope: two copies of a
 * press-and-hold timer is two things to keep in step.
 *
 * 250ms IS A DURATION, NOT A MEASUREMENT. The base-4 rule in CLAUDE.md governs
 * pixels — things that have to line up with other things. Nothing lines up
 * with a repeat interval; 250 is 1000/4 and is the rate the user named.
 *
 * A TAP IS STILL EXACTLY ONE STEP. The single step is the caller's own `click`
 * handler and this function does not fire it. The repeat starts one interval
 * AFTER the press lands, so a press held for 1s steps at 250/500/750/1000 —
 * four steps in that second — and a press released before 250ms repeats not at
 * all and is answered by the click alone. When the repeat DID fire, the click
 * that follows the release would be a fifth step nobody asked for, so it is
 * swallowed here.
 *
 * ORDER MATTERS: call this BEFORE wiring the control's `click` handler. At the
 * event target, listeners run in registration order whatever their capture
 * flag, so the swallow can only get in front of a same-element click handler
 * by being registered first. (The pager's click handler is delegated onto an
 * ancestor, which this beats either way.)
 *
 * POINTER EVENTS, so a finger repeats as well as a cursor. Release, cancel and
 * the pointer leaving the button all stop it, and so does the tab losing
 * focus: a timer that outlived a `pointerup` delivered somewhere else would
 * page the calendar until the tab was closed. The button is deliberately NOT
 * pointer-captured — capture would suppress the pointerleave this relies on.
 *
 * KEYBOARD IS UNTOUCHED, WHICH IS THE POINT. A held Enter or Space on a
 * focused button already auto-repeats at the OS key rate and delivers a click
 * each time. Those clicks arrive with no pointerdown before them, so no
 * interval is ever started for them and nothing here stacks a second repeat on
 * top of the first.
 *
 * THE BOUND STOPS THE REPEAT AND REFUSES AT MOST ONCE. `act` returns false
 * when it could not move; this stops the timer on that answer. The refusal
 * itself stays in the caller, which already refuses a crossing press with the
 * shared refuse() — so a hold that reaches a bound shakes and sounds exactly
 * once, at the moment it arrives, rather than four times a second forever.
 * That also covers a hold that STARTS on a dead arrow: the swallowed click
 * would otherwise have left it silent.
 *
 * ACCELERATION IS OPT-IN (CHECKLIST-15 #79), AND THE DEFAULT IS FLAT. `accel`
 * is the ms taken off the delay after every repeat, floored at REPEAT_MIN_MS.
 * setInterval cannot change its period, so the timer is a setTimeout that
 * reschedules itself; that is the only structural change. Both of fund's own
 * callers pass nothing, accel is 0, and every delay is max(100, 250 - 0) =
 * 250 — the flat 4-a-second the user asked for by name on 2026-09-09.
 *
 * The listing's arrows pass 30: delay k = max(100, 250 - 30k), so
 * 250, 220, 190, 160, 130, 100, 100, … The five ramped delays sum to 950ms,
 * so the 10-a-second cap is reached just under a second into the hold. A hold
 * of 1s is 5 steps, 2s is 15, 3s is 25. Durations, not pixels — no base 4.
 */
const REPEAT_MS = 250;
const REPEAT_MIN_MS = 100;

export const holdRepeat = (button, on, act, accel = 0) => {
    let timer = null;
    let repeated = false;

    const stop = () => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
    };

    on(button, "pointerdown", (event) => {
        // Primary button only; a right-click opens a menu, it does not page.
        if (event.pointerType === "mouse" && event.button !== 0) return;
        stop();
        repeated = false;
        let delay = REPEAT_MS;
        const tick = () => {
            repeated = true;
            if (act() === false) return stop();
            delay = Math.max(REPEAT_MIN_MS, delay - accel);
            timer = setTimeout(tick, delay);
        };
        timer = setTimeout(tick, delay);
    });

    ["pointerup", "pointercancel", "pointerleave"].forEach((type) => on(button, type, stop));
    on(window, "blur", stop);

    on(button, "click", (event) => {
        if (!repeated) return;
        repeated = false;
        event.preventDefault();
        event.stopImmediatePropagation();
    });

    return stop;
};

/*
 * REBUILDING THE STATE THE CALENDAR NEEDS FROM THE MARKUP ITSELF.
 *
 * A resize re-render has to draw days the first paint never drew, so it needs
 * more than what is on screen. Reading it back off `data-fund-today` and
 * `data-fund-runs` — rather than being handed a state object — is what lets
 * this work in the hand-transcribed Ghost partial, where nothing calls
 * renderFund and there is no state object in existence.
 */
const calendarState = (calendar) => {
    const today = calendar.dataset.fundToday;
    if (!today) return null;
    const runs = parseRuns(calendar.dataset.fundRuns);

    // `owner` maps a day key to a run index — see ownerMap.
    const filled = new Set();
    runs.forEach((run) => {
        for (let i = 0; i < run.span; i += 1) filled.add(addDays(run.startKey, i));
    });
    const owner = ownerMap(runs);
    /*
     * THE PAGING POSITION LIVES ON THE ELEMENT, which is the whole point of it
     * being an attribute: `paint` re-reads this on every call, so a resize
     * repaint keeps whatever page the reader had turned to instead of snapping
     * back to today. A missing, blank or unparseable attribute is 0 — centred —
     * so the Ghost partial, which ships without it, is unaffected.
     */
    const offset = Math.trunc(Number(calendar.dataset.fundOffset)) || 0;
    // The pressed span, re-read here for the same reason as the offset above.
    const selected = parseSelection(calendar.dataset.fundSelected);
    // The cell holding the grid's single tab stop — item 3.4, and read back
    // off the container for the same reason as the two above.
    const roving = calendar.dataset.fundRoving || null;
    return { today, filled, runs, owner, offset, selected, roving };
};

/*
 * ONE COLUMN'S PITCH IN PIXELS, WHICH IS WHAT AN ARROW SCROLLS BY.
 *
 *   pitch = --fund-cell + --fund-gap = 16 + 4 = 20px
 *
 * THIS REPLACES fitColumns, AND THE REPLACEMENT IS THE WHOLE OF REVISION 13.
 * That function answered "how many columns fit in this box", and the answer
 * was then rendered exactly — which is why the strip could never overflow and
 * why there was nothing for a finger to scroll. paint() now renders the whole
 * funded span (see stripEnds) and the width decides nothing, so the only thing
 * still worth measuring is how far one press of an arrow should travel.
 *
 * The two numbers are read from the CSS custom properties rather than
 * hardcoded, because the CSS owns them and a copy here is a copy that drifts.
 * The fallbacks are today's values and only apply if the stylesheet has not
 * loaded, which is the one frame before it does.
 *
 * A PITCH IS A COLUMN, WHICH IS A WEEK EXCEPT AT A MONTH BOUNDARY, where
 * buildColumns splits a week in two. The old pager pivoted on a real date to
 * page by a real week every time; a scroll cannot, because it moves pixels.
 * The arrows' labels still say "week" and that is honest for all but the two
 * presses either side of a month edge — a scroll of 20px is one square, which
 * is the unit the reader can see.
 */
const columnPitch = (calendar) => {
    const styles = getComputedStyle(calendar);
    const px = (name, fallback) => {
        const value = parseFloat(styles.getPropertyValue(name));
        return Number.isFinite(value) && value > 0 ? value : fallback;
    };
    return px("--fund-cell", 16) + px("--fund-gap", 4);
};

/*
 * A ResizeObserver ON THE CALENDAR, not a window resize listener.
 *
 * The footer's width changes without the window's doing so — a scrollbar
 * appearing, the comments drawer sliding in, a Storybook panel being dragged —
 * and a window listener sees none of those. The observer watches the box that
 * actually decides the answer.
 *
 * IT ONLY EVER REWRITES THE GRID'S INNER MARKUP. The tiles are not touched, so
 * the stepper's value, its focus and the price cannot be clobbered by a resize
 * — not by careful restoration afterwards, but because the nodes never move.
 *
 * THE COLUMN-COUNT GUARD IS ALSO THE FEEDBACK GUARD. Re-rendering changes the
 * grid's contents, which resizes it, which fires the observer again; bailing
 * when the count has not changed breaks that loop on the first turn and skips
 * the work for every resize too small to add a column. The rAF coalesces a
 * drag into one render per frame.
 *
 * `on` is attachFund's listener helper, threaded in because item 3.3 binds on
 * `document` — the one listener here that outlives the section if it leaks.
 * `teardowns` stays alongside it for the two teardowns that are not listeners.
 *
 * `onSpan` is the CALENDAR-TO-STEPPER half of item 5.2, handed in by attachFund
 * because that is the only scope holding both sides. It is already wrapped in
 * the one-flag re-entrancy guard there — see `sync` in attachFund — so nothing
 * in here has to know that the stepper will paint back.
 */const attachCalendar = (section, teardowns, on, onSpan = null) => {
    const calendar = section.querySelector("[data-fund-calendar]");
    if (!calendar) return null;

    /*
     * THE GHOST PARTIAL SHIPS THIS CONTAINER EMPTY AND DATELESS, AND THAT USED
     * TO KILL THE CALENDAR OUTRIGHT.
     *
     * calendarState() returns null without a `data-fund-today`, and the guard
     * below then returned before the first paint — so in Ghost the grid never
     * drew at all, and because attachCalendar returned null the live queue load
     * had no repaint function to call either. One missing attribute took out
     * the whole calendar, silently, in the only environment that matters.
     * Storybook never saw it because renderFund writes the attribute.
     *
     * partials/fund-section.hbs cannot write it. Handlebars has no access to
     * the Eastern-time day boundary this section is defined in — see the head
     * of this file — and a server-rendered date would be the WRONG date for
     * anyone whose page was cached, which on Ghost is everyone. The browser is
     * the only thing that knows, so the browser seeds it.
     *
     * Only when it is absent: an explicit attribute from renderFund, or one
     * written by a live queue load, always wins.
     */
    if (!calendar.dataset.fundToday) calendar.dataset.fundToday = todayKey();

    if (!calendarState(calendar)) return null;

    /*
     * A PINNED COLUMN COUNT WINS AND THE OBSERVER IS NEVER STARTED. Not
     * "measured then overridden" — the measurement is the thing that must not
     * happen, and an observer that recomputes a value it is then told to
     * discard is a resize handler running for no reason on every drag.
     */
    const pinnedColumns = Number(calendar.dataset.fundColumns);
    const pinned = Number.isFinite(pinnedColumns) && pinnedColumns > 0;

    let painted = null;
    let frame = 0;

    /*
     * A REVEAL IS A REQUEST, HELD UNTIL THE PAINT THAT CAN HONOUR IT.
     *
     * reveal() used to write `data-fund-offset` and let the caller's own repaint
     * put the day on screen, which is why every caller writes the selection,
     * calls reveal, and then paints. Scrolling cannot work that way: the cell
     * being scrolled to has to EXIST, and before the paint the markup is still
     * the previous span's. So reveal() records the key and paint() does the
     * scroll once the strip it is scrolling within is in the DOM.
     *
     * Holding it here rather than reordering the callers is deliberate: the
     * write-then-reveal-then-paint order is load-bearing for a reason of its
     * own — `bounds()` has to already see the new selection — and three call
     * sites reordered around a new constraint is three chances to get it wrong.
     */
    let pending = null;

    /*
     * PUT A DAY IN THE MIDDLE OF THE BOX, BY SCROLLING.
     *
     * The centring that used to be slice arithmetic in renderCalendarInner —
     * "today sits in the middle", revision 2 item 2.1 — is now a scroll
     * position, because the strip is rendered whole and starts about a quarter
     * in the past. Same promise, different mechanism.
     *
     * getBoundingClientRect DELTAS AND NOT offsetLeft. offsetLeft is measured
     * from the nearest POSITIONED ancestor, and nothing in this section
     * establishes one, so it would be relative to some box further up the page
     * and the arithmetic would be silently wrong. The rects are relative to the
     * viewport, and the difference between two of them is not.
     *
     * `scrollLeft +=`, not `=`, for the same reason: the delta is measured from
     * where the box currently is.
     *
     * It reports whether it found the day. reveal() needs that answer — a day
     * outside the rendered span cannot be scrolled to and has to widen the span
     * first.
     */
    const centreOn = (key) => {
        const cell = calendar.querySelector(`[data-key="${key}"]`);
        if (!cell) return false;
        const box = calendar.getBoundingClientRect();
        const rect = cell.getBoundingClientRect();
        calendar.scrollLeft += (rect.left - box.left) - (calendar.clientWidth - rect.width) / 2;
        return true;
    };

    /*
     * FILLED IN WHEN THE PAGER IS BOUND, BELOW, AND A NO-OP UNTIL THEN.
     * Item 2.4's forward bound is a function of the filled-or-previewed set,
     * and BOTH of those move under the calendar's feet — a live queue load
     * rewrites `data-fund-runs`, a press rewrites `data-fund-selected`, and
     * both then ask for a repaint. So the arrows are re-marked from paint()
     * rather than only from a press, or a preview that reaches past the bound
     * would leave a still-dead arrow the reader can no longer use.
     */
    let markPager = () => {};

    /*
     * THE STATE IS RE-READ FROM THE ATTRIBUTES ON EVERY PAINT, not captured
     * once when this ran. That is what lets the live load replace the queue by
     * writing `data-fund-runs` and asking for a repaint — the attributes are
     * the single source of truth for what this grid draws, and nothing holds a
     * stale copy of them.
     */
    /* Both exits from paint() go through this, because a reveal asked for
       while the span is unchanged still has to scroll — the day is already
       rendered, which is exactly when the guard below returns early. */
    const flush = () => {
        if (!pending) return;
        const key = pending;
        pending = null;
        centreOn(key);
    };

    const paint = (force) => {
        frame = 0;
        const state = calendarState(calendar);
        if (!state) return;
        /*
         * THE LIVE STRIP IS RENDERED WHOLE AND THE WIDTH NO LONGER DECIDES
         * ANYTHING. Revision 13, the user's ruling of 2026-09-09: "allow left
         * right scroll with finger." The strip used to render exactly as many
         * columns as the box fit, which is why there was never anything to
         * scroll to — fitColumns made overflow impossible by construction. So
         * the whole funded span is emitted between stripEnds()' two keys and
         * scrollLeft is the reader's position.
         *
         * THE GUARD IS NOW THE SPAN, NOT A COLUMN COUNT, and it is a better
         * guard than the one it replaces. A resize cannot change the span, so
         * the observer's re-render loop is closed for a reason that no longer
         * depends on measuring; a live queue load or a preview CAN change it,
         * which is exactly when the strip has to be rebuilt.
         *
         * A pinned count keeps the old centred window, unmeasured — see
         * renderCalendarInner's fork and the note at `pinned` above.
         */
        const range = pinned ? null : stripEnds(state);
        const columns = pinned ? pinnedColumns : null;
        const key = pinned ? `pin:${pinnedColumns}` : `${range.from}..${range.through}`;
        if (key === painted && !force) {
            flush();
            return;
        }
        painted = key;
        /*
         * FOCUS SURVIVES THE REWRITE. Item 3.4's second bullet, and the THIRD
         * consequence in this file of `paint()` reassigning `innerHTML` — the
         * pager is a sibling of the container and the click handler is on the
         * container for the same reason. The focused cell is one of the nodes
         * thrown away, so without this a resize or a paging arrow drops a
         * keyboard reader back to the top of the document.
         *
         * WHICH CELL TO GO BACK TO IS NOT DECIDED HERE. renderCalendarInner
         * already clamped `data-fund-roving` to the nearest surviving day and
         * marked it `tabindex="0"`, so asking the fresh markup which cell holds
         * the stop is the same answer without a second copy of that rule.
         *
         * Only when focus was already inside: `document.activeElement` is read
         * BEFORE the assignment, because afterwards it is <body>.
         */
        const held = calendar.contains(document.activeElement);
        /* SCROLL POSITION SURVIVES THE REWRITE, for the same reason focus does.
           Reassigning innerHTML resets scrollLeft to 0, which would throw the
           reader back to the far past every time a preview changed the span.
           Read before, restored after, and clamped by the browser if the new
           strip is shorter. */
        const wasAt = calendar.scrollLeft;
        calendar.innerHTML = renderCalendarInner(state, columns, range ?? {});
        calendar.scrollLeft = wasAt;
        if (held) calendar.querySelector('.qntns-fund__day[tabindex="0"]')?.focus();
        flush();
        markPager();
    };

    // rAF hands its callback a timestamp, which is a truthy number — passing
    // paint straight to it would force a redraw on every frame of a drag.
    const schedule = () => {
        if (frame) return;
        frame = requestAnimationFrame(() => paint(false));
    };

    if (pinned) {
        paint(true);
    } else {
        if (typeof ResizeObserver === "function") {
            const observer = new ResizeObserver(schedule);
            observer.observe(calendar);
            teardowns.push(() => {
                observer.disconnect();
                if (frame) cancelAnimationFrame(frame);
            });
        } else {
            // No ResizeObserver: the window is the only signal there is. Worse,
            // but it degrades to a grid that is right on load and stale after a
            // drag, rather than to no grid.
            window.addEventListener("resize", schedule);
            teardowns.push(() => {
                window.removeEventListener("resize", schedule);
                if (frame) cancelAnimationFrame(frame);
            });
        }
        paint(false);
        /* AND THEN PUT TODAY IN THE MIDDLE. The strip begins at stripEnds()'
           `from`, which is thirteen weeks or more before today, so an unscrolled
           box opens on the past. This is the one call that makes the scroll
           position mean what the old centred slice meant. Only on the live
           path: a pinned count is already centred by the render. */
        centreOn(calendarState(calendar)?.today ?? calendar.dataset.fundToday);
    }

    /*
     * THE ARROWS SCROLL THE STRIP AND REPAINT NOTHING. Revision 13. They used
     * to write `data-fund-offset` and force a repaint, because the grid held
     * only the columns that fit and moving through the queue meant rendering a
     * different window of it. The whole span is now in the DOM, so an arrow is
     * a scrollBy and the two paragraphs that used to be here — why the repaint
     * had to be FORCED past paint()'s guard, and how focus and the roving cell
     * were put back afterwards — describe work that no longer happens.
     *
     * The Ghost partial hand-writes the calendar container and knows nothing
     * about a pager, so if the markup arrived without one it is inserted here
     * — after the container, for the reason renderFundPager gives.
     */
    if (!section.querySelector("[data-fund-pager]")) {
        calendar.insertAdjacentHTML("afterend", renderFundPager());
    }
    const pager = section.querySelector("[data-fund-pager]");
    if (pager) {
        /*
         * WHERE THE STRIP STOPS is no longer asked here. Item 2.4's bound is
         * pageBounds(), which lives at module scope beside the rest of the
         * calendar arithmetic, and paint() renders exactly the span it
         * describes — so the end of the strip IS the bound, and markPager
         * below reads it off the box instead of recomputing it. The closure
         * that used to wrap pageBounds for this scope had no other caller once
         * pageBy stopped writing an offset, so it is gone rather than kept as
         * a second name for one function.
         */
        const steps = [...pager.querySelectorAll("[data-fund-page]")];

        /*
         * A BOUND IS ANNOUNCED BEFORE IT IS HIT, so an arrow that cannot move
         * looks dead before the reader presses it — 20% opacity off
         * .qntns-pagination__step[aria-disabled="true"] in pagination.css,
         * which the pager buttons now carry directly. fund.css states the
         * same 20% for the stepper arrows, which are not pagination steps.
         *
         * aria-disabled and NOT the `disabled` property, for the reason
         * wireStepper gives at length: a disabled button dispatches no click,
         * and a boundary that answers nothing reads as a broken button. The
         * press has to arrive for refuse() to answer it.
         */
        markPager = () => {
            /* THE BOUND IS NOW THE SCROLL RANGE, AND IT IS THE SAME BOUND.
               paint() renders exactly the span pageBounds() describes, so "can
               this arrow move" and "is there strip left in that direction" are
               one question asked of the box instead of two answers that could
               disagree. `bounds()` is still what decided how much was drawn;
               it is simply not re-asked here.

               THE 1px SLACK ON THE FORWARD EDGE is not a measurement and needs
               no base-4 exemption: scrollLeft is fractional on a scaled
               display and scrollWidth - clientWidth is a rounded integer, so a
               box scrolled fully right can report a hair under its own maximum
               and the arrow would never go dead. Same class of problem as
               END_SLACK in home-content.js, and the same shape of answer.

               A strip with nothing to scroll disables BOTH, which is the
               honest reading of a queue that fits. */
            const max = calendar.scrollWidth - calendar.clientWidth;
            steps.forEach((button) => {
                const step = Number(button.dataset.fundPage);
                const dead = max <= 0
                    || (step < 0 ? calendar.scrollLeft <= 0 : calendar.scrollLeft >= max - 1);
                button.setAttribute("aria-disabled", dead ? "true" : "false");
            });
        };

        /* MARKED FROM THE SCROLL TOO, not only from a press and a paint. A
           finger is now a way of reaching a bound, so the arrows have to go
           dead when a swipe lands on one — otherwise the reader is looking at
           the end of the strip with a live-looking arrow. rAF-coalesced,
           because a scroll event fires per frame of a drag and this reads
           layout. */
        let markFrame = 0;
        const onScroll = () => {
            if (markFrame) return;
            markFrame = requestAnimationFrame(() => {
                markFrame = 0;
                markPager();
            });
        };
        calendar.addEventListener("scroll", onScroll, { passive: true });
        teardowns.push(() => {
            calendar.removeEventListener("scroll", onScroll);
            if (markFrame) cancelAnimationFrame(markFrame);
        });

        /*
         * ONE STEP, AND IT REPORTS WHETHER IT MOVED. Both routes into the pager
         * come through here — the click below and holdRepeat's timer — so the
         * bound is tested in one place. `false` means the press was refused,
         * which is what stops a hold at the edge of the range; see holdRepeat.
         */
        const pageBy = (button) => {
            const step = Number(button.dataset.fundPage);
            if (!Number.isFinite(step)) return false;
            /* IT SCROLLS. `data-fund-offset` is not written and the grid is not
               re-rendered — the whole span is already in the DOM, so moving
               through it is a scroll and nothing more. That is what deletes the
               forced repaint this used to need, and with it the reason focus
               and the roving cell had to be restored on every press.

               A REFUSAL IS STILL A REFUSAL, and it is measured rather than
               computed: at the edge there is no room in that direction, so the
               press gets refuse()'s shake and reports false, which is what
               stops holdRepeat at the end of the strip.

               `behavior: "smooth"` because a press is a step and a step that
               teleports reads as a re-render. A drag is the reader's own
               gesture and is untouched by this. */
            const max = calendar.scrollWidth - calendar.clientWidth;
            const at = calendar.scrollLeft;
            if (max <= 0 || (step < 0 ? at <= 0 : at >= max - 1)) {
                refuse(button);
                return false;
            }
            calendar.scrollBy({ left: step * columnPitch(calendar), behavior: "smooth" });
            return true;
        };

        // BEFORE the click listener, so holdRepeat's swallow is registered
        // first — see the note there. The click stays delegated on the pager;
        // the hold is per button, because a hold is a press on one of them.
        steps.forEach((button) => {
            const stop = holdRepeat(button, on, () => pageBy(button));
            teardowns.push(stop);
        });

        const page = (event) => {
            const button = event.target.closest("[data-fund-page]");
            if (!button) return;
            pageBy(button);
        };
        pager.addEventListener("click", page);
        teardowns.push(() => pager.removeEventListener("click", page));
        markPager();
    }

    /*
     * PRESSING A SQUARE. Revision 2, item 3.1.
     *
     * BOUND ON THE CONTAINER, NOT ON THE SQUARES AND NOT ON THE GRID. `paint()`
     * assigns `calendar.innerHTML`, so every square and the `.qntns-fund__grid`
     * that holds them are thrown away and rebuilt on the first drag of a window
     * edge — a listener on either dies with them. The container element itself
     * is never replaced, only its contents, so one listener here outlives every
     * repaint. Same reasoning as the pager sitting outside the container.
     *
     * `.is-blank` cells are spans, so `closest("button")` already skips them
     * and no class check is needed; `data-key` is then always present.
     *
     * WHAT A PRESS DOES (item 3.2): it writes the pressed day onto
     * `data-fund-selected` as a ONE-DAY SPAN and repaints. The span, rather
     * than a bare key, is what lets item 5's purchase preview be the same
     * mechanism with a bigger number instead of a second one. Clearing the
     * selection is item 3.3 and is not here.
     */
    /*
     * THE LEFT TILE FOLLOWS THE SELECTION. Revision 4, item 4.2.
     *
     * DRIVEN OFF `data-fund-selected`, NOT OFF THE PRESS. Same reason the
     * squares are: the attribute is the only place the selection lives, so one
     * function reading it back covers the press, the clear, and item 5's
     * multi-day preview without any of them knowing about this tile.
     *
     * WHICH DAY OF A SPAN THE TILE DESCRIBES: THE LAST ONE. A span runs from a
     * day the queue chose to the day the reader pressed (item 5 anchors it at
     * `data-fund-first`), so the last day is the only end of it that anybody
     * pointed at. A one-day press is the same rule with a span of 1.
     *
     * COMING BACK IS A STASH, NOT A RE-RENDER. `renderFundNow` needs `next`
     * and `remaining`, which the calendar's attributes do not carry — they hold
     * runs, not the handoff instant — so a rebuild here would drop the
     * "{Next} is next." clause and mis-count the days. The live tile's own
     * markup is kept verbatim instead and put back untouched, which is the
     * live tile by construction rather than by two renders agreeing.
     *
     * A PRESS ON TODAY RESTORES rather than rendering: renderFundDay hands
     * today back to renderFundNow, and the state available here cannot answer
     * renderFundNow. Restoring gets the same string and gets it right.
     *
     * SILENT IN THE UNKNOWN STATE. With no queue there are no runs, so every
     * day would read as unfunded — "No one" behind, "Maybe you" ahead — and
     * that is the empty state's claim made on data nobody has. Unknown is never downgraded into empty (rule 5).
     */
    let liveTile = null;

    const syncTile = () => {
        const tiles = section.querySelector(".qntns-fund__tiles");
        const now = tiles?.querySelector(".qntns-fund__tile--now");
        if (!now || tiles.hasAttribute("data-fund-unknown")) return;

        const state = calendarState(calendar);
        if (!state) return;

        const [startKey, span] = (calendar.dataset.fundSelected || "").split("+");
        const key = startKey
            ? addDays(startKey, Math.max(1, Math.trunc(Number(span)) || 1) - 1)
            : null;

        if (!key || key === state.today) {
            if (liveTile === null) return;
            now.outerHTML = liveTile;
            liveTile = null;
            return;
        }

        if (liveTile === null) liveTile = now.outerHTML;
        /*
         * `current` is the run owning TODAY'S SQUARE, which is all
         * renderFundDay wants it for — the name test behind "will continue
         * funding". It is not fundState's `current`: that pivots on the
         * handoff INSTANT and the attributes carry no clock, so on the one day
         * two runs share, this is the incoming name where the live tile still
         * shows the outgoing one. The wrong side of one handoff costs the word
         * "continue"; carrying a second clock in here would cost a second
         * source of truth.
         */
        now.outerHTML = renderFundDay(
            { ...state, current: state.runs[state.owner.get(state.today)] || null },
            key
        );
    };

    /*
     * LETTING IT GO. Revision 2, item 3.3.
     *
     * Clearing is the ABSENCE of the attribute plus a forced repaint, not a
     * flag in a closure: the selection has never lived anywhere but
     * `data-fund-selected`, and `renderCalendarInner` re-reads it on every
     * paint, so deleting it is the whole of the state change. The repaint is
     * forced for the same reason the press's is — the column count has not
     * moved, only the classes.
     *
     * The guard is not an optimisation: without it, an outside click anywhere
     * on the page would repaint a calendar that has nothing to clear.
     *
     * CLEARING A PREVIEW TAKES ITS NUMBER WITH IT. The user, 2026-09-09:
     * "after clicking in the future it changes to +X days. Well, clicking away
     * from that should return the buy box back to 1 day". Without this the
     * calendar goes quiet while the buy box still says 12 days and $24.00 —
     * item 5.2's two-views-of-one-number contract broken at the one moment
     * nobody had tested.
     *
     * IT IS CONDITIONED ON THE SPAN BEING DROPPED, NOT ON THE CLEAR. A span of
     * 2 or more is a PREVIEW: the calendar put that number in the field, so
     * taking the preview away takes the number too. A span of 1 is someone
     * looking a day up — a past day, a name — and p14-bind deliberately made
     * that NOT touch the buy tile, so that a reader who typed 30, clicked a
     * past day and pressed Escape still has 30. That decision stands and this
     * one does not contradict it; they are answers to two different questions.
     * The test is the exact mirror of `press`'s `if (span > 1) onSpan?.(span)`.
     *
     * IN clear() AND NOT IN THE OUTSIDE-CLICK LISTENER, so all three ways a
     * selection ends give the same answer — the outside click, pressing the
     * same square again, and Escape. Putting it in the listener would fix one
     * of three and leave a keyboard-only bug nobody would see.
     *
     * applyQueue's clear (via `repaint.clear`) resets too, and that is wanted
     * rather than tolerated: a live load can move the first open day the
     * preview was anchored to, so the count in the box would describe a stretch
     * that no longer starts where it started. It also runs BEFORE applyQueue
     * reads `input.value` to re-render the tiles, so the fresh tile is built
     * from the reset number rather than the stale one.
     */
    const clear = () => {
        if (!calendar.dataset.fundSelected) return;
        const wasPreview = parseSelection(calendar.dataset.fundSelected).size > 1;
        delete calendar.dataset.fundSelected;
        paint(true);
        syncTile();
        // AFTER the repaint, exactly like `press` — `onSpan` is already wrapped
        // in attachFund's `sync` guard, so the field writing back cannot bounce
        // in here, and setSpan declines a count of 1 with nothing selected.
        if (wasPreview) onSpan?.(1);
    };

    /*
     * SCROLLING TO AN OFF-SCREEN START. Revision 12 item 5.4, rebuilt at
     * revision 13.
     *
     * A preview always begins at the FIRST OPEN DAY, and that day is routinely
     * not in view: a queue sold a couple of months out puts it well past the
     * right edge of a 720px box, and the reader would type a day count and
     * watch a strip that did not appear to change.
     *
     * IT USED TO PAGE AND NOW IT SCROLLS, and the change is smaller than it
     * reads. The old version computed a week offset, wrote `data-fund-offset`
     * and let the caller's repaint re-centre the slice on that pivot; it needed
     * a visibility test first (was the day already rendered?) and a paragraph
     * of argument about why no clamp was required. The strip now holds the
     * whole funded span, so the day is essentially always rendered and the only
     * question left is where the box is looking. That is centreOn's job.
     *
     * NO CLAMP IS NEEDED, STILL, and now for a simpler reason: scrollLeft is
     * clamped by the browser to the strip's own extent, and the strip is
     * exactly pageBounds()' span. A day past the far edge cannot be produced —
     * `bounds()` maxes over `filled` UNION `selected` and every day before the
     * first open one is filled — but if one ever were, the box would stop at
     * its end rather than scroll into nothing. That is why callers still write
     * the selection BEFORE calling this.
     *
     * WHY IT ONLY RECORDS: see `pending` at the top of attachCalendar. The cell
     * has to exist before it can be scrolled to, and at the moment a caller
     * asks, the markup is still the previous span's.
     */
    const reveal = (key) => {
        if (key) pending = key;
    };

    const press = (event) => {
        const button = event.target.closest("button.qntns-fund__day");
        if (!button || !calendar.contains(button)) return;
        const key = button.dataset.key;
        if (!key) return;
        // THE PRESSED SQUARE TAKES THE TAB STOP (item 3.4). Not a nicety: the
        // press forces a repaint, and paint() puts focus back on whichever cell
        // holds the stop — so without this line a mouse press would repaint and
        // then throw focus to a cell somewhere else in the grid.
        calendar.dataset.fundRoving = key;
        // The same square again is the way out — item 3.3. The comparison is
        // against the serialised form, so it matches only a one-day selection
        // of this day; pressing inside a multi-day preview re-anchors it,
        // which is item 5's business, not a clear.
        if (calendar.dataset.fundSelected === serialiseSelection(key, 1)) {
            clear();
            return;
        }
        /*
         * WHAT THE PRESS SELECTS. Revision 12, items 5.1 and 5.3.
         *
         * A press on a day AHEAD of the first open day selects the whole stretch
         * from that first open day through the one pressed — the days a purchase
         * ending there would cover. A press on the first open day itself, or on
         * anything before it, is the ordinary one-day selection: the past is
         * never for sale (rule 4 at the head of this file), and a span of one is
         * below the preview threshold by definition. So there is one write here
         * and the span length is the only thing that differs.
         *
         * THE FIRST OPEN DAY COMES OFF THE BUY TILE, NOT OFF CALENDAR STATE.
         * `calendarState` rebuilds from `data-fund-runs` and cannot know when
         * the queue runs out. `renderFundNext` already writes the answer onto
         * the tile as `data-fund-first` (fund.js:714) and `wireStepper` already
         * reads it back from there — same attribute, same DOM, no new plumbing.
         * It is absent only in the unknown state, where there is nothing to
         * preview and `first` is null, which falls through to a one-day press.
         *
         * Keys are `YYYY-MM-DD`, so `>` is a date comparison.
         */
        const first = section.querySelector("[data-fund-first]")?.dataset.fundFirst || null;
        /*
         * CLAMPED AT MAX_DAYS, because the grid pages and the stepper does not.
         * Two arrows to the right and a press puts the clicked day more than a
         * year out; the field would clamp the number it was handed and the map
         * would keep the unclamped one, which is the two views disagreeing
         * about the one number item 5.2 exists to keep single.
         */
        const span = first && key > first
            ? Math.min(MAX_DAYS, diffDays(first, key) + 1)
            : 1;
        calendar.dataset.fundSelected = span > 1
            ? serialiseSelection(first, span)
            : serialiseSelection(key, 1);
        // Item 5.4. Only a preview has an off-screen start to page to: a span
        // of one is anchored on the square just pressed, which is on screen by
        // definition. AFTER the write, so `bounds()` already sees the span.
        if (span > 1) reveal(first);
        // `force`, because the column count has not moved — only the classes.
        paint(true);
        syncTile();
        /*
         * ONLY A PREVIEW MOVES THE BUY TILE. Item 5.2's first bullet is "the
         * PREVIEW writes the day count", and a span of 1 is not one — a look-up
         * at a day in the past would otherwise silently reset a count the
         * reader had already dialled in, which is a purchase changing under
         * someone who only clicked to read.
         */
        if (span > 1) onSpan?.(span);
    };
    on(calendar, "click", press);

    /*
     * THE ARROW KEYS MOVE THE TAB STOP. Item 3.4.
     *
     * Bound on the CONTAINER, like the press and for the same reason: the rows
     * and every cell in them are replaced on each repaint, so a listener on
     * either dies with them. The shape — one `keydown` on the element that
     * owns the control, a key table, `preventDefault`, move — is copied from
     * pagination.js:167 rather than invented.
     *
     * IT WALKS THE DOM, NOT THE DATES. Left and right mean the previous and
     * next COLUMN in this weekday's row, and a column is a contiguous run of
     * days sharing a week AND a month, so it is not "seven days back": a week
     * straddling a month edge is two columns and both are partly blank. The
     * rendered row already holds the answer in its cell order, and every row
     * holds the same number of cells, so a column index means the same thing in
     * all seven. Doing this arithmetic again here is the copy that drifts.
     *
     * BLANKS ARE SKIPPED, NOT STOPPED AT. A `.is-blank` cell is a <span> with
     * nothing to press, so the walk steps over it and keeps going in the same
     * direction — otherwise a month edge would be a wall halfway across the
     * grid. Running off the end of a row or column simply does nothing; there
     * is no wrap, because Home and End are the ends of the row.
     *
     * `preventDefault` fires for every key this handler claims, even when the
     * walk found nothing, or an arrow at the edge of the grid would scroll the
     * page instead.
     */
    const daysIn = (row) => [...row.children].filter((el) => el.classList.contains("qntns-fund__day"));
    const rove = (cell) => {
        if (!cell) return;
        const held = calendar.querySelector('.qntns-fund__day[tabindex="0"]');
        if (held) held.tabIndex = -1;
        cell.tabIndex = 0;
        // The attribute is the storage; the two lines above are the same state
        // applied to the markup that is already on screen, so the move costs no
        // repaint and the next repaint agrees with it.
        calendar.dataset.fundRoving = cell.dataset.key;
        cell.focus();
    };

    const ROVE_KEYS = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1 };

    on(calendar, "keydown", (event) => {
        const cell = event.target.closest?.("button.qntns-fund__day");
        if (!cell || !calendar.contains(cell)) return;
        const key = event.key;
        if (!(key in ROVE_KEYS) && key !== "Home" && key !== "End") return;
        event.preventDefault();

        const row = cell.parentElement;
        const cells = daysIn(row);
        const index = cells.indexOf(cell);
        const isDay = (el) => el && el.tagName === "BUTTON";
        let next = null;

        if (key === "Home") next = cells.find(isDay);
        else if (key === "End") next = [...cells].reverse().find(isDay);
        else if (key === "ArrowLeft" || key === "ArrowRight") {
            const step = ROVE_KEYS[key];
            for (let i = index + step; i >= 0 && i < cells.length; i += step) {
                if (isDay(cells[i])) { next = cells[i]; break; }
            }
        } else {
            const step = ROVE_KEYS[key];
            const rows = [...calendar.querySelectorAll(".qntns-fund__row")];
            for (let r = rows.indexOf(row) + step; r >= 0 && r < rows.length; r += step) {
                const at = daysIn(rows[r])[index];
                if (isDay(at)) { next = at; break; }
            }
        }

        rove(next);
    });

    /*
     * OUTSIDE AND ESCAPE, the house dismissal contract — drawer.js:19 states it
     * ("clicking anywhere outside closes it, and so does Escape") and
     * footnotes.js repeats it. Both listeners go on `document` because this is
     * the first dismissable thing here with NO SCRIM: every other one tests
     * `.closest("[data-*-close]")` on an element that covers the outside, and
     * the calendar has no such element. Both are registered through `on`, so
     * they land in attachFund's teardown list — a document listener that
     * bypassed it would outlive the section.
     *
     * THE PAGER IS NOT OUTSIDE. It sits after the container in the DOM (see
     * renderFundPager) but it is part of the calendar, and turning a page while
     * a day is selected must not throw the selection away.
     *
     * IT LISTENS IN THE CAPTURE PHASE, AND THAT IS THE WHOLE OF THE FIX FOR THE
     * BUG THIS SHIPPED WITH. `contains(event.target)` reads as obviously
     * correct and is not: `press` writes `data-fund-selected` and then forces a
     * `paint(true)`, which reassigns `calendar.innerHTML` and so DETACHES the
     * very square that was clicked. The event's propagation path was fixed at
     * dispatch, so this handler still runs afterwards — against a node that no
     * longer has the calendar as an ancestor. `contains` answers false, an
     * inside click is misread as an outside one, and `clear()` throws away the
     * selection the press had just made. Day selection did not work at all.
     *
     * A DETACHED TARGET IS NOT AN OUTSIDE CLICK. Deciding in the capture phase
     * asks the question while the target is still in the tree, BEFORE any
     * handler downstream has had the chance to repaint — so the answer does not
     * depend on how many repaints run, or on which of them run first. That is
     * why this is capture rather than an `event.target.isConnected` test:
     * `isConnected` is a proxy for "was it detached by a repaint", and it would
     * also swallow a genuine outside click on a node some unrelated code had
     * removed. Order the test correctly and there is nothing to proxy.
     *
     * The pager exclusion below rides on the same guarantee: paint() leaves the
     * pager alone today (it is a sibling of the container and markPager only
     * sets attributes), but if a future change ever re-renders it, `closest`
     * here is still asked before that happens.
     *
     * The Escape handler is NOT exposed to this trap — it tests
     * `document.activeElement`, which is live rather than captured, and paint()
     * puts focus back on the roving cell.
     *
     * Escape only answers when focus is inside the section — otherwise the
     * footer's calendar would eat an Escape meant for the drawer above it —
     * and it stops propagating once it has cleared something, the trap
     * postcard.js:3755-3767 records: an unstopped Escape closes the outer
     * thing too.
     */
    on(document, "click", (event) => {
        const target = event.target;
        if (calendar.contains(target)) return;
        if (target.closest?.("[data-fund-pager]")) return;
        /*
         * NEITHER IS THE STEPPER. The arrows and the field are the OTHER VIEW
         * of the selection (item 5.2), not a click away from it — and because
         * this listener is in the capture phase it runs BEFORE the arrow's own
         * click handler. Without this line every arrow press cleared the
         * preview first (`clear` calls `onSpan?.(1)`, which writes 1 into the
         * field) and only then stepped, so up never got past 2 and down from a
         * 50-day preview landed on 1 instead of 49.
         */
        if (target.closest?.("[data-fund-step], [data-fund-days]")) return;
        /*
         * NEITHER IS THE BUY BUTTON. Same trap as the stepper and worse: this
         * capture listener runs BEFORE wireBuy's own click handler, so clearing
         * here wrote 1 into the field and the checkout that followed read it —
         * a reader who previewed 30 days and pressed Buy was sent to Stripe for
         * one day. Buying IS the selection being used, not a click away from it.
         */
        if (target.closest?.("[data-fund-buy]")) return;
        clear();
    }, true);

    on(document, "keydown", (event) => {
        if (event.key !== "Escape") return;
        if (!calendar.dataset.fundSelected) return;
        if (!section.contains(document.activeElement)) return;
        event.stopPropagation();
        clear();
    });

    // The handle the live load uses to redraw after it has rewritten the
    // attributes. `force`, because the column count has not changed — only the
    // queue behind it has.
    //
    // `.clear` rides along on it so applyQueue can drop a selection BEFORE it
    // replaces the tiles — see the note there. It is the same `clear` the
    // press, Escape and outside-click paths use, so there is still exactly one
    // way a selection ends.
    const repaint = () => paint(true);
    repaint.clear = clear;
    /* PUBLISHED FOR applyQueue, AND FOR NOTHING ELSE. A live load replaces the
       runs, which moves both ends of the strip, so the scroll position it was
       holding describes a span that no longer exists. It records today and the
       repaint that follows performs it — see `pending` and reveal(). */
    repaint.reveal = reveal;
    /*
     * THE STEPPER-TO-CALENDAR HALF of item 5.2. The field moved, so the span
     * is re-anchored at the first open day and redrawn — the same one write
     * `press` makes, through the same serialiser, so a typed 5 and a click
     * five days out are the identical state and cannot drift.
     *
     * IT REFUSES TO INVENT A SELECTION. A count of 1 with nothing selected is
     * the PAGE-LOAD state — the field ships at `value="1"` — and previewing
     * there would light a square nobody pressed. A count of 1 with a selection
     * already up is item 5.3's wind-down, which collapses to the ordinary
     * one-day selection of the first open day. Same line decides both.
     *
     * The equality bail is not the loop guard (that is `sync` in attachFund);
     * it just skips an innerHTML rewrite for a repaint that would draw the
     * identical grid — a `change` event after an `input` event is exactly that.
     */
    repaint.setSpan = (count) => {
        const first = section.querySelector("[data-fund-first]")?.dataset.fundFirst || null;
        if (!first) return;
        if (count <= 1 && !calendar.dataset.fundSelected) return;
        const next = serialiseSelection(first, count);
        if (calendar.dataset.fundSelected === next) return;
        calendar.dataset.fundSelected = next;
        // Item 5.4, and unconditional here because EVERY selection this path
        // writes is anchored at the first open day — the wind-down to one day
        // included. Typing into the field is the case the item is really about:
        // the map must move to where the money starts rather than sit still.
        reveal(first);
        paint(true);
        syncTile();
    };
    return repaint;
};

/* -------------------------------------------------------------------------
 * The Worker
 * ---------------------------------------------------------------------- */

/*
 * THIS IS THE SECOND FILE IN THE THEME ALLOWED TO FETCH, and it talks to the
 * SAME Worker as the first. assets/js/qntns/sync.js carries read receipts to
 * `qntns-reads.qstaley921.workers.dev`; funding is a second route on that same
 * origin, which is what keeps CLAUDE.md's one-third-party-runtime-call rule
 * intact rather than needing a second amendment. See CHECKLIST-v4.md section 6.
 *
 * Stripe is reached by NAVIGATION and never by a script. The page loads no
 * stripe.js and no third-party asset at any point: the button asks this Worker
 * for a hosted Checkout URL and then leaves. A link the reader presses is not
 * the same thing as a script the page loads to render itself.
 *
 * THE FIVE RULES FROM sync.js APPLY HERE UNCHANGED, and every one of them is
 * load-bearing for a section that sits in the footer of every page:
 *
 *   1. NEVER BLOCK FIRST PAINT. The section is fully rendered from the server's
 *      markup before anything below runs. No fetch is awaited by anything that
 *      paints, and nothing here is blanked while a request is in flight — a
 *      spinner where the funder's name goes would be strictly worse than the
 *      slightly stale name that is already correct almost all of the time.
 *
 *   2. NEVER THROW. One uncaught error kills every script on the page in this
 *      theme. attachFund is one try/catch, and each async path below carries
 *      its own as well, because a promise rejecting after attachFund has
 *      returned lands outside that outer catch entirely.
 *
 *   3. NEVER HANG. fetch has no default timeout. Both requests carry
 *      AbortSignal.timeout, so a Worker that never answers cannot leave a task
 *      running for the life of the tab.
 *
 *   4. NEVER SHOW THE READER AN ERROR. A dead Worker, a bad payload or a Stripe
 *      outage costs the LIVE data and nothing else; the server-rendered section
 *      stays exactly where it is. One console.debug is the whole concession.
 *
 *   5. DEGRADE TO THE MARKUP. Every failure below is a `return`, and what is
 *      left behind is the section as Ghost rendered it.
 */
const FUND_BASE = "https://qntns-reads.qstaley921.workers.dev";

// Same budget sync.js uses: generous enough for a cold Worker isolate on a slow
// mobile connection, short enough that this never outlives its page.
const TIMEOUT_MS = 8000;

/*
 * GET /fund — the public queue. No token, deliberately: who is funding this
 * site is a fact about the site rather than about a reader.
 *
 * The Worker returns ORDERS and nothing derived. Who is funding today, who is
 * next and which squares are filled are all worked out here by the same
 * layQueue/fundState the stories run against — there is deliberately no second
 * copy of that logic on the server for the two to disagree about.
 */
const loadQueue = async (section, repaintCalendar, wire) => {
    try {
        const res = await fetch(`${FUND_BASE}/fund`, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(TIMEOUT_MS)
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!data || !Array.isArray(data.orders)) return;

        applyQueue(section, fundState(data.orders), repaintCalendar, wire);
    } catch (error) {
        // Rule 4. The section on screen is already correct-ish and the reader
        // has no action to take, so this is for whoever is actually looking.
        console.debug("[fund] queue unavailable", error);
    }
};

/*
 * Swap the server-rendered queue for the live one.
 *
 * THE STEPPER'S VALUE SURVIVES. It is read before the tiles are replaced and
 * handed back to renderFundNext, because someone who typed "30" while the
 * request was in flight has not asked for it to become 1 again. The blurb is
 * not touched at all, so an expanded blurb stays expanded.
 *
 * `data-empty` is recomputed rather than assumed: the live queue can be empty
 * when the rendered one was not, and the now tile's wording keys off it. The
 * BUY tile is present either way — see the note above renderFund.
 */
const applyQueue = (section, state, repaintCalendar, wire) => {
    /*
     * THE SELECTION GOES FIRST, AND IT GOES BEFORE THE TILES ARE REPLACED.
     * Revision 4, item 4.2.
     *
     * The new queue can hand a day to somebody else, so a selection made
     * against the old one describes a day this data may have reassigned. It
     * also has to be dropped BEFORE the rewrite below rather than after: the
     * left tile is restored from a stash of the markup that is about to be
     * thrown away, and putting that back afterwards would overwrite the fresh
     * tile with the stale one.
     */
    repaintCalendar?.clear?.();

    const tiles = section.querySelector(".qntns-fund__tiles");
    if (tiles) {
        const input = section.querySelector("[data-fund-days]");
        const days = input ? Math.max(1, Math.floor(Number(input.value) || 1)) : 1;
        tiles.innerHTML = `${renderFundNow(state)}${renderFundNext(state, { days })}`;
        /*
         * THE ONLY PLACE `data-fund-unknown` IS EVER REMOVED, and it is reached
         * only from loadQueue's success path. A timeout, a non-200, a thrown
         * fetch or a payload with no orders array all return before this runs,
         * so the dashes stay and the section keeps saying nothing rather than
         * saying something false. Unknown is never downgraded into empty.
         */
        tiles.removeAttribute("data-fund-unknown");
        if (state.current) section.removeAttribute("data-empty");
        else section.setAttribute("data-empty", "");
        // The nodes the stepper and the buy button were bound to have just been
        // thrown away, so they are bound again on the new ones.
        wire(section);
    }

    const calendar = section.querySelector("[data-fund-calendar]");
    if (calendar && repaintCalendar) {
        calendar.dataset.fundToday = state.today;
        calendar.dataset.fundRuns = serialiseRuns(state.runs);
        // A LIVE LOAD SNAPS THE CALENDAR BACK TO TODAY, and since revision 13
        // that is a SCROLL and not an attribute. The runs it just wrote can
        // move both ends of the strip — pageBounds() reads the first funded day
        // — so a scroll position measured against the old span means nothing
        // against the new one, and today is the only place that still does.
        // reveal() records it and the repaint below performs it, which is the
        // same order every other caller uses.
        repaintCalendar.reveal?.(state.today);
        repaintCalendar();
    }
};

/*
 * THE DAY STEPPER. Everything in the buy tile that changes when the count does,
 * repainted from ONE function so the price, the unit, the range line and the
 * button's accessible name cannot drift apart.
 *
 * NOTHING HERE TOUCHES THE NETWORK. The price is `days * 2` and the range is
 * `firstOpenKey + days`, both computed locally — a round trip to ask a server
 * what 7 x 2 is would be slower and could fail.
 *
 * It is re-run after a live load replaces the tiles, so it must be safe to call
 * more than once on the same section; it binds only to nodes it finds now.
 *
 * `teardowns` IS TAKEN AS WELL AS `on` because hold-to-repeat owns a timer, and
 * a timer is not a listener — `on` can only unbind. attachFund's list is the
 * one thing guaranteed to run when the section goes away, so the stop function
 * goes in it. Same reason attachCalendar has always taken both.
 */
const wireStepper = (section, on, teardowns, onCount = null) => {
    const input = section.querySelector("[data-fund-days]");
    if (!input) return null;

    const unit = section.querySelector("[data-fund-unit]");
    const price = section.querySelector("[data-fund-price]");
    const range = section.querySelector("[data-fund-range]");
    const buy = section.querySelector("[data-fund-buy]");
    const buyTile = input.closest(".qntns-fund__tile--buy");
    const chipDay = buyTile?.querySelector(".qntns-fund__chip-day");
    const chipMonth = buyTile?.querySelector(".qntns-fund__chip-month");

    // The first open day is read ONCE, off what was rendered, and never
    // recomputed. Re-deriving it from a fresh todayKey() in a handler would let
    // a tab left open overnight sell a different day than the one on the chip
    // the reader is looking at. A live load rewrites the tile and this runs
    // again, which is the only thing that may change it.
    const firstOpenKey = buyTile?.dataset.fundFirst || null;

    const paint = () => {
        const count = Math.min(MAX_DAYS, Math.max(1, Math.floor(Number(input.value) || 1)));
        if (String(count) !== input.value) input.value = String(count);
        if (unit) unit.textContent = count === 1 ? "day" : "days";
        // ONE price node, and it is the button's own label. See the note above
        // renderFundNext — there is deliberately no second one to keep in step.
        if (price) price.textContent = money(count * PRICE_PER_DAY);
        if (range) range.textContent = rangeText(firstOpenKey, count);
        // The chip is invariant — see renderFundNext. It is written back anyway
        // so that this function is the single place the tile's contents come
        // from, and so a future change of mind about the start day has exactly
        // one place to land.
        if (firstOpenKey && chipDay && chipMonth) {
            chipDay.textContent = dayOfMonth(firstOpenKey);
            chipMonth.textContent = monthShort(firstOpenKey);
        }
        // The visible label is a bare number now, so the accessible name is the
        // only thing that says what the button does.
        if (buy) buy.setAttribute("aria-label", buyLabel(count, firstOpenKey));
        // THE FIELD IS AS WIDE AS ITS DIGITS. 1ch is the width of a "0" in the
        // current font and the value is digits only, so length ch is an exact
        // fit — which is what keeps "1 day" reading as one word group instead
        // of a glyph parked in the middle of a fixed box. See
        // .qntns-fund__days in fund.css, which carries the same reasoning and
        // the 1ch floor this overwrites.
        input.style.width = `${String(count).length}ch`;
        // A bound is announced BEFORE it is hit, so the arrow that cannot move
        // looks dead before the reader presses it. aria-disabled and not the
        // `disabled` property, because a disabled button dispatches no click
        // and a boundary that answers nothing reads as a broken button — the
        // press has to arrive for refuse() to answer it.
        steps.forEach((button) => {
            const dead = Number(button.dataset.fundStep) > 0 ? count >= MAX_DAYS : count <= 1;
            button.setAttribute("aria-disabled", dead ? "true" : "false");
        });
        /*
         * AND THE MAP. Item 5.2's second bullet — the field is the other view
         * of the same number, so every route that changes it (typing, the
         * native arrow keys, either stepper arrow, a blur that reformats, and
         * the calendar itself) lands here and resizes the highlight.
         *
         * LAST, DELIBERATELY. Everything above is this tile's own nodes and
         * must be right whether or not a calendar exists; this is the one line
         * that reaches outside the tile.
         *
         * `onCount` arrives already wrapped in attachFund's `sync` guard, so
         * the calendar writing the field cannot bounce back through here — the
         * bind-time `paint()` below is also a call, and with a count of 1 and
         * nothing selected `setSpan` declines it, which is what keeps page load
         * from drawing a selection.
         */
        onCount?.(count);
    };

    const steps = [...section.querySelectorAll("[data-fund-step]")];

    /*
     * ONE STEP, AND IT REPORTS WHETHER IT MOVED — the same shape the pager's
     * pageBy has, for the same reason: the click below and holdRepeat's timer
     * both come through here, so the bound is tested once. `paint()` already
     * marked the dead arrow, so the test is just reading that back.
     *
     * `false` stops a hold at 1 and at MAX_DAYS after exactly one refusal. The
     * stepper reaches its bounds constantly, and a shake plus playError() four
     * times a second is an alarm, not an answer.
     */
    const stepBy = (button) => {
        if (button.getAttribute("aria-disabled") === "true") {
            refuse(button);
            return false;
        }
        input.value = String((Number(input.value) || 1) + Number(button.dataset.fundStep));
        paint();
        return true;
    };

    steps.forEach((button) => {
        // BEFORE the click listener: at the target, listeners run in the order
        // they were registered, so this is the only way holdRepeat's swallow
        // gets in front of the click it has to swallow.
        teardowns.push(holdRepeat(button, on, () => stepBy(button)));
        on(button, "click", () => stepBy(button));
    });

    // Both events: "input" catches typing and the native arrow keys, "change"
    // catches a commit the browser makes without an input event (a blur that
    // reformats the value).
    on(input, "input", paint);
    on(input, "change", paint);
    paint();

    /*
     * The handle the calendar drives the tile with. It goes through `paint`
     * rather than setting the nodes itself, so the clamp, the price, the range
     * line, the chip, the field width and the arrow bounds are computed in the
     * one place they have always been computed. attachFund re-binds this after
     * a live load replaces the tiles, which is why it is returned rather than
     * captured once.
     */
    return (count) => {
        input.value = String(count);
        paint();
    };
};

/*
 * POST /fund/checkout — trade a day count for a Stripe Checkout URL.
 *
 * WHY THE BUTTON IS STILL AN ANCHOR. With JavaScript off it is an href that
 * goes nowhere, which is honest; with JavaScript on this intercepts it. It
 * cannot be a <button> because the no-JS case would then be a control that
 * looks pressable and is not.
 *
 * DOUBLE-CLICK CREATES ONE SESSION, NOT TWO. An anchor has no `disabled`, and
 * a disabled control would not fire the click this needs to swallow anyway, so
 * the guard is a busy flag plus aria-disabled — the same reasoning as the
 * pagination steps, which also have to stay clickable in order to refuse.
 *
 * ON SUCCESS THE BUTTON IS LEFT DISABLED. The page is navigating away; putting
 * it back would make it briefly pressable again during the unload.
 */
const wireBuy = (section, on) => {
    const buy = section.querySelector("[data-fund-buy]");
    const input = section.querySelector("[data-fund-days]");
    if (!buy || !input) return;

    on(buy, "click", async (event) => {
        event.preventDefault();
        if (buy.dataset.fundBusy) return;
        buy.dataset.fundBusy = "1";
        buy.setAttribute("aria-disabled", "true");

        try {
            const days = Math.min(MAX_DAYS, Math.max(1, Math.floor(Number(input.value) || 1)));
            const res = await fetch(`${FUND_BASE}/fund/checkout`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ days }),
                signal: AbortSignal.timeout(TIMEOUT_MS)
            });
            if (!res.ok) throw new Error(`checkout ${res.status}`);
            const data = await res.json();
            if (!data || typeof data.url !== "string") throw new Error("checkout url missing");
            window.location.assign(data.url);
            return;
        } catch (error) {
            console.debug("[fund] checkout unavailable", error);
        }

        delete buy.dataset.fundBusy;
        buy.removeAttribute("aria-disabled");
    });
};

/*
 * THE RETURN MARKER. Stripe sends a buyer back to `/?funded=1`.
 *
 * THE THANK-YOU MUST NOT DEPEND ON THEIR ORDER BEING IN THE QUEUE. The webhook
 * is a separate request from a separate machine and it may not have landed by
 * the time the reader's browser gets back here — so a footer that only says
 * thank you once the name appears would, for those few seconds, show somebody
 * who just paid a section that looks exactly as it did before they did. That
 * reads as a failed payment, and preventing that reading is the whole reason
 * this exists. The marker in the URL is proof enough that Stripe finished.
 *
 * THE PARAM IS THEN REMOVED from the address bar with replaceState, so a
 * reload or a shared link does not say thank you to someone who paid nothing.
 * replaceState rather than pushState: this is not a place in history worth a
 * back button.
 */
const showThanks = (section) => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("funded") !== "1") return;

    section.setAttribute("data-funded", "");

    /*
     * NO VISIBLE NOTICE ANY MORE. This used to insert a "Thank you. Your days
     * are being added now." line above the tiles, on the reasoning in the block
     * comment above: the webhook may not have landed yet, so without a word the
     * returning buyer sees a section that looks exactly as it did before they
     * paid. The user removed it on 2026-08-28 after seeing it on the live site.
     *
     * WHAT IS LOST, SO IT IS NOT LOST BY ACCIDENT: for the few seconds between
     * Stripe returning the reader and the webhook landing, a successful payment
     * looks like nothing happened. `data-funded` is still set on the section,
     * so the whole notice is one CSS rule away from coming back — nothing else
     * about this function changed.
     */

    try {
        params.delete("funded");
        const query = params.toString();
        window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    } catch {
        // A browser that refuses replaceState keeps the param. Harmless.
    }
};

/*
 * ONE try/catch AROUND THE WHOLE THING, AND IT RETURNS A TEARDOWN.
 *
 * One uncaught error in one module kills every script on the page in this
 * theme, and this section is the least important thing in the footer. A
 * malformed state, a missing node, a browser without something — all of it
 * costs the fund section and nothing else. It does not log on the ordinary
 * failure path either; a console error on every page load is noise that trains
 * people to ignore the console.
 *
 * THE EXPANDED BLURB IS NOT PERSISTED. CHECKLIST-v4 1.2's second item — whether
 * it remembers, the way sound.js and view.js do — is still OPEN with the user
 * and is deliberately NOT decided here. It resets on every load until they say
 * otherwise; adding localStorage later is a three-line change and removing it
 * once readers have it is not.
 *
 * `network: false` turns off BOTH requests and is what Storybook passes. A
 * story that reached the real Worker would be a review surface whose contents
 * depend on who has funded the site this week, and it would fire a request per
 * story on every hot reload. The shipped call sites take the default.
 */
export const attachFund = (root, { network = true } = {}) => {
    const teardowns = [];
    // `options` is passed through to both calls so a capture-phase listener can
    // still be registered here and still land in `teardowns` — the outside-click
    // handler in attachCalendar needs capture, and a listener added around this
    // helper would outlive the section.
    const on = (node, type, handler, options) => {
        node.addEventListener(type, handler, options);
        teardowns.push(() => node.removeEventListener(type, handler, options));
    };

    try {
        root.querySelectorAll("[data-fund]").forEach((section) => {
            const more = section.querySelector("[data-fund-more]");
            if (more) {
                // One-way. Revision 3 item 2: the blurb opens and stays open,
                // so the control removes itself rather than becoming a "View
                // less" that the user did not ask for. Removed, not hidden — a
                // hidden button is still in the tab order.
                on(more, "click", () => {
                    section.setAttribute("data-expanded", "");
                    more.remove();
                });
            }

            /*
             * THE MAP AND THE STEPPER ARE JOINED HERE. Revision 12, item 5.2.
             *
             * ONE FLAG FOR BOTH DIRECTIONS, AND IT IS THE WHOLE LOOP GUARD.
             * The two sides update each other: a press writes the span into
             * the field, and the field writes the span back onto the calendar.
             * Left alone that is infinite — the same shape attachCalendar's
             * column-count bail already breaks for the resize observer, and the
             * same fix: whoever moved first owns the turn, and a call arriving
             * while a turn is in flight is dropped rather than queued.
             *
             * ONE flag rather than one per direction, because there is only
             * ever one thing driving: the guard's question is "is a sync
             * already running", not "which way is it going". A pair of flags
             * would have four states to reason about and three of them unused.
             *
             * try/finally, not a trailing reset. If either side throws — and
             * this file's rule 2 is that nothing here may take the page down —
             * a flag left stuck at true would silently unwire the two halves
             * for the rest of the session, which is worse than the throw.
             */
            let syncing = false;
            const sync = (fn) => {
                if (syncing) return;
                syncing = true;
                try {
                    fn();
                } finally {
                    syncing = false;
                }
            };

            let setDays = null;
            const repaintCalendar = attachCalendar(section, teardowns, on, (span) =>
                sync(() => setDays?.(span))
            );

            // Everything inside .qntns-fund__tiles is re-bound after a live
            // load replaces those nodes, so the binding is a named function
            // rather than inline.
            const wire = (host) => {
                setDays = wireStepper(host, on, teardowns, (count) =>
                    sync(() => repaintCalendar?.setSpan?.(count))
                );
                wireBuy(host, on);
            };
            wire(section);

            showThanks(section);

            if (network) loadQueue(section, repaintCalendar, wire);
        });
    } catch {
        // Deliberately silent. See the note above.
    }

    return () => teardowns.forEach((off) => off());
};
