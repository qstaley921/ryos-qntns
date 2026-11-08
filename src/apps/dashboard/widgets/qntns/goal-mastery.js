import { icon } from "../icon-set.js";
import { escapeHtml } from "./escape.js";
import { addDays, todayKey } from "./fund.js";
import { renderPagination } from "./pagination.js";
import { renderMeditation, mastery } from "./goal-meditation.js";
import { attachPopCues, attachScrollCues, popCues, renderLog } from "./goal-log.js";
import { playClick } from "./sound.js";

// CHECKLIST-21: shared Storybook and live embed renderer. Trait states are explicit, never
// inferred from a mastery calculation. Daily counts default to a target of
// two; each trait can supply its own dailyTarget and tracking instructions.
const toggle = (on) => {
    const glyph = icon("columns-2", { size: 20 });
    return `<button type="button" class="qntns-steward__chart qntns-mastery__toggle" aria-pressed="${on}" aria-label="${on ? "Show meditation heatmap" : "Show mastery traits"}"><span class="qntns-steward__chart-layer qntns-steward__chart-layer--outline">${glyph}</span><span class="qntns-steward__chart-layer qntns-steward__chart-layer--fill">${glyph}</span></button>`;
};
/*
 * CHECKLIST-27 §8a. Each trait counts over its own period: trait.cadence "day"
 * (missing = day), "week" (Monday start) or "month" (calendar month), and
 * dailyTarget is the target per that period. Days stay logged by date and are
 * summed into the period here, a yes/no true as 1. Older MCP records carry
 * "weekly" in cadence or at the head of their tracking note; explicit cadence wins.
 */
const period = trait => ["week", "weekly"].includes(trait.cadence) || (!trait.cadence && /^weekly\b/i.test(trait.tracking || "")) ? "week" : trait.cadence === "month" ? "month" : "day";
const weekly = trait => period(trait) === "week";
export const weekStart = date => addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
const START = { day: date => date, week: weekStart, month: date => `${date.slice(0, 7)}-01` };
export const periodCounts = (trait, start = START[period(trait)]) => {
    const counts = {};
    for (const [date, count] of Object.entries(trait.days || {})) {
        const key = start(date);
        counts[key] = (counts[key] || 0) + Math.max(0, Number(count) || 0);
    }
    return counts;
};
export const weekCounts = trait => periodCounts(trait, weekStart);
// The last `n` period starts, oldest first, ending with the one holding `today`.
const periods = (trait, today, n) => {
    const start = START[period(trait)];
    const keys = [];
    for (let key = start(today); keys.length < n; key = start(addDays(key, -1))) keys.unshift(key);
    return keys;
};
const target = trait => yesNo(trait) ? 1 : trait.dailyTarget || 2;
/*
 * A week or month trait's rate, as mastery() scores a day trait: met / target,
 * capped at 1 per period, over whole periods ending with the last finished one
 * (or the current one once it is met), never before the first logged period.
 * "month" is the last 4 weeks or 3 months, "week" the last 1; the trend
 * compares them as mastery() does.
 */
export const periodScore = (trait, today) => {
    const counts = periodCounts(trait);
    const first = Object.keys(counts).sort()[0];
    const [long, short] = period(trait) === "week" ? [4, 1] : [3, 1];
    const all = periods(trait, today, long + 1);
    if ((counts[all.at(-1)] || 0) < target(trait)) all.pop();
    else all.shift();
    const keys = all.filter(key => first && key >= first);
    const rate = n => {
        const window = keys.slice(-n);
        return window.length ? window.reduce((sum, key) => sum + Math.min(1, (counts[key] || 0) / target(trait)), 0) / window.length : null;
    };
    const month = rate(long);
    const week = rate(short);
    const gap = month === null ? 0 : (week - month) * 100;
    return { month, week, percent: month === null ? null : Math.round(month * 100), trend: gap >= 5 ? "improving" : gap <= -5 ? "worsening" : "steady" };
};
/*
 * CHECKLIST-27 §8. A yes/no trait (kind "boolean") stores true or false per
 * day; a missing day is unreported. Done reads as a full square. §8b: not
 * done, a reported zero and an unreported day are all the same bare cell; only
 * the log tells them apart. It is never a count: done is 2 of 2 for the rate.
 */
