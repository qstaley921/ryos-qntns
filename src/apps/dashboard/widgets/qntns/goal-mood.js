import { icon } from "../icon-set.js";
import { escapeHtml } from "./escape.js";
import { attachPopCues, popCues, renderLog } from "./goal-log.js";
import { rampColor } from "./ramp.js";
import { layout } from "./goal-meditation.js";
import { todayKey } from "./fund.js";
import { playClick } from "./sound.js";

/*
 * QNTNs mood — happiness against energy. CHECKLIST-24 items 2 and 3.
 *
 * An entry is { at, happiness, energy, emotion, note? }: `at` an ISO instant,
 * happiness and energy each -5..-1 or 1..5. There is no zero (item 1): the
 * axes run between cells, so every entry sits on one side of each.
 *
 *   row    happiness  5 at the top … 1, axis, -1 … -5 at the bottom
 *   column energy    -5 at the left … -1, axis, 1 … 5 at the right
 *
 * THE 30 STOPS (item 1). The newest 30 entries are drawn. Entry k, 0 the
 * newest, is t = k / 29 × 5/6 on the ramp: navy at 0, and at 29 the lightest
 * tone the stewardship cards allow (goal-stewardship.js T_MAX). That is
 * stewardship's toneFill(k, 30) = rampColor(5k, 6 × 29 + 1), written out here
 * so this module does not load the treemap. Fewer than 30 entries take the
 * darkest stops: the ramp is fixed, not stretched.
 *
 * TWO ON ONE CELL. The newest one's colour shows; the pop-up lists every
 * drawn entry on that cell, newest first.
 *
 * THE LABELS ARE NOT HEADINGS, for goal-meditation.js's reason (toc.js and
 * content.js would take an <h2>): the title wears .qntns-med__title.
 */
export const STOPS = 30;
const tone = (k) => rampColor(5 * k, 6 * (STOPS - 1) + 1);
const SIDES = [5, 4, 3, 2, 1, -1, -2, -3, -4, -5];
const row = (happiness) => SIDES.indexOf(happiness);
const column = (energy) => 9 - SIDES.indexOf(energy);
const valid = (e) => e && typeof e.at === "string" && !Number.isNaN(Date.parse(e.at))
    && SIDES.includes(e.happiness) && SIDES.includes(e.energy);

// Rows 0, 2, 7 and 9 carry a word; NEUTRAL sits on the axis.
const ROW_WORDS = { 0: "Bliss", 2: "Happy", 7: "Unhappy", 9: "Misery" };
const signed = (n) => (n > 0 ? `+${n}` : `−${-n}`);
const where = (e) => `Happiness ${signed(e.happiness)}, energy ${signed(e.energy)}`;

// An entry counts on its reflection date when it has one, else on `at`.
const when = (e) => (e.date ? Date.parse(`${e.date}T12:00:00Z`) : Date.parse(e.at));
const stampOf = (e) => ({ ...(e.date ? { day: e.date } : { at: e.at }), sort: when(e) });

const byNewest = (entries = []) => entries
    .filter(valid)
    .sort((a, b) => when(b) - when(a));
export const newest = (entries = []) => byNewest(entries).slice(0, STOPS);

// A log row: the emotion, where it sat, and the note.
const logRow = (e) => ({ ...stampOf(e), what: e.emotion ? `${e.emotion} · ${where(e)}` : where(e), note: e.note });

/*
 * THE LOG TOGGLE (STOP 2 feedback). The head's right end: the two-layer
 * fill-up button stewardship and mastery use (sound.css .qntns-steward__chart),
 * with Lucide `list`. Pressed, the graph's stage shows every entry as a log,
 * newest first, and the log scrolls inside the graph's own height.
 */
const toggle = () => {
    const glyph = icon("list", { size: 20 });
    return `<button type="button" class="qntns-steward__chart qntns-mood__toggle" aria-pressed="false" aria-label="Show the log" data-mood-toggle><span class="qntns-steward__chart-layer qntns-steward__chart-layer--outline">${glyph}</span><span class="qntns-steward__chart-layer qntns-steward__chart-layer--fill">${glyph}</span></button>`;
};

