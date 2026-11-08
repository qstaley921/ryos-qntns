import { icon } from "../icon-set.js";
import { addDays, columnsThrough, todayKey } from "./fund.js";

/*
 * QNTNs meditation — the fund calendar's grid, one square per day, coloured by
 * how many times I sat that day. CHECKLIST-16 items 6 and 7.
 *
 * THE GRID IS THE FUND GRID. Columns come from fund.js's columnsThrough (the
 * month-ragged week runs, see "The calendar" there) and the markup reuses the
 * fund's own classes, so the square, the gutter and the M T W R F S Y rows are
 * the fund's and cannot drift from it. Only the fill is new:
 *
 *   0 sessions  open square, the fund's 1px hairline
 *   1 session   top-left triangle navy (diagonal split)   .is-half
 *   2 sessions  whole square navy                         .is-full
 *
 * `sessions` maps a day key ("2026-09-18") to a count. Missing is 0, and
 * anything over 2 is drawn as 2 — two is the day's goal, not a cap on sitting.
 */
const LABELS = ["M", "T", "W", "R", "F", "S", "Y"];
const MONTH_LONG = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long" });
const monthLong = (key) => MONTH_LONG.format(new Date(`${key}T00:00:00Z`));

/*
 * MASTERY RATE, CHECKLIST-16 items 29 and 30. Rate = sits / (2 x days) over a
 * window of days ending yesterday, or ending today once today is already 2/2 (a
 * day still in progress would drag the rate down). A window never starts before
 * the first entry: a new habit is not scored on days before it began.
 * The trend compares the 7-day rate with the 30-day rate, unrounded: a gap of
 * 5 points or more either way is an arrow, anything smaller is a dash.
 */
const sits = (sessions, key) => Math.min(2, Math.max(0, Number(sessions[key]) || 0));

export const mastery = (sessions = {}, today = todayKey()) => {
    const keys = Object.keys(sessions).sort();
    const end = sits(sessions, today) === 2 ? today : addDays(today, -1);
    const rate = (days) => {
        let key = addDays(end, 1 - days);
        if (keys[0] > key) key = keys[0];
        let got = 0;
        let out = 0;
        for (; key <= end; key = addDays(key, 1)) {
            got += sits(sessions, key);
            out += 2;
        }
        return out ? got / out : null;
    };
    const month = rate(30);
    const week = rate(7);
    const gap = month === null ? 0 : (week - month) * 100;
    const trend = gap >= 5 ? "improving" : (gap <= -5 ? "worsening" : "steady");
    return { month, week, percent: month === null ? null : Math.round(month * 100), trend };
};

// Lucide, from the vendored set, stroked in currentColor so the trend class
// sets the colour. icon() hides its svg, so the name sits on the wrapper.
const TREND = { improving: "arrow-up", worsening: "arrow-down", steady: "minus" };

/*
 * THE RANGE FILLS THE WIDTH WITH WHOLE MONTHS (item 68). The grid ends on
 * the last day of the current month, then takes whole earlier months, right to
 * left, for as long as they fit `width`. A month is never cut. A row is the
 * 16px weekday label, its 4px gap, then 20px per column less the last gap:
 *
 *   grid width = 20 x columns + 16
 *
 * The width left over is side padding: left = half of it floored to 4, right
 * = the rest floored to 4. They differ by under 8, the extra going right. A
 * width that is not itself a multiple of 4 leaves 1-3px of slack past the
 * right padding: the padding stays on the grid and the slack is the box's.
 *
 * AT A NARROW WIDTH THE 30-DAY WINDOW MAY NOT ALL BE DRAWN. When only the
 * current month fits, days of the scoring window that fall in last month are
 * off the left edge. The Mastery rate still counts them; the grid is a view
 * of the data, the rate is computed from all of it.
 *
 * With no width (nothing has measured yet) it draws the current month and the
 * one before it, which holds the whole 30-day window, and no padding.
 *
 * GREYED (.is-out, items 44 and 45): a day before the first entry, or after
 * today. Neither is a missed sit, so neither may look like a 0-session square.
 *
 * THE LABEL IS NOT A HEADING (item 41). Inside a post body a real <h2> would be
 * collected by toc.js and demoted to <h3> by content.js; a <div> is neither,
 * and goal-meditation.css gives it the in-article h2's face and size.
 */
