/*
 * QNTNs read receipts — which posts THIS READER has read, and when.
 *
 * Settled with the user on 2026-08-28 (CHECKLIST-v2.md 14.1 and 14.5): the
 * receipt is READER-FACING. A reader sees which posts they have finished — the
 * card dims and its chevron becomes a check. The AUTHOR never sees who read
 * what, which is what keeps this out of the surveillance-and-consent category
 * entirely.
 *
 * WHAT COUNTS AS A READ: VISITING THE PAGE. SETTLED, NOT PROVISIONAL.
 * The user's words: "Let's keep reads simple. A simple visiting the page counts
 * as a read." So this is the rule, and the alternatives that were on the table
 * — scroll depth, a dwell timer — are closed rather than deferred. It is worth
 * writing down WHY the simple rule wins, because the objection to it is
 * obvious and was considered: yes, a mis-click counts as a read. The cost of
 * that is one card dimmed that the reader did not finish, on their own device,
 * where they can see the mistake and it misleads nobody else. The cost of the
 * clever rules is a receipt that fires unpredictably — a post read on a phone
 * in two sittings never crossing a dwell threshold, a short post that cannot
 * be scrolled at all never reaching the bottom — and a reader who cannot tell
 * why one card dimmed and another did not. A rule you can state in one
 * sentence is the feature; the accuracy given up is worth less than that.
 *
 * WHY localStorage, AND WHY THAT IS THE WHOLE OF PHASE ONE.
 * Ghost gives a theme nowhere to store a per-member anything — the members
 * frontend API updates a name and a newsletter choice and nothing else, and the
 * Admin API that could write a label needs a key a public theme cannot hold. So
 * the only place a receipt can live without a server is the browser, and this
 * theme already keeps two preferences there the same way (sound.js, view.js).
 * That buys the full feature for every reader including the ones who never sign
 * in, at the cost of it being per-device. Cross-device is phase two.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO:
 *   - no fetch, no server, no API. CLAUDE.md forbids runtime fetching and this
 *     phase must not need an exception to that rule.
 *   - no member identity, no JWT, no /members/api/session.
 *   - no union-on-login merge. There is nothing yet to merge with — but see
 *     THE STORED SHAPE, which is versioned so that merge can arrive without
 *     stranding everything already on a reader's device.
 *   - no rendering. It stores and it answers questions; the history page is
 *     somebody else's file. See SERVING THE HISTORY PAGE at the foot.
 *
 * WHAT A POST IS KEYED ON: its PATH. The posts blob hands each card a `url`
 * that is a Ghost URL ("/cobblestone/"), and the content page for that post is
 * served at exactly that path, so the card and the page agree on the key
 * without either of them having to be told about the other. A Ghost post slug
 * is unique per site and does not change unless the author edits it, which
 * makes it the most stable identifier a theme can see — the post id is not in
 * the blob and is not in the URL, so it is not available here at all.
 *
 * THE STORED SHAPE, AND WHY IT IS NOT A LIST OF STRINGS
 * ----------------------------------------------------
 *     {"v": 1, "reads": {"<path>": {"t": 1756... , "title": "…", "url": "…",
 *                                   "date": "Aug 2026", "dateTime": "2026-08-24",
 *                                   "tag": "Poem", "excerpt": "…"}}}
 *
 * A bare array of ids is the shape that cannot change. Any later version has to
 * guess whether an array it finds is the old thing or a corrupted new one, and
 * guessing wrong loses a reader's whole history. So the payload carries a
 * VERSION NUMBER from the start. `v` is the only field `load` trusts before it
 * has decided what it is looking at; everything else is read through it.
 *
 * The reads are an OBJECT KEYED BY PATH rather than an array of records because
 * every operation this module performs is a lookup by path — isRead on every
 * card render, markRead on every page load — and an array makes all of them a
 * scan. Ordering is a property of the timestamps, not of the storage.
 *
 * WHY THE RECORD CARRIES THE CARD AND NOT JUST THE TIME
 * ----------------------------------------------------
 * The history page has to render a CARD for each read post, and it has NO POST
 * LIST TO LOOK ANYTHING UP IN. The posts blob is the home page's contract and
 * describes what is on the home page NOW; a reader's history contains posts
 * that have been unpublished, retagged out of a section, or paged off the end.
 * A record that held only a path and a time would render as a card with a URL
 * and nothing else on it.
 *
 * So the record is SELF-SUFFICIENT: it holds exactly what renderCard needs and
 * stops there.
 *
 *   t          the read time, epoch ms. The one field with no other source.
 *   url        the card's href. Also the key, stored again so a record can be
 *              handed to renderCard without the caller rebuilding it.
 *   title      the card's title. Not derivable from a slug: "long-tuesday" is
 *              not "A Long Tuesday".
 *   date       the display string ("Aug 2026") the card shows.
 *   dateTime   the ISO date, for the <time> element and for sorting by
 *              PUBLICATION where the history page sorts by READ time.
 *   excerpt    the card's two lines of body. The only optional one — a card
 *              with an empty excerpt is a card with a gap, not a broken card.
 *   tag        the post's tag. Not used by the grid, but the FEED renders it
 *              as the card's `meta`, and the history page is the feed, so
 *              leaving it out would cost a re-scrape that can never happen.
 *
 * THE COST, STATED PLAINLY: THIS GROWS WITHOUT BOUND AND HAS NO EVICTION RULE.
 * A record is roughly 250 bytes with a full excerpt. The smallest localStorage
 * quota in a browser this theme supports is 5MB per origin, which is something
 * like 20,000 posts — more than this site will publish, read on one device, in
 * its life. A cap would therefore be a policy invented to solve a problem that
 * does not arrive, and it would arrive as a BUG rather than as a limit: the
 * reader whose oldest reads silently vanished from their history page has no
 * way to tell that from the feature being broken. So there is no cap.
 *
 * What there IS instead is a quota FAILURE path, because "will not happen" and
 * "cannot happen" are different claims and only the second one may go
 * unhandled. The theme shares its origin with anything Ghost or an injected
 * script also stores, so the quota can be exhausted by something that is not
 * this. See `save`: a refused write drops the oldest quarter of the history and
 * tries once more, and a second refusal is swallowed. Losing the oldest quarter
 * is the least-bad outcome available at that point, and it is a real event with
 * a reason rather than a routine trim nobody asked for.
 *
 * DEGRADATION. In a private window, or with site data blocked, the localStorage
 * ACCESSOR ITSELF throws — reading window.localStorage, not just calling a
 * method on it. Every touch is wrapped both ways, exactly as view.js wraps its
 * two. A refused read leaves the history empty, so NO card dims and the site
 * behaves precisely as it did before this file existed. A refused write is
 * swallowed, so opening a post can never take the page down with it. Nothing
 * here may throw: card.js imports this file and every page imports card.js, and
 * one failed module import kills every script on the page.
 */