const yesNo = trait => trait.kind === "boolean";
const said = (trait, value) => value === undefined ? "unrecorded" : yesNo(trait) ? (value ? "done" : "not done") : `${value} of ${trait.dailyTarget || 2}`;
// 53 periods, newest first: days, Monday weeks or calendar months, each summed against the period's target. CSS shows as many as fit (§8).
const strip = (trait, today) => {
    const daily = period(trait) === "day";
    const values = daily ? trait.days || {} : periodCounts(trait);
    // Greyed only before the first logged period, as the heatmap; after that every unmet period is bare (§8b).
    const first = Object.keys(values).sort()[0];
    return `<div class="qntns-mastery__strip" aria-label="Recent trait history">${periods(trait, today, 53).reverse().map(date => {
        const value = values[date];
        const fill = !first || date < first ? " is-out" : value === true || value >= target(trait) ? " is-full" : value > 0 ? " is-half" : "";
        return `<span class="qntns-fund__day${fill}" role="img" aria-label="${daily ? date : `${period(trait) === "week" ? "Week" : "Month"} of ${date}`}: ${said(trait, value)}"></span>`;
    }).join("")}</div>`;
};
// A week or month trait's day heatmap fills any day it was done: its target is per period, not per day.
const normalized = (trait) => Object.fromEntries(Object.entries(trait.days || {}).map(([date, count]) => [date, yesNo(trait) ? (count === true ? 2 : 0) : Math.min(2, Math.max(0, Number(count) || 0) / (period(trait) === "day" ? trait.dailyTarget || 2 : 1) * 2)]));
// Rewrite a trait calendar's cell labels in the trait's own terms.
const relabel = (root, trait) => root.querySelectorAll('[aria-label]').forEach((cell) => {
    const date = cell.getAttribute('aria-label').split(':')[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || cell.classList.contains('is-out')) return;
    cell.setAttribute('aria-label', `${date}: ${said(trait, trait.days?.[date])}`);
});
const traitScore = (trait, today) => period(trait) === "day" ? mastery(normalized(trait), today) : periodScore(trait, today);
const weeklyCalendar = (root, trait, today) => {
    const dates = [...root.querySelectorAll('.qntns-fund__day[aria-label]')]
        .map(cell => cell.getAttribute('aria-label').slice(0, 10)).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
    if (!dates.length) return;
    const counts = weekCounts(trait);
    const weeks = [];
    for (let date = weekStart(dates[0]); date <= dates.at(-1); date = addDays(date, 7)) weeks.push(date);
    const groups = [];
    for (const date of weeks) {
        const month = date.slice(0, 7);
        if (groups.at(-1)?.month === month) groups.at(-1).count++;
        else groups.push({ month, date, count: 1 });
    }
    root.querySelector('.qntns-fund__months').innerHTML = groups.map(group => `<span class="qntns-fund__month" style="--weeks: ${group.count}">${new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long' }).format(new Date(`${group.date}T00:00:00Z`))}</span>`).join('');
    const grid = root.querySelector('.qntns-fund__grid');
    grid.classList.add('qntns-mastery__weekly');
    // CHECKLIST-28 §3: no logged week at all greys every week, as the strip does; `date < undefined` was false and left them bare.
    const first = Object.keys(counts).sort()[0];
    grid.innerHTML = `<div class="qntns-fund__row"><span class="qntns-fund__weekday" aria-hidden="true"></span>${weeks.map(date => {
        const value = counts[date];
        const fill = date > today || !first || date < first ? ' is-out' : value >= target(trait) ? ' is-full' : value > 0 ? ' is-half' : '';
        return `<span class="qntns-fund__day${fill}" role="img" aria-label="Week ${date} through ${addDays(date, 6)}: ${value === undefined ? 'unrecorded' : value}"></span>`;
    }).join('')}</div>`;
};
const figure = (score) => `<span class="qntns-med__figure qntns-mastery__card-figure"><span class="qntns-med__trend is-${score.trend}" role="img" aria-label="${score.trend}">${icon({ improving: "arrow-up", worsening: "arrow-down", steady: "minus" }[score.trend], { size: 16 })}</span><span>${score.percent === null ? "-" : `${score.percent}%`}</span></span>`;
/*
 * THE HABIT LOG (CHECKLIST-24 #5). Every trait card carries a list button at
 * the end of its head; it opens the footnote pop-up (footnotes.css
 * .qntns-fn-pop*, as goal-projects.js uses it) on that habit's log
 * (goal-log.js). Rows come from the Worker's doc.log, { at, habit, date, add,
 * note? }, newest first. A day counted before the log existed has no entry,
 * so it gets a day-only row with the day's count, and no time.
 */
