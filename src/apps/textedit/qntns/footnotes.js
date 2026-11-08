import { playClick } from "./sound.js";
import { openLinksInNewTab } from "./links.js";

/*
 * QNTNs footnotes — square brackets in the body, numbered marks in the text,
 * a popover on press, and a list at the foot of the page.
 *
 * THE SYNTAX IS NOT STANDARD MARKDOWN, AND THAT IS A DELIBERATE TRADE.
 * The de-facto standard — PHP Markdown Extra, and the CommonMark extension
 * every static-site generator copied from it — is a two-part reference:
 *
 *     Some claim.[^why]
 *
 *     [^why]: Because of this, see <https://example.com>.
 *
 * That syntax is not available here, for a reason that has nothing to do with
 * taste: Ghost's editor is Koenig, and a Koenig paragraph is not markdown. It
 * is a rich-text document that is serialised straight to HTML. Nothing ever
 * runs a markdown parser over it, so `[^why]` would reach the page as the four
 * literal characters `[^why]` and the definition at the bottom would reach it
 * as a literal paragraph. Ghost does ship a markdown CARD, but its parser does
 * not implement the footnote extension either, and putting a whole post in one
 * markdown card would give up every other Koenig card in the theme.
 *
 * So the syntax is the writer's own: ONE pair of square brackets, inline,
 * holding the note itself.
 *
 *     Some claim.[Because of this — see the paper.]
 *
 * The bracket is replaced in place by a numbered mark, and the contents are
 * moved to the foot of the page. Numbering is by document order and nothing
 * else, so moving a sentence renumbers everything automatically and there is
 * no label to keep in sync.
 *
 * WHAT THIS SYNTAX COSTS, stated plainly because it is the part worth arguing
 * about:
 *
 *   - `[` and `]` are no longer ordinary characters in body text. A writer who
 *     wants a literal bracket has to escape it as `\[`. Handled below, but it
 *     is a rule a writer has to know.
 *   - It collides with markdown link syntax by SHAPE, though not in practice
 *     here — see the `(` guard in `scan` for why the guard exists anyway.
 *   - With JavaScript off the reader sees the note inline, in brackets, where
 *     it was typed. That is the honest degradation and it is not a good one;
 *     see the note in the theme's docs. Nothing is lost, but nothing is
 *     numbered either.
 *
 * WHY THE SCAN IS A CHARACTER LOOP AND NOT A REGULAR EXPRESSION.
 * The note is allowed to contain links, so the bracket spans element
 * boundaries: `[see <a href="…">the paper</a>]` is a text node, an element and
 * another text node. A regex over innerHTML would be the short way to catch
 * that, and it would also match a `[` inside an href or a title attribute,
 * because a regex cannot tell text from markup. The loop below skips anything
 * between `<` and `>` wholesale, so attributes are invisible to it and the
 * only brackets it can ever see are brackets a reader can see.
 */

const BODY = ".qntns-content__body";

/* Blocks whose text is not prose and where a bracket means what it says: a
   footnote inside a code sample would be a bug in every case. This is the
   BLOCK-level guard — a whole <pre> is skipped by the walk and never reaches
   the scanner.

   An INLINE <code> inside an ordinary paragraph is a different problem and the
   scanner handles it separately, because by then the code span is just part of
   the paragraph's HTML. See `literal` in `scan`. */
const LITERAL = "pre, code, kbd, samp";

/* The inline spans the scanner must not read brackets inside. Same set as
   LITERAL minus <pre>, which can never be inline. */
const LITERAL_TAGS = new Set(["code", "kbd", "samp"]);

/* Split one element's HTML into the text that stays and the notes that leave.
   Returns null when the element holds no footnote, so the caller can leave its
   innerHTML alone rather than rewriting it to an identical string.

   The scanner is tag-aware in exactly one way: `<` puts it inside a tag and
   `>` takes it out, and while it is inside a tag every character is copied
   through untouched. That single rule is what makes attributes safe.

   `depth` allows a bracket inside a note — `[a note [with an aside] in it]` —
   to close the inner pair rather than the outer one. Cheap to support and it
   removes a whole class of "why did my note stop early" report. */
