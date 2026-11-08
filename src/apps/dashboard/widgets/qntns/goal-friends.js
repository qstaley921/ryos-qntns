import { addDays, diffDays, todayKey } from "./fund.js";
import { rampColor } from "./ramp.js";

/*
 * QNTNs friends heatmap — CHECKLIST-16 item 12. GitHub's activity grid, with
 * hard edges and the site's font and navy ramp.
 *
 * `counts` maps a day key ("2026-09-18") to the number of events with people
 * that day. Missing is 0. Counts only: no names ever reach this module.
 *
 * THE GRID IS CONTINUOUS WEEKS, not the fund's month-ragged columns. 7 rows,
 * Sunday on top; one column per week; the right-most column is today's week,
 * and the days after today in it are not drawn.
 *
 * SIZE, all base 4: 12px cell, 4px gap, 16px pitch. The row labels sit in a
 * 32px gutter (28px of text box, then the 4px gap before the first column):
 *
 *   grid width  = 32 + 16 x weeks - 4
 *   grid height = 7 x 16 - 4 = 108
 *   weeks       = floor((W - 32 + 4) / 16)
 *
 * THE LEFTOVER IS PADDING, by item 68's rule (only that rule is reused here):
 * left = half of it floored to 4, right = the rest floored to 4. They differ by
 * under 8, the extra going right. A width that is not a multiple of 4 leaves
 * 1-3px of slack past the right padding, the box's, not the grid's.
 * With no width (nothing measured yet) it draws 53 weeks and no padding.
 *
 * LEVELS: 0 if the count is 0, else ceil(4 x count / max) clamped to 1-4, max
 * being the largest count in view. Level 0 is --color-beige-dark; levels 1-4
 * are the ramp at t 0.75, 0.5, 0.25, 0 (4 is the full navy). The ramp's light
 * end, t 1, is 1.00:1 against the page, which is why level 1 starts at t 0.75.
 */
const PITCH = 16;
const GUTTER = 32;
const GAP = 4;
const FALLBACK_WEEKS = 53;
const LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];
const MONTH_SHORT = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short" });
const monthShort = (key) => MONTH_SHORT.format(new Date(`${key}T00:00:00Z`));
// 0 = Sunday, the top row.
const weekday = (key) => new Date(`${key}T00:00:00Z`).getUTCDay();

// Level 4 is t 0 (index 0 of 5), level 1 is t 0.75 (index 3 of 5).
const LEVEL_COLORS = [1, 2, 3, 4].map((level) => rampColor(4 - level, 5));

const count = (counts, key) => Math.max(0, Math.floor(Number(counts[key]) || 0));
const level = (n, max) => (n === 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((4 * n) / max))));

export const layout = (width) => {
    if (width == null) return { weeks: FALLBACK_WEEKS, left: 0, right: 0 };
    const weeks = Math.max(1, Math.floor((width - GUTTER + GAP) / PITCH));
    const spare = Math.max(0, width - (GUTTER + PITCH * weeks - GAP));
    const left = Math.floor(spare / 8) * 4;
    const right = Math.floor((spare - left) / 4) * 4;
    return { weeks, left, right };
};

/*
 * MONTH LABELS: one over the first column holding the 1st of its month. The
 * leading partial month is also named, over column 0, as on GitHub, unless the
 * first 1st falls within 3 columns (48px) of it, in which case the partial
 * label is the one dropped: it is the less informative of the two.
 */
const monthLabels = (starts, today) => {
    const labels = [];
    starts.forEach((start, column) => {
        for (let d = 0; d < 7; d += 1) {
            const key = addDays(start, d);
            if (key > today) break;
            if (key.endsWith("-01")) labels.push({ column, key });
        }
    });
    if (!labels.length || labels[0].column > 3) labels.unshift({ column: 0, key: starts[0] });
    return labels
        .map(({ column, key }) => `<span class="qntns-friends__month" style="left: ${GUTTER + PITCH * column}px">${monthShort(key)}</span>`)
        .join("");
};

const cell = (lvl, label) => `<span class="qntns-friends__day is-${lvl}"${label ? ` role="img" aria-label="${label}"` : ` aria-hidden="true"`}></span>`;

export const renderFriends = (counts = {}, { today = todayKey(), width = null } = {}) => {
    const { weeks, left, right } = layout(width);
    const last = addDays(today, -weekday(today));
    const starts = Array.from({ length: weeks }, (_, i) => addDays(last, (i - weeks + 1) * 7));
    const first = starts[0];
    const days = diffDays(first, today) + 1;

    const keys = Array.from({ length: days }, (_, i) => addDays(first, i));
    const values = keys.map((key) => count(counts, key));
    const max = Math.max(0, ...values);
    const total = values.reduce((a, b) => a + b, 0);

    const cells = keys.map((key, i) => {
        const n = values[i];
        return cell(level(n, max), `${key}: ${n} event${n === 1 ? "" : "s"}`);
    }).join("");
    const rows = LABELS.map((label) => `<span class="qntns-friends__weekday">${label}</span>`).join("");
    const legend = [0, 1, 2, 3, 4].map((lvl) => cell(lvl, null)).join("");
    const palette = LEVEL_COLORS.map((color, i) => `--friends-${i + 1}: ${color}`).join("; ");

    return `
    <div class="qntns-friends" style="padding: 0 ${right}px 0 ${left}px; ${palette}">
      <div class="qntns-med__head">
        <div class="qntns-med__title">Friend activity</div>
      </div>
      <div class="qntns-friends__months" aria-hidden="true">${monthLabels(starts, today)}</div>
      <div class="qntns-friends__body">
        <div class="qntns-friends__weekdays" aria-hidden="true">${rows}</div>
        <div class="qntns-friends__grid" role="group" aria-label="${total} event${total === 1 ? "" : "s"} over ${weeks} week${weeks === 1 ? "" : "s"}">${cells}</div>
      </div>
      <div class="qntns-friends__legend" aria-hidden="true">
        <span class="qntns-friends__legend-label">Less</span>${legend}<span class="qntns-friends__legend-label">More</span>
      </div>
    </div>`;
};

/*
 * Render into `host` at its measured width, and again whenever that width
 * changes — attachMeditation's shape. The padding is on the .qntns-friends
 * inside the host, so re-rendering never changes the width observed.
 */
export const attachFriends = (host, counts, options = {}) => {
    let drawn = null;
    const paint = (width) => {
        const w = Math.floor(width);
        if (w === drawn) return;
        drawn = w;
        host.innerHTML = renderFriends(counts, { ...options, width: w });
    };
    paint(host.clientWidth);
    const observer = new ResizeObserver(([entry]) => paint(entry.contentRect.width));
    observer.observe(host);
    return () => observer.disconnect();
};