const renderPop = () => `
    <div class="qntns-fn-pop" data-mood-pop hidden>
        <div class="qntns-fn-pop__scrim" data-mood-close></div>
        <div class="qntns-fn-pop__panel" role="dialog" aria-modal="true" aria-label="Mood entries">
            <button type="button" class="qntns-fn-pop__close" data-mood-close aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
            <div class="qntns-fn-pop__body" data-mood-body tabindex="0"></div>${popCues()}
        </div>
    </div>`;

export const renderMood = (entries = [], options = {}) => {
    const all = byNewest(entries);
    const drawn = all.slice(0, STOPS);
    const cells = new Map();
    drawn.forEach((e) => {
        const key = row(e.happiness) * 10 + column(e.energy);
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(e);
    });

    let field = "";
    for (let i = 0; i < 100; i += 1) {
        const here = cells.get(i);
        if (!here) {
            field += `<span class="qntns-mood__cell"></span>`;
            continue;
        }
        const top = here[0];
        const more = here.length > 1 ? ` and ${here.length - 1} more` : "";
        const said = `${top.emotion ?? ""}, ${where(top)}${more}`;
        field += `<button type="button" class="qntns-mood__cell is-entry" data-mood-cell="${i}" aria-label="${escapeHtml(said)}"><span class="qntns-mood__mark" style="background: ${tone(drawn.indexOf(top))}"></span></button>`;
    }

    const labels = Object.entries(ROW_WORDS)
        .map(([r, word]) => `<span class="qntns-mood__word" style="grid-row: ${Number(r) + 1}">${word}</span>`)
        .join("");
    const key = Array.from({ length: STOPS }, (_, k) => `<span style="background: ${tone(STOPS - 1 - k)}"></span>`).join("");

    return `
    <div class="qntns-mood">
      <div class="qntns-mood__head">
        <div class="qntns-med__title">Happiness + Energy</div>${toggle()}
      </div>
      <div class="qntns-mood__stage">
      <div class="qntns-mood__figure">
        <div class="qntns-mood__labels" aria-hidden="true">${labels}<span class="qntns-mood__word is-axis">Neutral</span></div>
        <div class="qntns-mood__field">${field}</div>
        <div class="qntns-mood__energy" aria-hidden="true"><span>Less energy</span><span>More energy</span></div>
        <div class="qntns-mood__key" aria-hidden="true"><span>Older</span><span class="qntns-mood__ramp">${key}</span><span>Newer</span></div>
      </div>
      <div class="qntns-mood__log" data-mood-log hidden>
        <div class="qntns-mood__scroll" data-mood-scroll tabindex="0">${renderLog(all.map(logRow), options)}</div>
        <div class="qntns-track qntns-mood__track" aria-hidden="true"><div class="qntns-track__nub" data-mood-nub>${icon("grip-horizontal", { size: 16 })}</div></div>
        <button type="button" class="qntns-mood__more" data-mood-more aria-label="Scroll the log down">${icon("chevron-down", { size: 18 })}</button>
      </div>${renderPop()}
      </div>
    </div>`;
};

/*
 * The footnote pop-up's markup and classes (footnotes.css .qntns-fn-pop*), as
 * goal-projects.js uses them, but held inside the stage (goal-mood.css) so
 * it sits centred over the graph, not the window. A square opens it on that
 * cell's entries; the X,
 * the scrim and Escape close it and focus goes back to the square. One click
 * listener on the host: the pop-up lives inside it.
 *
 * THE LOG'S SCROLL (STOP 2 feedback). The native scrollbar is hidden and the
 * postcard's track stands in for it (postcard.css .qntns-track): a 16px track
 * on the right with a navy nub sized to the share of the log in view, floored
 * at 16 as the postcard's is, and draggable. Below the text a 32px fade and the
 * card's navy down-square (card.css .qntns-card__more); the square scrolls one
 * view down. Both go when the log is at its end.
 * Returns the teardown.
 */