import { bumpView, slugOf } from "./counts.js";

const STORAGE_KEY = "qntns:reads";
const VERSION = 1;

// Trailing-slash and case differences are the two ways the same post gets two
// keys: Ghost links "/cobblestone/" and a hand-typed "/Cobblestone" is the same
// page. A query string or a fragment ("?ref=…", "#comments") identifies a visit
// and not a post, so both are dropped. Anything that is not a string returns
// "" and is ignored by every caller; an absolute URL is reduced to its path.
//
// A BARE FRAGMENT ("#", "#cobblestone" — what the stories use for a dead link)
// has no path of its own and resolves to "/". That is harmless rather than
// lucky: markReadHere refuses to store "/" (see its guard), so "/" can never
// enter the history and isRead on a fragment is always false. It is worth
// knowing before someone wires a real link to a fragment and wonders why it
// never dims.
export const readKey = (url) => {
    if (typeof url !== "string" || !url) return "";
    let path = url;
    // A full URL from the same site normalises to its path; new URL() throws on
    // a relative string, which is the common case, so it is tried and caught
    // rather than sniffed for.
    try {
        path = new URL(url, "https://qntns.invalid").pathname;
    } catch {
        /* Keep the raw value; the trimming below still applies. */
    }
    path = path.split("?")[0].split("#")[0].toLowerCase();
    if (!path || path === "#") return "";
    return path.endsWith("/") ? path : `${path}/`;
};

const str = (value) => (typeof value === "string" ? value : "");

// One record, normalised. Everything but `t` is a string, so a malformed stored
// value degrades to an empty field rather than to a card that renders `null`.
const record = (key, source = {}, time = 0) => ({
    t: Number.isFinite(source.t) ? source.t : time,
    url: str(source.url) || key,
    title: str(source.title),
    date: str(source.date),
    dateTime: str(source.dateTime),
    tag: str(source.tag),
    excerpt: str(source.excerpt)
});

