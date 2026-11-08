// QNTNs pagination: prev button, a strip of square dots, next button.
// Page numbers are 1-based throughout — renderPagination({ page: 1 }) is the
// first page, and onChange is called with the new 1-based page.
//
// VERTICAL VARIANT. `vertical: true` is the card group's mobile mode: the
// control sits on the group's heading row and pages a stack that runs top to
// bottom, so the chevrons are rotated a quarter turn by CSS to read UP and
// DOWN, and THE DOTS ARE NOT RENDERED AT ALL. They are dropped from the markup
// rather than hidden with CSS so they are not in the tab order or the
// accessibility tree either; everything below therefore treats the dot strip
// as optional. The step labels read "Previous page" / "Next page" in the middle
// of a run and "Last page" / "First page" at the ends, where they wrap — on a
// vertical stack, previous IS up and next IS down, so label and arrow agree in
// both orientations. See assets/css/qntns/pagination.css.
import { icon } from "../icon-set.js";
import { playError } from "./sound.js";

const clamp = (page, pages) => Math.min(Math.max(page, 1), Math.max(pages, 1));

/*
 * THE STEPS WRAP.
 *
 * Next on the last page goes to the first, and previous on the first goes to
 * the last. The arrows are therefore only ever disabled when there is exactly
 * ONE page — the single case where there is genuinely nowhere else to go.
 *
 * Modulo on a 1-based sequence: shift to 0-based, add `pages` so a step off the
 * front is still positive before the %, take the remainder, shift back.
 *   pages 3:  0 -> 3,  4 -> 1
 * A dot click passes a page that is already in range and comes back unchanged,
 * so both entry points can share this.
 */
const wrap = (page, pages) => {
    const total = Math.max(pages, 1);
    return ((page - 1 + total) % total) + 1;
};

/*
 * The step's label says where it actually goes. On the last page the forward
 * arrow is "First page", not "Next page" — a screen reader reading "next" and
 * landing back at the start would be a lie, and the arrow is the only thing a
 * sighted reader has to go on either.
 */
const stepLabel = (direction, page, pages, wrapOn = true, noun = "page") => {
    // §89: a stop (wrap off) names the end it is parked at.
    if (!wrapOn && pages > 1 && (direction < 0 ? page <= 1 : page >= pages)) return `${direction < 0 ? "First" : "Last"} ${noun}`;
    if (!wrapOn) return `${direction < 0 ? "Previous" : "Next"} ${noun}`;
    if (pages <= 1) return direction < 0 ? "Previous page" : "Next page";
    if (direction < 0) return page <= 1 ? "Last page" : "Previous page";
    return page >= pages ? "First page" : "Next page";
};

const renderDot = (n, page, extra = "") => `
    <button class="qntns-pagination__dot" type="button" data-dot="${n}" aria-label="Page ${n}"${n === page ? ' aria-current="true"' : ""}${extra}></button>
`;

const renderDots = (page, pages) => Array.from({ length: pages }, (_, i) => renderDot(i + 1, page)).join("");

/*
 * THE DOT WINDOW (§86). Past DOT_WINDOW pages the strip stops growing.
 *
 * Every dot is still rendered, in a track inside a viewport exactly
 * DOT_WINDOW dots wide (7 x 8 + 6 x 8 = 104px, pagination.css). The track
 * slides by whole dots so the current dot stays inside the window, and the
 * dot on each edge shrinks to half when there are more pages beyond it — the
 * Instagram cue that the row continues. The window only moves when the
 * current dot would land ON an edge, so a step in the middle moves the fill,
 * not the row.
 *
 * `start` is the 0-based index of the window's first dot. It is carried
 * between steps (nav.dataset.windowStart) because the rule depends on where
 * the window already is; a fresh render starts from 0.
 */
export const DOT_WINDOW = 7;
// §94: a phone (the theme's 599px breakpoint) shows 4 slots, each small edge dot taking one;
// pages <= 4 are then plain full dots (3 pages = 3 dots). Read at render and on change.
export const MOBILE_QUERY = "(max-width: 599px)";
export const dotWindow = () => (window.matchMedia?.(MOBILE_QUERY).matches ? 4 : DOT_WINDOW);
const DOT_PITCH = 16; // 8px dot + 8px gap, pagination.css

export const windowStart = (start, page, pages, n = DOT_WINDOW) => {
    if (pages <= n) return 0;
    const i = page - 1;
    // Keep the current dot off both edges: inside [start + 1, start + n - 2].
    const next = Math.min(Math.max(start, i - (n - 2)), i - 1);
    // ...except at the very ends, where there is nothing past the edge.
    return Math.min(Math.max(next, 0), pages - n);
};