const PITCH = 20;
const GUTTER = 16;
const monthStart = (key) => `${key.slice(0, 7)}-01`;
const monthEnd = (key) => addDays(monthStart(addDays(monthStart(key), 31)), -1);

export const layout = (today, width) => {
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
    const spare = width == null ? 0 : Math.max(0, width - (PITCH * columns + GUTTER));
    const left = Math.floor(spare / 8) * 4;
    const right = Math.floor((spare - left) / 4) * 4;
    return { from, through, left, right };
};

// CHECKLIST-27 §8b. A reported zero draws as the same bare cell as an unreported day; the log keeps it.
export const renderMeditation = (sessions = {}, { today = todayKey(), width = null } = {}) => {
    const score = mastery(sessions, today);
    const first = Object.keys(sessions).sort()[0] || today;
    const { from, through, left, right } = layout(today, width);
    const head = `
      <div class="qntns-med__head">
        <div class="qntns-med__title">Mastery rate</div>
        <div class="qntns-med__figure">
          <span class="qntns-med__trend is-${score.trend}" role="img" aria-label="${score.trend}">${icon(TREND[score.trend], { size: 16 })}</span>
          <div class="qntns-med__rate">${score.percent === null ? "-" : `${score.percent}%`}</div>
        </div>
      </div>`;
    const built = columnsThrough(from, through);

    const groups = [];
    for (const column of built) {
        const last = groups[groups.length - 1];
        if (last && last.month === column.month) last.columns.push(column);
        else groups.push({ month: column.month, columns: [column] });
    }
    const months = groups
        .map((group) => `<span class="qntns-fund__month" style="--weeks: ${group.columns.length}">${monthLong(group.columns[0].keys[0])}</span>`)
        .join("");

    const rows = LABELS.map((label, row) => {
        const cells = built.map((column) => {
            const key = column.keys[row - column.startRow];
            if (!key) return `<span class="qntns-fund__day is-blank"></span>`;
            if (key < first || key > today) {
                return `<span class="qntns-fund__day is-out" role="img" aria-label="${key}: no entry"></span>`;
            }
            const count = sits(sessions, key);
            const fill = count >= 2 ? " is-full" : count > 0 ? " is-half" : "";
            return `<span class="qntns-fund__day${fill}" role="img" aria-label="${key}: ${count} session${count === 1 ? "" : "s"}"></span>`;
        });
        return `
        <div class="qntns-fund__row">
          <span class="qntns-fund__weekday">${label}</span>
          ${cells.join("")}
        </div>`;
    }).join("");

    // CHECKLIST-28 §10: the centring pad is the calendar's only, as margin so
    // the months row keeps its own label-gutter padding; the head runs full width.
    const pad = "margin: 0 var(--med-pad-r) 0 var(--med-pad-l)";
    return `
    <div class="qntns-med" style="--med-pad-l: ${left}px; --med-pad-r: ${right}px">${head}
      <div class="qntns-fund__months" style="${pad}">${months}</div>
      <div class="qntns-fund__grid" style="${pad}">${rows}
      </div>
    </div>`;
};

/*
 * Render into `host` at its measured width, and again whenever that width
 * changes. The padding is on the calendar inside the host, so re-rendering
 * never changes the width being observed. Returns the teardown.
 */
export const attachMeditation = (host, sessions, options = {}) => {
    let drawn = null;
    const paint = (width) => {
        const w = Math.floor(width);
        if (w === drawn) return;
        drawn = w;
        host.innerHTML = renderMeditation(sessions, { ...options, width: w });
    };
    paint(host.clientWidth);
    const observer = new ResizeObserver(([entry]) => paint(entry.contentRect.width));
    observer.observe(host);
    return () => observer.disconnect();
};
