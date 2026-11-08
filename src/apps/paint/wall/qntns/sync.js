/*
 * QNTNs read receipts — cross-device sync.
 * ===========================================================================
 * This is the CLIENT half of the phase-two work in CHECKLIST-v3.md section 2;
 * the Worker at worker/src/index.js is the SERVER half and the DECISIONS
 * SETTLED block at the top of that checklist is binding on both. Read reads.js
 * first. This file adds NOTHING to what counts as a read or how a read
 * receipt looks — it only carries the set reads.js already keeps to and from
 * a signed-in reader's account, in the background, without reads.js needing
 * to know sync exists at all. reads.js has no import of this file and never
 * will; the dependency runs one way.
 *
 * WHY THIS IS ALLOWED TO FETCH, WHEN NOTHING ELSE IN THE THEME DOES.
 * CLAUDE.md's no-runtime-fetch constraint is amended for exactly this file —
 * see the entry in DECISIONS-LOG.md. The trade stated there: a reader who
 * never signs in makes zero network requests here (see LOGIN DETECTION below)
 * and pays nothing for this file existing; a reader who does sign in trades
 * one small background request per page for carrying their history to a
 * second device.
 *
 * THE FIVE RULES THIS FILE IS BUILT AROUND, AND WHY EACH ONE EXISTS.
 *
 *   1. NEVER BLOCK FIRST PAINT. reads.js loads synchronously at module scope
 *      and every card is already rendered — home.js, history.js and content.js
 *      all call syncReads() LAST, after every attach* call, never before. A
 *      slow or unreachable Worker must never be a reason a reader is looking
 *      at a blank grid, and nothing below is awaited by anything that paints.
 *
 *   2. NEVER THROW. One failed module import or one uncaught exception kills
 *      every script on the page in this theme (see reads.js's own
 *      DEGRADATION note), and this file is the one new thing in the graph
 *      that talks to a server it does not control — a server this theme's
 *      own DNS, TLS or the reader's network can break in ways nothing else
 *      here is exposed to. The whole body of syncReads is one try/catch, so
 *      every failure below — a rejected fetch, a non-200, a JSON parse error,
 *      a DOM lookup that finds nothing — lands in the same place and none of
 *      them propagates.
 *
 *   3. NEVER HANG. fetch has no default timeout, and a Worker that never
 *      answers would otherwise leave a promise this module never resolves —
 *      not a crash, but a background task that runs for the life of the tab.
 *      Both requests below carry AbortSignal.timeout(TIMEOUT_MS).
 *
 *   4. NEVER SHOW THE READER ANYTHING. No banner, no thrown error, no
 *      console.error on the ordinary failure path — CHECKLIST-v3.md 2.3
 *      settles this: a sync failure costs the cross-device half of a
 *      convenience feature and nothing else, which is not worth a reader's
 *      attention. A single console.debug is the one concession, for whoever
 *      is actually looking.
 *
 *   5. NEVER DO ANYTHING FOR AN ANONYMOUS READER. getToken() is the first
 *      thing syncReads awaits and a null return — the 204 case, see LOGIN
 *      DETECTION — ends the function before the sync request is ever built,
 *      let alone sent. An anonymous reader gets exactly the site they have
 *      today, network tab included.
 */

import { icon } from "../icon-set.js";
import { readKey, readEntries, mergeReads } from "./reads.js";
import { unlockedEntries, mergePhrases } from "./unlocked.js";

// The Worker's own hostname. Deployed 2026-08-28 from worker/; a workers.dev
// subdomain, per CHECKLIST-v3.md 1.1. It is hardcoded because the theme ships
// as a ZIP with nothing to configure at install time, which means moving the
// Worker to a custom domain later is a re-zip and not a settings change — the
// trade was taken knowingly. If it ever stops resolving, this file fails the
// same way any other network error does: caught, logged once at debug level,
// and otherwise invisible. See rule 2 above.
export const SYNC_BASE = "https://qntns-reads.qstaley921.workers.dev";

// Generous enough that a cold Worker isolate and a slow mobile connection
// both get a fair try, short enough that this module never runs long past
// the page it belongs to. See rule 3 above.
const TIMEOUT_MS = 8000;


