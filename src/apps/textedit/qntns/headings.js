/*
 * QNTNs heading demotion.
 *
 * The page's <h1> is the post title, so every heading the author typed in the
 * body moves down one level: their <h2> becomes the <h3> it actually is in the
 * document's outline. Ghost's editor offers h2, h3 and h4 and cannot be talked
 * out of starting at h2.
 *
 * IT LIVES IN ITS OWN FILE BECAUSE TWO CALLERS NEED IT AND ONE OF THEM IS NOT
 * A PAGE. content.js demotes the body on load; lock.js demotes the fragment the
 * worker hands back when a book unlocks, BEFORE putting it in the document —
 * that HTML is the author's raw draft and has never been through this pass,
 * while everything already on the page has. Importing content.js from lock.js
 * to reach it would be a cycle, since content.js imports lock.js.
 *
 * IT IS NOT IDEMPOTENT AND MUST NOT BE MADE SO. Running it twice over the same
 * nodes demotes them twice, which is exactly why the unlocked fragment is
 * demoted while it is still detached rather than by re-running the pass over a
 * body that already holds demoted headings.
 *
 * TOP-DOWN — 3, then 2, then 1 — so a heading promoted into a level is not
 * picked up again by the same loop on the next pass. Attributes are carried
 * over because toc.js has already put ids on nothing at this point, but a
 * reader may have typed one and the ToC's links depend on it.
 */
export const demoteHeadings = (container) => {
    if (!container) return;
    for (const from of [3, 2, 1]) {
        container.querySelectorAll(`h${from}`).forEach((heading) => {
            const replacement = document.createElement(`h${from + 1}`);
            for (const { name, value } of heading.attributes) {
                replacement.setAttribute(name, value);
            }
            replacement.innerHTML = heading.innerHTML;
            heading.replaceWith(replacement);
        });
    }
};