export const attachMood = (host, entries, options = {}) => {
    host.innerHTML = renderMood(entries, options);
    const log = host.querySelector("[data-mood-log]");
    const figure = host.querySelector(".qntns-mood__figure");
    const scroller = host.querySelector("[data-mood-scroll]");
    const track = host.querySelector(".qntns-mood__track");
    const nub = host.querySelector("[data-mood-nub]");
    const NUB_MIN = 16;
    // Nub height is the share in view, its top the share scrolled; neither is
    // rounded to 4, or the nub would lie about where the reader is.
    const layoutTrack = () => {
        const range = scroller.scrollHeight - scroller.clientHeight;
        const trackH = track.clientHeight;
        const nubH = Math.max(NUB_MIN, (trackH * scroller.clientHeight) / scroller.scrollHeight);
        nub.style.height = `${nubH}px`;
        nub.style.top = `${range ? ((trackH - nubH) * scroller.scrollTop) / range : 0}px`;
        log.classList.toggle("is-end", scroller.scrollTop >= range - 1);
    };
    scroller.addEventListener("scroll", layoutTrack, { passive: true });
    const onNub = (event) => {
        const y = event.clientY;
        const from = scroller.scrollTop;
        const ratio = (scroller.scrollHeight - scroller.clientHeight) / Math.max(1, track.clientHeight - nub.offsetHeight);
        const move = (e) => { scroller.scrollTop = from + (e.clientY - y) * ratio; };
        nub.setPointerCapture(event.pointerId);
        nub.addEventListener("pointermove", move);
        nub.addEventListener("lostpointercapture", () => nub.removeEventListener("pointermove", move), { once: true });
    };
    nub.addEventListener("pointerdown", onNub);
    const drawn = newest(entries);
    const pop = host.querySelector("[data-mood-pop]");
    const body = host.querySelector("[data-mood-body]");
    const syncCues = attachPopCues(host.querySelector(".qntns-mood .qntns-fn-pop__panel"));
    let opener = null;
    const close = (quiet = false) => {
        if (pop.hidden) return;
        if (!quiet) playClick();
        pop.hidden = true;
        opener?.focus();
        opener = null;
    };
    const open = (button) => {
        const i = Number(button.dataset.moodCell);
        const here = drawn.filter((e) => row(e.happiness) * 10 + column(e.energy) === i);
        const rows = here.map((e) => ({ ...stampOf(e), what: e.emotion || where(e), note: e.note }));
        body.innerHTML = `<div class="qntns-med__title qntns-mood__pop-title">${escapeHtml(where(here[0]))}</div>${renderLog(rows, options)}`;
        opener = button;
        pop.hidden = false;
        body.scrollTop = 0;
        syncCues();
        body.focus();
    };
    const onClick = (event) => {
        const press = event.target.closest?.("[data-mood-toggle]");
        if (press) {
            const on = press.getAttribute("aria-pressed") !== "true";
            press.setAttribute("aria-pressed", String(on));
            press.setAttribute("aria-label", on ? "Show the graph" : "Show the log");
            log.hidden = !on;
            figure.inert = on;
            if (on) layoutTrack();
            return;
        }
        if (event.target.closest?.("[data-mood-more]")) {
            scroller.scrollBy({ top: scroller.clientHeight - 32, behavior: "smooth" });
            return;
        }
        const cell = event.target.closest?.("[data-mood-cell]");
        if (cell) open(cell);
        else if (event.target.closest?.("[data-mood-close]")) close(Boolean(event.target.closest("button")));
    };
    const onKey = (event) => {
        if (event.key === "Escape") close();
    };
    host.addEventListener("click", onClick);
    host.addEventListener("keydown", onKey);
    // CHECKLIST-25 #9: the head takes the meditation head's inset (layout()), so
    // the two titles share a left edge. The graph below is untouched.
    const head = host.querySelector(".qntns-mood__head");
    const inset = (width) => {
        const { left, right } = layout(options.today || todayKey(), Math.floor(width));
        head.style.padding = `0 ${right}px 0 ${left}px`;
    };
    inset(host.clientWidth);
    const observer = new ResizeObserver(([entry]) => inset(entry.contentRect.width));
    observer.observe(host);
    return () => {
        observer.disconnect();
        host.removeEventListener("click", onClick);
        host.removeEventListener("keydown", onKey);
        host.innerHTML = "";
    };
};
