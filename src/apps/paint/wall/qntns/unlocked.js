/*
 * QNTNs unlocked books — which books THIS READER has the phrase for.
 *
 * Ruled by the user, 2026-09-19: "I have already entered the password for this
 * browser. It should persist, and also keep when logged in to comments, same
 * mechanism as the read history." This file is the first half of that — the
 * per-device half. It is deliberately built to the same shape as reads.js and
 * says why at each point the two differ.
 *
 * WHAT IS STORED IS THE PHRASE THE READER TYPED, and that was chosen with the
 * cost on the table. The alternatives were an opaque token the worker issues,
 * which buys revocation at the price of a new route and a KV write per unlock,
 * and caching the unlocked HTML, which is strictly worse on two counts — it
 * goes stale the moment the draft is edited and it puts the whole paid text in
 * the browser instead of the key to it. The phrase is the smallest thing that
 * works. It sits in plain text on the reader's own device, readable by anyone
 * with that browser, which is the same exposure a saved password in the browser
 * already has and is the reader's own to accept.
 *
 * IT IS A CONVENIENCE AND NOT A CREDENTIAL, and lock.js treats it that way.
 * Nothing here decides whether a book opens — the phrase is replayed against
 * the worker exactly as if the reader had typed it, and the worker's rate limit
 * and its BOOK_PASSWORDS secret are still the whole of the security boundary. A
 * stored phrase that has since been changed simply fails, and forget() drops it
 * so the reader is asked once rather than on every load forever.
 *
 * THE STORED SHAPE, VERSIONED FROM v1 FOR THE REASON reads.js GIVES:
 *
 *     {"v": 1, "books": {"<draft-slug>": {"p": "<phrase>", "t": 1758...}}}
 *
 * Keyed by the DRAFT SLUG, which is what the published post's `<content>`
 * pointer names and what the worker's /lock route takes. The published post's
 * own path is NOT the key: two posts could point at one draft, and a reader who
 * unlocked it from one should not be asked again on the other.
 *
 * `t` is the time the phrase was last confirmed to work, and it is here for the
 * same reason reads.js carries one — it is the field a merge needs and there is
 * no second source for it. Newest wins on merge, not first: unlike a read
 * receipt, which is a fact about a moment and never changes, a phrase is a
 * fact about a book that the author can change, so the most recent confirmed
 * one is the one more likely to still work.
 *
 * NO CAP. A site has a handful of books, not a history of every post read, so
 * the quota arithmetic reads.js has to do does not arise. If a write is refused
 * it is swallowed and the reader types the phrase again next time, which is
 * exactly the behaviour before this file existed.
 *
 * DEGRADATION. In a private window, or with site data blocked, the
 * localStorage ACCESSOR ITSELF throws — reading window.localStorage, not just
 * calling a method on it — so every touch is wrapped both ways, as reads.js and
 * view.js wrap theirs. A refused read means no book is remembered and the gate
 * behaves precisely as it did before. Nothing here may throw: lock.js imports
 * it and one failed module import kills every script on the page.
 */

const STORAGE_KEY = "qntns:unlocked";
const VERSION = 1;

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
    if (!parsed || typeof parsed !== "object") return map;

    const books = parsed.books;
    if (!books || typeof books !== "object" || Array.isArray(books)) return map;

    Object.keys(books).forEach((slug) => {
        const entry = books[slug];
        if (!slug || !entry || typeof entry !== "object") return;
        const phrase = typeof entry.p === "string" ? entry.p : "";
        if (!phrase) return;
        map.set(slug, { p: phrase, t: Number(entry.t) || 0 });
    });
    return map;
};

const books = load();

const write = () => {
    const out = {};
    books.forEach((entry, slug) => { out[slug] = entry; });
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: VERSION, books: out }));
    } catch {
        /* Swallowed on purpose — see NO CAP above. The reader types it again
           next time, which is the behaviour this file is an improvement on. */
    }
};

/* The phrase this device has for a draft, or "" for none. Callers test it as a
   string and never as a promise: this is a synchronous memory read, because
   lock.js needs the answer before it decides whether to build a gate at all. */
export const savedPhrase = (slug) => (slug && books.get(slug)?.p) || "";

/* Called only after the worker has CONFIRMED the phrase, never on what the
   reader typed. A wrong phrase must not be written and then replayed on every
   later load to earn a rate-limit strike the reader did not ask for. */
export const rememberPhrase = (slug, phrase) => {
    if (!slug || typeof phrase !== "string" || !phrase) return;
    books.set(slug, { p: phrase, t: Date.now() });
    write();
};

/* Called when a stored phrase is refused — the author changed it, or the book
   was retired. Dropping it is what stops a stale phrase being replayed forever
   against a rate limit that is counting. */
export const forgetPhrase = (slug) => {
    if (!slug || !books.has(slug)) return;
    books.delete(slug);
    write();
};

/* For the sync half. Same contract as reads.js's readEntries: the set as the
   worker's payload wants it, built fresh so a caller cannot hold the map. */
export const unlockedEntries = () => {
    const out = {};
    books.forEach((entry, slug) => { out[slug] = { p: entry.p, t: entry.t }; });
    return out;
};

/*
 * NEWEST WINS, AND THAT IS THE ONE PLACE THIS DIFFERS FROM reads.js.
 * A read receipt is a fact about a moment: the FIRST time a post was read is
 * the true one and a later claim is a duplicate, so the worker merges reads
 * first-wins. A phrase is a fact about a book that the author can change, so
 * the newer of two confirmed phrases is the one more likely to still open it.
 * Returns the count of entries this device did not already have, so a caller
 * can tell whether anything is worth acting on without diffing the map itself.
 */
export const mergePhrases = (remote) => {
    if (!remote || typeof remote !== "object") return 0;
    let added = 0;
    Object.keys(remote).forEach((slug) => {
        const entry = remote[slug];
        if (!slug || !entry || typeof entry !== "object") return;
        const phrase = typeof entry.p === "string" ? entry.p : "";
        if (!phrase) return;
        const time = Number(entry.t) || 0;
        const mine = books.get(slug);
        if (mine && mine.t >= time) return;
        if (!mine || mine.p !== phrase) added += 1;
        books.set(slug, { p: phrase, t: time });
    });
    if (added) write();
    return added;
};