const amount = (trait, n) => {
    if (key(trait.name) === "meditation") return `${n} sit${Math.abs(n) === 1 ? "" : "s"}${n < 0 ? " taken back" : ""}`;
    if (n < 0) return `${n} taken back`;
    if (typeof n === "boolean") return n ? "Done" : "Not done";
    return (trait.dailyTarget || 2) === 1 && n === 1 ? "Done" : `${n} of ${trait.dailyTarget || 2}`;
};
const key = (name) => String(name).trim().toLowerCase();
export const habitRows = (trait, log = []) => {
    const mine = log.filter((e) => key(e.habit) === key(trait.name) && typeof e.at === "string");
    const logged = new Set(mine.map((e) => e.date));
    return [
        ...mine.map((e) => ({ at: e.at, what: amount(trait, e.done ?? e.add), note: e.note })),
        ...Object.entries(trait.days || {})
            .filter(([date, count]) => (count > 0 || typeof count === "boolean") && !logged.has(date))
            .map(([date, count]) => ({ day: date, what: amount(trait, count) }))
    ];
};
const logButton = (trait, i) => `<button type="button" class="qntns-mastery__log" data-trait-log="${i}" aria-label="Log for ${escapeHtml(trait.name)}">${icon("list", { size: 20 })}</button>`;
const logPop = () => `
    <div class="qntns-fn-pop" data-trait-pop hidden>
        <div class="qntns-fn-pop__scrim" data-trait-close></div>
        <div class="qntns-fn-pop__panel" role="dialog" aria-modal="true" aria-label="Habit log">
            <button type="button" class="qntns-fn-pop__close" data-trait-close aria-label="Close">${icon("x", { size: 16 })}</button>
            <div class="qntns-fn-pop__body" data-trait-body tabindex="0"></div>${popCues()}
        </div>
    </div>`;

const card = (trait, i, today) => {
    const title = `<div class="qntns-proj__row-head"><span class="qntns-card__title">${escapeHtml(trait.name)}</span><span class="qntns-mastery__head-end">${trait.state === "developing" ? figure(traitScore(trait, today)) : ""}${logButton(trait, i)}</span></div>`;
    const copy = `<div class="qntns-mastery__description">${escapeHtml(trait.state === "mastered" ? trait.reason || "" : trait.tracking || "")}</div>`;
    if (trait.state !== "developing") return `<div class="qntns-proj__row">${title}${copy}</div>`;
    return `<details class="qntns-proj__row qntns-mastery__trait"><summary>${title}${strip(trait, today)}</summary>${copy}<div class="qntns-mastery__calendar" data-trait="${i}"></div></details>`;
};
const columns = (traits, today) => {
    const group = (state) => traits.map((t, i) => t.state === state ? card(t, i, today) : "").join("") || '<div class="qntns-mastery__empty">No traits yet</div>';
    // CHECKLIST-24: each column scrolls past 500px, with the log's fade and
    // down-square (goal-log.js attachScrollCues) at its foot.
    // The label is its own block above the scroller and never scrolls.
    const col = (label, inner) => `<div class="qntns-mastery__col"><div class="qntns-mastery__label">${label}</div><div class="qntns-mastery__col-scroll" data-col-scroll tabindex="0"><div>${inner}</div></div><div class="qntns-mastery__col-fade" data-col-fade aria-hidden="true" hidden></div><button type="button" class="qntns-log__more" data-col-more aria-label="Scroll down" hidden>${icon("chevron-down", { size: 18 })}</button></div>`;
    return `<div class="qntns-mastery__columns">${col("Mastered traits", group("mastered"))}${col("Developing traits", `<div class="qntns-mastery__group"><div class="qntns-mastery__sublabel">In development</div>${group("developing")}</div><div class="qntns-mastery__group"><div class="qntns-mastery__sublabel">In queue</div>${group("queued")}</div>`)}</div>`;
};

