/*
 * QNTNs color ramp.
 *
 * The ramp interpolates from the brand navy hsl(222 55% 21%) at the dark end to
 * a pure grey hsl(222 0% 81%) at the light end. Saturation and lightness move
 * linearly; hue is fixed at 222.
 *
 * SEMANTICS: the ramp is CONTENT-BOUND. The colour belongs to the POST, not to
 * the slot it happens to land in, and it is assigned once when the page loads.
 *
 * `total` is EVERY post on the page, not just the ones currently on screen.
 * Sections are concatenated in DOM order and the run is continuous across the
 * boundary, so a page of 100 "Poems" followed by 40 "Lessons" divides the ramp
 * into 140 steps: "Poems" post 1 is the darkest, "Lessons" post 40 is the
 * lightest, and "Lessons" post 1 simply carries on from "Poems" post 100. Each
 * post's `index` is its position in that concatenated list — never an index
 * restarted per section, and never a slot position.
 *
 * The consequence is deliberate: paging through a section walks along the ramp.
 * Page 1 shows the darkest end, and each flip turns the cards over to lighter
 * colours because the incoming posts carry their own values. Resizing changes
 * how many posts are visible, never how many exist, so the colours do not move.
 */

const RAMP_H = 222;
const RAMP_S_START = 55;
const RAMP_S_END = 0;
const RAMP_L_START = 21;
const RAMP_L_END = 81;

export function rampColor(index, total) {
    const t = total <= 1 ? 0 : index / (total - 1);
    const s = RAMP_S_START + (RAMP_S_END - RAMP_S_START) * t;
    const l = RAMP_L_START + (RAMP_L_END - RAMP_L_START) * t;
    return `hsl(${RAMP_H} ${s.toFixed(2)}% ${l.toFixed(2)}%)`;
}

export function rampColors(total) {
    return Array.from({ length: total }, (_, i) => rampColor(i, total));
}

/*
 * The order colours are handed out in, so every handover is a contrast jump.
 *
 * Walks the ramp from both ends at once, two apart: 0, N-1, 2, N-3, 4, N-5 …
 * That puts the darkest next to the lightest at each step instead of running
 * down the ramp in order.
 *
 * EXHAUSTION: that walk alone is not total. Stepping by two from both ends
 * covers only about half the indices before lo crosses hi — N=5 emits 0, 4, 2
 * and leaves 1 and 3 unassigned. A second pass offset by one (1, N-2, 3, N-4 …)
 * picks up the rest, so every index is emitted exactly once. The `includes`
 * guard is for the single-index case where lo === hi.
 *
 * This is a permutation over `rampColors(total)`, not a second colour function.
 * It is not repairing a legibility failure: at small counts adjacent ramp
 * indices are already plainly different (15 lightness points apart at N=5). It
 * exists so the maximum contrast lands at every handover at any count.
 */
export function rampOrder(total) {
    const order = [];
    const push = (i) => { if (!order.includes(i)) order.push(i); };
    for (const start of [0, 1]) {
        for (let lo = start, hi = total - 1 - start; lo <= hi; lo += 2, hi -= 2) {
            push(lo);
            push(hi);
        }
    }
    return order;
}

/*
 * Fund calendar: eight fixed stops, dark to light, both ends included. Run n
 * (0-based, paid order) wears stop n % 8, so a new funder never recolours an
 * earlier run and the 9th run wraps back to the darkest.
 */
export const FUND_STOPS = 8;
export const fundColor = (n) => rampColor(n % FUND_STOPS, FUND_STOPS);