// Which dots are visible, and which of those are the shrunk edge dots.
export const dotState = (n, start, pages, w = DOT_WINDOW) => {
    const i = n - 1;
    if (i < start || i >= start + w) return "out";
    if ((i === start && start > 0) || (i === start + w - 1 && start + w < pages)) return "edge";
    return "in";
};

// The window state is in the markup, not added by attachPagination: a caller
// that renders and wires its own clicks (goal-mastery.js) gets it too.
const windowAttrs = (state) => ` data-window="${state}"${state === "out" ? ' aria-hidden="true" tabindex="-1"' : ""}`;

const renderWindowedDots = (page, pages, start, w) => `
    <div class="qntns-pagination__track" style="transform: translateX(${-start * DOT_PITCH}px)">
        ${Array.from({ length: pages }, (_, i) => renderDot(i + 1, page, windowAttrs(dotState(i + 1, start, pages, w)))).join("")}
    </div>`;

// Applies the window to dots already in the DOM, in place, so the track's
// transform and each dot's scale TRANSITION rather than being rebuilt.
const paintWindow = (dots, start, pages, w) => {
    const track = dots.querySelector(".qntns-pagination__track");
    if (!track) return;
    track.style.transform = `translateX(${-start * DOT_PITCH}px)`;
    dots.querySelectorAll("[data-dot]").forEach((dot) => {
        const state = dotState(Number(dot.dataset.dot), start, pages, w);
        dot.dataset.window = state;
        // Out-of-window dots leave the tab order and the accessibility tree;
        // the steps still reach every page.
        const out = state === "out";
        if (out) {
            dot.setAttribute("aria-hidden", "true");
            dot.setAttribute("tabindex", "-1");
        } else {
            dot.removeAttribute("aria-hidden");
            dot.removeAttribute("tabindex");
        }
    });
};

const renderStrip = (page, pages, w, start) => pages > w
    ? `<div class="qntns-pagination__dots qntns-pagination__dots--window" data-pagination-dots style="--dot-window: ${w}">${renderWindowedDots(page, pages, start, w)}</div>`
    : `<div class="qntns-pagination__dots" data-pagination-dots>${renderDots(page, pages)}</div>`;

// `wrap: false` (§89, the photos carousel) stops at the ends: the arrow at an end is
// aria-disabled and refuses. Default true: the home grid and goal-mastery keep wrapping.
export const renderPagination = ({ page = 1, pages = 1, vertical = false, wrap: wrapOn = true, noun = "page" } = {}) => {
    const current = clamp(page, pages);
    // One page is the only dead end left; see wrap() above.
    const only = pages <= 1;
    // aria-disabled ALONE, never the disabled attribute — a disabled button
    // dispatches no click, and this one has to be clickable so it can refuse.
    // See the note in pagination.css.
    const offAt = (d) => (only || (!wrapOn && (d < 0 ? current <= 1 : current >= pages)) ? ' aria-disabled="true"' : "");
    const modifier = vertical ? " qntns-pagination--vertical" : "";
    const w = dotWindow();
    const windowed = !vertical && pages > w;
    const start = windowed ? windowStart(0, current, pages, w) : 0;
    const dots = vertical ? "" : renderStrip(current, pages, w, start);

    return `
        <nav class="qntns-pagination${modifier}" aria-label="Pagination" data-pagination data-page="${current}" data-pages="${pages}"${wrapOn ? "" : ` data-wrap="false" data-noun="${noun}"`}${windowed ? ` data-window-start="${start}" data-window-size="${w}"` : ""}>
            <button class="qntns-pagination__step" type="button" data-step="-1" aria-label="${stepLabel(-1, current, pages, wrapOn, noun)}"${offAt(-1)}>
                ${icon("chevron-left", { size: 18, className: "qntns-pagination__icon" })}
            </button>
            ${dots}
            <button class="qntns-pagination__step" type="button" data-step="1" aria-label="${stepLabel(1, current, pages, wrapOn, noun)}"${offAt(1)}>
                ${icon("chevron-right", { size: 18, className: "qntns-pagination__icon" })}
            </button>
        </nav>
    `;
};