export const attachMasteryPreview = (host, sessions, traits = [], { today = todayKey(), view = "meditation", log = [], timeZone } = {}) => {
    // The Worker keeps meditation history only in sessions, not trait.days.
    traits = traits.map(trait => trait.name.trim().toLowerCase() === "meditation"
        ? { ...trait, days: sessions } : trait);
    let on = view === "traits";
    let selected = 0;
    let turning = false;
    const goals = traits.filter(t => t.state === "developing").map(t => ({ ...t, sessions: normalized(t) }));
    if (!goals.length) goals.push({ name: "Meditation", sessions, days: sessions });
    const change = (index, direction) => {
        if (turning || index === selected) return;
        const before = [...host.querySelectorAll('.qntns-fund__grid > .qntns-fund__row > .qntns-fund__day')].map(cell => cell.cloneNode(true));
        selected = index;
        paint();
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const rows = [...host.querySelectorAll('.qntns-fund__grid > .qntns-fund__row')];
        const count = rows[0]?.querySelectorAll('.qntns-fund__day').length || 0;
        const animations = [];
        let i = 0;
        rows.forEach(row => row.querySelectorAll('.qntns-fund__day').forEach((cell, col) => {
            const old = before[i++];
            if (!old || cell.classList.contains('is-blank')) return;
            const back = cell.cloneNode(true);
            const flipper = document.createElement('span');
            flipper.className = 'qntns-mastery__flipper';
            old.classList.add('qntns-mastery__face');
            back.classList.add('qntns-mastery__face', 'qntns-mastery__face--back');
            flipper.append(old, back);
            cell.className = 'qntns-fund__day qntns-mastery__turn';
            cell.replaceChildren(flipper);
            const delay = (direction > 0 ? col : count - 1 - col) * 32;
            animations.push(flipper.animate([{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(180deg)' }], { duration: 400, delay, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' }).finished);
        }));
        turning = true;
        Promise.allSettled(animations).then(() => { turning = false; paint(); });
    };
    const columnObservers = [];
    const paint = () => {
        columnObservers.splice(0).forEach((o) => o.disconnect());
        const existingToggle = host.querySelector(".qntns-mastery__toggle");
        host.innerHTML = renderMeditation(goals[selected].sessions, { today, width: host.clientWidth });
        const root = host.querySelector(".qntns-med");
        root.classList.add("qntns-mastery");
        if (!on && yesNo(goals[selected])) relabel(root, goals[selected]);
        if (!on && period(goals[selected]) !== "day") {
            if (weekly(goals[selected])) weeklyCalendar(root, goals[selected], today);
            root.querySelector('.qntns-med__figure').outerHTML = figure(traitScore(goals[selected], today));
        }
        if (on) {
            const scores = goals.filter(t => t.state === "developing").map(t => traitScore(t, today));
            const values = scores.filter(s => s.month !== null);
            const average = field => values.length ? values.reduce((sum, s) => sum + s[field], 0) / values.length : null;
            const month = average("month");
            const week = average("week");
            const gap = month === null ? 0 : (week - month) * 100;
            const score = { percent: month === null ? null : Math.round(month * 100), trend: gap >= 5 ? "improving" : gap <= -5 ? "worsening" : "steady" };
            root.querySelector(".qntns-med__figure").outerHTML = figure(score);
        }
        root.querySelector(".qntns-med__figure").insertAdjacentHTML("beforeend", toggle(on));
        if (on) {
            const head = root.querySelector(".qntns-med__head");
            root.replaceChildren(head);
            root.insertAdjacentHTML("beforeend", columns(traits, today));
            // Re-sync when a card opens or closes and the column's content resizes.
            root.querySelectorAll(".qntns-mastery__col").forEach((column) => {
                const scroller = column.querySelector("[data-col-scroll]");
                const sync = attachScrollCues(scroller, column.querySelector("[data-col-fade]"), column.querySelector("[data-col-more]"));
                const sizes = new ResizeObserver(sync);
                sizes.observe(scroller);
                sizes.observe(scroller.firstElementChild);
                columnObservers.push(sizes);
            });
        }
        if (!on) {
            root.insertAdjacentHTML('beforeend', `<div class="qntns-mastery__foot"><div class="qntns-mastery__name" aria-live="polite">${escapeHtml(goals[selected].name)}</div>${renderPagination({ page: selected + 1, pages: goals.length })}</div>`);
            const nav = root.querySelector('[data-pagination]');
            nav.setAttribute('aria-label', 'Trait heatmaps');
            nav.querySelectorAll('[data-step]').forEach(button => {
                const direction = Number(button.dataset.step);
                button.setAttribute('aria-label', direction < 0 ? 'Previous trait' : 'Next trait');
                button.addEventListener('click', () => change((selected + direction + goals.length) % goals.length, direction));
            });
            nav.querySelectorAll('[data-dot]').forEach(button => {
                const index = Number(button.dataset.dot) - 1;
                button.setAttribute('aria-label', goals[index].name);
                button.addEventListener('click', () => change(index, index > selected ? 1 : -1));
            });
        }
        let button = root.querySelector(".qntns-mastery__toggle");
        if (existingToggle) {
            button.replaceWith(existingToggle);
            button = existingToggle;
            // Preserve the two-layer control across renders, then establish
            // its previous fill before changing pressed state.
            button.getBoundingClientRect();
            button.setAttribute("aria-pressed", String(on));
            button.setAttribute("aria-label", on ? "Show meditation heatmap" : "Show mastery traits");
        }
        button.onclick = () => { on = !on; paint(); };
        root.querySelectorAll("details").forEach((details) => {
            details.addEventListener("click", (event) => {
                // The native summary owns mouse/keyboard toggling. Everywhere
                // else on the card toggles too, unless selecting text or using
                // an interactive child added to the card in future.
                if (event.target.closest("summary, a, button, input, select, textarea")) return;
                if (window.getSelection()?.toString()) return;
                details.open = !details.open;
            });
            details.addEventListener("toggle", () => {
                if (!details.open) return;
                const calendar = details.querySelector("[data-trait]");
                const trait = traits[Number(calendar.dataset.trait)];
                const days = Object.fromEntries(Object.entries(normalized(trait)).map(([date, count]) => [date, count >= 2 ? 2 : count > 0 ? 1 : 0]));
                calendar.innerHTML = renderMeditation(days, { today, width: calendar.clientWidth });
                calendar.querySelector(".qntns-med__head").remove();
                if (weekly(trait)) {
                    weeklyCalendar(calendar, trait, today);
                    return;
                }
                relabel(calendar, trait);
            });
        });
    };
    // One listener on the host: paint() replaces everything inside it, the
    // pop-up included, so nothing here holds a node across a repaint.
    let opener = null;
    const closeLog = (quiet = false) => {
        const pop = host.querySelector("[data-trait-pop]");
        if (!pop || pop.hidden) return;
        if (!quiet) playClick();
        pop.hidden = true;
        opener?.focus();
        opener = null;
    };
    const onLog = (event) => {
        const button = event.target.closest?.("[data-trait-log]");
        if (button) {
            // Inside a <summary>: the press is the log's, not the card's.
            event.preventDefault();
            event.stopPropagation();
            const trait = traits[Number(button.dataset.traitLog)];
            let pop = host.querySelector("[data-trait-pop]");
            if (!pop) {
                host.insertAdjacentHTML("beforeend", logPop());
                pop = host.querySelector("[data-trait-pop]");
                pop.syncCues = attachPopCues(pop.querySelector(".qntns-fn-pop__panel"));
            }
            const body = pop.querySelector("[data-trait-body]");
            body.innerHTML = `<div class="qntns-med__title qntns-mastery__pop-title">${escapeHtml(trait.name)}</div>${renderLog(habitRows(trait, log), { timeZone })}`;
            opener = button;
            pop.hidden = false;
            body.scrollTop = 0;
            pop.syncCues();
            body.focus();
        } else if (event.target.closest?.("[data-trait-close]")) closeLog(Boolean(event.target.closest("button")));
    };
    const onKey = (event) => event.key === "Escape" && closeLog();
    host.addEventListener("click", onLog, true);
    host.addEventListener("keydown", onKey);
    paint();
    let drawnWidth = host.clientWidth;
    const observer = new ResizeObserver(([entry]) => {
        const width = Math.floor(entry.contentRect.width);
        if (width === drawnWidth) return;
        drawnWidth = width;
        paint();
    });
    observer.observe(host);
    return () => {
        observer.disconnect();
        columnObservers.forEach((o) => o.disconnect());
        host.removeEventListener("click", onLog, true);
        host.removeEventListener("keydown", onKey);
    };
};
