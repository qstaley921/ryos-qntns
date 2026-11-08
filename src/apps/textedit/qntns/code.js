/*
 * THE CODE BLOCK — line numbers, copy button, syntax colour.
 * ===========================================================================
 * Ghost's code card emits exactly this, and nothing else:
 *
 *     <pre><code class="language-html">&lt;p&gt;hi&lt;/p&gt;</code></pre>
 *
 * The class is present only when the writer filled in the editor's language
 * field, or typed ```html in markdown. A block with no language is the normal
 * case for a URL or a shell line, and it gets the gutter and the button but no
 * colour rather than a guess.
 *
 * WHY THE HIGHLIGHTER IS 60 LINES AND NOT A LIBRARY. CLAUDE.md forbids
 * dependencies and forbids the page depending on a network call, which rules
 * out both a CDN highlighter and a vendored one — Prism's core plus five
 * grammars is larger than every other script this theme ships put together,
 * for a component that appears on a handful of pages. What is here handles
 * comments, strings, numbers, keywords and names, which is the whole of what
 * the mockup asks for. It is a colouriser, not a parser: it will mis-colour
 * pathological input (a keyword inside an unterminated string) and that is an
 * accepted cost, not a bug to fix by growing it into a parser.
 *
 * THE ORDER OF THE PATTERNS IS THE PRECEDENCE, and it is the whole design.
 * Comments and strings come first in every grammar so that a `#` inside a
 * string is a character and a keyword inside a comment is a comment. One
 * alternation is built per language and run once over the source, so a match
 * consumes its own text and later patterns never see inside it.
 *
 * ESCAPING. The source is read with textContent — Ghost has already decoded
 * its own entities by then — and every span of it goes back through escape()
 * before it re-enters the DOM as HTML. Nothing reaches innerHTML unescaped,
 * including the untokenised gaps between matches.
 */

import { icon } from "./icon-set.js";

// Matches the 1500ms in content.js's share button, and for the same reason:
// long enough to read a tick, short enough that a second copy does not feel
// blocked. The two are independent constants on purpose — a change to the
// share button's timing is not a change to this one.
const COPIED_FEEDBACK = 1500;

const escape = (text) =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/*
 * THE GRAMMARS.
 * Each is an ordered list of [tokenType, pattern]. Every pattern is written to
 * match from the current position outward and to be safe under a global scan —
 * no lookbehind (Safari shipped it late and this theme supports older phones),
 * and no unbounded backtracking pair like (a+)+.
 *
 * ALIASES BELOW map what a writer actually types — ```js, ```sh, ```yml — onto
 * these five. An unknown language falls through to no highlighting at all,
 * which is the same result as no language, and is correct: a wrong grammar
 * colours the wrong words, which is worse than plain text.
 */