export const attachPagination = (root, { onChange } = {}) => {
    root.querySelectorAll("[data-pagination]").forEach((nav) => {
        let dots = nav.querySelector("[data-pagination-dots]");
        const steps = nav.querySelectorAll("[data-step]");
        const pages = Number(nav.dataset.pages) || 1;
        const wrapOn = nav.dataset.wrap !== "false", noun = nav.dataset.noun || "page";

        const paint = (page) => {
            // The vertical variant has no dot strip at all, so every read of
            // it is optional. The steps are the whole control there.
            const hadFocus = dots ? dots.contains(document.activeElement) : false;
            nav.dataset.page = String(page);
            if (dots && nav.dataset.windowStart !== undefined) {
                // Windowed: same dots, moved — see THE DOT WINDOW above.
                const w = Number(nav.dataset.windowSize);
                const start = windowStart(Number(nav.dataset.windowStart), page, pages, w);
                nav.dataset.windowStart = String(start);
                dots.querySelectorAll("[data-dot]").forEach((dot) => {
                    if (Number(dot.dataset.dot) === page) dot.setAttribute("aria-current", "true");
                    else dot.removeAttribute("aria-current");
                });
                paintWindow(dots, start, pages, w);
            } else if (dots) dots.innerHTML = renderDots(page, pages);
            if (hadFocus) dots.querySelector(`[data-dot="${page}"]`).focus();
            steps.forEach((step) => {
                const direction = Number(step.dataset.step);
                // Never blocked by POSITION any more — only by there being a
                // single page. The label is what changes at the ends.
                const blocked = pages <= 1 || (!wrapOn && (direction < 0 ? page <= 1 : page >= pages));
                step.setAttribute("aria-disabled", String(blocked));
                step.setAttribute("aria-label", stepLabel(direction, page, pages, wrapOn, noun));
            });
        };

        /*
         * `direction` is the GESTURE, not the page delta, and onChange gets it.
         *
         * They stopped agreeing the moment the steps started wrapping. Pressing
         * the right arrow on the last page of three moves the page number from
         * 3 to 1, which reads as backwards to anything comparing the two
         * numbers — and the card flip does exactly that, so the cards turned
         * right-to-left on a press of the right arrow. The arrow knows which
         * way it points; nothing downstream can work it out afterwards, so it
         * is passed along.
         *
         * A dot has no direction of its own — jumping to page 5 from page 2 is
         * genuinely forwards — so it derives one from the delta, which is the
         * old behaviour and still correct for a jump.
         */
        const goto = (page, direction = null) => {
            const current = Number(nav.dataset.page);
            if (!wrapOn && (page < 1 || page > pages)) return;
            const next = wrap(page, pages);
            if (next === current) return;
            paint(next);
            if (onChange) onChange(next, direction ?? (next > current ? 1 : -1));
        };

        /*
         * A STEP THAT CANNOT MOVE REFUSES OUT LOUD.
         *
         * There is one page, so both arrows are dead — and a press on a dead
         * control that does nothing at all reads as a broken button rather
         * than as a boundary. It shakes and plays the error sound, which is
         * exactly what a face-down card does in flip.js; the animation is
         * shared rather than copied so the two gestures cannot drift.
         *
         * Restarting a CSS animation on an element that never left the DOM
         * needs the class removed, a reflow forced, and the class re-added.
         * Reading offsetWidth is the reflow; nothing uses the value.
         */
        // §94: a resize or rotation across the breakpoint rebuilds the strip at the new size.
        if (dots) window.matchMedia?.(MOBILE_QUERY).addEventListener("change", () => {
            const page = Number(nav.dataset.page), w = dotWindow();
            const start = pages > w ? windowStart(0, page, pages, w) : 0;
            const had = dots.contains(document.activeElement);
            dots.outerHTML = renderStrip(page, pages, w, start);
            dots = nav.querySelector("[data-pagination-dots]");
            if (pages > w) { nav.dataset.windowStart = String(start); nav.dataset.windowSize = String(w); }
            else { delete nav.dataset.windowStart; delete nav.dataset.windowSize; }
            if (had) dots.querySelector(`[data-dot="${page}"]`)?.focus();
        });

        const REFUSE = "is-refused";
        const refuse = (step) => {
            playError();
            step.classList.remove(REFUSE);
            void step.offsetWidth;
            step.classList.add(REFUSE);
        };

        nav.addEventListener("click", (event) => {
            const step = event.target.closest("[data-step]");
            if (step) {
                if (step.getAttribute("aria-disabled") === "true") return refuse(step);
                const move = Number(step.dataset.step);
                return goto(Number(nav.dataset.page) + move, move);
            }

            const dot = event.target.closest("[data-dot]");
            if (dot) goto(Number(dot.dataset.dot));
        });

        // Left/up step back, right/down step forward. The vertical pair is
        // accepted in both orientations rather than being switched on the
        // variant: the arrows a reader reaches for depend on how the control
        // looks, and accepting all four costs nothing and can never be wrong.
        const STEP_KEYS = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };

        nav.addEventListener("keydown", (event) => {
            const move = STEP_KEYS[event.key];
            if (!move) return;
            event.preventDefault();
            goto(Number(nav.dataset.page) + move, move);
        });
    });
};