const scan = (html, notes) => {
    let out = "";
    let buf = "";
    let depth = 0;
    let inTag = false;
    let literal = 0;
    let changed = false;

    for (let i = 0; i < html.length; i += 1) {
        const ch = html[i];
        const sink = () => (depth > 0 ? (buf += ch) : (out += ch));

        if (inTag) {
            if (ch === ">") inTag = false;
            sink();
            continue;
        }
        if (ch === "<") {
            /* ENTERING OR LEAVING AN INLINE CODE SPAN. The block-level guard
               above cannot see this one: `<p>an array, <code>[1, 2, 3]</code>`
               is an ordinary paragraph and reaches the scanner whole, so the
               `[1, 2, 3]` has to be recognised as literal HERE or it silently
               becomes footnote 1. `literal` is a counter rather than a flag
               because these nest in principle and a flag would come back on
               one `</code>` too early. */
            const tag = /^<(\/?)([a-z]+)/i.exec(html.slice(i, i + 12));
            if (tag && LITERAL_TAGS.has(tag[2].toLowerCase())) {
                if (tag[1]) literal = Math.max(0, literal - 1);
                else literal += 1;
            }
            inTag = true;
            sink();
            continue;
        }

        if (literal > 0) {
            sink();
            continue;
        }

        /* THE ESCAPE IS A BACKSLASH AND IT IS CONSUMED. `\[` writes a literal
           `[` and the backslash does not survive into the page — an escape the
           reader can see is not an escape. */
        if (ch === "\\" && (html[i + 1] === "[" || html[i + 1] === "]")) {
            i += 1;
            if (depth > 0) buf += html[i];
            else out += html[i];
            /* The block has to be rewritten even if it turns out to hold no
               footnote at all, because the backslash has just been dropped.
               Returning null here — as an earlier version did — left the
               escape visible in the page, which is the one outcome an escape
               must never have. */
            changed = true;
            continue;
        }

        if (ch === "[") {
            /* A `[` IMMEDIATELY FOLLOWED BY A `(` AFTER ITS CLOSE is markdown
               link syntax, and this leaves it alone. Koenig never emits that
               shape — it emits a real <a> — so this guard should never fire on
               a Ghost post. It exists for the paste case: a writer moving a
               post in from a markdown file can land `[text](url)` in the body
               as plain text, and silently eating the label into a footnote
               would be the worst possible way to find that out. */
            const close = html.indexOf("]", i + 1);
            if (depth === 0 && close !== -1 && html[close + 1] === "(") {
                out += ch;
                continue;
            }
            depth += 1;
            if (depth === 1) continue;   // the outer bracket itself is dropped
            buf += ch;
            continue;
        }

        if (ch === "]" && depth > 0) {
            depth -= 1;
            if (depth === 0) {
                notes.push(buf.trim());
                out += mark(notes.length);
                buf = "";
                changed = true;
                continue;
            }
            buf += ch;
            continue;
        }

        sink();
    }

    /* AN UNCLOSED BRACKET IS PUT BACK, NOT SWALLOWED. Everything captured
       since the last unmatched `[` is returned to the text with its bracket,
       so a typo costs the writer a visible stray bracket rather than a
       silently vanished paragraph. */
    if (depth > 0) out += "[".repeat(depth) + buf;

    return changed ? out : null;
};

/* THE MARK IS A BUTTON, NOT A LINK, and that is the whole accessibility
   argument for this feature. An <a href="#fn-3"> promises navigation: a screen
   reader announces "link", and following it moves the reader to the foot of
   the page and leaves them there. This does not navigate — it opens a
   transient panel over the sentence you are already reading and returns you to
   it — and <button> is the element that means that. The visible label keeps
   the brackets because a bare superscript numeral is indistinguishable from a
   footnote in the SOURCE the writer is quoting; `[3]` is unambiguous.

   aria-label carries the word "Footnote" so the mark is not announced as the
   single character "3". */
const mark = (n) => `<button type="button" class="qntns-fn-mark" data-fn-mark="${n}" aria-label="Footnote ${n}">[${n}]</button>`;

/* A NOTE CAN BE SEVERAL PARAGRAPHS, AND A WRITER TYPES THEM AS BLANK LINES.
   -----------------------------------------------------------------------
   The temptation is to let the writer put <p> tags inside the bracket. That
   cannot work, and the reason is the HTML parser rather than anything here: a
   <p> inside a <p> is not nesting, it is an implicit close, so the browser
   would tear the paragraph in half before this file ever saw it. Koenig would
   never emit that shape either — there is no way to put a block inside a
   paragraph in the editor.

   What a writer CAN type is a soft return, twice: shift+enter, shift+enter.
   Koenig serialises those as `<br><br>`, inside the one paragraph, which is
   exactly the "blank line means new paragraph" convention every writing tool
   already uses. So that is the break, and the note is split on it here.

   Two or more <br> in a row, because a writer leaning on the key produces
   three as easily as two and meaning something different by it would be a
   trap. A SINGLE <br> is left alone and stays a line break, which is what
   makes a short address or a line of verse inside a note still possible. */
const paragraphs = (note) => `<p>${note.split(/(?:\s*<br\s*\/?>\s*){2,}/i).join("</p><p>")}</p>`;

