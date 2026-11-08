/*
 * QNTNs toast — the one thing that tells a buyer the money went somewhere.
 *
 * CHECKLIST-15 §67. The user, after placing the first real book order: "It just
 * took me back to the page with no apparent success ... we need a toast icon
 * pop up alerting them that their order has been placed and they should check
 * their email, also adding this to post card and fund purchase orders."
 *
 * ONE COMPONENT, THREE PARAMS. All three checkout paths already flag themselves
 * on the way back from Stripe and until now NOTHING read any of them for the
 * reader's benefit:
 *
 *     ?ordered=1   worker/src/book.js:271      a book, returned to its own post
 *     ?posted=1    worker/src/postcard.js:597  a postcard, returned to the root
 *     ?funded=1    worker/src/fund.js:453      a funding day, returned to the root
 *
 * Only the wording differs. Building three notices — one per path, each in the
 * file that owns that path — was considered and rejected: they would be three
 * boxes that have to look identical, in three files that never change at the
 * same time, and the first divergence would be invisible until a buyer saw it.
 *
 * WHY THE SEARCH STRING IS SNAPSHOT AT MODULE SCOPE AND NOT READ IN THE CALL.
 * THIS IS THE LOAD-BEARING LINE IN THE FILE. Two other modules already read
 * these same params live off `location`:
 *
 *     postcard.js:3742  clearPostedDrafts()  reads ?posted to bin the drafts
 *     fund.js:2935      showThanks()         reads ?funded, sets data-funded
 *                                            on the section, then STRIPS IT
 *
 * So whichever of us runs first decides what the others see, and there is no
 * call order that works: strip before fund.js and the funded section never
 * learns it was paid for; run after it and the param is already gone and the
 * buyer gets no toast. Reading `location.search` ONCE, here, at module
 * evaluation, removes the ordering question entirely — every `import` in an
 * entry point is evaluated before that entry point's first statement, so this
 * constant is taken before clearPostedDrafts, before attachFund, and before
 * anything else on the page has had a chance to rewrite the URL. attachToast
 * may then be called anywhere in the list, early or last, and reads the same
 * three answers. It is called LAST in both entry points for an unrelated
 * reason: it paints, and painting comes after the page exists.
 *
 * STRIPPING IS NOT OPTIONAL. Without it a reload — or a link the buyer shares
 * because they are pleased — congratulates somebody on an order they never
 * placed. replaceState rather than pushState, matching fund.js:2958: this is
 * not a place in history worth a back button.
 *
 * IT DOES NOT TIME OUT, AND IT IS DISMISSED ONLY ON PURPOSE. The user, having
 * seen the stories: "toasts are persistent". A toast that fades after four
 * seconds is right for "copied" and wrong for the only confirmation a buyer
 * will ever get that their money moved — they may have looked away, or be on a
 * phone that woke the page late. So: no timeout, and no dismissal on anything
 * the reader happens to do elsewhere on the page. TWO WAYS OUT, one per input
 * device — the x for a pointer, Escape for a keyboard. The cost is a box
 * sitting over the footer bar until someone closes it, and that is the cheap
 * half of the trade.
 *
 * NOTHING HERE FETCHES ANYTHING. The Worker already sent the email by the time
 * Stripe redirected; the toast's whole claim is "Stripe finished", which the
 * param is proof of. A confirmation that had to call home would be a spinner on
 * the happy path and a lie on a flaky one.
 */
import { icon } from "../icon-set.js";

/* See the long note above: taken once, at import, before any other module has
   had the chance to delete one of these. Wrapped because a document with no
   `location` (a test harness, an oddly-built iframe) must not take the whole
   module graph down with it — one failed import kills every script on the
   page in this theme. */
const RETURN_PARAMS = (() => {
    try {
        return new URLSearchParams(window.location.search);
    } catch {
        return new URLSearchParams("");
    }
})();

/*
 * THE WORDING, PER PARAM, AND IT IS THE ONLY THING THAT DIFFERS.
 *
 * Each one names WHAT WAS BOUGHT in the heading — the user's word was
 * "alerting them that their order has been placed" and an order nobody can
 * name is not much of a reassurance — and sends them to their email in the
 * line under it, because the receipt and everything that follows lives there
 * and not on this page.
 *
 * The order of the keys is the order they are tested in, which only matters in
 * the impossible case of two flags at once; the book wins because it is the
 * only one that returns to a page of its own.
 */
const MESSAGES = {
    ordered: {
        title: "Your book order is placed.",
        body: "Check your email — the receipt is there, and a note when it ships."
    },
    posted: {
        title: "Your postcard is paid for.",
        body: "Check your email for the receipt. It goes to the printer next."
    },
    funded: {
        title: "Thank you — your day is funded.",
        body: "Check your email for the receipt."
    }
};

/*
 * THE BOX ITSELF, taking its wording as an argument so the story can render
 * one without a URL to return from. Returns its own dismiss function; the
 * caller does not have to know what was appended where.
 *
 * role="status" and aria-live="polite", NOT role="alert". Nothing has gone
 * wrong and the reader is not being interrupted — polite queues the
 * announcement behind whatever the screen reader is already saying, which is
 * the correct rudeness for good news.
 */
/* §28c: `action: { label, icon?, onClick }` puts a labelled button where the x
   is, and the toast stays (no Escape) until that button or the returned
   dismiss. Every other caller is as before. */