/*
 * LOADING, INCLUDING THE ONE MIGRATION THAT EXISTS.
 *
 * v0 was a bare array of path strings — the shape this file shipped with for
 * exactly as long as it took to learn the history page was coming. It is
 * migrated rather than discarded: those paths are still true statements that
 * the reader read those posts, so they keep dimming their cards. What they
 * cannot do is appear in the history, because an array carries no time and no
 * title and there is nowhere to recover either from. They arrive with `t: 0`
 * and `readEntries` drops them, which is the honest outcome — a history page
 * that invented a date for them would be worse than one that is short.
 *
 * This is what the version number buys, and it is why it is there from v1
 * rather than added at v2 when it would already be too late.
 */
const load = () => {
    const map = new Map();
    let raw = null;
    try {
        raw = window.localStorage.getItem(STORAGE_KEY);
    } catch {
        return map;
    }
    if (!raw) return map;

    let parsed = null;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return map;
    }

    // v0: the bare array.
    if (Array.isArray(parsed)) {
        parsed.forEach((key) => {
            if (typeof key === "string" && key) map.set(key, record(key, {}, 0));
        });
        return map;
    }

    if (!parsed || typeof parsed !== "object") return map;
    const reads = parsed.reads;
    if (!reads || typeof reads !== "object") return map;

    Object.keys(reads).forEach((key) => {
        const entry = reads[key];
        if (!key || !entry || typeof entry !== "object") return;
        map.set(key, record(key, entry, 0));
    });
    return map;
};

const history = load();

const write = () => {
    const reads = {};
    history.forEach((entry, key) => { reads[key] = entry; });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: VERSION, reads }));
};

/* See THE COST, STATED PLAINLY at the top. There is no routine cap; this is
   the quota FAILURE path and it only ever runs after the browser has actually
   refused a write. It drops the oldest quarter — oldest by READ time, and a
   migrated v0 record with t: 0 sorts oldest of all, which is right: it is the
   record with the least in it — and tries once. A second refusal is swallowed;
   at that point the storage is not ours to fix and the page still works. */
const save = () => {
    try {
        write();
        return;
    } catch {
        /* Fall through to the one retry. */
    }
    try {
        const oldest = [...history.entries()].sort((a, b) => a[1].t - b[1].t);
        const drop = Math.ceil(oldest.length / 4);
        oldest.slice(0, drop).forEach(([key]) => history.delete(key));
        write();
    } catch {
        /* Storage refused twice. The in-memory history still serves this page. */
    }
};

export const isRead = (url) => {
    const key = readKey(url);
    return Boolean(key) && history.has(key);
};

/*
 * FIRST READ WINS. RE-READING DOES NOT MOVE THE TIMESTAMP.
 *
 * The choice is between "the day you discovered this" and "the last time this
 * page was open", and the first is the one a history page can be built on.
 *
 * The deciding argument is not which is more interesting, it is which is
 * STABLE. Under last-wins, a history page reorders itself under the reader:
 * every revisit tears a post out of the day it belongs to and drops it at the
 * top of today, so a list the reader has been building for months is rearranged
 * by an accidental click on a link they already followed. Their history stops
 * being a record of anything and becomes a most-recently-touched list, which is
 * a thing they can already get from their browser. First-wins gives every post
 * exactly one permanent place in the timeline, and the day headings the history
 * page groups by stay put once they are written.
 *
 * It is also the only choice compatible with the trigger the user settled on.
 * "Visiting counts" means the receipt fires on navigation, including the
 * navigation of pressing Back — under last-wins, moving backwards through a
 * session would rewrite the very history that session created.
 *
 * The cost is that a re-read is invisible: nothing records that a post was
 * returned to. If a read COUNT or a last-seen time is wanted later, it is a new
 * field on a record that already has a version number to add it under, not a
 * reinterpretation of `t`. That is the whole reason `t` is defined narrowly.
 *
 * THE METADATA IS STILL REFRESHED on a revisit, and only the timestamp is
 * pinned. A post whose title or excerpt was edited after it was first read
 * should show its CURRENT text on the history page — the record is a cache of
 * the card, and a stale cache is a bug. A field is only overwritten when the
 * new visit actually supplies it, so a scrape that comes back empty cannot
 * blank a record that already had a title in it.
 */
export const markRead = (url, details = {}) => {
    const key = readKey(url);
    if (!key) return false;

    const existing = history.get(key);
    const now = Date.now();
    const next = record(key, {
        ...(existing || {}),
        ...Object.fromEntries(Object.entries(details).filter(([, v]) => str(v))),
        url: str(details.url) || (existing && existing.url) || key,
        t: existing && existing.t ? existing.t : now
    }, now);

    history.set(key, next);
    save();
    return !existing;
};