/* THE LIST AT THE FOOT IS AN <ol> AND ITS NUMBERS ARE ITS OWN.
   Nothing writes "1." into the markup: the list is ordered, so the browser
   numbers it, and a reader using a screen reader is told how many notes there
   are before the first one. The rule above it is decorative and hidden.

   NO BACK-LINK FROM THE NOTE TO THE MARK, and this is the one place the
   footnote convention is deliberately not followed. A back-link is what a
   printed-style footnote needs because reaching the note MEANS leaving the
   sentence. Here it does not: the popover is the way a reader reads a note,
   and it never moves them, so the return trip the back-link exists to solve
   does not happen. The list at the foot is the with-JavaScript-off fallback
   and the printable copy of the notes, not the primary path — and adding a
   caret to every line to serve a trip nobody takes is noise in the margin.
   If the popover is ever dropped, this decision comes back. */
const renderList = (notes) => `
    <div class="qntns-fn" role="doc-endnotes">
        <hr class="qntns-fn__rule" aria-hidden="true">
        <ol class="qntns-fn__list">
            ${notes.map((note, i) => `
                <li class="qntns-fn__item" id="qntns-fn-${i + 1}">${paragraphs(note)}</li>
            `).join("")}
        </ol>
    </div>
`;

/* The popover is ONE element for the whole page, not one per note. There is
   never more than a single note open, so a second panel would be a second
   thing to keep in sync for no gain. The scrim is the same object as the
   comments drawer's — same ink, same 0.45 — because it is the same statement:
   the page behind is still there and still legible.

   role="dialog" + aria-modal, and the close button is the only focusable thing
   inside it, so the tab order collapses to "close" while it is open without
   needing a focus trap. */
/* THE PANEL DOES NOT SCROLL — THE BODY INSIDE IT DOES, and that split is
   load-bearing rather than tidy. The close button is positioned absolutely,
   and an absolutely positioned child of a SCROLLING ancestor scrolls with the
   content: put the overflow on the panel and the X travels up out of the box
   on the first flick of a long note. The panel is therefore a fixed frame
   holding two things that stay put (the X, the fade) and one that moves.

   THE FADE IS aria-hidden AND pointer-events: none. It is a gradient over the
   text, so it must not intercept a press meant for a link in the note, and it
   must not be announced as anything.

   THE BODY IS tabindex="0" BECAUSE ITS SCROLLBAR IS HIDDEN. A scroll container
   with no visible scrollbar and no place in the tab order is unreachable
   without a mouse wheel — arrow keys only scroll the focused element. Putting
   it in the tab order is what gives a keyboard reader a way to reach the
   bottom of a long note, and it is why it is focused on open rather than the
   panel: focus is inside the dialog either way, but only this way can the
   reader move. */
const renderPopover = () => `
    <div class="qntns-fn-pop" data-fn-pop hidden>
        <div class="qntns-fn-pop__scrim" data-fn-close></div>
        <div class="qntns-fn-pop__panel" role="dialog" aria-modal="true" aria-label="Footnote">
            <button type="button" class="qntns-fn-pop__close" data-fn-close aria-label="Close footnote">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
            <div class="qntns-fn-pop__body" data-fn-body tabindex="0"></div>
            <div class="qntns-fn-pop__fade" data-fn-fade aria-hidden="true"></div>
        </div>
    </div>
`;