/*
 * LOGIN DETECTION.
 * Ghost answers "is anyone signed in on this device" on its own members
 * frontend API, on the theme's own origin, using the cookies the browser is
 * already carrying — no code here ever sees or stores a session cookie. A 200
 * body is the member's JWT as plain text; Ghost issues it, this file never
 * does. A 204 is "logged out", and is treated as the full answer: nothing
 * past this function runs a single further fetch on that path. Anything that
 * is not a 200 with a non-empty body — a 204, a 5xx, a network failure — is
 * folded into the same "no token" result, because the only two things this
 * caller can do with a token are use it or not, and every one of those
 * outcomes means not.
 */
export const getToken = async () => {
    const res = await fetch("/members/api/session", {
        credentials: "include",
        signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (res.status !== 200) return null;
    const token = (await res.text()).trim();
    return token || null;
};

/*
 * THE WHOLE LOCAL SET, AS THE WORKER'S CONTRACT WANTS IT.
 * readEntries() already returns exactly this record shape and already drops
 * the one thing that cannot travel — v0-migrated entries with no real read
 * time (see the migration note in reads.js). Sending a fabricated t: 0 for
 * one of those would make it look like the EARLIEST read this reader has
 * ever made the moment it reached the Worker's first-wins merge, which is a
 * worse outcome than simply not syncing it; the device that made it still
 * has it, dimmed, from localStorage. The path each record is keyed under is
 * rebuilt with readKey() over the record's own `url` — the same
 * normalisation reads.js used to store it in the first place, so the two
 * always agree.
 */
const buildPayload = () => {
    const reads = {};
    readEntries().forEach((entry) => {
        const key = readKey(entry.url);
        if (key) reads[key] = entry;
    });
    return { v: 1, reads };
};

/*
 * ONE POST, BOTH DIRECTIONS. See CHECKLIST-v3.md 2.2: the union happens on
 * the Worker, so this is not "push, then pull" as two requests with a race
 * between them — it is one call that returns the merged set, which is what
 * this device should now believe. A non-2xx response (a 401 from a token
 * Ghost has since revoked, a 413 from a set this device somehow grew past the
 * Worker's cap, a 500) returns null and the caller treats it exactly like a
 * network failure: nothing merges, nothing repaints, nothing is said.
 */
const postReads = async (token) => {
    const res = await fetch(`${SYNC_BASE}/reads`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(buildPayload()),
        signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!res.ok) return null;
    return res.json();
};

/*
 * FLIPPING AN ALREADY-RENDERED CARD, WITHOUT RE-RENDERING IT.
 * -----------------------------------------------------------------------
 * card.js's renderCard is the only place in the theme that knows how a read
 * card is built, and it is a string template — there is nothing in this
 * theme that re-renders one card from live state, only decks that flip whole
 * pages (card-group.js). Re-rendering the whole feed to dim one newly-synced
 * card would cost every other card its scroll position and its animation
 * state for a change that affects a handful of pixels, so this instead
 * REPRODUCES renderCard's own read branch against the DOM node that already
 * exists — same class, same icon() call, same markup — rather than inventing
 * a second way to draw a read card. Compare this to card.js's `read` branch
 * of renderCard, lines ~135-153: the two must stay in step by inspection,
 * because there is nowhere to share the fragment from without turning
 * renderCard itself into a DOM-mutating function it was never built to be.
 *
 * THE DIMMING ITSELF needs none of this — `.qntns-card--read` alone drives
 * every opacity rule in card.css (border, shadow, bar, title, excerpt, date
 * all key off that one class; see card.css's READ block). Only the chevron
 * button's swap to a check and the word "Read" is markup rather than a class,
 * because it is content, not a style.
 *
 * `.qntns-card__go` IS ABSENT ON A TINY CARD, because tiny omits the whole
 * meta row from its markup (see card.js) — but tiny ships nowhere today (see
 * card.css's own map of which variant ships where), so this is a defensive
 * no-op rather than a live case. The dimming still applies with or without it.
 *
 * THE GLYPH SIZE follows card.js's own rule: 18px on any card carrying
 * `--large`, `--medium-wide` or `--super-wide`, 12px otherwise. Only large and
 * medium-wide ship, so in practice this always resolves to 18 — the fallback
 * exists so a story or a future variant is not silently wrong.
 */
const paintRead = (key) => {
    // NOT `a.qntns-card`: DECISIONS-LOG #67 made the home-content card a
    // <button>, so the tag would have made this a false statement. The href
    // read below still resolves — home-content is excluded from the read paint
    // by card.js's readClass, so it never reaches the key test anyway.
    document.querySelectorAll(".qntns-card").forEach((card) => {
        if (card.classList.contains("qntns-card--read")) return;
        if (readKey(card.getAttribute("href")) !== key) return;

        card.classList.add("qntns-card--read");

        const go = card.querySelector(".qntns-card__go");
        if (!go) return;

        const large = card.classList.contains("qntns-card--large")
            || card.classList.contains("qntns-card--medium-wide")
            || card.classList.contains("qntns-card--super-wide");

        go.classList.add("qntns-card__go--read");
        // The unread button is aria-hidden — a chevron is decoration, see
        // card.js. The read one carries the word "Read" and must not be.
        go.removeAttribute("aria-hidden");
        go.innerHTML =
            `${icon("check", { size: large ? 18 : 12, className: "qntns-card__chevron" })}` +
            `<span class="qntns-card__go-label">Read</span>`;
    });
};

/*
 * THE READER-FACING ENTRY POINT.
 * Nothing in this file may throw past here (rule 2), nothing may run before
 * every attach* call on the page it is loaded from (rule 1), and an
 * anonymous reader ends this function at the first await (rule 5). Every
 * exit past getToken() either merges something and repaints exactly the
 * cards that changed, or falls straight through to the catch and changes
 * nothing at all — there is no partial state between "still local-only" and
 * "merged", because mergeReads only ever runs once, on a response this
 * function has already confirmed exists.
 */
/*
 * THE SAME FIVE RULES, FOR THE BOOKS THIS READER HAS THE PHRASE TO.
 * Ruled by the user, 2026-09-19: the password should keep "when logged in to
 * comments, same mechanism as the read history". assets/js/qntns/unlocked.js
 * holds the set; this carries it, and knows nothing about how a gate is drawn.
 *
 * IT IS A SEPARATE CALL AND NOT A SECOND FIELD ON /reads. The two sets have
 * different merge rules — reads are first-wins, phrases are newest-wins, and
 * the Worker's two handlers say why — and folding them into one envelope would
 * mean one 413 from a large reading history also costing a reader the book
 * they just unlocked. Separate payloads fail separately.
 *
 * IT RUNS ONLY ON A PAGE THAT COULD HAVE A BOOK ON IT. assets/js/content.js is
 * the only caller: the home page, the history page, tags and authors have no
 * gate to open and no phrase to contribute, so an unconditional call there
 * would be a request that can change nothing.
 *
 * THE EVENT IS WHAT MAKES IT VISIBLE. lock.js listens for
 * `qntns:unlocks-synced` on the document and replays the newly-arrived phrase
 * against the Worker, so a book unlocked on a phone opens itself on a laptop a
 * beat after the page settles. It is dispatched ONLY when the merge actually
 * added something, so the ordinary case — a reader whose devices agree — costs
 * one request and no work at all.
 */
const postUnlocks = async (token) => {
    const res = await fetch(`${SYNC_BASE}/unlocks`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ v: 1, books: unlockedEntries() }),
        signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!res.ok) return null;
    return res.json();
};

export const syncUnlocks = async () => {
    try {
        const token = await getToken();
        if (!token) return;

        const merged = await postUnlocks(token);
        if (!merged || !merged.books) return;

        if (mergePhrases(merged.books)) {
            document.dispatchEvent(new CustomEvent("qntns:unlocks-synced"));
        }
    } catch {
        // Rule 4, unchanged: a failed sync costs the cross-device half of a
        // convenience and nothing a reader should be told about.
        console.debug("[qntns] unlock sync skipped");
    }
};

export const syncReads = async () => {
    try {
        const token = await getToken();
        if (!token) return;

        const merged = await postReads(token);
        if (!merged || !merged.reads) return;

        const added = mergeReads(merged.reads);
        added.forEach(paintRead);
        if (added.length) document.dispatchEvent(new CustomEvent("qntns:reads-synced"));
    } catch {
        // See rule 4. This is the whole of the failure path: one debug line,
        // no detail a reader would ever see, localStorage untouched.
        console.debug("[qntns] read sync skipped");
    }
};
