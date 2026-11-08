import { icon } from "../icon-set.js";
import { escapeHtml } from "./escape.js";

/*
 * QNTNs goal log — the drill-in list. CHECKLIST-24 item 4.
 *
 * One list for every goal embed that opens on its entries: the mood pop-up
 * (goal-mood.js) and, after STOP 0, a meditation habit. A row is
 *
 *   { at?: "2026-10-04T12:12:00Z", day?: "2026-09-18", what: "1 sit", note? }
 *
 * THE TIME IS STORED IN UTC AND SHOWN IN THE VIEWER'S ZONE. `at` is an ISO
 * instant; Intl formats it in the reader's own zone and names the zone
 * ("Oct 4, 2026, 8:12 AM EDT"), so a reader in London and one in Denver each
 * see their own clock. A row with only `day` is an entry from before times
 * were kept (the day counts): it shows the date alone, read as UTC so the day
 * never shifts. Newest first; rows with `at` sort by it, day-only rows by day.
 *
 * A <div role="list">, not an <ol>: inside a post, content.css numbers every
 * ol > li in the body face and pads the list 32, and this list numbers itself
 * (goal-log.css).
 *
 * Every string is escaped: notes come from the connector, not from this file.
 */
// `sort` overrides the shown time as the order key (mood: an entry counts on its reflection date).
const stamp = (row) => row.sort ?? Date.parse(row.at ?? `${row.day}T00:00:00Z`);

export const formatAt = (row, { timeZone } = {}) => {
    if (row.at) {
        return new Intl.DateTimeFormat("en-US", {
            timeZone,
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
            timeZoneName: "short"
        }).format(new Date(row.at));
    }
    return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" })
        .format(new Date(`${row.day}T00:00:00Z`));
};

export const renderLog = (rows = [], options = {}) => {
    if (!rows.length) return `<p class="qntns-log__empty">No entries yet.</p>`;
    const items = [...rows]
        .sort((a, b) => stamp(b) - stamp(a))
        .map((row) => `
        <div class="qntns-log__row" role="listitem">
          <time class="qntns-log__when" datetime="${escapeHtml(row.at ?? row.day)}">${escapeHtml(formatAt(row, options))}</time>
          <div class="qntns-log__what">${escapeHtml(row.what)}</div>${row.note ? `
          <p class="qntns-log__note">${escapeHtml(row.note)}</p>` : ""}
        </div>`)
        .join("");
    return `<div class="qntns-log" role="list">${items}
    </div>`;
};

/*
 * THE POP-UP'S SCROLL CUES (STOP 3 feedback). A log in the footnote pop-up
 * gets the pop-up's own bottom fade (footnotes.css .qntns-fn-pop__fade) and
 * the card's navy down-square (card.css .qntns-card__more), which scrolls the
 * body one view down. Both are children of the panel, not the scroller, so
 * they stay put; both go when the body is at its end, or never overflowed.
 * `popCues` is the markup for the panel; `attachPopCues(panel)` wires it and
 * returns the sync to call after the body's content changes.
 */
export const popCues = () => `<div class="qntns-fn-pop__fade" data-pop-fade aria-hidden="true" hidden></div><button type="button" class="qntns-log__more" data-pop-more aria-label="Scroll down" hidden>${icon("chevron-down", { size: 18 })}</button>`;

export const attachPopCues = (panel) => attachScrollCues(
    panel.querySelector(".qntns-fn-pop__body"),
    panel.querySelector("[data-pop-fade]"),
    panel.querySelector("[data-pop-more]")
);

// The same cues on any scroller: a mastery column uses them too (goal-mastery.js).
export const attachScrollCues = (body, fade, more) => {
    // 2px of slack, as footnotes.js: fractional heights stop a hair short.
    const sync = () => {
        const end = body.scrollTop + body.clientHeight >= body.scrollHeight - 2;
        fade.hidden = end;
        more.hidden = end;
    };
    body.addEventListener("scroll", sync, { passive: true });
    more.addEventListener("click", (event) => {
        event.stopPropagation();
        body.scrollBy({ top: body.clientHeight - 48, behavior: "smooth" });
    });
    return sync;
};