export const attachFootnotes = (root) => {
    const body = root.querySelector(BODY);
    if (!body) return () => {};

    const notes = [];

    /* THE WALK IS OVER BLOCKS, NOT OVER THE WHOLE BODY AT ONCE.
       Rewriting body.innerHTML in one pass would work and would also throw
       away every Koenig card's internal state and any element identity the
       later attach* passes rely on. Per-block keeps the blast radius to the
       paragraph that actually contained a bracket.

       Document order is what numbers the notes, and querySelectorAll returns
       document order, so the sequence falls out of the walk with nothing to
       sort. */
    const blocks = body.querySelectorAll("p, li, blockquote, figcaption, h1, h2, h3, h4, h5, h6");
    blocks.forEach((block) => {
        if (block.closest(LITERAL)) return;
        // A note lives in a <p>; a <p> inside a <li> would otherwise be walked
        // twice, once as itself and once as part of its parent.
        if (block.querySelector("p, li, blockquote")) return;
        const rewritten = scan(block.innerHTML, notes);
        if (rewritten !== null) block.innerHTML = rewritten;
    });

    if (!notes.length) return () => {};

    body.insertAdjacentHTML("beforeend", renderList(notes));

    /* THE POPOVER GOES INSIDE `root`, NOT ON document.body. Two reasons, and
       the second is the one that matters. First: the single click listener on
       `root` then already hears the panel's own buttons, so there is no second
       listener and no question about which of two fires first. Second: this
       function returns a teardown, and a teardown that reaches outside the
       root it was given cannot be trusted — Storybook mounts and unmounts the
       same story repeatedly, and a panel parked on document.body would
       accumulate one copy per mount with only the newest one wired up.

       Every custom property the panel uses is declared on :root, so being
       outside .qntns-content costs it nothing. --color-meta and
       --content-measure ARE scoped to .qntns-content, which is why the panel
       uses neither.

       position: fixed still means the viewport here, because nothing between
       this element and the document root carries a transform, filter or
       will-change. If a page-level transform is ever added, this breaks and
       the panel starts positioning against it.

       `root` IS NOT ALWAYS AN ELEMENT, AND insertAdjacentHTML IS AN ELEMENT
       METHOD. The entry points call attachContent(document); the story calls
       it with canvasElement. Document inherits from Node, not from Element, so
       document.insertAdjacentHTML is undefined and this line threw — killing
       attachContent and, with it, every attach* call below it in content.js.
       It only ever fired on a post that HAD a footnote, because the `notes`
       check above returns first on one that does not, which is why the site
       ran fine until the first note shipped.

       document.body is inside `root` either way, so both arguments above
       survive: the click listener still sits on `root` and hears the panel,
       and the teardown still cannot reach outside what it was given.
       querySelector and addEventListener are Node/Document methods and need
       no such treatment, which is why this is the only line that changes. */
    const host = root.body ?? root;
    host.insertAdjacentHTML("beforeend", renderPopover());

    const pop = root.querySelector("[data-fn-pop]");
    const slot = pop.querySelector("[data-fn-body]");
    const fade = pop.querySelector("[data-fn-fade]");
    let opener = null;

    /* THE FADE IS ONLY ON WHILE THERE IS SOMETHING LEFT TO SEE. A gradient
       that never turns off sits permanently over the LAST line of the note,
       which is the one line a reader who scrolled to the bottom is trying to
       read. There is no CSS that knows "this element is scrolled to its end",
       so this is the smallest amount of JavaScript that answers it.

       The 2px of slack absorbs sub-pixel scroll heights on fractional-DPI
       displays, where scrollTop + clientHeight lands a hair short of
       scrollHeight and the fade would never quite clear. */
    const syncFade = () => {
        const more = slot.scrollTop + slot.clientHeight < slot.scrollHeight - 2;
        fade.hidden = !more;
    };

    const open = (n, trigger) => {
        slot.innerHTML = paragraphs(notes[n - 1] ?? "");
        /* The popover lives outside .qntns-content__body, so the pass
           content.js runs over the body never reaches it. The note's links get
           the same treatment here, at the point they are put into the DOM. */
        openLinksInNewTab(slot);
        opener = trigger ?? null;
        pop.hidden = false;
        // Reset before measuring: the slot keeps the scroll position of the
        // previous note otherwise, so a short note opened after a long one
        // shows blank space.
        slot.scrollTop = 0;
        syncFade();
        slot.focus();
    };

    // `sound` is false when the X closes it: the X is a <button>, so the
    // page's attachClickSound (content.js) already clicked for it. The scrim
    // is a <div> and Escape is a key, so those two still need this one.
    const close = (sound = true) => {
        if (pop.hidden) return;
        if (sound) playClick();
        pop.hidden = true;
        slot.innerHTML = "";
        // Back to the mark that opened it, so a keyboard reader is returned to
        // the sentence rather than to the top of the post.
        opener?.focus();
        opener = null;
    };

    const onClick = (event) => {
        const trigger = event.target.closest?.("[data-fn-mark]");
        if (trigger && root.contains(trigger)) {
            open(Number(trigger.dataset.fnMark), trigger);
            return;
        }
        // The scrim covers everything the panel does not, so testing it is the
        // same as testing every point outside the panel. The X carries the
        // same hook, which is why one check answers both dismissals.
        const hit = event.target.closest?.("[data-fn-close]");
        if (hit) close(!hit.matches("button"));
    };

    const onKey = (event) => {
        if (event.key === "Escape") close();
    };

    root.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    slot.addEventListener("scroll", syncFade, { passive: true });
    // A note whose length is close to the cap can cross the threshold when the
    // window resizes, so the fade is re-checked there too.
    window.addEventListener("resize", syncFade);

    return () => {
        root.removeEventListener("click", onClick);
        document.removeEventListener("keydown", onKey);
        window.removeEventListener("resize", syncFade);
        pop.remove();
    };
};

/* Exported for the stories and for anyone testing the parser without a DOM.
   The scanner is the only part of this file with a decision in it. */
export const __scan = (html) => {
    const notes = [];
    const out = scan(html, notes);
    return { html: out ?? html, notes };
};
