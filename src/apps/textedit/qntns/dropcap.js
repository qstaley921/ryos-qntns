/*
 * QNTNs drop caps — |T| sets that letter as a drop cap and the pipes vanish.
 *
 * WHY A SECOND WAY TO DO THIS. The `#dropcap` tag already sets the first
 * letter of a post, and it is the right control for "this post opens with a
 * drop cap": it is a decision about the whole post and it belongs on the post.
 * What it cannot do is choose a different letter, or set one anywhere except
 * the very beginning — a section opening halfway down a long piece, the first
 * letter after a divider, the start of a new chapter. That is what this is
 * for. The two do not conflict; a post can use either, both, or neither.
 *
 * WHY PIPES. The bracket is taken — assets/js/qntns/footnotes.js owns `[` and
 * `]` — and the pipe is close to unused in prose. It is not a quotation mark,
 * not punctuation, and not a character Koenig does anything with. The pair is
 * required: `|` on its own is left alone, so a lone pipe in a sentence is
 * still just a pipe.
 *
 * EXACTLY ONE CHARACTER BETWEEN THE PIPES. `|T|` is a drop cap; `|The|` is
 * three characters and is left exactly as typed. That rule is what keeps this
 * from firing on the other thing pipes are used for — a row of a table typed
 * by hand, `| Name | Total |`, where every cell is more than one character. It
 * also means the feature cannot silently eat a word.
 *
 * WHAT IT WILL NOT TOUCH: anything inside <code>, <kbd>, <samp> or a <pre>
 * block, where a pipe means a pipe. Same guard footnotes.js uses, for the same
 * reason.
 */

const BODY = ".qntns-content__body";
const LITERAL = "pre, code, kbd, samp";
const LITERAL_TAGS = new Set(["code", "kbd", "samp"]);

/* Rewrites one element's HTML, or returns null if there was nothing to do so
   the caller can leave its innerHTML alone rather than replacing it with an
   identical string — replacing it throws away every node inside.

   The loop is tag-aware in exactly one way: `<` puts it inside a tag and `>`
   takes it out, and everything between is copied through untouched. That is
   what stops a pipe in an href or a title attribute from being read as markup
   the reader can see. It is the same shape as the scanner in footnotes.js and
   deliberately so — two nearly identical loops are easier to hold in the head
   than one loop with a mode flag threaded through it. */
const scan = (html) => {
    let out = "";
    let inTag = false;
    let literal = 0;
    let changed = false;

    for (let i = 0; i < html.length; i += 1) {
        const ch = html[i];

        if (inTag) {
            if (ch === ">") inTag = false;
            out += ch;
            continue;
        }
        if (ch === "<") {
            const tag = /^<(\/?)([a-z]+)/i.exec(html.slice(i, i + 12));
            if (tag && LITERAL_TAGS.has(tag[2].toLowerCase())) {
                if (tag[1]) literal = Math.max(0, literal - 1);
                else literal += 1;
            }
            inTag = true;
            out += ch;
            continue;
        }

        /* THE LETTER IS TAKEN AS A WHOLE CHARACTER, NOT AS A CODE UNIT.
           html[i] would split an emoji or an accented letter written as a
           surrogate pair in half, and half of a surrogate pair is not a
           character — it renders as a replacement box. Array.from over the
           three-character window is what keeps `|é|` and `|字|` working. */
        if (ch === "|" && literal === 0) {
            const rest = Array.from(html.slice(i + 1, i + 9));
            const letter = rest[0];
            if (letter && letter !== "|" && letter !== "<" && rest[1] === "|") {
                out += `<span class="qntns-dropcap">${letter}</span>`;
                i += letter.length + 1;   // the letter and its closing pipe
                changed = true;
                continue;
            }
        }

        out += ch;
    }

    return changed ? out : null;
};

export const attachDropCaps = (root) => {
    const body = root?.querySelector(BODY);
    if (!body) return;

    /* The same walk footnotes.js does, and it has to be a walk over blocks
       rather than one pass over the whole body: rewriting body.innerHTML in
       one go would throw away every Koenig card's internal state and any
       element the later attach* passes hold a reference to. Per-block keeps
       the blast radius to the paragraph that actually held a pipe. */
    body.querySelectorAll("p, li, blockquote, h1, h2, h3, h4, h5, h6").forEach((block) => {
        if (block.closest(LITERAL)) return;
        // A <p> inside a <li> would otherwise be walked twice, once as itself
        // and once as part of its parent.
        if (block.querySelector("p, li, blockquote")) return;
        const rewritten = scan(block.innerHTML);
        if (rewritten !== null) block.innerHTML = rewritten;
    });
};

/*
 * HOW MANY LINES THE CAP IS, WHICH IS A MEASUREMENT AND NOT A CONSTANT.
 * ===========================================================================
 * A drop cap is three lines tall. A THREE-LINE cap in a TWO-LINE paragraph is
 * not a drop cap, it is a letter hanging off the bottom of a sentence — the
 * paragraph grows to make room for the letter, which is the tail wagging the
 * dog. So the cap is as tall as the paragraph is, up to three:
 *
 *     1 line    no cap at all
 *     2 lines   a two-line cap
 *     3+ lines  a three-line cap
 *
 * AND THEN ONE SIZE IS CHOSEN FOR THE WHOLE PAGE, the smallest any capped
 * paragraph can carry, so several caps read as one feature rather than as
 * several. See fitAll.
 *
 * ONE LINE GETS NOTHING, and that is a rejection rather than a one-line cap.
 * A one-line cap is just a letter in a different face, which reads as a typo
 * rather than as an opening.
 *
 * initial-letter DOES THE SINKING, and it is the only thing that can. It is
 * the one property that knows where the Nth baseline is, and it puts the glyph
 * on it without anybody having to know the face's cap height. The number is a
 * custom property so this can set it per paragraph:
 * `initial-letter: var(--dropcap-lines, 3)` in qntns/content.css.
 *
 * WHICH MEANS THE CAP HAS TO BE A ::first-letter. initial-letter applies to
 * ::first-letter and, per spec, to an inline box that opens a block — but
 * Chrome implements only the first of those. Measured on 2026-08-31: a
 * `<span class="qntns-dropcap">` at the start of a paragraph computed
 * `initial-letter: 3` and rendered at body size, unsunk, because the @supports
 * test passed and turned the float fallback off. That is the bug this pass
 * fixes, and it fixes it by UNWRAPPING the span: a `|T|` that opens its
 * paragraph is by definition that paragraph's first letter, so it does not
 * need a box of its own.
 *
 * A `|T|` IN THE MIDDLE OF A PARAGRAPH KEEPS THE FLOAT and is untouched here.
 * initial-letter cannot reach it at all, so there is nothing to size.
 */