// A copy, not the live Map. Nothing outside this module may write to the
// history without going through markRead, or the write-through stops happening.
export const readSet = () => new Set(history.keys());

/*
 * MERGE A SERVER SET IN. THE OTHER HALF OF FIRST READ WINS.
 * -----------------------------------------------------------------------
 * This exists for assets/js/qntns/sync.js and nothing else — see
 * CHECKLIST-v3.md section 2. It is a second function rather than a flag on
 * markRead because it is answering a different question. markRead pins the
 * EXISTING timestamp on purpose (see FIRST READ WINS above) and has no way to
 * accept a SMALLER one from outside — "now" is baked into it. A synced record
 * needs exactly that ability: the Worker has already unioned every device's
 * reads with the same rule this file uses, so on THIS device a stored record
 * only ever loses to a server record that is OLDER than it. Nothing here
 * touches Date.now() at all, which is the whole difference from markRead.
 *
 * Returns the keys that are NEW to this device — present in the server's set
 * but absent from ours before the merge. That is deliberately not "every key
 * the merge touched": a path whose local timestamp already exists and only
 * had a title or excerpt refreshed was already showing as read on this page,
 * so a caller repainting cards has no reason to touch it again. New keys are
 * the only ones a page can be showing as unread when they are not.
 */
export const mergeReads = (serverReads) => {
    if (!serverReads || typeof serverReads !== "object") return [];

    const added = [];
    let changed = false;

    Object.keys(serverReads).forEach((key) => {
        if (!key) return;
        const incoming = serverReads[key];
        if (!incoming || typeof incoming !== "object" || !Number.isFinite(incoming.t)) return;

        const existing = history.get(key);
        if (!existing) {
            added.push(key);
            history.set(key, record(key, incoming, incoming.t));
            changed = true;
        } else if (incoming.t < existing.t) {
            history.set(key, record(key, incoming, incoming.t));
            changed = true;
        }
    });

    if (changed) save();
    return added;
};

/*
 * SERVING THE HISTORY PAGE
 * ========================
 * The page the user wants is the FEED view grouped by full day — "F.Aug.28.2026"
 * as the sticky heading rather than "Aug 2026" — linked from the footer.
 * It is not built here and this file renders nothing. What it does is answer
 * the two questions that page cannot answer for itself, so that page can be
 * built without this module being reopened.
 *
 * WHAT THIS FILE PROVIDES:
 *
 *   readEntries()   every read, NEWEST FIRST, as records that renderCard can
 *                   take directly. Records with no usable time (the v0
 *                   migration) are dropped, because they cannot be placed in a
 *                   timeline at all.
 *   readDays()      the same records already grouped into calendar days,
 *                   newest day first, each with the ISO day, a formatted
 *                   heading, and its entries newest first within the day.
 *
 * WHAT THE HISTORY PAGE STILL HAS TO DO FOR ITSELF:
 *
 *   - render. Mapping a record onto renderCard, and a day onto the feed's
 *     month-heading markup, is that page's job. A record is deliberately
 *     shaped as renderCard's argument, so the mapping is a spread.
 *   - the accent ramp. rampColor is indexed across a known total; the history
 *     page knows its own total and this file does not.
 *   - the sticky-heading observer. That mechanism lives in card-group.js and
 *     is the feed's, not the receipt's.
 *   - the empty state. A reader with no history is a page with nothing on it,
 *     and what that page should say is a copy decision.
 *   - marking anything read. Visiting the history page is not reading a post,
 *     and markReadHere already declines to fire on anything that is not a post.
 *
 * WHY DAYS ARE CUT IN LOCAL TIME. A post's `dateTime` is a date-only string and
 * card.js formats it in UTC on purpose, because a bare date has no time zone
 * and shifting it would show the wrong month at the edges. A READ time is the
 * opposite kind of value: it is a real instant, and the reader's own midnight
 * is where their day ends. Reading something at 11pm must not file it under
 * tomorrow. So these two formatters disagree about time zone deliberately, and
 * neither is wrong.
 */

// Newest first. Records the v0 migration could not date are dropped — see the
// migration note in `load` for why inventing a date for them would be worse.
export const readEntries = () => [...history.values()]
    .filter((entry) => entry.t > 0)
    .sort((a, b) => b.t - a.t);

