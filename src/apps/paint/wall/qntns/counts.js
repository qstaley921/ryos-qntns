/*
 * QNTNs views and likes — the Worker client (CHECKLIST-26 §9, §10).
 * ===========================================================================
 * The three calls worker/src/counts.js answers, and nothing else:
 *
 *   bumpView(slug)          POST /views/<slug>     reads.js, a FIRST read only
 *   getCounts(slugs)        GET  /counts?slugs=…   the post page and home
 *   setLike(slug, liked)    POST /likes/<slug>     the post page, signed in
 *
 * sync.js's five rules hold here unchanged: never block paint, never throw,
 * never hang (AbortSignal.timeout), never show the reader anything, and a
 * failure is a null return the caller treats as "no counts" — a "-" figure.
 *
 * sync.js IS IMPORTED LAZILY, and on purpose: reads.js imports this file, and
 * sync.js imports reads.js, so a static import would close a cycle sync.js's
 * own header promises never exists. The origin and the member token are
 * sync.js's, reused rather than copied.
 */

const TIMEOUT_MS = 8000;
// The Worker's slug rule (worker/src/counts.js SLUG). One bad slug must not
// cost a whole /counts batch its answer, so they are dropped before sending.
const SLUG = /^[a-z0-9][a-z0-9-]{0,190}$/;
const BATCH = 100;

// A Ghost post URL is /<slug>/ — the last path segment. null when it is not a slug.
export const slugOf = (url) => {
    try {
        const slug = new URL(url, "https://x.invalid").pathname.split("/").filter(Boolean).pop();
        return SLUG.test(slug || "") ? slug : null;
    } catch {
        return null;
    }
};

const call = async (path, { method = "GET", token = null, body } = {}) => {
    try {
        const { SYNC_BASE } = await import("./sync.js");
        const headers = {};
        if (token) headers.Authorization = `Bearer ${token}`;
        if (body) headers["Content-Type"] = "application/json";
        const res = await fetch(`${SYNC_BASE}${path}`, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(TIMEOUT_MS)
        });
        return res.ok ? await res.json() : null;
    } catch {
        return null;
    }
};

// The signed-in reader's Ghost member token, or null. Never throws.
export const memberToken = async () => {
    try {
        const { getToken } = await import("./sync.js");
        return await getToken();
    } catch {
        return null;
    }
};

export const bumpView = (slug) => (SLUG.test(slug || "") ? call(`/views/${slug}`, { method: "POST" }) : Promise.resolve(null));

// { slug: { views, likes, liked? } } for every batch that answered; null when none did.
export const getCounts = async (slugs, token = null) => {
    const list = [...new Set(slugs)].filter((s) => SLUG.test(s || ""));
    const batches = [];
    for (let i = 0; i < list.length; i += BATCH) batches.push(list.slice(i, i + BATCH));
    const answers = await Promise.all(batches.map((b) => call(`/counts?slugs=${b.join(",")}`, { token })));
    const ok = answers.filter((a) => a && typeof a === "object");
    return ok.length ? Object.assign({}, ...ok) : null;
};

// An idempotent SET, not a toggle (the Worker's contract). { views, likes, liked } or null.
export const setLike = (slug, liked, token) =>
    SLUG.test(slug || "") && token ? call(`/likes/${slug}`, { method: "POST", token, body: { liked } }) : Promise.resolve(null);