const GRAMMARS = {
    markup: [
        ["comment", /<!--[\s\S]*?-->/],
        ["string", /"[^"]*"|'[^']*'/],
        // The tag name, captured with its bracket so </div> and <div both land
        // as one token rather than a punct followed by a name.
        ["name", /<\/?[a-zA-Z][\w:-]*/],
        ["punct", /\/?>/],
        ["keyword", /\s[a-zA-Z-][\w:-]*(?==)/]
    ],
    css: [
        ["comment", /\/\*[\s\S]*?\*\//],
        ["string", /"[^"]*"|'[^']*'/],
        ["keyword", /@[a-zA-Z-]+/],
        // Hex colours before the selector pattern, or #fff is read as an id
        // selector and coloured as a name. Ordering is the precedence here as
        // everywhere else in this table.
        ["number", /#[0-9a-fA-F]{3,8}\b/],
        ["name", /[.#][a-zA-Z_-][\w-]*|--[\w-]+/],
        ["number", /-?\d*\.?\d+(?:px|rem|em|%|vh|vw|s|ms|deg)?\b/],
        ["punct", /[{}:;,()]/]
    ],
    javascript: [
        ["comment", /\/\/[^\n]*|\/\*[\s\S]*?\*\//],
        ["string", /"[^"\n]*"|'[^'\n]*'|`[^`]*`/],
        ["keyword",
            /\b(?:const|let|var|function|return|if|else|for|while|of|in|new|class|extends|import|export|from|default|async|await|try|catch|finally|throw|typeof|instanceof|null|undefined|true|false|this)\b/],
        ["number", /\b-?\d*\.?\d+\b/],
        ["punct", /[{}()[\];,.]/]
    ],
    json: [
        ["string", /"[^"\\]*(?:\\.[^"\\]*)*"/],
        ["keyword", /\b(?:true|false|null)\b/],
        ["number", /-?\d*\.?\d+(?:[eE][+-]?\d+)?/],
        ["punct", /[{}[\]:,]/]
    ],
    bash: [
        ["comment", /#[^\n]*/],
        ["string", /"[^"\n]*"|'[^'\n]*'/],
        ["keyword",
            /\b(?:cd|ls|cat|echo|export|curl|npm|npx|node|git|sudo|mkdir|rm|cp|mv|grep|sed|awk|ffmpeg|if|then|fi|for|do|done|while)\b/],
        ["number", /\b-?\d+\b/],
        ["punct", /[|&;<>()$]/]
    ]
};

const ALIASES = {
    html: "markup", xml: "markup", svg: "markup", markup: "markup",
    css: "css",
    js: "javascript", javascript: "javascript", mjs: "javascript",
    json: "json",
    bash: "bash", sh: "bash", shell: "bash", zsh: "bash"
};

/*
 * ONE ALTERNATION PER GRAMMAR, BUILT ONCE AND CACHED.
 * Each pattern becomes one capturing group, so the index of the group that
 * matched is the index of the token type. Building it per block would rebuild
 * the same object for every code card on the page; building it per page load
 * is once.
 */
const compiled = new Map();

const compile = (name) => {
    if (compiled.has(name)) return compiled.get(name);
    const rules = GRAMMARS[name];
    const pattern = new RegExp(rules.map(([, re]) => `(${re.source})`).join("|"), "g");
    const entry = { pattern, types: rules.map(([type]) => type) };
    compiled.set(name, entry);
    return entry;
};

/*
 * COLOUR ONE BLOCK'S SOURCE.
 * Walks the alternation and emits escaped plain text for everything between
 * matches. Returns HTML. A language with no grammar returns the escaped source
 * unchanged, which is what makes "unknown language" and "no language" the same
 * safe path.
 */
const highlight = (source, language) => {
    const grammar = ALIASES[language];
    if (!grammar) return escape(source);

    const { pattern, types } = compile(grammar);
    pattern.lastIndex = 0;

    let out = "";
    let last = 0;
    let match;

    while ((match = pattern.exec(source)) !== null) {
        // A pattern that can match the empty string would spin here forever.
        // None of the grammars above can, but the guard costs one comparison
        // and removes the entire class of failure from a future edit.
        if (match[0] === "") {
            pattern.lastIndex += 1;
            continue;
        }
        out += escape(source.slice(last, match.index));
        // Group 0 is the whole match, so the type index is one less than the
        // group number that is defined.
        const which = match.findIndex((value, index) => index > 0 && value !== undefined);
        out += `<span class="qntns-code__token--${types[which - 1]}">${escape(match[0])}</span>`;
        last = match.index + match[0].length;
    }

    return out + escape(source.slice(last));
};

/*
 * CUT HIGHLIGHTED HTML INTO ONE STRING PER SOURCE LINE.
 *
 * WHY NOT JUST HIGHLIGHT EACH LINE SEPARATELY, which would be four lines
 * shorter: three of the five grammars have tokens that legally span a newline —
 * `/* *\/` in CSS and JavaScript, `<!-- -->` in markup, and a backtick template
 * literal. Highlighting line by line would end those tokens at the first
 * newline and colour the rest of the comment as code. The whole block is
 * highlighted once, as it always was, and only the RESULT is cut up.
 *
 * The cut has to reopen the span it is standing inside, which is only tractable
 * because highlight() emits FLAT spans — one alternation, no nesting, ever. So
 * there is at most one span open at any newline and remembering its class is
 * the entire state this needs.
 */
const LINE_SPLIT = /(<span class="[^"]*">)|(<\/span>)|\n/g;

const splitLines = (html) => {
    const lines = [];
    let current = "";
    let open = "";
    let last = 0;
    let match;

    LINE_SPLIT.lastIndex = 0;
    while ((match = LINE_SPLIT.exec(html)) !== null) {
        current += html.slice(last, match.index);
        last = match.index + match[0].length;

        if (match[1]) {
            open = match[1];
            current += match[1];
        } else if (match[2]) {
            open = "";
            current += match[2];
        } else {
            // A newline. Close whatever is open, bank the line, and reopen the
            // same span at the start of the next one.
            lines.push(open ? `${current}</span>` : current);
            current = open;
        }
    }

    lines.push(current + html.slice(last));
    return lines;
};

/*
 * THE COPY BUTTON.
 * navigator.clipboard needs a secure context and a user gesture; a click on
 * this button is both. Where it is missing or refused, NOTHING HAPPENS AND NO
 * ERROR IS SHOWN — same rule as the share button in qntns/content.js. A button
 * that reported a clipboard failure would be telling the reader about a
 * browser setting they did not choose and cannot fix from here.
 *
 * The text copied is the ORIGINAL source, captured before highlighting, so a
 * copy never picks up a span boundary or a line number.
 */
const attachCopy = (button, source) => {
    const slot = button.querySelector(".qntns-code__copy-icon-slot");

    button.addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(source);
        } catch {
            return;
        }

        /* THE WORD AND THE TICK, NOT THE TICK ALONE. A check mark on its own
           is read as "done" only by somebody who was already watching the
           button; the word says which thing is done. The button widens to hold
           it, and because it is floated the first line or two of code reflow
           around the wider box and back again — that movement is the feedback
           as much as the label is.

           ONLY THE ICON IS SWAPPED. The label is in the markup from the start
           and stays there, clipped to nothing by a 0fr grid track; the class
           below is what opens that track. Replacing the button's whole
           innerHTML — which is what this used to do — inserted the label a
           frame before it was measured, and a transition cannot run from a
           width an element never had. That is why the button snapped.

           aria-label still carries the same two states, and it overrides the
           button's contents, so the permanent label span cannot make a screen
           reader announce "Copied Copied" or read "Copied" on a resting
           button. */
        slot.innerHTML = icon("check", { size: 20, className: "qntns-code__copy-icon" });
        button.classList.add("is-copied");
        button.setAttribute("aria-label", "Copied");
        setTimeout(() => {
            slot.innerHTML = icon("copy", { size: 20, className: "qntns-code__copy-icon" });
            button.classList.remove("is-copied");
            button.setAttribute("aria-label", "Copy code");
        }, COPIED_FEEDBACK);
    });
};

/*
 * ENHANCE ONE <pre><code>.
 * The <pre> is replaced by a wrapper holding a gutter, a scroller and a button.
 * The original <code> is reused rather than rebuilt so that anything Ghost put
 * on it — its language class, any id — survives.
 */
const enhance = (pre) => {
    const code = pre.querySelector("code");
    if (!code) return;

    const source = code.textContent.replace(/\n$/, "");
    const languageClass = [...code.classList].find((name) => name.startsWith("language-"));
    const language = languageClass ? languageClass.slice("language-".length).toLowerCase() : "";

    const wrapper = document.createElement("div");
    wrapper.className = "qntns-code";

    /*
     * THE LINE NUMBER LIVES INSIDE ITS LINE NOW, AS `data-line`, AND CSS DRAWS
     * IT WITH ::before.
     *
     * It used to be a separate grid column of fixed 24px rows, aligned to the
     * code only because the code could not wrap. The copy button now floats and
     * the code wraps around it, so a source line can be two or three visual rows
     * tall and a parallel column of fixed rows would drift out of step with it
     * from the first wrapped line onward.
     *
     * A NUMBER IN AN ATTRIBUTE IS STILL NOT SELECTABLE AND STILL NOT SPOKEN.
     * That was the gutter's other job and this keeps both halves of it for free:
     * generated content is not part of the selection and is not copied, and it
     * is not in the accessibility tree as text either. So a drag-select still
     * picks up the code alone, and the <code> element still holds the source as
     * one continuous run.
     *
     * Three digits because that is the mockup's gutter width; padStart leaves a
     * longer number alone rather than truncating, so line 1000 renders as 1000
     * and eats into the slack.
     *
     * NO SEPARATOR BETWEEN THE SPANS. They are block boxes inside a pre-wrap
     * container, so a newline between two of them would be preserved as an
     * empty line box and every line would be double-spaced.
     */
    const newPre = document.createElement("pre");
    newPre.className = "qntns-code__pre";
    code.innerHTML = splitLines(highlight(source, language))
        .map((line, index) =>
            `<span class="qntns-code__line" data-line="${String(index + 1).padStart(3, "0")}">${line}</span>`)
        .join("");
    newPre.append(code);

    /*
     * THE BUTTON IS FIRST IN THE FLOW AND FLOATED, WHICH IS THE WHOLE POINT.
     * A float only shortens the line boxes that come AFTER it in source order,
     * so it has to precede the <pre>. It also only reaches into that <pre> if
     * nothing between them establishes a new block formatting context — which
     * is why the old .qntns-code__scroll wrapper is gone rather than merely
     * unused: `overflow-x: auto` would have made one and the code would have
     * run under the button exactly as it did before.
     */
    const button = document.createElement("button");
    button.type = "button";
    button.className = "qntns-code__copy";
    button.setAttribute("aria-label", "Copy code");

    /* TWO SLOTS, BOTH PERMANENT: the icon, which is swapped in place, and the
       label, which is only ever revealed or clipped. See THE CONFIRMED SIZE in
       code.css — the button is a two-column grid and these are its columns. */
    button.innerHTML =
        `<span class="qntns-code__copy-icon-slot">${icon("copy", { size: 20, className: "qntns-code__copy-icon" })}</span>` +
        '<span class="qntns-code__copy-label"><span>Copied</span></span>';
    attachCopy(button, source);

    wrapper.append(button, newPre);

    pre.replaceWith(wrapper);
};

/*
 * THE ENTRY POINT.
 * Idempotent by construction: enhance() removes the <pre> it was given, so a
 * second call finds nothing left to match. Safe to call from a page that also
 * rewrites its body.
 */
export const attachCode = (root = document) => {
    root.querySelectorAll("pre:not(.qntns-code__pre)").forEach(enhance);
};