// The local calendar day an instant falls in, as YYYY-MM-DD. Built from the
// parts rather than from toISOString, which is UTC and would file a late-night
// read under the following day.
export const readDayKey = (time) => {
    const d = new Date(time);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// "F.Aug.28.2026" — the heading the user asked for, formatted here rather
// than at the history page so the day key and its label can never disagree.
//
// THE WEEKDAY IS ONE LETTER, FROM MTWRFSY. Tuesday and Thursday both start
// with T and Saturday and Sunday both start with S, so the single-letter
// alphabet borrows R for Thursday and Y for Sunday — the convention timetables
// have used for decades. Indexed by getDay(), which is 0 for Sunday, so the
// string is written Sunday-first rather than Monday-first.
const DAY_LETTERS = "YMTWRFS";

export const readDayLabel = (time) => {
    const d = new Date(time);
    if (Number.isNaN(d.getTime())) return "";
    // en-US short month only — the rest of the label is built from the parts,
    // because no locale option produces this shape.
    const month = d.toLocaleDateString("en-US", { month: "short" });
    return `${DAY_LETTERS[d.getDay()]}.${month}.${d.getDate()}.${d.getFullYear()}`;
};

// [{ day: "2026-08-28", label: "F.Aug.28.2026", entries: [record, …] }, …]
// Newest day first, newest read first within each day. readEntries is already
// sorted, so one pass builds the groups in order.
export const readDays = () => {
    const days = [];
    let current = null;
    readEntries().forEach((entry) => {
        const day = readDayKey(entry.t);
        if (!current || current.day !== day) {
            current = { day, label: readDayLabel(entry.t), entries: [] };
            days.push(current);
        }
        current.entries.push(entry);
    });
    return days;
};

/*
 * THE TRIGGER, AND THE ONLY CALLER OF markRead IN THE THEME.
 *
 * "Read" means "the post's page was visited" — settled by the user, see the top
 * of this file. This is the whole implementation of that rule, and it is one
 * function so that it stays that way: no other module in the theme knows what
 * makes a post read.
 *
 * It reads location.pathname because that is what the content page knows about
 * itself; the post's own URL is not written into the content markup anywhere.
 *
 * IT ONLY FIRES ON A POST, and it works that out from Ghost's own body class
 * rather than from a marker this theme would have to add. `{{body_class}}` in
 * default.hbs emits "post-template" on a post, "page-template" on a page and
 * "error-template" on an error — so a 404 is excluded for free, which matters
 * because Ghost serves error.hbs AT THE REQUESTED PATH and the theme would
 * otherwise record a mistyped URL as something the reader read. About and Store
 * are excluded by the same test: a read receipt is a claim about a post.
 *
 * THE SCRAPE IS THE ONLY WAY TO GET THE CARD. A content page renders a title, a
 * meta row and a body; it does not carry the posts blob, and adding a second
 * JSON blob to post.hbs to restate what is already on the page in words would
 * be a template change, a new contract to keep in step, and a bigger download,
 * to obtain data that is sitting in the DOM. So the record is read off the
 * rendered article, from the classes qntns/content.js writes. Every field is
 * optional here: a missing one stores as "" and the existing value survives
 * (see markRead), so a template change that renames a class costs a blank
 * field on new records rather than an exception.
 *
 * THE #noread TAG OPTS A POST OUT ENTIRELY. A post tagged `#noread` in Ghost
 * never gets a receipt: its card never dims, it never appears in the history
 * page, and sync.js never sends it, because sync only ever carries what this
 * file has stored and nothing is stored. That is one guard rather than four,
 * which is the reason it lives here — markRead is the single door and this
 * shuts it.
 *
 * WHY THE TEMPLATE TELLS US AND NOT `{{body_class}}`. Ghost's body_class adds
 * `tag-<slug>` for the PRIMARY tag only, and an internal tag is never primary,
 * so a body-class test would silently never fire. post.hbs therefore puts
 * `qntns-content__article--noread` on the article, the same internal-tag
 * mechanism #dropcap and #fixed-lines already use two lines below it.
 *
 * THE MARK SPREADS ALONG A TAG, the way #home-content does: one post in a
 * section carrying #noread makes the whole section no-read. That arithmetic is
 * NOT done here, because a post page has no idea what its siblings are — it is
 * the {{#get}} in post.hbs, and this file only ever reads its answer. See the
 * comment on that attribute for why the query is where it is.
 *
 * ALREADY-READ POSTS STAY READ. Tagging a post `#noread` stops new receipts;
 * it does not erase one a reader already has. Deleting theirs would have to
 * beat the server copy sync.js merges back in, so the honest small behaviour is
 * that the tag is forward-looking.
 */
/* The view POST markReadHere fired, or a resolved null when it fired none.
   The post page's counts read waits on it, so a first view shows its own +1
   rather than racing the bump and showing the old figure until a reload. */
export let viewBumped = Promise.resolve(null);

export const markReadHere = () => {
    if (!document.body || !document.body.classList.contains("post-template")) return false;
    const path = readKey(window.location.pathname);
    if (!path || path === "/") return false;

    const article = document.querySelector(".qntns-content__article");
    // Two sources, one fact. The class is the post's OWN #noread tag; the meta
    // is its SECTION's, which only a {{#get}} in post.hbs can answer — see the
    // comment there for why the group answer travels as an element rather than
    // as a second condition inside the class attribute.
    if (article && article.classList.contains("qntns-content__article--noread")) return false;
    if (document.querySelector('meta[name="qntns-noread"]')) return false;
    const pick = (selector) => {
        const node = article && article.querySelector(selector);
        return node ? node.textContent.trim() : "";
    };
    const time = article && article.querySelector(".qntns-content__meta time");

    const first = markRead(path, {
        url: window.location.pathname,
        title: pick(".qntns-content__title"),
        date: time ? time.textContent.trim() : "",
        dateTime: time ? time.getAttribute("datetime") || "" : "",
        tag: pick(".qntns-content__tag"),
        excerpt: excerptOf(article)
    });
    /* THE VIEW (CHECKLIST-26 §5, §9): one POST /views/<slug> per device,
       anonymous or signed in. §54b: keyed on its own record (countView), not on
       `first` — the feed marks posts read without the post page, and keying on
       the read receipt meant a post read on the feed was never counted. */
    viewBumped = countView(path);
    return first;
};

/* §54b: the slugs this device has counted a view for, apart from the read
   history (which the feed writes and sync.js merges in from other devices),
   each with the count the Worker answered. countView sends the bump once per
   slug, records it only on a 200, and resolves to the Worker's {views, likes}
   — or null when already counted, not a post slug, or the bump failed, so a
   null answer never counts this reader. The answered count is kept because
   /counts can trail the bump for up to a minute (KV's edge cache and the
   Worker's public max-age=60): a reload inside that minute would put the
   figure back one low and the next expand, already counted, would bump
   nothing — "views don't update". countedViews is the floor the fills use.
   Legacy record (an array of slugs, build 1333): counted, floor 0.
   ponytail: posts this device read before §54b have no record, so their next
   read sends one bump that may repeat an old one. Accepted: counts are tiny. */
const VIEWED_KEY = "qntns:viewed";
const viewed = (() => {
    try {
        const v = JSON.parse(window.localStorage.getItem(VIEWED_KEY));
        return Array.isArray(v) ? Object.fromEntries(v.map((s) => [s, 0])) : (v && typeof v === "object" ? v : {});
    } catch { return {}; }
})();
const sending = new Set(); // in flight: not counted yet, but a second open must not send a second bump
export const isCounted = (url) => Object.hasOwn(viewed, slugOf(url));
// The count the Worker answered this device's bump with, 0 when none: never above the real count.
export const countedViews = (url) => Number(viewed[slugOf(url)]) || 0;
export const countView = (url) => {
    const slug = slugOf(url);
    if (!slug || Object.hasOwn(viewed, slug) || sending.has(slug)) return Promise.resolve(null);
    sending.add(slug);
    return bumpView(slug).then((answer) => {
        sending.delete(slug);
        if (!answer) return null;
        viewed[slug] = Number(answer.views) || 0;
        try { window.localStorage.setItem(VIEWED_KEY, JSON.stringify(viewed)); } catch { /* private window: counted for this page only */ }
        return answer;
    });
};

/* The card's two lines, taken from the first real paragraph of the body.
   Capped at 200 characters: the card clamps to two lines and never shows more
   than about 160, and storing a whole post would turn a 250-byte record into a
   several-kilobyte one for no visible gain. Cut on a word boundary — a record
   is written once and read on a page, so a mid-word truncation is permanent. */
const excerptOf = (article) => {
    const p = article && article.querySelector(".qntns-content__body p");
    const text = p ? p.textContent.replace(/\s+/g, " ").trim() : "";
    if (text.length <= 200) return text;
    const cut = text.slice(0, 200);
    const space = cut.lastIndexOf(" ");
    return `${(space > 120 ? cut.slice(0, space) : cut).trim()}…`;
};