const LINE_MAX = 3;

const lineCount = (block) => {
    const height = parseFloat(getComputedStyle(block).lineHeight);
    if (!height) return 0;
    return Math.round(block.getBoundingClientRect().height / height);
};

/*
 * THE COUNT IS TAKEN WITH THE CAP OFF, AND IT IS NOT ITERATED.
 *
 * Sinking a two-line cap into a two-line paragraph takes width away from both
 * of its lines, which can push the last few words onto a third — so measuring
 * again after applying can report a different number, and applying that number
 * can change it back. That is an oscillation, and the only stable rule is to
 * answer the question the writer asked: how long is this paragraph? Every cap
 * is sized from the paragraphs AS WRITTEN and then left alone.
 */
const strip = (paragraph) => {
    paragraph.removeAttribute("data-dropcap");
    paragraph.style.removeProperty("--dropcap-lines");

    const span = paragraph.querySelector(":scope > .qntns-dropcap:first-child");
    if (span) {
        span.replaceWith(...span.childNodes);
        // Two adjacent text nodes are two nodes, and ::first-letter takes the
        // first letter of the first one either way — but normalising keeps a
        // later innerHTML read from showing the seam.
        paragraph.normalize();
    }
};

/*
 * ONE SIZE FOR THE WHOLE PAGE, AND IT IS THE SMALLEST ONE ANY OF THEM CAN
 * HAVE.
 * ===========================================================================
 * Sizing each cap to its own paragraph is right when there is one cap. With
 * several on a page it is wrong, and obviously so: a three-line T beside a
 * two-line T reads as two different features, or as one of them being broken.
 * Drop caps are a page's voice, not a paragraph's, so they are all the same
 * height and the height is the one every paragraph can carry — the SMALLEST.
 *
 * A page with a two-line paragraph and a six-line one gets two-line caps
 * throughout. The alternative is the six-line paragraph setting the standard
 * and the two-line one growing to a third line to meet it, which is the
 * paragraph serving the decoration.
 *
 * ONE-LINE PARAGRAPHS DO NOT VOTE. They get no cap at all — see above — so
 * they are not asked what size they could carry. A page of a one-line
 * paragraph and a four-line one gets one three-line cap, not none.
 */
const fitAll = (paragraphs) => {
    paragraphs.forEach(strip);

    // Every count taken before any cap goes back on. They are separate
    // paragraphs and could not affect each other's wrapping, but measuring a
    // set and then changing it is the shape that stays true when that stops
    // being so.
    const lines = paragraphs.map(lineCount).filter((count) => count > 1);
    if (!lines.length) return;

    const shared = Math.min(LINE_MAX, ...lines);
    paragraphs.forEach((paragraph) => {
        if (lineCount(paragraph) <= 1) return;
        paragraph.dataset.dropcap = "";
        paragraph.style.setProperty("--dropcap-lines", String(shared));
    });
};

/*
 * RUN AFTER THE FONTS LOAD AND AGAIN WHEN THE COLUMN CHANGES WIDTH.
 *
 * Both for the same reason: the line count is a function of the measure and of
 * the face, and it is wrong before either has settled. A fallback face at a
 * different width per character is exactly how a three-line paragraph reports
 * two.
 *
 * WITH NO JAVASCRIPT NOTHING HERE RUNS AND THE CAP IS STILL THERE — the
 * `#dropcap` tag's rule in qntns/content.css stands on its own at the default
 * three lines. This pass makes it right; it is not what makes it exist. The
 * class it keys on is removed at the end so the two rules cannot both apply,
 * which is also why removing it is the LAST thing and not the first.
 */
export const fitDropCaps = (root) => {
    const body = root?.querySelector(BODY);
    if (!body) return () => {};

    const wanted = new Set();
    if (body.classList.contains("qntns-content__body--dropcap")) {
        const first = body.querySelector("p");
        if (first) wanted.add(first);
    }
    body.querySelectorAll("p > .qntns-dropcap:first-child").forEach((span) => {
        wanted.add(span.parentElement);
    });
    if (!wanted.size) return () => {};

    const paragraphs = [...wanted];
    const run = () => {
        fitAll(paragraphs);
        body.classList.remove("qntns-content__body--dropcap");
    };

    document.fonts?.ready.then(run) ?? run();

    if (typeof ResizeObserver === "undefined") return () => {};
    // Skipping the observer's own first callback: `run` above has already been
    // scheduled, and a second pass before the fonts land is the wrong answer
    // arriving first.
    let primed = false;
    const observer = new ResizeObserver(() => {
        if (!primed) { primed = true; return; }
        fitAll(paragraphs);
    });
    observer.observe(body);
    return () => observer.disconnect();
};

/* Exported for testing the parser without a DOM. */
export const __scan = (html) => scan(html) ?? html;