export const showToast = (root, { title, body, icon: name = "mail", action = null }) => {
    const host = (root && root.body) || root || document.body;

    const el = document.createElement("div");
    el.className = "qntns-toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.innerHTML = `
        <span class="qntns-toast__icon">${icon(name, { size: 20, className: "icon" })}</span>
        <span class="qntns-toast__text">
            <strong class="qntns-toast__title"></strong>
            <span class="qntns-toast__body"></span>
        </span>
        ${Array.isArray(action)
            ? action.map((a) => `<button class="qntns-toast__close" type="button">${icon(a.icon, { size: 16, className: "icon" })}</button>`).join("")
            : action
            ? `<button class="qntns-toast__close qntns-toast__action" type="button">${action.icon ? icon(action.icon, { size: 16, className: "icon" }) : ""}<span></span></button>`
            : `<button class="qntns-toast__close" type="button" aria-label="Dismiss">${icon("x", { size: 16, className: "icon" })}</button>`}
    `;
    if (action && !Array.isArray(action)) el.querySelector(".qntns-toast__action span").textContent = action.label;
    /* textContent, NOT the template above. The wording is ours today, but a
       heading that is ever built from anything a buyer typed — a book title, a
       recipient's name — must not be able to carry markup into the page. */
    el.querySelector(".qntns-toast__title").textContent = title;
    // §21b: no empty second line.
    const bodyEl = el.querySelector(".qntns-toast__body");
    if (body) bodyEl.textContent = body; else bodyEl.remove();

    let gone = false;
    const dismiss = () => {
        if (gone) return;
        gone = true;
        document.removeEventListener("keydown", onKey);
        // §21b: glide out, then go. Reduced motion runs it in 1ms (toast.css).
        el.addEventListener("animationend", (e) => {
            if (e.animationName === "qntns-toast-out") el.remove();
        });
        el.classList.add("qntns-toast--out");
    };
    const onKey = (event) => {
        if (event.key === "Escape") dismiss();
    };

    /*
     * TWO ROUTES OUT, AND THEY ARE THE SAME ROUTE FOR TWO DEVICES. The x is
     * the POINTER's dismissal and Escape is the KEYBOARD's; neither is a
     * shortcut for power users and neither is redundant. A reader who never
     * touches the mouse should not have to hunt for a 32px target to put away
     * a box that is already covering the bar, and a reader with a trackpad
     * should not have to know a key.
     *
     * The x is a real <button> in the document rather than a styled <span>, so
     * Tab reaches it and Enter and Space activate it with no code of ours; its
     * focus ring is styled in toast.css. The Escape listener is on the
     * document, not the toast, because nothing here takes focus on appearing —
     * this is not a modal, it traps nothing — so there would be no element for
     * the key to arrive at.
     *
     * THE LISTENER IS REMOVED IN dismiss(), not left to the toast's removal.
     * A detached node stops receiving events; a listener on the document does
     * not, and one left behind would keep a reference to the whole closure
     * alive for the life of the page.
     */
    /* §43: `action` may be an array — one icon-only 32px block each, its
       label the aria-label (the lasso's Check and Trash). */
    el.querySelectorAll(".qntns-toast__close").forEach((b, i) => {
        const a = Array.isArray(action) ? action[i] : action;
        if (Array.isArray(action)) b.setAttribute("aria-label", a.label);
        b.addEventListener("click", a ? () => { dismiss(); a.onClick?.(); } : dismiss);
    });
    if (!action) document.addEventListener("keydown", onKey);
    host.appendChild(el);

    return dismiss;
};

/*
 * THE PAGE ENTRY. Reads the snapshot, shows at most one toast, strips the flag.
 *
 * THE STRIP HAPPENS ONCE THE TOAST IS UP, not before it — if appending were
 * ever to throw, the URL still carries the flag and the next load gets another
 * chance to say so. Money having moved is worth an ugly URL.
 *
 * Wrapped whole and silent, like every other optional thing in this theme: a
 * page that cannot show its confirmation is a page missing a confirmation, not
 * a page with no footer, no cards and no sound.
 */
export const attachToast = (root = document) => {
    try {
        const key = Object.keys(MESSAGES).find((name) => RETURN_PARAMS.get(name) === "1");
        if (!key) return () => {};

        const dismiss = showToast(root, MESSAGES[key]);

        try {
            /* The LIVE params, not the snapshot — fund.js may already have
               removed its own flag from the bar and rewriting from a stale copy
               would put it back. Only our key is deleted; anything else the URL
               carries (a Ghost `?ref=`, a fragment) survives untouched. */
            const live = new URLSearchParams(window.location.search);
            live.delete(key);
            const query = live.toString();
            window.history.replaceState(
                null,
                "",
                `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`
            );
        } catch {
            // A browser that refuses replaceState keeps the param. Harmless
            // until a reload, which is the cost fund.js:2960 already accepts.
        }

        return dismiss;
    } catch {
        return () => {};
    }
};

/* The bare link icon (CHECKLIST-33 §7): copy a URL, say so. Silent without a clipboard. */
export const copyLink = async (url) => {
    try {
        await navigator.clipboard.writeText(url);
        showToast(document, { title: "Link copied", body: url, icon: "link" });
    } catch { /* no clipboard */ }
};
