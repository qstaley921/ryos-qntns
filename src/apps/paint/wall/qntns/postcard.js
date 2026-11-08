/*
 * QNTNs postcard — the share button's replacement.
 * ===========================================================================
 * Clicking share no longer hands a URL to the operating system. It opens this
 * popover, which renders the article as a physical 4x6 postcard the reader can
 * save, share as a picture, or pay to have printed and mailed.
 *
 * ONLY THE FRONT IS EVER AN IMAGE. The back is not drawn here and is not
 * uploaded anywhere: PostGrid composes it from a message string and an address,
 * because PostGrid is the one that knows where the address block, the barcode and
 * the postage have to sit. Sending it a picture of the back would mean
 * hand-dodging all three against a spec we do not control. So the popover's
 * Back view is a FORM, not a preview, and it must never be presented as a
 * picture of what arrives. See DECISIONS-LOG.md #13 and #15.
 *
 * NO LIBRARY. There is no html2canvas and there cannot be one — package.json
 * has no runtime dependencies and tools/build-zip.mjs fails the build on any
 * import that leaves assets/. Everything below is Canvas 2D and the fonts the
 * theme already ships in assets/fonts.
 *
 * IT TALKS TO EXACTLY ONE ORIGIN, AND ONLY WHEN $4 IS PRESSED. The Worker at
 * qntns-reads.qstaley921.workers.dev is the theme's one permitted third-party
 * runtime origin (CLAUDE.md, DECISIONS-LOG.md #10) and it is already spent on
 * the read-receipt sync and the funding queue; the postcard is a third route
 * family on that same Worker, not a second origin. Nothing here is fetched to
 * paint anything — the card renders, the form validates and the picture
 * downloads with the network unplugged. The only call is the order itself.
 *
 * `onMail` OVERRIDES THAT, and Storybook uses it to inspect the order object
 * without a server. Left unset, the button does the real thing.
 */

import { icon } from "../icon-set.js";
import { escapeHtml } from "./escape.js";
import { drawQr } from "./qr.js";
import { playError, playFlip } from "./sound.js";

/* -------------------------------------------------------------------------
 * Geometry
 * ---------------------------------------------------------------------- */

/*
 * TRIM IS THE CARD. BLEED IS THE PAPER IT IS CUT OUT OF.
 *
 * A 4x6 postcard finishes at 4in x 6in, which at 300dpi is 1200 x 1800. The
 * printer wants the artwork at 4.25in x 6.25in — 1275 x 1875 — so the trimming
 * blade always lands inside the ink rather than beside it. The difference is
 * 0.125in on every edge.
 *
 * THE PRINTED CARD IS LANDSCAPE AND THIS DRAWING IS NOT. PostGrid has no
 * portrait size: its 6x4 artwork is 6.25 x 4.25in, the same numbers transposed.
 * The rotation happens in the Worker, in frontHtml(), on the copy the printer
 * sees — never here. What the reader looks at, downloads and shares stays
 * portrait, which is the design. See DECISIONS-LOG.md #20.
 *
 * 0.125in AT 300DPI IS 37.5px AND THAT IS OFF THE GRID. It is an exemption
 * under CLAUDE.md's base-4 rule and this comment is where it is taken. It
 * cannot be rounded: 36 loses an eighth of the bleed, 40 moves the trim line,
 * and the trim line is where the reader's eye reads the edge of the card.
 *
 * The exemption is contained by keeping LAYOUT entirely in TRIM space, where
 * every number below is a multiple of 4, and translating the whole context by
 * the bleed exactly once in paintFront(). Nothing else in this file ever adds
 * 37.5 to anything.
 */
export const TRIM_W = 1200;
export const TRIM_H = 1800;
export const BLEED = 37.5;
export const CARD_W = TRIM_W + BLEED * 2;   // 1275 — what the printer is sent
export const CARD_H = TRIM_H + BLEED * 2;   // 1875

/*
 * Every value here is in TRIM space and every one is a multiple of 4.
 *
 * The margin is 72px, which is 0.24in. A quarter inch would be 75 and is not
 * on the grid; 72 is the nearest 4 and the eighth of an inch it gives up is
 * inside the printer's cutting tolerance anyway.
 *
 * IT CLEARS THE SAFE ZONE WITH ROOM. PostGrid's published rule is 0.2in from
 * the TRIM edge — 60px at 300dpi, measured in exactly the TRIM space LAYOUT is
 * written in. 72 is 12px inside that and every value below is at least 72 from
 * its edge, so nothing critical can be trimmed. (Lob's rule was 0.125in and the
 * margin cleared that too; this is the tighter of the two and it still holds.)
 *
 * THE FOOTER BAND IS PART OF THE BUDGET, NOT AN OVERLAY. The body's available
 * height is measured down to the top of the band, so a line count that would
 * collide with the wordmark is refused by maxLines() rather than drawn over it.
 *
 * THE TITLE IS BUDGETED AT TWO LINES EVEN WHEN IT ONLY NEEDS ONE. A title may
 * wrap to a second line (and is ellipsised at the end of it — see drawTitle),
 * so the second line has to be paid for somewhere. It is paid for here,
 * unconditionally, rather than by measuring the title and handing the body a
 * cap that changes with it: a cap that grew by a line whenever the sender
 * happened to be on a short-titled post would let them add a line that
 * disappears again on the next post, which is the same failure ELLIPSIS_RESERVE
 * exists to avoid. WHERE THE UNPAID ROW GOES, AND IT IS NOT UNDER THE TITLE:
 * `used` reserves titleLead unconditionally but drawTitle does not draw it, so
 * on a one-line title the meta row, the body and everything after it start 76
 * units HIGHER than the budget assumed, and the 76 falls through to the BOTTOM
 * of the card as extra air above the wordmark band. The gap under the last body
 * row is bandGap on a two-line title and bandGap + titleLead on a one-line one.
 * This comment claimed the white sat under the title until 2026-09-01; it never
 * did, and CHECKLIST-v6 §7.11 is where the consequence is priced. THE
 * ALTERNATIVE WAS WEIGHED AND REFUSED, so nobody re-proposes it: advancing `y`
 * by the full two-row reserve would move that white from the bottom of the card
 * to under the title and costs NOTHING in the budget, and the user excluded it
 * because it pushes the meta row 76 units down whenever the title is one line.
 *
 * THIS COMMENT NAMES THE PARTS. IT DOES NOT STATE THE ANSWER.
 *
 * It used to close with a worked cap — "the cap the sender may reach is 15" —
 * and that sentence has been wrong twice: once when the leading ellipsis went
 * and the cap became 16, and again the moment anybody moves a gap. A number
 * copied out of an arithmetic is a number that goes stale silently, because
 * nothing checks a comment. So the parts are listed here and the RESULT is
 * derived, in code, by bodyBudget() and maxLines(). If you want to know what
 * the cap is, read it off QNTNs/Postcard > Numbers in Storybook, which prints
 * it from the same functions the card draws with.
 *
 * WHAT IS SPENT ABOVE AND BELOW THE BODY (`used` in bodyBudget):
 *
 *     marginTop   top margin above the title
 *     titleSize   the title's first line, at its own size
 *     titleLead   the title's second line, reserved whether or not it is drawn
 *     titleGap    gap under the title
 *     metaSize    the meta line
 *     metaGap     gap under the meta rule
 *     bandGap     breathing room above the wordmark band
 *     bandH       the band, sitting flush on the trim's bottom edge
 *
 * and the body gets TRIM_H less that total.
 *
 * THE CLOSING ELLIPSIS IS A BODY ROW TOO. A window that does not reach the end
 * of the article draws one under the passage, on its own leading, so the worst
 * case is count + 1 and ELLIPSIS_RESERVE holds a row back for it. Reserving it
 * unconditionally rather than only when it is showing is deliberate: a cap that
 * grew whenever the window happened to reach the end of the poem would let the
 * sender add a line that vanishes again the moment they scroll back up. That is
 * why the reserve is never the place to find an extra row. (Unless the dots are
 * gone: they are off since CHECKLIST-13 §30, and §31 set ELLIPSIS_RESERVE to 0
 * and gave the row to the text. Bringing them back means 1 again.)
 *
 * THE LEADING ELLIPSIS IS NOT IN THE RESERVE, AND IT IS NOT GONE EITHER.
 * It used to be a reserved body row alongside the closing one, which cost the
 * body two rows rather than one. §7.5 removed it to buy a line back; the reader
 * asked for it in as many words; it now draws inside the metaGap instead — a
 * gap that is already spent, holds nothing, and is unconditional, so the space
 * for it is held in every window state without the budget knowing. See the note
 * beside it in paintFront. The reserve is 1 because ONE ellipsis is drawn out
 * of the body: the closing one.
 *
 * THE ROW ARITHMETIC DISCARDS THE REMAINDER, AND THE REMAINDER IS WORTH
 * KNOWING. maxLines() adds whole entries until the next one will not fit, so
 * whatever is left under a row's height is simply unused. At the values
 * shipping today that remainder is 64 units — most of a row the card is
 * carrying and cannot spend. It is the reason a further row is worth 8 units
 * out of `used` rather than 72: see QNTNs/Postcard > Seventeen Lines, which is
 * a live proposal to take those 8 from bandGap.
 *
 * THE HEADER IS A TWO-BY-TWO, AND THE QR IS ITS SECOND COLUMN.
 *
 *   +----------------------------+  +--------+
 *   | title, wrapping to 2 rows  |  |        |
 *   +----------------------------+  |   QR   |  <- one cell, square, spanning
 *   | meta                       |  |        |     both rows of column one
 *   +----------------------------+  +--------+
 *
 * The code's size is not a constant: it IS the height of the two rows beside
 * it, which is what "spanning the rows" has to mean when the thing spanning
 * them is square. headerHeight() is the one place that height is computed and
 * both the code and the column width read it, so the code cannot drift out of
 * agreement with the type beside it.
 *
 * THE TITLE IS WRAPPED AGAINST THE TWO-LINE HEADER WIDTH EVEN WHEN IT ONLY
 * NEEDS ONE LINE, which is circular-looking and is the point: the column width
 * depends on the header height, the header height depends on how many lines the
 * title took, and the title's line count depends on the column width. Wrapping
 * against the NARROWEST case breaks the circle in the safe direction. A title
 * that then turns out to fit on one line gets a smaller code and a column with
 * slack in it, which is invisible; solving the circle the other way round would
 * mean a title that fits at one width and not at the other, which is a loop.
 *
 * The header is not in the vertical budget above beyond its own two rows — the
 * code sits beside the type rather than under it, so it costs width, not height.
 */
export /*
 * THE ADDRESS THIS CARD POINTS AT, WITH A SCHEME ON IT.
 *
 * `data.url` is collected as `${location.host}${location.pathname}` — no
 * protocol, because the card PRINTS it and "https://" on the front of a
 * postcard is noise a person reading it does not need. Everything that has to
 * be followed rather than read needs the scheme back: the QR code, and the link
 * that goes out with a share. Both call this, so a card and its share can never
 * disagree about where they point.
 */
const absoluteUrl = (url) =>
    (/^https?:\/\//i.test(url) ? String(url) : `https://${String(url)}`);

export const LAYOUT = {
    marginX: 72,
    marginTop: 72,
    /* 72, down from 96 — three quarters of it, on the user's instruction of
       2026-08-31. 96 x 0.75 is exactly 72 and 72 is on the grid, so the
       "approximately 75%, in whole pixels" asked for is exact here. */
    titleSize: 72,
    /* 76, not 72. type.css sets .display to line-height 1.05, which on a 72px
       face is 75.6; 76 is the nearest 4 and it is the display face's own
       leading rather than a number invented for the card. */
    titleLead: 76,
    titleGap: 24,
    metaSize: 32,
    /* 1.28 IS 0.04em OF 32, AND IT IS OFF THE GRID ON PURPOSE. content.css:161
       sets the article's meta row to letter-spacing 0.04em and this row is meant
       to be that row. CLAUDE.md exempts type metrics pinned by the source, and
       this is where that exemption is taken: rounding it to 4 would be 0.125em,
       three times the article's tracking, and the two would visibly disagree. */
    metaTrack: 1.28,
    /* 72. It got here in two 12-unit steps, both the user's, and the SECOND one
       is what makes the pair below read oddly — read them together.
         48 -> 60 on 2026-09-01 (option C), paid for by bandH 156 -> 144.
         60 -> 72 on 2026-09-01 (CHECKLIST-v6 §7.12, N = 12), paid for by
       bandGap 24 -> 12, with bandH FROZEN at 144 on the user's ruling — the
       wordmark band does not change size again.
         IT COST NOTHING EITHER TIME, and the reason is worth keeping: `used` is
       a SUM of six terms ABOVE the body and two BELOW it. The body's start moves
       when an above-term grows; the budget survives when a below-term shrinks by
       the same amount. So `used` stays 504, the body 1296, the budget 1224 and
       the cap 17 rows with a remainder of exactly 0 (1296 and 18 rows since
       CHECKLIST-13 §31 dropped the dots' reserve). "Lower" and "less" are
       separable on this card.
         WHY THE SECOND 12 CAME OUT OF bandGap AND NOT bandH. `bandTop` is
       `TRIM_H - bandH` and knows nothing about bandGap, so spending bandGap
       moves the passage down while the band stays put and the gap under the last
       row closes 1:1. Spending bandH moves both ends together and closes
       nothing — which is why the first step lowered the passage but did not
       narrow the gap below it.
         12 IS THE CAP AND THE TWO-LINE CARD IS WHAT CAPS IT. On a wrapped title
       the gap under the last body row IS bandGap, so it is now 12 and the row
       closes on the 4-unit navy rule. 16 would have left 8, under 3 CSS px at
       440, and the descenders hang about that far. Do not take more. */
    metaGap: 72,
    bodySize: 40,
    /* 72 is 40 x 1.8. The article's reading text is 1.75 leading (type.css
       :151, the `body` rule — NOT :129, which this comment used to cite and
       which is a line inside the --font-meta note. Re-read and corrected
       2026-09-01: a comment checkable enough to be believed and wrong has cost
       this repo two investigations), which would be 70 and is off the grid; 72
       is the nearest 4 and it
       rounds the line AWAY from the text, so nothing gets tighter than the
       article. This is the "same formatting" the body is meant to keep. */
    bodyLead: 72,
    /* ZERO, deliberately. The body used to be tracked-out monospace; it is now
       the article's own reading face and the article tracks nothing. Tracking
       it would change where the lines break, and matching the article's line
       breaks is the entire point of the change. */
    bodyTrack: 0,
    /* The gutter between the type and the code — and, since the code no longer
       reserves a quiet zone inside its own box, this IS the quiet zone on that
       side and it has to be wide enough to be one.
         A QR code needs 4 clear modules around it. The worst case here is the
       smallest module at the biggest box: a 25-module version 2 in the 204px
       two-row header is 8.16px a module, so 4 of them is 32.6px. 40 clears it
       with room and is on the grid. The other three sides are already clear by
       much more — 72 above, 72 to the trim edge, 48 below.
         The code's own SIZE is derived rather than stated; see headerHeight().
       It is defined as the height of the rows it spans, and a second number
       saying so could only ever disagree with them. */
    qrGap: 40,
    /* 144, down from 156, and it is what pays for metaGap's 12 above. The band
       shrinks 8% and stays the only element on the card that visibly gets
       smaller rather than moving. It still holds the wordmark with air to
       spare: an 88-unit face has a cap height of about 63, centred in 144
       leaves roughly 40 units of band above and below the lettering, and the
       4-unit rule on top eats 4 of the upper 40.
         FROZEN AT 144 BY THE USER, 2026-09-01: "That can stay the same." The
       band paid once and does not pay again — §7.12's second 12 came out of
       bandGap for that reason. It is also the wrong lever anyway: bandTop is
       TRIM_H - bandH, so moving bandH moves both ends of the gap below the
       passage together and narrows nothing. CHECKLIST-v6 §7.11.1 is dead; do
       not re-cost it. */
    bandH: 144,
    /* THE RULE IS ON TOP OF THE BAND NOW, AND THERE IS NOTHING BELOW IT. The
       band used to sit 28px up from the bottom edge with a navy strip filling
       the gap, which read on the printed card as a second line under the
       footer. The site's own footer does not do that: .qntns-footer__bar
       (home.css:159) is a beige-dark band with a 1px navy rule along its TOP
       and nothing beneath it, and this now matches.

       4px, not 1. The site's rule is one CSS pixel, which is 1/96in, which at
       300dpi is 3.125 device pixels — a 1px line here would print as a third of
       the weight it has on screen. 4 is the nearest grid value to 3.125 and is
       the same hairline at print scale rather than a thicker rule. */
    bandRule: 4,
    /* 12, and it has now paid twice in one day. This is the air between the
       last body row and the top of the band.
         32 -> 24 on 2026-09-01, after the user compared QNTNs/Postcard >
       Sixteen Lines against > Seventeen Lines. The eight units came out of here
       rather than out of any other gap because the band below it bleeds off the
       trim edge, so this is the only gap on the card with drawn ink on one side
       and a cut on the other — and because titleGap, titleSize, titleLead and
       metaSize all feed headerHeight(), so taking it from any of those would
       silently resize the QR code as well. What it bought: `used` fell 512 ->
       504, the body rose to 1296, the budget to 1224, exactly 17 rows, and the
       remainder became 0 (the budget is the whole 1296, 18 rows, since
       CHECKLIST-13 §31). See bodyBudget().
         24 -> 12 on 2026-09-01, CHECKLIST-v6 §7.12: the 12 units metaGap took
       to move the passage down. Free in rows for the reason given at metaGap.
         THIS IS THE FLOOR. On a wrapped title these 12 units are the WHOLE gap
       under the passage, and the band's own 4-unit rule is drawn at the far end
       of them. There is no third withdrawal here.
         THE ASYMMETRY BELOW IS KNOWN AND PRICED, NOT UNNOTICED. On a one-line
       title the gap under the last row is 12 + titleLead = 88, not 12, because
       `used` reserves a second title row nobody draws — see the block comment at
       the top of this file. CHECKLIST-v6 §7.11 costed closing it and the user
       excluded the only change that does (it moves the meta row). Do not spend
       the band on it. */
    bandGap: 12,
    wordmarkSize: 88
};

/* The message the sender types on the back. PostGrid publishes no limit — the only
   number they document is a 25,000-character cap on the whole merge-variables
   payload, which is a transport limit and says nothing about what fits beside
   an address block.

   500 IS THE PRODUCT DECISION, AND IT IS WEIGHTED. The user set it on
   2026-09-01: "they can allow 500 characters on the back, but every return line
   counts as 50 characters." A plain character costs 1; a newline costs 50
   INCLUDING its own character, not on top of it, because "a return counts as
   50" is a claim the sender can check against the counter and 51 would make
   them wrong every time. See DECISIONS-LOG.md #59.
   HISTORY, NOT STATE: this was 500, was lowered to 250 by the user on
   2026-08-31, and is 500 again — weighted — from 2026-09-01. The 250 is gone.

   500 / 50 = 10, so no message can carry more than 10 hard returns, i.e. 11
   drawn paragraphs. worker/src/postcard.js measures the printed box at 13
   lines, so the return path cannot overflow the card on arithmetic alone.

   THE BACK TEMPLATE STILL HAS TO BE PROVED AGAINST THIS, and the raise makes
   that harder rather than moot: the case to render is 500 unbroken capital Ms,
   which the arithmetic in worker/src/postcard.js says does NOT fit at 11pt.
   PostGrid returns a rendered PDF of the piece even on a test key, so the proof
   costs nothing. It has not been done. */
export const MESSAGE_MAX = 500;

/*
 * THE WEIGHTING, WRITTEN HERE AND AGAIN IN worker/src/postcard.js.
 *
 * The duplication is deliberate and is the same duplication MESSAGE_MAX already
 * carries: `worker/` is a separate deploy and CLAUDE.md forbids anything under
 * assets/js from importing a path outside assets/, so the two files cannot share
 * a module. The two definitions MUST agree exactly — a form that accepts a
 * message the Worker then truncates takes the sender's money for a card they
 * did not write. Change one, change the other in the same commit.
 *
 * `\r\n` normalises to `\n` BEFORE anything is weighed. A message pasted from a
 * Windows editor arrives as `\r\n` and would otherwise cost 100 a line — the
 * same text costing twice as much for a reason the sender cannot see.
 *
 * 49, not 50, because the newline already counts 1 in `.length`.
 */
export const weigh = (s) => {
    const t = String(s).replace(/\r\n/g, "\n");
    return t.length + 49 * (t.split("\n").length - 1);
};

/*
 * The longest prefix of `s` weighing <= max. `<=`, not `<`: a message that fills
 * the box exactly is not cut, here or on the Worker, or the last character of a
 * full message vanishes between the form and the print.
 *
 * The returned string is normalised, so what the counter weighs, what the draft
 * stores and what the Worker re-weighs are the identical string.
 *
 * The cut never lands inside a surrogate pair. Cost is counted in UTF-16 units
 * because `.length` is, but slicing between the halves of an astral character
 * would leave a lone surrogate in the payload.
 */
export const clampWeighted = (s, max = MESSAGE_MAX) => {
    const t = String(s).replace(/\r\n/g, "\n");
    if (weigh(t) <= max) return t;
    let used = 0;
    for (let i = 0; i < t.length; i += 1) {
        used += t[i] === "\n" ? 50 : 1;
        if (used > max) {
            const end = /[\uD800-\uDBFF]/.test(t[i - 1]) ? i - 1 : i;
            return t.slice(0, end);
        }
    }
    return t;
};

/* The window starts here. Six lines is enough to read as a passage and short
   enough that the first thing the sender does is press + rather than wonder
   what the controls do. */
export const DEFAULT_LINES = 6;
export const MIN_LINES = 1;

/* -------------------------------------------------------------------------
 * Fonts
 * ---------------------------------------------------------------------- */

/*
 * CANVAS DOES NOT WAIT FOR A FONT. If the face has not loaded, ctx.fillText
 * silently draws in a system fallback and nothing reports it — the reader gets
 * a postcard in Helvetica and never knows it was meant to be anything else.
 *
 * The faces are already declared in assets/css/type.css, so this does not
 * construct FontFace objects; it asks the document to load the exact
 * font shorthands this file draws with, then waits. `document.fonts.load`
 * resolves rather than rejects on a face it cannot find, which is why the
 * result is ignored: a missing font is a visual problem, not a reason to
 * refuse to draw the card.
 */
/*
 * EXPORTED, AND THAT IS NOT A CONVENIENCE. This is the authoritative statement
 * of every shorthand the card draws — loadCardFonts() preloads exactly it, and
 * a face drawn without being named here is already a bug by CHECKLIST-v5's
 * rule. So the stories derive their measuring probes from this array rather
 * than re-typing the shorthands, and a second copy that could disagree with it
 * stops existing. Two bugs on 2026-09-01 were exactly that shape: a probe that
 * measured the one face a change did not touch, and a token read from outside
 * the scope that declared it. Neither failed; both went quiet.
 *
 * If FACES ever needs keying by role — `{ body: ..., meta: ... }` rather than a
 * flat list indexed by string — that is the better shape and it is a change to
 * both sides. It is not needed at two entries.
 */
export const FACES = [
    '800 72px "Gill Sans Ultra"',
    /* The meta face, and the postcard's is the theme's: IBM Plex Mono Bold,
       which is what type.css's --font-meta resolves to everywhere else since
       2026-09-01 (DECISIONS-LOG #28 supersedes #16). It replaced the
       OpenDyslexic bold that used to be listed here, and nothing else on the
       card draws at 700 any more, so that entry went with it.
       IBMPlexMono-Bold.ttf already ships in assets/fonts/ and is already
       declared at type.css:89-90 — no new file and no network call. */
    '700 32px "IBM Plex Mono"',
    /* The body is the article's own reading face, not mono — see LAYOUT's
       bodyTrack note. type.css declares it as --font-reader. */
    '400 40px "OpenDyslexic"',
    /* THE FIVE ENTRIES BELOW ARE §2's BLOCK KINDS, AND EVERY ONE OF THEM IS A
       FILE THAT ALREADY SHIPS. No new font, no network call, CLAUDE.md's
       one-third-party-call rule untouched.
         The quote is the body face in italic — OpenDyslexic-Italic.otf,
       declared at type.css:9-15. If it fails to load the rule and the indent
       carry the quote alone; a synthetic slant is what FACES exists to stop.
         The headings are the body face at 700 — OpenDyslexic-Bold.otf,
       type.css:17-23 — at the three sizes content.css gives h1/h2, h3 and
       h4-h6 through the card's 2.5x type scale. They are listed per size
       because that is what FACES is: the exact shorthands this file draws
       with. A size the card draws and this list does not name is already a bug
       by CHECKLIST-v5's rule.
         The code block is the meta face at REGULAR — IBMPlexMono-Regular.ttf,
       type.css:58 — where the 700 above is the same family's Bold. */
    'italic 400 40px "OpenDyslexic"',
    '700 60px "OpenDyslexic"',
    '700 48px "OpenDyslexic"',
    '700 40px "OpenDyslexic"',
    '400 36px "IBM Plex Mono"'
];

let fontsPromise = null;

export const loadCardFonts = () => {
    if (fontsPromise) return fontsPromise;
    fontsPromise = Promise.all(FACES.map((face) => document.fonts.load(face).catch(() => {})))
        .then(() => document.fonts.ready)
        .catch(() => {});
    return fontsPromise;
};

/* -------------------------------------------------------------------------
 * Colour
 * ---------------------------------------------------------------------- */

/*
 * The canvas reads its colours out of the same custom properties the CSS uses,
 * rather than repeating the hex values here. A postcard that stopped matching
 * the site the first time a token moved would be the obvious failure, and it
 * would be invisible until someone held the two side by side.
 */
const readTokens = (root = document.documentElement) => {
    const style = getComputedStyle(root);
    const token = (name, fallback) => (style.getPropertyValue(name) || "").trim() || fallback;
    return {
        ink: token("--color-ink", "hsl(222 55% 21%)"),
        card: token("--color-card", "hsl(34 23% 86%)"),
        band: token("--color-beige-dark", "hsl(32 25% 75%)"),
        /* The code block's border, and the only thing on the card that uses it.
           tokens.css:8 declares it on :root, so unlike --color-meta below it is
           in scope on any page. */
        accent: token("--color-accent", "#182952"),
        /* --color-meta is declared on .qntns-content, not on :root, so on a
           page without the article this reads nothing and the fallback is what
           is used. They are the same value on purpose: content.css:83 owns it
           and this is a copy that has to be updated with it. */
        meta: token("--color-meta", "#868079")
    };
};

/* -------------------------------------------------------------------------
 * Text
 * ---------------------------------------------------------------------- */

/*
 * Tracked-out monospace, one character at a time.
 *
 * The frame letter-spaces the body copy, and canvas has no letterSpacing that
 * can be relied on — it is unsupported in Safari, which is most of the phones
 * this will be used from. So the tracking is applied by hand: draw each
 * character, advance by its own width plus the track. On a monospace face every
 * advance is the same, so this stays cheap and stays aligned.
 */
const trackedWidth = (ctx, text, track) => {
    if (!text) return 0;
    /* One track per code point, as fillTracked's for…of draws it: an emoji is
       two UTF-16 units and one advance (CHECKLIST-13 §28). */
    return ctx.measureText(text).width + track * ([...text].length - 1);
};

const fillTracked = (ctx, text, x, y, track) => {
    if (!track) {
        ctx.fillText(text, x, y);
        return;
    }
    let cursor = x;
    for (const char of text) {
        ctx.fillText(char, cursor, y);
        cursor += ctx.measureText(char).width + track;
    }
};

/*
 * WRAPPING HAPPENS BEFORE WINDOWING, AND THAT ORDER IS THE WHOLE DESIGN.
 *
 * A poem's lines are already lines and must not be re-flowed, but a paragraph
 * of prose is one enormous line that has to become several. Both end up in the
 * same array, and the up/down and +/- controls then operate on THAT array — so
 * "how many lines are shown" means display lines, which is the only meaning
 * that matches what the sender is looking at.
 *
 * An empty source line survives as an empty display line. That is what keeps
 * the blank line between two stanzas.
 */
/*
 * AN ENTRY IS A LINE OF TEXT OR A PICTURE, AND THE TWO ARE TOLD APART BY TYPE.
 *
 * `data.lines` used to be an array of strings and is now an array of entries: a
 * string is a line of text, an object is a figure. A string stays a string on
 * purpose — every story fixture, every draft and readArticle's own text path
 * pass plain arrays of strings in and none of them had to change.
 *
 * A FIGURE IS EIGHT ROWS TALL AND ONE STEP WIDE, and those are two different
 * numbers that must never be confused:
 *
 *   HEIGHT  8 * bodyLead = 576 trim units, so a picture reads as a photograph
 *           rather than a thumbnail. It was 4 rows (288), which left a portrait
 *           about a sixth of the card wide; CHECKLIST-13 §16 doubled it. A
 *           whole number of rows, so the text after a picture is still on the
 *           text baseline. 576 + the 72 blank after it = 648 of the 1296
 *           budget (§13.31; 1224 before), so at step 0 one picture and nine
 *           rows fill a window, and so do two pictures (1296, exactly). None
 *           is ever oversized: the largest block is 992 at +13 (§13.27).
 *   STEPS   ONE. Pressing minus once removes a picture, the same as it removes
 *           a line. The reader does not learn a second rule for a second kind
 *           of thing.
 *
 * That split is why maxLines() below is a height budget and not a row count.
 */
export const FIGURE_H = 576;

/*
 * HOW FAR THE BLUE EDGE SITS BELOW THE LAST BASELINE, IN TRIM UNITS.
 *
 * 20, and the user's own measurement was "about 2px lower than 16". 2px is not
 * the number to write down, because they are reading CSS pixels off a canvas
 * that is scaled: --postcard-w is min(440px, 100vw - 32px, (100vh - 160px)*2/3)
 * against aspect-ratio 2/3, so the card's height in CSS pixels changes with the
 * window and one CSS pixel buys a different number of trim units on every
 * screen.
 *
 *   desktop, at the 440px maximum   660 CSS px tall / 1800 trim  =  2.727 trim per px
 *                                   2 px  =  5.45 trim  ->  16 + 5.45  =  21.45
 *                                   nearest multiple of 4: 20 (1.45 away; 24 is 2.55)
 *
 *   phone, 360px wide               328 x 492 CSS px             =  3.66 trim per px
 *                                   2 px  =  7.3 trim   ->  16 + 7.3   =  23.3
 *                                   nearest multiple of 4: 24
 *
 * ONE NUMBER HAS TO SERVE BOTH AND 20 IS A KNOWN COMPROMISE, not an exact
 * answer. It is written for the desktop maximum because that is where the
 * judgement was made. On a 360px phone the rule will read about 1 CSS px higher
 * than it does in Storybook. That is a real difference and it is recorded here
 * rather than smoothed over; scaling it per viewport would mean the printed
 * card and the preview no longer shared one set of coordinates, which is a
 * worse thing to buy with it.
 *
 * The reason 16 was chosen survives the move: 40px body type descends about 8
 * units, so 20 still clears a descender with 12 units to spare and sits well
 * inside the 72-unit leading.
 */
export const EDGE_DROP = 20;
/*
 * AN ENTRY IS NOW A STRING, A PICTURE, OR A BLOCK — CHECKLIST-v8 §2.2.
 *
 * isFigure() used to be "is it an object", because an object was the only kind
 * of object there was. §2 adds four more — a quote line, a heading, an <hr> and
 * a line of code — and every one of them is an object too, so the old test
 * would have claimed all of them and handed them to drawFigure().
 *
 * SO THE TEST IS NOW ON THE `type` FIELD THAT WAS ALWAYS THERE. figureEntries()
 * has written `type: "image"` and bookmarkEntry() `type: "bookmark"` since v6
 * §8, and the three story fixtures do too, so nothing that was a figure stops
 * being one. An object with no type at all was a figure before and is a block
 * now; there is no such object in the repo, and a block is the safer landing —
 * a block with no kind draws as an ordinary line of prose, where a figure with
 * no bitmap gets spliced out of the passage entirely by loadFigures().
 */
const PICTURE_TYPES = new Set(["image", "bookmark"]);
export const isFigure = (entry) =>
    !!entry && typeof entry === "object" && PICTURE_TYPES.has(entry.type);
export const isBookmark = (entry) => isFigure(entry) && entry.type === "bookmark";
export const isBlock = (entry) => !!entry && typeof entry === "object" && !isFigure(entry);
/* Every consumer that wants the WORDS of an entry, whichever shape it is. A
   rule has none and that is not a special case here — it is an empty string,
   and nothing asks a rule for its text. */
export const entryText = (entry) => (isBlock(entry) ? String(entry.text ?? "") : String(entry ?? ""));

/* -------------------------------------------------------------------------
 * §2's block geometry
 *
 * TWO RATIOS, AND MIXING THEM IS THE TRAP THIS BLOCK EXISTS TO AVOID.
 *
 *   TYPE AND SPACING take 2.5x. The site's 16px reading face is bodySize 40.
 *   RULES take 4x. The site's 1px hairline is 4 on the card — see
 *     LAYOUT.bandRule, which derives it: 1 CSS px is 1/96in, which at 300dpi is
 *     3.125 trim units, and 4 is the nearest grid value to 3.125.
 *
 * A trim unit is 1/300 inch: TRIM_W 1200 x TRIM_H 1800 is a 4x6 card at 300dpi.
 *
 * *** THE QUOTE'S INSET IS 60, NOT THE 96 CHECKLIST-v8 §2.1 CARRIES, AND THIS
 * IS THE ONE NUMBER IN §2 THAT WAS CHANGED RATHER THAN TRANSCRIBED. ***
 * §2.1 derived it as "the 4px rule becomes 16, and the 24 inset scales by the
 * same 4 to 96" — and then instructed, in the same sentence, CONFIRM THAT RATIO
 * AGAINST §1's REASONING BEFORE USING IT. Confirmed, and it does not hold. The
 * "4" is not a ratio at all: it is 3.125 rounded to the grid, and it is an
 * argument about how a HAIRLINE has to print, which is why LAYOUT.bandRule
 * makes it and why it is right for the 4px border. An INSET is spacing, and
 * §2.3 states the card's rule for spacing outright — every spacing takes 2.5x,
 * and the divider's gap is the single named exception. 24 x 2.5 = 60, on the
 * grid. Taking 96 would have been a second unnamed divergence smuggled in as
 * arithmetic, which is exactly the failure §2.0's "the card's type scale is
 * 2.5x and not 4x" item was written to catch.
 * ---------------------------------------------------------------------- */

/* THE QUOTE. content-cards.css `.qntns-content__body blockquote`: a 4px
   --color-ink rule on the inline start, 24px of padding inside it, italic, and
   NO block margin of its own — it takes the ordinary --content-para-gap from
   `.qntns-content__body > * + *` like any other block. So a quote LINE costs
   exactly one body row, and the whole cost of a quote is horizontal. */
export const QUOTE_RULE = 16;   /* the site's 4px rule at the 4x rule ratio */
export const QUOTE_INSET = 60;  /* the site's 24px padding at the 2.5x spacing ratio */

/* THE HEADINGS. content.css `.qntns-content__body :is(h1, h2)` 24px, `h3` 20px,
   `:is(h4, h5, h6)` 16px, over type.css:154-163's --font-ui at weight 700 and
   line-height 1.15. h1 AND h2 ARE THE SAME SIZE ON PURPOSE — content.css says
   so where it sets them; do not turn them into a ladder.

   THE FACE IS THE CARD'S OWN BODY FACE AT 700, NOT JOSEFIN, and that is RULED
   rather than forced: JosefinSans ships and could have been drawn. OpenDyslexic
   Bold at 60 against body text at 40 regular is unmistakably a heading and it
   costs one weight of a face the card already has, instead of a whole family
   and a variable-font axis the canvas has to resolve.

   TWO NAMED ROUNDINGS, BOTH REQUIRED BY CLAUDE.md AND BOTH TAKEN HERE:

     h3   20 x 2.5 = 50, WHICH IS OFF THE GRID. 48 and 52 are equidistant, so
          base 4 does not decide it. 48 does: CLAUDE.md names the 8px grid as
          the rhythm the layout lands on and 4 as the floor it may not go below,
          and 48 is on the 8 where 52 is not. The ladder stays 60 / 48 / 40.
     gap  12 x 2.5 = 30, ALSO OFF THE GRID, and 28 and 32 are equidistant again.
          Same tiebreak, same answer: 32 is on the 8 and 28 is not. It also
          rounds AWAY from the text, which is the direction LAYOUT.bodyLead
          already rounds in — nothing on the card ends up tighter than the
          article.

   The 32-above gap is clean: 32 x 2.5 = 80. content.css's reason for the pair
   carries across and is why they are two different numbers rather than one:
   the space above is larger than a paragraph gap so the heading reads as a
   break, and the space below is smaller so the line under it reads as attached.

   A HEADING'S OWN LINE IS ONE BODY ROW AND THAT IS MEASURED, NOT ASSUMED. The
   site's leading is 1.15, so the tallest heading is 60 x 1.15 = 69, inside the
   72-unit row. The row is what keeps every line after a heading on the body's
   own baseline grid. */
/* H1 IS UNREACHABLE ON A LIVE POST AND THE ENTRY IS KEPT ANYWAY. content.js's
   demoteBodyHeadings() replaces every body h3/h2/h1 with the tag one level
   down before anything here runs, so a writer's h1 is an h2 by the time
   readArticle sees it and draws at 60 through H2; an h2 is an h3 and draws at
   48. THAT IS NOT A BUG AND THE SIZES MUST NOT BE SHIFTED TO "FIX" IT:
   content.css:406-408 sizes by the FINAL tag too, so the card and the page
   agree today, and renumbering this table would break that agreement rather
   than restore it. H1 stays because the demotion is JavaScript — with it off
   the h1 stays an h1, which CLAUDE.md requires the theme to survive — and
   because readArticle can be called on markup that never met content.js at
   all, which is what the story fixtures are. */
export const HEADING_SIZE = { H1: 60, H2: 60, H3: 48, H4: 40, H5: 40, H6: 40 };
export const HEADING_ABOVE = 80;
export const HEADING_BELOW = 32;

/* THE DIVIDER. content.css `.qntns-content__body hr`: a 2px --color-ink rule,
   width 100% capped at 80% of the measure, with margin-block of twice
   --content-para-gap — 48 above and 48 below.

   *** NAMED DIVERGENCE, RULED 2026-09-01, AND IT IS A DIVERGENCE FROM THE RATIO
   RATHER THAN FROM THE NUMBER. *** Faithfully translated the gaps would take
   the 2.5x spacing ratio and be 120 each, so the divider would cost
   120 + 8 + 120 = 248 of a 1296-unit body — a fifth of the card for a block
   with no words in it, and three dividers in an opening would spend more than
   half of it on nothing anybody can read. The card instead draws THE SITE'S OWN
   48, unchanged, at 1x. That is the whole divergence and it is one sentence:
   every other spacing on this card takes 2.5x and the divider's gap alone takes
   1x, because a divider's gap is the one spacing here whose job is done as well
   by less of it. 48 + 8 + 48 = 104, which is 4 x 26 and on the grid, and it
   costs 1.4 body rows instead of 3.4. A freely-chosen 60 or 72 would have been
   a number nobody could justify later; 48 is not a new number at all.

   THE 8 RULE IS NOT A DIVERGENCE. A rule takes the 4x: 2 -> 8.

   THE 80% IS EXEMPT FROM BASE 4 AND THE SITE ALREADY SAYS SO, at content.css
   where it is set: "80% is a proportion of a container, not a spacing value, so
   base 4 does not apply to it." That exemption carries across and is re-stated
   here because CLAUDE.md requires an exemption to be named where it is taken.
   0.8 x 1056 = 844.8 and it is drawn at 844.8.

   LEFT-ALIGNED, WHERE THE SITE CENTRES IT. The site's hr inherits
   `margin-inline: auto`; the card puts every block on the body's own left
   margin, which is the same call CHECKLIST-v7 §2.2 made for a picture and for
   the same reason — the eye reads a left edge. Centring would also put the
   rule's left end at (1056 - 844.8) / 2 = 105.6, off the grid, from a number
   that is only on the grid by exemption. */
export const RULE_GAP = 48;
export const RULE_WEIGHT = 8;
export const RULE_PROPORTION = 0.8;
export const RULE_H = RULE_GAP + RULE_WEIGHT + RULE_GAP;       /* 104 */
export const RULE_H_LAST = RULE_GAP + RULE_WEIGHT;             /* 56 */

/* THE LISTS. content.css:448-575 is the design and it SHIPPED FIRST, on the
   site, as f0ed972 — so this is a translation of an approved thing and not a
   decision taken here. The site's geometry, both lists sharing one:

       0                        28  32
       |------ marker column ----|-4-|-- text ---------------
                             "10." | and the 4x4 square is
                                   | centred in the same column.

   THE RATIO TRANSLATES; THE PIXELS DO NOT. §2.1's 96 was a ratio applied to a
   number it did not come from, and 28 x 2.5 = 70 would be that same mistake
   twice over — 70 is off the grid AND 28 is a MEASURED number, derived against
   the SITE's 16px face. So the column is re-derived here against the CARD's
   face and size, from the same inputs.

   THE COLUMN, DERIVED. OpenDyslexic's digits are proportional, not tabular.
   content.css:466-470 reads the advances per 1000upem out of the shipped
   OpenDyslexic-Regular.otf's hmtx — 0:650 1:581 2:609 3:626 4:678 5:618 6:650
   7:610 8:666 9:649, period 292 — and those are the same file the card draws
   with, so the only thing that changes is the size. Width scales linearly with
   it, which is why this is a re-derivation and not a rescale of the answer:

       card body face   400 40px OpenDyslexic   (LAYOUT.bodySize, BODY_FONT)
       "10."   (581 + 650 + 292) / 1000 x 40  =  60.92   the 9 -> 10 jump
       "44."   (678 + 678 + 292) / 1000 x 40  =  65.92   the widest two digits
       next grid step above 65.92            =  68       and it clears it by 2.08

   68, NOT 70. The site took the next grid step above its own worst case (26.37
   -> 28) and this takes the next grid step above the card's (65.92 -> 68). Same
   derivation, same rule, one number apart from the naive scale — and 68 is on
   the grid where 70 is not.

   THE TEXT EDGE IS 80, WHICH IS THE ONE NUMBER THAT DOES TAKE THE 2.5x: it is a
   spacing, the site's 32, and 32 x 2.5 = 80 lands on the grid and on the 8.
   THE GAP IS WHAT FALLS OUT: 80 - 68 = 12. The site's 4px gap at 2.5x is 10,
   off the grid, with 8 and 12 equidistant — so the gap is not chosen at all,
   it is the slack between a measured column and a ratio'd edge, and it happens
   to be the one of the two that rounds AWAY from the text, which is the
   direction LAYOUT.bodyLead already rounds in.

   RIGHT-ALIGNED, WHICH IS THE WHOLE REASON THE COLUMN IS FIXED — the numeral
   grows leftward into its own column and the text edge never moves, so the
   9-to-10 jump does not shove the tenth item sideways. content.css says the
   same thing where it sets `text-align: end`.

   PAST 99 IT OVERFLOWS, DELIBERATELY, exactly as the site rules: "444." is
   (678 x 3 + 292) / 1000 x 40 = 93.04 and would hang 25 units into the left
   margin. A hundred-item list is not worth widening every list for. If one is
   ever written the fix is to raise the column for that list, not to re-derive
   this.

   THE ITEM GAP IS CLEAN: the site's 8 between items x 2.5 = 20, on the grid. It
   is a THIRD of the paragraph gap for the site's own reason — items in one list
   are more closely related to each other than two paragraphs are. It is spent
   ONCE PER ITEM, above every item but the first, and never per display line;
   that is the same discipline HEADING_ABOVE takes and it is enforced the same
   way, through wrapLines()'s first/last. An eleven-item list therefore costs
   11 x 72 + 10 x 20 = 992 of the 1296 budget.

   THE BULLET IS A 12x12 SQUARE, AND THE SIZE IS FORCED RATHER THAN PICKED. The
   site's is 4x4 — RULED by the user, "It should be a perfect square, maybe
   4x4px" — and 4 x 2.5 = 10, off the grid with 8 and 12 equidistant. The
   tiebreak is not taste: the square is CENTRED in the marker column, so the
   column minus the square must halve onto the grid. 68 - 8 = 60, halved is 30,
   OFF THE GRID. 68 - 12 = 56, halved is 28, on it. 12 is the only one of the
   two that centres without an exemption, so the square is 12 and it sits 28
   from the list's left edge, spanning 28 to 40 with 40 of air before the text.
   The site's is 12 to 16 with 16 of air — 16/32 and 40/80 are both exactly a
   half, so the two lists have the same proportions at both scales.

   DO NOT "FIX" THE SQUARE TO A DISC. A disc is the browser's default and is
   what the ruling rejects; every object in this theme has square corners. The
   2x2 the user floated as a fallback — "Or 2x2 if 4 is too big" — would be
   under the grid's floor on the site and is a named exemption THEY have to ask
   for. It has not been asked for and must not be substituted quietly here
   either.

   THE SQUARE'S HEIGHT ABOVE THE BASELINE IS 20, AND IT IS CENTRED ON THE CAP OF
   THE FIRST LINE rather than in the line box — the same call content.css makes,
   for the same reason: the cap is what the eye reads a bullet against. The card
   puts all of a body row's leading ABOVE the baseline (see drawBlock), so the
   arithmetic is measured from the baseline and not from the row's top:

       cap height   11.664px at 16px (content.css:471, canvas
                    actualBoundingBoxAscent of "H" off the shipped face)
                    x 40/16  =  29.16 above the baseline at the card's size
       cap middle   29.16 / 2  =  14.58 above the baseline
       a 12 square centred there wants its top at 14.58 + 6 = 20.58
       20 IS THE GRID VALUE 0.58 AWAY, so it is centred on the cap to within
       three fifths of a unit — 1/500 of an inch on the printed card — and
       needs no exemption.

   If the body size or the leading ever moves, this is re-derived from those two
   inputs and not nudged. */
export const LIST_MARKER_COL = 68;   /* measured against the card's own face */
export const LIST_INDENT = 80;       /* the site's 32 text edge at the 2.5x spacing ratio */
export const LIST_ITEM_GAP = 20;     /* the site's 8 between items at 2.5x */
export const LIST_SQUARE = 12;       /* the site's 4x4 square, sized to centre on the grid */
export const LIST_SQUARE_RISE = 20;  /* the square's top above the baseline */

/* THE CODE BLOCK. code.css: 14px IBM Plex Mono on a 24px line, a 1px
   --color-accent border, a --color-card ground and 16 vertical / 24 horizontal
   padding. RULED 2026-09-01: the fuller component, WITHOUT the line numbers.

   WHAT IS NOT HERE, AND NEITHER OMISSION IS A COMPROMISE:

     THE COPY BUTTON. It is chrome, and chrome never enters the canvas —
     DECISIONS-LOG.md #37 and CLAUDE.md. paintPreview() and exportFront() are
     one function at two scales, so a button drawn here is a button printed on a
     card somebody paid to have mailed.
     THE 56 GUTTER AND ITS LINE NUMBERS. The user ruled the numerals out and the
     gutter went with them, because the gutter exists to hold them and holds
     nothing else. It was a WIDTH cost only: its 140 units go back to the
     measure, the vertical arithmetic below is untouched by it, and there is NO
     wrap divergence to name — the card's code measure is derived from the full
     1056 exactly as the site's is from its own.

   ONE NAMED ROUNDING: 14 x 2.5 = 35, WHICH IS OFF THE GRID. 36 is one unit away
   and 32 is three, so unlike the heading pair this one is not a tie — it rounds
   up to 36. Everything else is clean: the 24 line -> 60, the 16 vertical
   padding -> 40, the 24 horizontal -> 60, and the 1px border is a RULE and
   takes the 4x -> 4.

   ONE ENTRY PER CODE LINE, AND THAT IS BINDING RATHER THAN A WORKAROUND. It is
   what §2.2's one-source-line-one-entry contract already requires of every
   other kind. It is ALSO what stops maxLines() meeting a single oversized entry
   that does not fit and dropping it whole — the silent disappearance §2 was
   opened to close, reintroduced by §2's own fix. A block of N lines is
   40 + 60N + 40 + 4 + 4 = 88 + 60N, which against bodyBudget()'s 1296 solves to
   N = 20.1: TWENTY-ONE LINES OF CODE STILL EXCEED THE WHOLE BODY BUDGET. Per-line
   entries mean such a block runs past the window like a long passage instead of
   vanishing. DO NOT REBUILD IT AS ONE ENTRY PER <pre>.

   CODE_CAP IS THE 44 A FIRST OR LAST LINE CARRIES: the 40 of padding and the 4
   of border on that end. A middle line is CODE_LEAD alone, 60. A one-line block
   is first AND last, so 60 + 44 + 44 = 148, which is 88 + 60 x 1 — the same
   arithmetic, not a second one.

   THE GROUND IS THE SAME COLOUR AS THE CARD TODAY, AND IT IS STILL DRAWN.
   --color-card is the site's code ground AND the postcard's own ground (see
   paintFront's first fill), so the slab is currently invisible and the 4 accent
   border is what separates the block from the passage. That is an observation
   about two tokens, not a reason to stop reading one of them: the day
   --color-card and the card's ground diverge, the code block should follow the
   site's token rather than the card's. */
export const CODE_SIZE = 36;
export const CODE_LEAD = 60;
export const CODE_PAD_Y = 40;
export const CODE_PAD_X = 60;
export const CODE_RULE = 4;
export const CODE_CAP = CODE_PAD_Y + CODE_RULE;                /* 44 */
/* Half-leading, exactly as the site sets a 14px face on a 24px line: (60 - 36)
   / 2 = 12 above the em box, so the baseline sits 12 + 36 = 48 below the row's
   top. 48 is on the grid, and 48/60 is 0.8 where the site's 19/24 is 0.79 — the
   same placement, not a new one. This is the one text kind on the card that
   does NOT put all of its leading above the baseline, and the reason is that a
   code row is drawn INSIDE a box with visible padding, where a prose row is
   not: all-leading-above would read as 76 units of padding at the top of the
   block and 36 at the bottom. */
export const CODE_BASE = (CODE_LEAD + CODE_SIZE) / 2;          /* 48 */

/*
 * A CALLOUT IS EXACTLY AS TALL AS A PICTURE, AND THAT IS THE ANSWER RATHER THAN
 * A COINCIDENCE.
 *
 * The height was worked out from what has to fit ACROSS the row, not from what
 * the art wants to be. The code is square and is sized from the row's height,
 * so every unit of height costs a unit of width TWICE over — once for the code
 * and once for the thumbnail beside it — and the type in between pays for both.
 * At the 1056-unit measure:
 *
 *   H = 288   1056 - 288 (code) - 40 (gap) - 288 (art) - 40 (gap) = 400 for type
 *   H = 360   1056 - 360        - 40       - 360       - 40       = 256 for type
 *
 * A TALLER CALLOUT IS A NARROWER ONE. 360 buys a bigger picture and takes a
 * third of the words away to pay for it, which is the wrong trade on an object
 * whose job is to say where a link goes. So the height is settled at the
 * smallest value that clears the constraints, and 288 clears them:
 *
 *   - it is 4 x bodyLead, so the rows after a callout are still on the text
 *     baseline, which is the rule §8.2 set for a tall entry;
 *   - entryHeight() tests a bookmark before a figure and returns CALLOUT_H,
 *     so the §8 height budget accounts for it with no branch of its own. It
 *     used to be `= FIGURE_H`; CHECKLIST-13 §16 doubled the picture to 576
 *     and left the callout here, because the trade above has not changed;
 *   - 400 units of type is two lines of 40px title plus a publisher, which is
 *     what a link callout actually has to say.
 *
 * THE HEIGHT IS FIXED AND THE ART IS FITTED INTO IT, not the other way round.
 * Letting the thumbnail decide would mean an entry whose height depends on a
 * picture from another website — a number the budget cannot be written against
 * and a baseline the text after it cannot rely on. A bookmark with no thumbnail
 * at all is still 288 tall; it simply gives the words the space.
 */
export const CALLOUT_H = 288;

/* entryHeight() lives further down, beside bodyBudget() and figureBlock(). */

/*
 * THE QUOTE CARD. CHECKLIST-v11 §6.5.
 *
 * A #home-content postcard is a different KIND of card, not a different value
 * handed to this one. Three things change and they all follow from one
 * sentence — THE WHOLE PASSAGE ALWAYS SHOWS:
 *
 *   the type is sized to the passage, instead of the passage being windowed
 *   to the type;
 *   there is no closing ellipsis and no reserve held for one, because nothing
 *   is ever left out;
 *   a blockquote draws as plain text, because EVERY entry on the card is one
 *   and a rule down the left of all of them marks nothing.
 *
 * WHY THE SIZE IS WRITTEN ONTO `LAYOUT` ITSELF, WHICH LOOKS LIKE THE WORST
 * OPTION AND IS THE SAFEST ONE.
 *
 * The size has to reach blockFont, blockMeasure, wrapLines, blockHeight,
 * entryHeight, maxLines, bodyBudget and drawBlock. This file states the same
 * invariant in five places — MEASURING AND DRAWING MUST AGREE — and blockFont's
 * own comment names the failure exactly: a heading measured in the 40px body
 * face and drawn at 60 breaks in the wrong places. Threading a size through
 * eight signatures makes that agreement something every future edit has to
 * remember. One value that all eight already read makes it structural: there is
 * no second copy to fall behind, because there is no second copy.
 *
 * IT CANNOT LEAK, and that is a property of the call graph rather than a hope.
 * withQuoteType() saves and restores around every call and is properly
 * nestable, and paintFront is SYNCHRONOUS end to end — the fonts and the
 * figures are awaited BEFORE it is entered, never inside it (see loadFigures())
 * — so no other paint and no other card can observe the value set. Nothing here
 * is async, so there is no frame on which a half-restored LAYOUT exists.
 *
 * paintPreview() AND exportFront() BOTH GO THROUGH paintFront, so the preview
 * and the file the printer gets are sized by the same run of the same search.
 * That is DECISIONS-LOG.md #37's rule holding for the TYPE as well as for the
 * chrome: one function at two scales, and now also at one size.
 *
 * null means "an ordinary postcard", which is every card in the theme but this
 * one.
 */
let quoteCard = null;

/* 1.8, the same ratio LAYOUT.bodyLead is — 40 x 1.8 is 72 — rounded to the
   nearest 4 so the passage stays on the baseline grid at every size it lands
   on. The rounding goes to the NEAREST rather than up: at these sizes up would
   drift the leading looser than the article's the further the type grows, and
   the ratio is what is meant to be kept. */
const quoteLead = (size) => Math.round((size * 1.8) / 4) * 4;

/* The floor of the search. 28 is on the grid and is the smallest the reading
   face stays a reading face at this trim — 28 trim units is about 11 CSS px on
   the printed card. A passage that will not fit at 28 is drawn at 28 and
   overflows, which is a passage nobody would put on a postcard; the alternative
   is silently cutting words off a card the sender is paying to mail. */
const QUOTE_SIZE_MIN = 28;

/* THE SETTING, SAVED AND RESTORED AROUND ONE CALL. Nestable on purpose:
   fitQuoteType() runs this once per candidate size and paintFront runs it once
   around the whole drawing, and neither has to know about the other. */
const withQuoteType = (size, fn) => {
    const size0 = LAYOUT.bodySize;
    const lead0 = LAYOUT.bodyLead;
    const was = quoteCard;
    quoteCard = { size };
    LAYOUT.bodySize = size;
    LAYOUT.bodyLead = quoteLead(size);
    try {
        return fn();
    } finally {
        LAYOUT.bodySize = size0;
        LAYOUT.bodyLead = lead0;
        quoteCard = was;
    }
};

/* THE READER'S TEXT SIZE (§13.3), SAVED AND RESTORED THE SAME WAY. One step is
   size ±4 and lead ±8, which keeps the 40/72 ratio and both on base 4; the
   range −4…+4 is 24/40 to 56/104. It goes through LAYOUT itself so bodyBudget,
   maxLines, wrapLines and poemHang all see it. Never on a quote card — that
   card sizes itself, and its A buttons are dead.

   §13.18: past +4 a step is size +16 (the user's "+4 to 56, then +16"), so +13
   is 200. The step itself is recorded in `textStep` for the pictures, which
   grow 32 a step whatever the lead does (§13.26): mosaicTarget(), figureBlock()
   and the full-front zoom read it.

   §13.27: THE LEAD IS A TABLE, AND LEAD ÷ SIZE FALLS AT EVERY STEP. It is the
   line through step 0 (40/72) and the top (200/212), lead = 37 + 0.875 × size,
   so lead ÷ size = 0.875 + 37 ÷ size, which falls as the size grows. Each value
   is rounded to base 4, ties up except at 24 (up would equal 28's 60); every
   value is within 2 of the line. It is a table because no one rounding rule
   keeps it strictly rising: ties-up collides at 24, ties-down at 56.

     step  −4  −3  −2  −1   0  +1  +2  +3  +4  +5  +6  +7  +8  +9 +10 +11 +12 +13
     size  24  28  32  36  40  44  48  52  56  72  88 104 120 136 152 168 184 200
     lead  56  60  64  68  72  76  80  84  88 100 116 128 144 156 172 184 200 212

   −4 is 2.33 and +13 is 1.06: small type gets relatively more air, poster type
   reads as lines rather than islands. The table is absolute at LAYOUT's own
   72; withTextStep applies it as an offset from the lead in force. */
const TEXT_STEP_MIN = -4;
const TEXT_STEP_MAX = 13;
const LEADS = [56, 60, 64, 68, 72, 76, 80, 84, 88, 100, 116, 128, 144, 156, 172, 184, 200, 212];
/* A mosaic row reaches 576, a wrap-on picture at step 0, at +9 (§13.24). */
const PHOTO_STEP_MAX = 9;
/* A single picture grows every step, 448 at −4 … 992 at +13, because with the
   table above every block fits its window: block ≤ bodyBudget() = 1296
   (§13.31; a picture pays no closingTail), and the largest is +13,
   576 + 32 × 13 = 992 ≤ 1296 (§13.27). */
const FIGURE_STEP_MAX = 13;
let textStep = 0;
const withTextStep = (step, fn) => {
    const size0 = LAYOUT.bodySize;
    const lead0 = LAYOUT.bodyLead;
    const step0 = textStep;
    const low = Math.min(step, 4);
    const high = Math.max(0, step - 4);
    LAYOUT.bodySize = size0 + 4 * low + 16 * high;
    LAYOUT.bodyLead = lead0 + LEADS[step - TEXT_STEP_MIN] - LEADS[-TEXT_STEP_MIN];
    textStep = step;
    try {
        return fn();
    } finally {
        LAYOUT.bodySize = size0;
        LAYOUT.bodyLead = lead0;
        textStep = step0;
    }
};

/* The body face, as a FUNCTION, because its size is no longer a constant. It
   used to be `export const BODY_FONT` and a precomputed string goes stale the
   moment the search moves the size. Nothing outside this file ever read it. */
const bodyFont = () => `400 ${LAYOUT.bodySize}px "OpenDyslexic", Arial, sans-serif`;

/*
 * THE FACE AND THE MEASURE A BLOCK IS SET IN. Both are read here rather than at
 * the draw site, because WRAPPING AND DRAWING HAVE TO AGREE: a heading measured
 * in the 40px body face and then drawn at 60 would break in the wrong places,
 * which is the same class of fault as measuring a budget with one height and
 * drawing another. One function, two callers.
 */
export const blockFont = (entry) => {
    if (isBlock(entry)) {
        if (entry.type === "code") return `400 ${CODE_SIZE}px "IBM Plex Mono", ui-monospace, monospace`;
        if (entry.type === "heading") return `700 ${entry.size}px "OpenDyslexic", Arial, sans-serif`;
        if (entry.type === "quote") return `italic 400 ${LAYOUT.bodySize}px "OpenDyslexic", Arial, sans-serif`;
    }
    return bodyFont();
};

/* A QUOTE AND A CODE BLOCK COST WIDTH, AND §2.3 NAMES THAT AS THE COST THAT
   GETS MISSED: a narrower measure wraps the same words into MORE ROWS, so a
   horizontal change arrives as a vertical one. It is not missed here because
   the budget walks the WRAPPED array. */
export const blockMeasure = (entry, maxWidth) => {
    if (!isBlock(entry)) return maxWidth;
    /* ON A QUOTE CARD THE QUOTE COSTS NO WIDTH, because it is not marked as a
       quote at all — see quoteCard above. Every entry is a blockquote there, so
       a rule and an inset applied to all of them would step the whole passage
       in from the margin and mark nothing off from anything. The measure and
       the draw both drop it, which is the agreement this pair exists for:
       drawBlock's two `!quoteCard` tests are the other half of this one. */
    if (entry.type === "quote") return quoteCard ? maxWidth : maxWidth - QUOTE_RULE - QUOTE_INSET;
    if (entry.type === "code") return maxWidth - (CODE_RULE + CODE_PAD_X) * 2;
    /* A LIST ITEM IS SET AGAINST THE TEXT EDGE, NOT THE MARGIN, on every
       display line of it — a wrapped second line lines up under the first word
       and not under the numeral, which is what the marker column is for. */
    if (entry.type === "list") return maxWidth - LIST_INDENT;
    return maxWidth;
};

/* Prose, a quote and a heading all break between words. An empty source line
   survives as an empty display line — that is what keeps the blank line between
   two stanzas, and it is why the emptiness is tested before the loop.

   `restWidth` is the measure of every piece after the first, which is how a
   poem's hanging indent costs width: see poemHang. Prose leaves it equal.

   A WORD WIDER THAN ITS LINE IS BROKEN, no hyphen, the way wrapMono breaks
   code (§13.18: at 200 a 20-letter word is wider than the card). As many
   graphemes as fit, then the rest on the next line, at least one a line. */
/* THE BREAK STEPS BY GRAPHEME, NOT BY UTF-16 UNIT. `.slice(0, n)` cut 😀 into
   two lone surrogates (§13.18 refuter), which draw as tofu on the card and on
   the mailed PNG; a ZWJ family or a flag split the same way. Intl.Segmenter
   keeps those whole in every browser Ghost runs in; Array.from (code points)
   is the fallback for whatever lacks it, and it still never halves a pair. */
const segmenter = typeof Intl !== "undefined" && Intl.Segmenter
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;
const graphemes = (text) => (segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text));

const wrapWords = (ctx, line, maxWidth, track, restWidth = maxWidth) => {
    if (!line.trim()) return [""];
    const out = [];
    const room = () => (out.length ? restWidth : maxWidth);
    let current = "";
    for (const word of line.split(/\s+/)) {
        const candidate = current ? `${current} ${word}` : word;
        if (current && trackedWidth(ctx, candidate, track) > room()) {
            out.push(current);
            current = word;
        } else {
            current = candidate;
        }
        if (trackedWidth(ctx, current, track) <= room()) continue;
        /* Over-wide: cut pieces off the front until the rest fits. `at` walks
           the grapheme array instead of re-slicing the string, and each cut is
           found by galloping (1, 2, 4 …) then bisecting, so a 20k-character
           word measures about twice what fits per piece rather than the whole
           remainder — the old scan was quadratic. `lo` always fits (one
           grapheme is the floor, fit or not); `hi` does not, or is past the
           end. lo === len means the rest fits, which ends the loop. */
        const units = graphemes(current);
        let at = 0;
        for (;;) {
            const len = units.length - at;
            const width = room();
            const fits = (n) => trackedWidth(ctx, units.slice(at, at + n).join(""), track) <= width;
            let lo = 1;
            let hi = 2;
            while (hi <= len && fits(hi)) {
                lo = hi;
                hi *= 2;
            }
            hi = Math.min(hi, len + 1);
            while (hi - lo > 1) {
                const mid = (lo + hi) >> 1;
                if (fits(mid)) lo = mid;
                else hi = mid;
            }
            if (lo === len) break;
            out.push(units.slice(at, at + lo).join(""));
            at += lo;
        }
        current = units.slice(at).join("");
    }
    if (current) out.push(current);
    return out;
};

/*
 * THE RUNT LINE, AND WHY IT IS MENDED BY MOVING A WORD DOWN RATHER THAN BY
 * REJECTING THE SIZE. CHECKLIST-v11 §6.5, the user's rule, RAISED TO 15 ON
 * 2026-09-09: "for the postcard, don't break lines when there is less than 15
 * characters". It was 5.
 *
 * A quote card sizes its type up until the passage only just fits, so it lands
 * on the worst case for a widow far more often than an ordinary card does: the
 * last line of a paragraph holding one short word, with a whole line's width
 * of white beside it. Fifteen characters is the threshold the user set.
 *
 * RAISING IT MAKES THE MEND FIRE MORE OFTEN, NOT HARDER, and that is why the
 * number can move without anything else moving with it. The two refusals below
 * are what bound it: the mended line is measured and left alone if it will not
 * fit, and a one-word previous line is never emptied. A 15-character threshold
 * asks the question of most final lines rather than of a few, and the answer
 * is still no whenever the words do not go — so the worst case is the old
 * behaviour, on a line the old threshold would not have looked at.
 *
 * IT IS STILL ONE WORD, AND A MENDED LINE CAN STILL BE SHORTER THAN 15. Moving
 * a second word would need the line above to be re-measured as well, and the
 * point of the mend is that it costs no line — see below. A 3-character runt
 * that gains a 4-character word is 8 and is left there, which reads as
 * deliberate even though it does not reach the threshold.
 *
 * THE FIX MOVES A WORD DOWN, WHICH COSTS NO LINE. Pulling the previous line's
 * last word onto the runt makes both lines look deliberate and leaves the LINE
 * COUNT alone — so the budget the search measured is the budget the drawing
 * uses, and this cannot push a card that fitted into one that does not. The
 * alternative considered and rejected was to treat a runt as a bad fit and try
 * the next size down; it works, and it makes every card with an awkward final
 * word noticeably smaller for a reason the reader cannot see.
 *
 * IT REFUSES TO MAKE A LINE THAT DOES NOT FIT. The moved word plus the runt can
 * be wider than the measure — a 4-character runt after a long word — and a line
 * over the measure would run off the card, which is worse than the widow. So
 * the mended line is measured before it is accepted and the runt is left alone
 * when it will not go.
 *
 * A ONE-WORD PREVIOUS LINE HAS NOTHING TO GIVE. Taking its only word would
 * leave an empty line, so that case is left as it is.
 *
 * QUOTE CARDS ONLY. Every other card in the theme breaks exactly where the
 * article breaks, which is the whole point of the body face and of bodyTrack
 * being 0 — see wrapLines. This is a rule about a card whose type size nobody
 * chose, so it applies only where that search runs.
 */
const WIDOW_MIN = 15;

/*
 * A POEM LINE THAT WRAPS HANGS, THE WAY IT DOES ON THE SITE. CHECKLIST-13 §4.
 *
 * content.css sets a poem's paragraphs `padding-left: 2em; text-indent: -2em`,
 * so a line opens at the margin and its continuation sits 2em in — that is how
 * a reader tells a real line from a wrapped one. The card does the same at its
 * own body size: 2 x 40 = 80 today, the same 80 as LIST_INDENT.
 *
 * READ AT CALL TIME, NOT FROZEN, so it follows whatever the body size is when
 * the wrap runs — the text-size step and a quote card's search both move it.
 * Twice a multiple of 4 is a multiple of 4, so the hang is always on the grid.
 *
 * wrapLines() measures continuation pieces this much narrower and paintFront's
 * poem branch draws them this much in. One function, both callers.
 */
const poemHang = () => 2 * LAYOUT.bodySize;

const mendWidow = (ctx, pieces, maxWidth, track) => {
    if (pieces.length < 2) return pieces;
    const runt = pieces[pieces.length - 1];
    if (runt.trim().length >= WIDOW_MIN) return pieces;
    const words = pieces[pieces.length - 2].split(/\s+/);
    if (words.length < 2) return pieces;
    const moved = words[words.length - 1];
    const mended = `${moved} ${runt}`;
    if (trackedWidth(ctx, mended, track) > maxWidth) return pieces;
    return [...pieces.slice(0, -2), words.slice(0, -1).join(" "), mended];
};

/*
 * CODE BREAKS BETWEEN CHARACTERS, NOT BETWEEN WORDS, AND THAT IS NOT A
 * REFINEMENT — word-wrapping code would collapse its runs of spaces and lose
 * the indentation, which is the one thing about a line of code that a reader
 * cannot reconstruct. The slice keeps every character the writer typed,
 * leading whitespace included.
 *
 * THE COLUMN COUNT IS MEASURED, NOT ASSUMED. On a monospace face every advance
 * is equal — which is the same fact fillTracked() relies on — so one
 * measureText tells us the width of all of them and the count is a division.
 * The card's code measure is the full body measure less its own border and
 * padding, derived the same way the site derives its own, so code breaks in the
 * same places on both and there is no divergence to name.
 */
const wrapMono = (ctx, text, maxWidth) => {
    const src = String(text ?? "");
    if (!src) return [""];
    const advance = ctx.measureText("0").width;
    if (!advance) return [src];
    const per = Math.max(1, Math.floor(maxWidth / advance));
    const out = [];
    for (let i = 0; i < src.length; i += per) out.push(src.slice(i, i + per));
    return out;
};

/*
 * WRAP OFF: A RUN OF PICTURES PACKS INTO JUSTIFIED ROWS. DECISIONS-LOG.md #76,
 * CHECKLIST-13 §2.
 *
 * EACH ROW IS ONE WINDOW ENTRY, { type: "mosaic", run, figures, h }, so
 * maxLines(), the chevrons and the rail step a mosaic row by row with no new
 * code. `run` is shared by every row cut from one run of pictures (§10 reads it).
 *
 *   target  MOSAIC_ROW 288 = 4 x bodyLead, its own constant: CHECKLIST-13 §16
 *           doubled FIGURE_H to 576 and left the mosaic where it was
 *   gap     MOSAIC_GAP 8 between pictures, and 8 above each row — ABOVE, not
 *           below as the checklist wrote it, so a row after text clears the
 *           descenders the way FIGURE_PAD does. Rows are still 8 apart.
 *   entry   h + 8. Base 4; not a multiple of 72, and blocks already break that.
 *
 * A picture joins the row until, at the target height, the row passes the
 * measure. That row's height is then solved to span it and floored to 4 — so it
 * never exceeds the target, and the leftover from the floor (at most ~16) goes
 * to the row's last cell, which widens to the measure and is cover-cropped by
 * that sliver (#78, close() below). Leaving the overflowing picture for the
 * next row instead could stretch a lone portrait to the full measure, 1400-odd
 * tall, past the whole budget. The last row is never stretched: it stays at
 * the target, left-aligned, and is the one row left short of the right edge.
 *
 * BASE-4 EXEMPTION, TAKEN HERE: every cell is w = aspect x h, no crop, and the
 * aspect is whatever the camera gave, so cell widths — and every cell x after
 * the first — are off the grid. Only h and the row's edges are on it. Only a
 * picture with a decoded bitmap can be packed; one without, and a bookmark,
 * stay single entries and end the run.
 */
const MOSAIC_ROW = 288;
/* §13.11: A± zooms the mosaic too. The target is MOSAIC_ROW + 32 x textStep,
   read off the step withTextStep recorded, not the lead: past +4 the lead grows
   32 a step and 4 x lead would grow 128. Capped at +9, 576 (§13.24), so
   160…576. A quote card is never stepped, so it keeps MOSAIC_ROW. */
const mosaicTarget = () => (quoteCard ? MOSAIC_ROW : MOSAIC_ROW + 32 * Math.min(textStep, PHOTO_STEP_MAX));
export const MOSAIC_GAP = 8;
const packable = (e) => isFigure(e) && !isBookmark(e) && e.img?.naturalWidth > 0 && e.img?.naturalHeight > 0;
const aspect = (e) => e.img.naturalWidth / e.img.naturalHeight;

export const mosaicRows = (figures, width, run = 0, target = MOSAIC_ROW, breakAfter = () => false, strictTarget = false) => {
    const rows = [];
    let row = [];
    let sum = 0;
    const close = (last) => {
        const gaps = MOSAIC_GAP * (row.length - 1);
        const h = last || strictTarget ? target : Math.max(4, Math.floor((width - gaps) / sum / 4) * 4);
        let x = 0;
        const cells = row.map((entry) => {
            const cell = { entry, x, w: aspect(entry) * h };
            x += cell.w + MOSAIC_GAP;
            return cell;
        });
        /* FLUSH (#78): a justified row's last cell takes the leftover from
           flooring h, at most ~16, and drawFigure cover-crops it by that much. */
        if (!last) cells[cells.length - 1].w += width - (x - MOSAIC_GAP);
        rows.push({ type: "mosaic", run, figures: cells, h });
        row = [];
        sum = 0;
    };
    for (const entry of figures) {
        if (strictTarget && row.length && (sum + aspect(entry)) * target + MOSAIC_GAP * row.length > width) close(true);
        row.push(entry);
        sum += aspect(entry);
        if (breakAfter(entry)) close(true);
        else if (sum * target + MOSAIC_GAP * (row.length - 1) > width) close(false);
    }
    if (row.length) close(true);
    return rows;
};

/* Full mosaics paginate whole rendered rows. The rail uses physical row
   heights, so its thumb describes the actual overflow rather than row count. */
export const mosaicPages = (rows, boxH) => {
    const pages = [];
    let count = 0;
    let offset = 0;
    let used = 0;
    for (const row of rows) {
        const rowStart = offset ? offset + MOSAIC_GAP : 0;
        if (used && used + MOSAIC_GAP + row.h > boxH) used = 0;
        if (!used) pages.push({ rows: [], pic: count, start: rowStart, h: 0 });
        const page = pages[pages.length - 1];
        const needed = page.rows.length ? MOSAIC_GAP + row.h : row.h;
        page.rows.push(row);
        page.h += needed;
        used += needed;
        offset = rowStart + row.h;
        count += row.figures.length;
    }
    return { pages, total: offset, count };
};

export const wrapLines = (ctx, lines, maxWidth, track = 0, wrap = true) => {
    const out = [];
    /* Restored after every block, because the caller set the body face before
       calling and the loop below borrows the context to measure with. */
    const bodyFace = ctx.font;
    /* Wrap off only: the pictures of the run in progress, packed when anything
       else arrives or the lines end. */
    let pending = [];
    let run = 0;
    const flush = () => {
        if (pending.length) out.push(...mosaicRows(pending, maxWidth, run++, mosaicTarget()));
        pending = [];
    };
    /* §23 WRAP OFF GATHERS EVERY PICTURE. All packable pictures move to where
       the first one was, so they pack as ONE run; the "" readArticle put after
       each goes with it. Everything else from there on follows the mosaic in
       order, after one blank — none if it opens on a heading or divider, which
       replace the gap (readArticle's dropGap). Bookmarks and unloaded images are
       not packable and move with the text. A blank left trailing is popped, as
       readArticle pops its own. */
    if (!wrap) {
        const pics = lines.filter(packable);
        const at = lines.indexOf(pics[0]);
        if (at >= 0) {
            const rest = lines.slice(at).filter((e, i, a) => !packable(e) && !(e === "" && packable(a[i - 1])));
            while (rest.at(-1) === "") rest.pop();
            const gap = rest.length && !(isBlock(rest[0]) && (rest[0].type === "heading" || rest[0].type === "rule"));
            lines = [...lines.slice(0, at), ...pics, ...(gap ? [""] : []), ...rest];
        }
    }
    /* §22 WRAP OFF RUNS A POEM ON, THE " / " WAY. readArticle gives a stanza as
       consecutive `poem` entries with a "" after it, so each run joins into one
       plain string — prose, no hang — and the "" stays as the stanza gap. An
       empty line is "" and not poem, so it never makes a slash. */
    if (!wrap) {
        const joined = [];
        let poemRun = false;
        for (const e of lines) {
            const poem = isBlock(e) && e.type === "poem";
            if (poem && poemRun) joined[joined.length - 1] += ` / ${e.text}`;
            else joined.push(poem ? e.text : e);
            poemRun = poem;
        }
        lines = joined;
    }
    for (const raw of lines) {
        if (!wrap && packable(raw)) {
            pending.push(raw);
            continue;
        }
        flush();
        /* A picture has no words in it, so there is nothing to wrap and it goes
           through whole. It still occupies exactly one slot in the wrapped
           array, which is what makes it one step for every control. A divider
           has no words either, and for the same reason. */
        if (isFigure(raw) || (isBlock(raw) && raw.type === "rule")) {
            out.push(raw);
            continue;
        }
        const block = isBlock(raw) ? raw : null;
        if (!block) {
            const plain = wrapWords(ctx, String(raw ?? ""), maxWidth, track);
            out.push(...(quoteCard ? mendWidow(ctx, plain, maxWidth, track) : plain));
            continue;
        }
        ctx.font = blockFont(block);
        const width = blockMeasure(block, maxWidth);
        /* A poem's continuation pieces are set poemHang() in, so they are
           measured that much narrower. The mend below only ever lengthens the
           LAST piece, which is a continuation, so it is held to the same. */
        const rest = block.type === "poem" ? width - poemHang() : width;
        let pieces = block.type === "code"
            ? wrapMono(ctx, block.text, width)
            : wrapWords(ctx, entryText(block), width, track, rest);
        /* Code is exempt: its breaks are character breaks that keep the writer's
           indentation, and moving a word between them would move code. */
        if (quoteCard && block.type !== "code") pieces = mendWidow(ctx, pieces, rest, track);
        ctx.font = bodyFace;
        /* ONE SOURCE LINE IS STILL ONE ENTRY PER DISPLAY LINE, AND WHATEVER A
           BLOCK PAYS ONCE STAYS ON THE ENDS. A code line that wraps into three
           pieces is three code entries, and only the outermost pieces carry
           `first`/`last` — otherwise a wrapped first line would draw the top
           border and the 40 of padding twice, and entryHeight() would charge
           the budget for both.
 
           *** THIS IS GENERAL NOW, AND IT WAS A BUG THAT IT WAS NOT. *** The
           caps were carried only for a block that already had the fields, which
           meant CODE. A heading has no `first`/`last`, so every wrapped piece
           of one used to be a whole heading: blockHeight() charged 80 + 72 + 32
           per piece and drawBlock() drew the air per piece. A heading past
           about 29 characters at 60px wraps, and two pieces then sat 184 apart
           instead of 72 — 112 units of white INSIDE one heading, and 368
           charged to what was then a 1224 budget for one line and a bit. It is now
           80 + 72 + 72 + 32 = 256 drawn and 256 charged.
 
           A BLOCK THAT NAMES NEITHER FIELD IS ITS OWN WHOLE — first and last —
           because it arrived as one entry standing for one block. A block that
           names them (code, one entry per source line) keeps exactly what
           codeEntries() decided, so `false` still means false. That is the only
           difference between `undefined` and `false` here and it is why the
           test is `!== false` rather than `=== true`. */
        const opensBlock = block.first !== false;
        const closesBlock = block.last !== false;
        for (let i = 0; i < pieces.length; i++) {
            out.push({
                ...block,
                text: pieces[i],
                first: opensBlock && i === 0,
                last: closesBlock && i === pieces.length - 1
            });
        }
    }
    flush();
    return out;
};

/*
 * The window itself: a start index and a count over the wrapped lines, plus
 * whether anything is hidden on either side. The ellipses are drawn from these
 * two booleans rather than from comparing indices at the draw site, so there is
 * one place that decides what "there is more above" means.
 */
/*
 * EXPANDED IS AN ENTRY-STEPPER, NOT A WINDOW (§13.8 retry). The ordinary card
 * tail-clamps `from` so the last window is always full. While expanded, the
 * text card opens on the entry the step landed on, with empty room below it
 * near the end: `from` is `start`, clamped only into the list, and `size` is
 * what is left from there. And `hiddenAfter` is "any entry after from", so
 * `later` stays live when the next picture already fits inside this window —
 * landing() then takes it there full-front. Otherwise text → P3 was dead
 * whenever the last text sat within one window of the end.
 */
export const windowLines = (lines, start, count, expanded = false) => {
    const total = lines.length;
    if (expanded) {
        const from = Math.max(0, Math.min(start, total - 1));
        const size = Math.max(MIN_LINES, Math.min(count, total - from));
        return {
            from,
            size,
            visible: lines.slice(from, from + size),
            hiddenBefore: from > 0,
            hiddenAfter: from < total - 1
        };
    }
    const size = Math.max(MIN_LINES, Math.min(count, total));
    const from = Math.max(0, Math.min(start, Math.max(0, total - size)));
    return {
        from,
        size,
        visible: lines.slice(from, from + size),
        hiddenBefore: from > 0,
        hiddenAfter: from + size < total
    };
};

/*
 * THE TITLE GETS TWO LINES AND THEN IT GETS CUT.
 *
 * A post title is somebody else's text and it can be any length, so a card that
 * simply drew it would either run it off the right edge or push the passage off
 * the bottom. Two lines is the frame's allowance; past that the second line is
 * truncated with an ellipsis, because a title that ends mid-word reads as a
 * mistake and one that ends in "…" reads as a title that is longer than this.
 *
 * The truncation walks characters off the end rather than estimating from an
 * average width, since the display face is proportional and an estimate is
 * wrong by a different amount on "Illinois" than on "WWW".
 */
export const titleLines = (ctx, text, maxWidth, rows = 2) => {
    const words = String(text || "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [];

    const out = [];
    let current = "";
    for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (current && ctx.measureText(candidate).width > maxWidth) {
            out.push(current);
            current = word;
            if (out.length === rows) break;
        } else {
            current = candidate;
        }
    }
    if (out.length < rows) out.push(current);

    // Everything fitted, or the last row is still the one being filled.
    // Compared against the RE-JOINED words, not the raw string: a title typed
    // with a double space would otherwise measure longer than what was drawn and
    // every such title would get an ellipsis it had not earned.
    const overflowed = out.length === rows
        && (out.join(" ").length < words.join(" ").length
            || ctx.measureText(out[rows - 1]).width > maxWidth);
    if (!overflowed) return out;

    let last = out[rows - 1];
    while (last && ctx.measureText(`${last}…`).width > maxWidth) {
        last = last.slice(0, -1);
    }
    out[rows - 1] = `${last.replace(/\s+$/, "")}…`;
    return out;
};

/*
 * The meta line — "Type  •  qntns.com/slug" — composed and, if it will not fit,
 * shortened from the END and closed with an ellipsis.
 *
 * WHY THE END, WHICH IS THE EXPENSIVE CHOICE. End-of-line means the SLUG is
 * what gets eaten, so an over-long line prints "qntns.com/the-cobblestone-sur…"
 * — an address that goes nowhere, on an object nobody can reissue. The user was
 * shown that in full and chose it anyway, because the QR code above carries the
 * real URL and this line is a label rather than the way in. The two rejected
 * options are in DECISIONS-LOG.md #49 and are not to be re-proposed: WRAPPING
 * costs a body row and reopens the budget §7.8 closed to a remainder of exactly
 * zero, and TRUNCATING THE TYPE NAME was offered and declined.
 *
 * WHY IT MEASURES RATHER THAN COUNTS. IBM Plex Mono is monospaced at exactly
 * 600/1000 upem, so at metaSize 32 with metaTrack the budget of 812 units is
 * 39 characters and a character count would be right — today. It is right only
 * while the meta face is mono and the size is 32, and §11.6 changed both once
 * already this month. measureText costs nothing here and cannot go stale.
 *
 * NOT FACTORED WITH titleLines, deliberately. That one wraps to a row count and
 * stops on a word boundary; this one is a single line with no wrap. They take
 * different arguments and stop on different rules, and two callers of a shared
 * helper would each need a flag to turn the other's behaviour off.
 *
 * `www.` IS STRIPPED HERE AND NOWHERE ELSE, AND THAT ASYMMETRY IS THE POINT.
 * The printed line is for a person to read, and "www." is four characters of
 * noise nobody needs on a postcard. The QR code keeps the full host, because
 * www.qntns.com is canonical and the bare domain only reaches it through a 301.
 * A redirect is a fine thing to depend on in a browser and a bad thing to
 * depend on in ink: the card outlives whatever redirect rule is configured
 * today and there is no way to reissue it.
 *
 * The caller sets the meta face on `ctx` before calling; the Numbers story does
 * the same, so the story reports the string the card actually draws.
 */
export const metaLine = (ctx, type, url, maxWidth) => {
    const shown = url ? String(url).replace(/^www\./i, "") : "";
    const full = [type, shown].filter(Boolean).join("  •  ");
    if (!full || trackedWidth(ctx, full, LAYOUT.metaTrack) <= maxWidth) return full;

    let cut = full;
    while (cut && trackedWidth(ctx, `${cut}…`, LAYOUT.metaTrack) > maxWidth) {
        cut = cut.slice(0, -1);
    }
    return `${cut.replace(/\s+$/, "")}…`;
};

/*
 * The header's height, and therefore the QR code's size, from the number of
 * title rows drawn. One function so the code, the column width and the meta
 * baseline are all measuring the same box.
 *
 * It runs from the TOP of the first title line to the meta BASELINE, which is
 * the bottom of the ink rather than the bottom of the meta's own line box. That
 * is the edge the eye reads as the bottom of the header, and it is the edge the
 * code is meant to finish on.
 */
export const headerHeight = (rows = 2) => {
    const L = LAYOUT;
    return Math.max(0, rows - 1) * L.titleLead + L.titleSize + L.titleGap + L.metaSize;
};

/* 0 since CHECKLIST-13 §31: the dots it held a row for are off (§30), so the
   row held nothing. Bringing the dots back means setting this to 1 again. */
const ELLIPSIS_RESERVE = 0;

/*
 * THE HEIGHT THE BODY IS ALLOWED, IN TRIM UNITS. Worked from LAYOUT rather than
 * typed, so that moving the title size or the band height moves the budget with
 * it instead of silently overflowing the wordmark.
 *
 *   1800  trim height
 *   - 504  everything above and below the body (see LAYOUT's block comment)
 *   ------
 *   1296  available to the body, and the budget: ELLIPSIS_RESERVE is 0
 *
 * At step 0 that is 18 rows of 72 with a remainder of exactly 0. It was 1224
 * and 17 rows while the reserve held a row for the closing dots; §13.31 gave
 * it back. What a last line's letter tails need below the budget is charged
 * per row by closingTail() in maxLines(), not held here.
 *
 * It stays unconditional for the reason §7.5 gives: a budget that grew
 * whenever the window happened to reach the end would let the sender add
 * something that vanishes again the moment they scroll back up.
 */
export const bodyBudget = () => {
    const used = LAYOUT.marginTop
        + LAYOUT.titleSize
        + LAYOUT.titleLead
        + LAYOUT.titleGap
        + LAYOUT.metaSize
        + LAYOUT.metaGap
        + LAYOUT.bandGap
        + LAYOUT.bandH;
    /* NO ELLIPSIS ROW ON A QUOTE CARD. The reserve holds a row back for the
       closing dots, and a quote card never draws them: the whole passage shows
       or the type comes down until it does. Holding the row anyway would spend
       one of the search's rows on a mark that cannot appear, which at the sizes
       this card reaches is a whole line of the quote. §6.5. */
    return TRIM_H - used - (quoteCard ? 0 : ELLIPSIS_RESERVE * LAYOUT.bodyLead);
};

/*
 * THE CLEARANCE AT THE TOP AND BOTTOM OF A PICTURE'S BLOCK. paintFront's
 * 576 = 8 + 560 + 8 split, written once. 8 is a multiple of 4 and is the
 * descender depth of 40px body type, which is the thing being cleared.
 */
const FIGURE_PAD = 8;

/*
 * A PICTURE INSIDE THE WINDOW: CONTAIN INTO 1056 x (block − 16), NEVER COVER.
 *
 * 1056 x 560 at step 0; the block follows the text step (figureBlock). The expanded size that used
 * to grow it inside the window (CHECKLIST-v7 §2.4) is gone: an
 * expanded picture takes the whole front above the band and is drawn alone by
 * paintFront's full-front branch, outside the window budget. DECISIONS-LOG.md
 * #77, which supersedes #39. That branch is where the only crop on this card
 * is, and where a landscape source is turned. Here there is neither.
 */
export const figureFit = (entry) => {
    const img = entry && entry.img;
    const nw = img && img.naturalWidth;
    const nh = img && img.naturalHeight;
    if (!nw || !nh) return null;
    const boxW = TRIM_W - LAYOUT.marginX * 2;
    const boxH = figureBlock(entry) - FIGURE_PAD * 2;
    const scale = Math.min(boxW / nw, boxH / nh);
    return { w: nw * scale, h: nh * scale };
};

/* A picture's block is FIGURE_H + 32 a text step (§13.26), 448 at −4 … 992 at
   +13 (FIGURE_STEP_MAX, §13.27). It also stops once the picture spans
   the 1056 measure: its full-width height + 16, up to the 4, so no blank band
   grows under a landscape (a 3:2 holds at 720 from +5). Never below FIGURE_H
   on that account, so step 0 draws as it did. A bookmark is tested before this
   in entryHeight and is CALLOUT_H. */
export const figureBlock = (entry) => {
    const grown = FIGURE_H + 32 * Math.min(quoteCard ? 0 : textStep, FIGURE_STEP_MAX);
    const nw = entry?.img?.naturalWidth;
    const nh = entry?.img?.naturalHeight;
    if (!nw || !nh) return grown;
    const wide = Math.ceil(((TRIM_W - LAYOUT.marginX * 2) * nh / nw + FIGURE_PAD * 2) / 4) * 4;
    return Math.min(grown, Math.max(FIGURE_H, wide));
};

/*
 * WHAT A §2 BLOCK COSTS THE BUDGET.
 *
 * A QUOTE COSTS NOTHING EXTRA VERTICALLY and that is measured, not assumed: the
 * site gives a blockquote no block margin of its own, only an inline rule and
 * padding. Its whole cost is the narrower measure, and that arrives through
 * wrapLines() as more entries rather than through here as a taller one.
 *
 * A DIVIDER IS BUDGETED AT 104 AND DRAWN AT 56 WHEN IT LANDS LAST. This
 * function is what maxLines() walks, and whether an entry is last is a property
 * of the WINDOW rather than of the entry — so the trailing case belongs where
 * the window is painted and cannot be known here. The 48 units of
 * over-reservation are deliberate and err in the only safe direction: they can
 * leave a unit of slack unused, never push a line off the card. The alternative
 * — making maxLines() refuse to end on a divider — is REJECTED, not deferred,
 * because it would drop a block the writer typed on the grounds of what follows
 * it, which is the silent rewrite §2 exists to close.
 */
const blockHeight = (entry) => {
    if (entry.type === "rule") return RULE_H;
    /* A HEADING BUYS ITS AIR ONCE PER HEADING, NOT ONCE PER DISPLAY LINE. A
       wrapped heading is several entries and only the outermost two carry the
       gaps — see wrapLines(). `!== false` so an entry that never went through
       wrapLines (a hand-built one entry standing for one heading) still pays
       both, which is the whole heading and correct. */
    if (entry.type === "heading") {
        return (entry.first !== false ? HEADING_ABOVE : 0)
            + LAYOUT.bodyLead
            + (entry.last !== false ? HEADING_BELOW : 0);
    }
    if (entry.type === "code") {
        return CODE_LEAD + (entry.first ? CODE_CAP : 0) + (entry.last ? CODE_CAP : 0);
    }
    /* A LIST ITEM IS ONE BODY ROW PLUS, ON THE FIRST DISPLAY LINE OF EVERY ITEM
       AFTER THE FIRST, the 20 that separates one item from the next. Once per
       ITEM and never per display line, which is the same discipline the heading
       above takes: `gap` is only ever set on an item's first source line, and
       `first !== false` is what stops a wrapped piece of that line buying it a
       second time. THESE TWO TESTS AND drawBlock's TWO MUST AGREE. */
    if (entry.type === "list") {
        return LAYOUT.bodyLead + (entry.gap && entry.first !== false ? LIST_ITEM_GAP : 0);
    }
    /* A quote, and anything object-shaped whose kind this file does not know.
       Both draw as one row of text, so both cost one row. */
    return LAYOUT.bodyLead;
};

export const entryHeight = (entry) => {
    /* Before isBlock, which would claim it: a mosaic row is an object with a type. */
    if (entry?.type === "mosaic") return entry.h + MOSAIC_GAP;
    if (isBookmark(entry)) return CALLOUT_H;
    if (isFigure(entry)) return figureBlock(entry);
    if (isBlock(entry)) return blockHeight(entry);
    return LAYOUT.bodyLead;
};

/*
 * THE FIRST TEXT ROW OF THE WINDOW SITS ON THE TYPE'S CAP HEIGHT, NOT A LEAD
 * DOWN (§13.28). The loop used to drop a whole bodyLead before its first line,
 * so the band above the first word grew with the lead: 43 at step 0, 351 at
 * +13. Now the window's first text row drops firstLead() instead, and every row
 * after it still drops bodyLead.
 *
 *   c = 0.729  H, E and L top out at 729 of 1000 units in the shipped
 *              OpenDyslexic-Regular.otf, read from the glyph outlines (its OS/2
 *              sCapHeight says 1000, a placeholder)
 *   firstLead  = 72 + round4(c × (bodySize − 40)): step 0's 72, plus the cap
 *              height's growth over step 0's 40, so the cap top sits where it
 *              does at step 0, 72 − 0.729 × 40 = 42.8 below the body top
 *
 * 60 at −4, 72 at 0, 84 at +4, 188 at +13. Base-4 rounding leaves the cap top
 * 40.9…44.7 below the body top (+9 and −2 are the ends), within 2 of step 0's
 * 42.8 at every step — a named jitter, since a 4 grid cannot do better. A
 * quote card sizes its own type and keeps its own lead (§6.5), so it gets
 * bodyLead here and nothing on it moves.
 */
const CAP_HEIGHT = 0.729;
export const firstLead = () => (quoteCard
    ? LAYOUT.bodyLead
    : 72 + Math.round((CAP_HEIGHT * (LAYOUT.bodySize - 40)) / 4) * 4);
/* Whether an entry draws as a row of text: prose, a poem line, a heading, a
   quote, a list item. Not a picture, a mosaic row, a callout, a divider or a
   code line — those start at the body top as they always did. */
const isTextRow = (entry) => !isFigure(entry) && entry?.type !== "mosaic"
    && entry?.type !== "rule" && entry?.type !== "code";
/* An entry's height when it opens the window: its one bodyLead swapped for
   firstLead(). blockHeight() charges exactly one bodyLead for every text kind,
   so the swap is exact. */
const openingHeight = (entry) => entryHeight(entry)
    + (isTextRow(entry) ? firstLead() - LAYOUT.bodyLead : 0);
/*
 * WHAT THE WINDOW'S LAST TEXT ROW'S LETTER TAILS NEED PAST THE BUDGET
 * (§13.31). The mirror of openingHeight() on the other end: a g hangs
 * DESCENT × size below its baseline, and bandGap (12) is all the room under
 * the budget, plus HEADING_BELOW (32) under a heading's last line.
 *
 *   DESCENT = 0.262  the g's yMin, −262 of 1000, in the shipped
 *                    OpenDyslexic-Regular.otf, read from its outline. No ASCII
 *                    glyph in Bold, Italic or BoldItalic goes deeper. A type
 *                    metric, so it is the named base-4 exemption; the tail is
 *                    ceil4 − 12, so the budget stays on the grid.
 *   tail = max(0, ceil4(DESCENT × size) − bandGap − below)
 *
 * 0 at −4…+1, 4 at +2…+4, then 8 … 44 at +5…+13. A heading is its own size
 * (60 / 48 / 40), which is why this is per row and not one flat tail: at +1 a
 * wrapped 60 heading's first line has no HEADING_BELOW under it and is bigger
 * than the body. 0 for a blank row, anything that is not a text row (code's
 * Plex Mono tail, 0.212 × 36 = 7.6, is under the 12) and a quote card, which
 * fits its own type (§6.5). Letters with a comma or cedilla below (ģ, Ķ) go
 * deeper; this does not cover them.
 */
const DESCENT = 0.262;
const closingTail = (entry) => (quoteCard || !entry || !isTextRow(entry) ? 0 : Math.max(0,
    Math.ceil((DESCENT * (entry.type === "heading" ? entry.size : LAYOUT.bodySize)) / 4) * 4
    - LAYOUT.bandGap - (entry.type === "heading" && entry.last !== false ? HEADING_BELOW : 0)));

/*
 * THE CAP IS A HEIGHT BUDGET NOW, NOT A ROW COUNT, AND IT MOVES WITH THE WINDOW.
 *
 * It used to be one number worked out once at attach: floor(1288 / 72) - 1 = 16
 * rows, every row the same height. That arithmetic is only true while every
 * entry is a line of text. A picture is 576 units — eight rows — so two steps
 * can be 144 units of text or 1152 units of pictures, and a fixed cap either
 * overflows the wordmark band or leaves a third of the card empty depending on
 * what the window happens to be sitting on.
 *
 * So the cap is measured rather than counted: walk forward from where the
 * window starts, adding each entry's own height, and stop at the last one that
 * still fits in bodyBudget(). On an article of nothing but text this returns
 * exactly what the counted version would — at step 0, 18 x 72 = 1296 against a
 * budget of 1296, and a nineteenth row would be 1368 — so nothing about the
 * all-text card changes. Both numbers are derived; do not re-type either one
 * here.
 *
 * THE WALK RE-DERIVES `from` FOR EVERY CANDIDATE SIZE, and it has to.
 *
 * This used to walk forward from `start` once, and justified that by pointing
 * at paint() blocking "more" on !hiddenAfter — so the window could never be
 * grown against the end of the article and `from` was always `start`. §9.1
 * deleted that block, because growing the window at the end of the passage is
 * the whole point of it: windowLines() slides `from` BACKWARD as `size` rises,
 * so the entries drawn are no longer the entries a forward walk from `start`
 * would have measured. The cap has to be asked the question the window will
 * actually be asked — "does a window of n lines fit?" — for each n in turn.
 *
 * Wherever `start + n <= total` the clamp is inert and this measures exactly
 * what the old forward walk did: an all-text card at step 0 still caps at
 * 18 x 72 = 1296 against a budget of 1296, and a nineteenth row would be 1368.
 * Both numbers are derived; do not re-type either one here.
 *
 * THE LAST ENTRY ALSO PAYS closingTail() (§13.31), what its letter tails need
 * below the budget. 0 up to +1, so steps −4…+1 are the plain row count.
 */
export const maxLines = (entries = [], start = 0, expanded = false) => {
    const budget = bodyBudget();
    const total = entries.length;
    let count = 0;
    /* Expanded has no tail clamp (windowLines above), so the walk counts from
       `start` and can only reach the end of the list: budget == paint. */
    const top = expanded ? Math.max(0, Math.min(start, total - 1)) : 0;
    for (let n = 1; n <= total - top; n++) {
        const from = expanded ? top : Math.max(0, Math.min(Math.max(0, start), total - n));
        /* The window's first entry at its opening height (firstLead above),
           which is what paintFront draws for it: budget == paint. */
        let height = openingHeight(entries[from]);
        for (let i = from + 1; i < from + n; i++) height += entryHeight(entries[i]);
        /* FIRST REFUSAL, NOT THE LARGEST n THAT FITS, AND THAT IS A CHOICE.
           Once the clamp bites, height is NOT monotonic in n: growing the window
           swaps in a different entry from ABOVE, and a 576-unit figure can
           replace a 72-unit text row, so the total can jump and then come back
           down. Breaking here can therefore stop at an n that a larger n would
           have cleared.

           That is correct rather than merely safe. A cap that was not monotonic
           would make the +/- buttons not monotonic: the sender presses plus, is
           refused, presses plus again and is granted it. Stopping at the first
           refusal is what keeps the control honest about what it will do. */
        if (height + closingTail(entries[from + n - 1]) > budget) break;
        count = n;
    }
    return Math.max(MIN_LINES, count);
};

/*
 * DRAWING A PICTURE INTO ITS ROW.
 *
 * CONTAIN, NEVER COVER, IN THE WINDOW. The box is 1056 x 560 — the full measure by
 * eight rows less its clearance — and that is a 1.9:1 letterbox, which almost no
 * article image is. Filling it would mean cropping a photograph the writer
 * chose, on a card that gets printed and posted, with nobody able to see what
 * was cut. The one exception is the full-front picture, cover-fit on the
 * reader's own screen before they mail it — DECISIONS-LOG.md #77.
 *
 * THE FIT IS WORKED OUT BY THE CALLER AND HANDED IN: figureFit() in the
 * window, the cover fit in paintFront's full-front branch.
 *
 * LEFT ALIGNED AT THE BODY'S OWN MARGIN. THIS REVERSES A DELIBERATE v6 §8
 * DECISION AND IS NOT A BUG FIX. v6 §8 centred the image in its box on purpose
 * and measured it doing so — a 1600x900 source came out 483.56 wide at x
 * 358.22, and 358.22 is a centring offset. CHECKLIST-v7 §2.2 is the user asking
 * for the reversal: a picture starts where every line of text starts, because
 * the eye reads a left edge and a centred picture breaks it.
 *
 * TOP ALIGNED TOO, AND THAT IS ALSO A CHANGE. The vertical centring it replaces
 * was a no-op in every case anybody has drawn — contain into a 3.9:1 letterbox
 * is height-bound for any source narrower than 3.88:1, so h was boxH and the
 * offset was zero.
 *
 * THE TURN IS A QUARTER TURN CLOCKWISE ABOUT THE TARGET RECT'S CENTRE, and
 * only the full-front branch asks for it (a landscape source, #77). The bitmap
 * is drawn at (h x w) in its own frame, which the turn maps onto the (w x h)
 * rect the caller measured — the same two numbers swapped.
 *
 * NOTHING IS DRAWN IF THE IMAGE IS NOT READY. loadFigures() resolves every
 * picture before the first paint and drops the ones that will not come, so an
 * entry reaching here without a decoded bitmap is not a state to recover from
 * mid-drawing — it is simply skipped, and the row it holds stays blank rather
 * than the whole card failing.
 */
const drawFigure = (ctx, entry, x, y, fit, turned = false) => {
    const img = entry.img;
    if (!img || !fit) return;
    if (!turned) {
        /* COVER (#78): scale to fill the rect and centre, cropping the source.
           A rect in the source's aspect — every caller but a flush mosaic cell —
           crops nothing, so this is the old contain draw for them. */
        const s = Math.max(fit.w / img.naturalWidth, fit.h / img.naturalHeight);
        const sw = fit.w / s;
        const sh = fit.h / s;
        ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, fit.w, fit.h);
        return;
    }
    ctx.save();
    ctx.translate(x + fit.w / 2, y + fit.h / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, -fit.h / 2, -fit.w / 2, fit.h, fit.w);
    ctx.restore();
};

/*
 * DRAWING A LINK CALLOUT INTO ITS ROW.
 *
 * THIS IS THE SITE'S BOOKMARK CARD AT PRINT SCALE, NOT A DRAWING OF ITS OWN.
 * `assets/css/qntns/content-cards.css:804-978` is the original: a square-
 * cornered card with a solid offset shadow, an image flush to its left edge at
 * the card's full height, and a padded text column beside it. Two columns, not
 * three. Until 2026-09-01 this function drew code | art | type, which was
 * designed from the postcard outwards; the ruling (CHECKLIST-v7 §1,
 * DECISIONS-LOG.md #54) is that it is copied from the site inwards, and that
 * THE QR CODE IS THE IMAGE — one picture in the image slot, not a code square
 * standing beside a thumbnail.
 *
 *   x                            x+272     x+308                    x+1040
 *   +---------------------------+---------+------------------------+
 *   |                           |   36    | title, up to 2 rows    |  \
 *   |          QR 272           |         | publisher              |   | 272
 *   |                           |         |                     36 |  /
 *   +---------------------------+---------+------------------------+
 *                                                                     +16 shadow
 *
 *   272 code  +  36 pad  +  696 type  +  36 pad  =  1040
 *   1040 card + 16 shadow                        =  1056, the measure
 *    272 card +  16 shadow                       =   288, CALLOUT_H
 *
 * THE SHADOW IS DRAWN INSIDE THE 288, NOT HANGING OUT OF IT. The entry stays
 * exactly CALLOUT_H tall — 288, its own constant since CHECKLIST-13 §16 doubled
 * FIGURE_H to 576 — so entryHeight()'s callout line and §8.3's height budget
 * need no new code. A shadow outside the box would make a callout taller than
 * its entry and would be a real change to the budget rather than a change to
 * this function. So the CARD shrinks to 1040 x 272 and the shadow takes the right 16
 * and the bottom 16 of the space the entry already owns. 1040 = 4 x 260,
 * 272 = 4 x 68, 288 unchanged.
 *
 * WHY 16. The site's is `--shadow-hard: 4px 4px 0 --color-ink` (tokens.css:94)
 * against a `1px solid` border. 4 is already on the base-4 grid, so nothing is
 * rounded and no exemption is claimed. The translation is the site's own ratio:
 * its shadow is 4x its border, and this card's border is CALLOUT_RULE = 4, so
 * the shadow is 16.
 *
 * ORDER OF OPERATIONS, AND IT IS FOUR STEPS RATHER THAN THREE:
 * shadow rect, card fill, CONTENTS, border stroke LAST.
 *   - The fill is NEW. Before the shadow there was nothing behind the card but
 *     card, so an unfilled box was invisible; with an ink rectangle behind it,
 *     an unfilled box shows the shadow straight through itself.
 *   - The stroke MOVED TO THE END. It used to be first, which was harmless
 *     while everything else was inset by 16. It is not harmless now: the code
 *     runs flush under the rule, so a stroke drawn first would be painted over.
 *
 * "FLUSH" MEANS THE RULE DRAWS OVER THE CODE, NOT THAT THE CODE IS INSET OFF
 * IT. The rule is stroked half a width inward, so it occupies the outer 4 units
 * of the card on every side. The site does exactly this — `padding: 0` under a
 * 1px border, so its thumbnail runs under the border box and the hairline lands
 * on the image's edge. Ours is that at 4x. The code therefore starts at `x`,
 * not at `x + CALLOUT_RULE`; insetting it defensively would silently break the
 * 272 and with it the 696. `{ quiet: 0 }` is what makes that safe: the code has
 * no margin of its own to lose, and the 4 units the rule covers are its outer
 * frame rather than modules.
 *
 * THE THUMBNAIL IS GONE FROM THE DRAWING. `bookmarkEntry` still captures `src`
 * and `loadFigures` still decodes it into `entry.img`; nothing reads it here.
 * Leaving the data is free and reversible, and ripping it out would be a second
 * change with its own blast radius (CHECKLIST-v7 §1.2).
 *
 * THE SITE'S DESCRIPTION AND FAVICON ARE OUT, AND NEITHER IS AN OVERSIGHT.
 *   - The description is content-cards.css:899-913, two clamped lines. It is
 *     not in the entry at all — `bookmarkEntry` never reads
 *     `.kg-bookmark-description` — so adding it is a DATA change, not a drawing
 *     change. And v6 §11.4 ruled a blurb is PROSE, which on this card means
 *     OpenDyslexic at bodySize 40: two more rows the 272 does not have.
 *   - The favicon is `.kg-bookmark-icon`, 16px, and it is a THIRD-PARTY IMAGE
 *     fetched from the linked site. CLAUDE.md allows this theme exactly ONE
 *     third-party runtime call and it is the read-receipt sync.
 *
 * THE FACES STAY OURS AND ARE NOT CHANGED TO THE SITE'S. The site's title is
 * --font-ui and its metadata --font-meta; the canvas equivalents are
 * OpenDyslexic at bodySize and IBM Plex Mono at metaSize, which is what is drawn
 * below. "The exact same design" is the same geometry, weight and colour
 * relationships — a canvas cannot draw a face FACES does not ship.
 *
 * AND THE SITE CROPS ITS THUMBNAIL WHERE THIS SURFACE MAY NOT.
 * content-cards.css:973-978 is `object-fit: cover` and argues for it. This card
 * contains, always, per DECISIONS-LOG.md #39: a photograph on a mailed card
 * cannot be reissued and a crop cannot be undone by the person holding it.
 * Under the ruling the conflict does not arise here — there is no thumbnail
 * left to fit — but it WILL the first time anybody proposes putting one back.
 *
 * VERTICAL CENTRING, ON PAPER, IN THE CARD'S 272 RATHER THAN THE ENTRY'S 288:
 *
 *   two title rows   2 x 72 (bodyLead)   = 144
 *   gap                                  =  16
 *   publisher        metaSize            =  32
 *   -----                                  ---
 *   content                                192   ->  (272 - 192) / 2 =  40 above
 *   one title row     72 + 16 + 32       = 120   ->  (272 - 120) / 2 =  76 above
 *
 * Both offsets are multiples of 4. The 16 is the gap between the title and the
 * publisher and is the smallest grid step that reads as a separation rather
 * than as leading.
 */
/* THE BORDER'S OWN WEIGHT. 4 trim units, and it needs no base-4 exemption
   because 4 IS the grid's floor. It is the same rule at the same scale as
   LAYOUT.bandRule and for the same reason recorded there: the site's 1px
   hairline is 1/96in, which at 300dpi is 3.125 device pixels, and 4 is the
   nearest grid value — the same hairline at print scale rather than a heavier
   rule invented for the card. */
const CALLOUT_RULE = 4;

/* THE SOLID OFFSET SHADOW, down and right, in ink. 4x the rule, exactly as the
   site's --shadow-hard is 4x its 1px border. On the grid (16 = 4 x 4); nothing
   rounded. Drawn INSIDE the entry — see the block above. */
const CALLOUT_SHADOW = 16;

/* THE INSET ON THE TEXT SIDE ONLY; the code is flush, as on the site.
 * BASE-4 ROUNDING, NAMED HERE PER CLAUDE.md: the site's inset is 16 on a
 * 128-tall card, which is one eighth of the card's height. One eighth of 272 is
 * 34, and 34 is OFF THE GRID. Rounded UP to 36 (4 x 9), a 2-unit difference —
 * 0.007in on the printed card. Up rather than down so the text column lands on
 * 1040 - 272 - 36 - 36 = 696 = 4 x 174; at 34 it would have been 700, which is
 * on the grid too, but the inset itself would not have been. */
const CALLOUT_TEXT_PAD = 36;

const drawCallout = (ctx, entry, x, y, width, height, palette) => {
    const L = LAYOUT;

    /* The card is the entry less the room the shadow needs. 1056 -> 1040,
       288 -> 272. */
    const cardW = width - CALLOUT_SHADOW;
    const cardH = height - CALLOUT_SHADOW;

    /* 1. The shadow. An opaque ink rectangle, offset down and right. */
    ctx.save();
    ctx.fillStyle = palette.ink;
    ctx.fillRect(x + CALLOUT_SHADOW, y + CALLOUT_SHADOW, cardW, cardH);

    /* 2. The card's own ground, over the part of the shadow it covers. */
    ctx.fillStyle = palette.card;
    ctx.fillRect(x, y, cardW, cardH);
    ctx.restore();

    /* 3. The contents. The code first, in the image slot: flush to the left
       edge, the card's full height, square. Wrapped for the same reason the
       header's is — the encoder refuses a URL past its size limit and throws,
       and a callout without a code is still a callout while a card that failed
       to draw is nothing. */
    if (entry.href) {
        try {
            drawQr(ctx, absoluteUrl(entry.href), x, y, cardH, palette.ink, { quiet: 0 });
        } catch {
            // Unencodable. Draw the rest of the callout.
        }
    }

    const textX = x + cardH + CALLOUT_TEXT_PAD;
    const textW = cardW - cardH - CALLOUT_TEXT_PAD * 2;

    ctx.font = `400 ${L.bodySize}px "OpenDyslexic", Arial, sans-serif`;
    const rows = titleLines(ctx, entry.title, textW, 2);
    const contentH = rows.length * L.bodyLead + 16 + L.metaSize;
    let ty = y + (cardH - contentH) / 2 + L.bodySize;

    ctx.fillStyle = palette.ink;
    rows.forEach((row, i) => {
        fillTracked(ctx, row, textX, ty + i * L.bodyLead, L.bodyTrack);
    });

    if (entry.publisher) {
        ty += (rows.length - 1) * L.bodyLead + 16 + L.metaSize;
        ctx.fillStyle = palette.meta;
        ctx.font = `700 ${L.metaSize}px "IBM Plex Mono", ui-monospace, monospace`;
        fillTracked(ctx, entry.publisher, textX, ty, L.metaTrack);
        ctx.fillStyle = palette.ink;
    }

    /* 4. The rule, LAST, so it lands on top of the code rather than under it.
       Stroked half a rule inward so the 4 units sit wholly inside the card
       rather than straddling its edge. Square corners — --radius-control is 0
       and the site's card is border-radius: 0 deliberately. */
    ctx.save();
    ctx.strokeStyle = palette.ink;
    ctx.lineWidth = CALLOUT_RULE;
    ctx.strokeRect(
        x + CALLOUT_RULE / 2,
        y + CALLOUT_RULE / 2,
        cardW - CALLOUT_RULE,
        cardH - CALLOUT_RULE
    );
    ctx.restore();
};

/*
 * THE PICTURES ARE RESOLVED BEFORE THE FIRST PAINT AND NEVER DURING ONE.
 *
 * paintFront is synchronous from top to bottom, and it runs on every press,
 * every wheel step and every frame of a drag. A fetch inside it would mean a
 * card that flickers or comes up blank while a picture arrives. So this runs
 * once, at attach and again on open, and by the time paint() is called every
 * entry either carries a decoded bitmap or is no longer in the array.
 *
 * crossOrigin = "anonymous" IS LOAD-BEARING AND NOT A PRECAUTION. Ghost serves
 * its images from storage.ghost.io, a different origin from the site. Drawing
 * a cross-origin image onto a canvas without CORS taints it, and a tainted
 * canvas does not degrade politely: canvas.toBlob() in exportFront() THROWS,
 * and the reader presses download and gets no file at all. One picture the
 * host will not share would cost them the whole postcard.
 *
 * A PICTURE THAT WILL NOT COME IS REMOVED FROM THE ARRAY, not left in as a
 * blank. It is the same rule the QR code follows at the top of paintFront — a
 * postcard without a picture is a postcard; a postcard that failed to draw is
 * nothing — and removing it rather than blanking it means it stops costing the
 * budget four rows the reader gets nothing for.
 *
 * A BOOKMARK IS THE ONE ENTRY THAT SURVIVES LOSING ITS PICTURE, and it is also
 * the one entry GUARANTEED to be cross-origin. A bookmark's thumbnail is the
 * linked site's own OG image, so it comes from that site, always, without
 * exception — and a great many sites serve their OG image with no
 * Access-Control-Allow-Origin header at all, which makes the load fail here by
 * design rather than by accident. That refusal is the outcome this function
 * exists to produce: the picture is declined, the canvas stays clean, and the
 * reader can still save their card.
 *
 * So a failed bookmark thumbnail drops the ART and keeps the ENTRY. The callout
 * still has its title, its publisher and its scannable code, which is the whole
 * of what it is for, and drawCallout gives the words the space the picture
 * would have taken. A plain picture that fails has nothing left to be, and goes.
 */
export const loadFigures = (data) => {
    const entries = (data && data.lines) || [];
    const figures = entries.filter(isFigure);
    if (!figures.length) return Promise.resolve(data);

    return Promise.all(figures.map((entry) => new Promise((resolve) => {
        if (typeof Image !== "function") {
            resolve();
            return;
        }
        /* Ghost drops the whole thumbnail element when the other site
           published no OG image, so a bookmark with no src is normal and is not
           a failure. */
        if (!entry.src) {
            resolve();
            return;
        }
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => { entry.img = img; resolve(); };
        img.onerror = () => resolve();
        img.src = entry.src;
    }))).then(() => {
        for (let i = entries.length - 1; i >= 0; i--) {
            const entry = entries[i];
            if (isFigure(entry) && !entry.img && !isBookmark(entry)) entries.splice(i, 1);
        }
        return data;
    });
};

/*
 * DRAWING A §2 BLOCK, AND HANDING BACK THE TWO NUMBERS ONLY THE DRAWING KNOWS.
 *
 * Returns [nextY, edgeAt] — where the cursor ends up, and where the blue drag
 * edge belongs if this turns out to be the last visible entry. They are two
 * numbers rather than one for the same reason the picture branch keeps them
 * apart: a text row's baseline is not the bottom of its ink, so it needs
 * EDGE_DROP under it, while a drawn boundary — a rule, the bottom of a code
 * slab — already carries its own clearance and gets none.
 *
 * THE RULE AND THE SLAB ARE DRAWN PER ENTRY AND ABUT INTO ONE SHAPE. A quote of
 * three display lines is three entries, each drawing its own 72-unit segment of
 * the 16-wide ink rule, and the three segments meet exactly because each starts
 * where the last ended. A code block is the same trick with a ground and a
 * border. That is what lets a block of any length live inside a window that can
 * start and end anywhere in it — the window shows a run of entries, and the run
 * draws as much of the shape as it contains.
 *
 * NOTHING IN HERE IS CHROME. Every mark this function makes is printed on the
 * mailed card, which is the test CLAUDE.md and DECISIONS-LOG.md #37 set: no
 * copy button, no line numbers, no control of any kind.
 */
const drawBlock = (ctx, entry, x, y, measure, palette, isLast, opens = false) => {
    const L = LAYOUT;

    if (entry.type === "rule") {
        const top = y + RULE_GAP;
        ctx.fillStyle = palette.ink;
        /* 844.8 at the 1056 measure. The fraction is the site's 80% proportion,
           which content.css exempts from base 4 where it sets it, and the
           exemption is re-named at RULE_PROPORTION above. */
        ctx.fillRect(x, top, measure * RULE_PROPORTION, RULE_WEIGHT);
        const bottom = top + RULE_WEIGHT;
        /* THE TRAILING GAP IS DROPPED WHEN THE DIVIDER LANDS LAST, so the card
           ends on the rule rather than on 48 units of white the sender did not
           ask for and cannot remove without stepping past content they wanted.
           entryHeight() still charged 104 for it — see the note there. */
        return [isLast ? bottom : bottom + RULE_GAP, bottom];
    }

    if (entry.type === "code") {
        const h = entryHeight(entry);
        ctx.fillStyle = palette.card;
        ctx.fillRect(x, y, measure, h);
        ctx.fillStyle = palette.accent;
        /* The two sides on every line; the ends only on the ends. */
        ctx.fillRect(x, y, CODE_RULE, h);
        ctx.fillRect(x + measure - CODE_RULE, y, CODE_RULE, h);
        if (entry.first) ctx.fillRect(x, y, measure, CODE_RULE);
        if (entry.last) ctx.fillRect(x, y + h - CODE_RULE, measure, CODE_RULE);
        ctx.font = blockFont(entry);
        ctx.fillStyle = palette.ink;
        ctx.fillText(
            entry.text,
            x + CODE_RULE + CODE_PAD_X,
            y + (entry.first ? CODE_CAP : 0) + CODE_BASE
        );
        ctx.font = bodyFont();
        return [y + h, y + h];
    }

    /* A quote, a heading and a list item are all ONE BODY ROW OF TEXT, so they
       advance the cursor first and draw on the baseline they land on, exactly
       as prose does. A heading buys its air either side of that row; a list
       item buys the 20 above it that separates it from the item before. */
    /* The air goes on the ends of the HEADING, not on every display line of it.
       Read blockHeight()'s note — these two tests and its two must agree, or
       the budget and the drawing disagree about where the baselines are. */
    const heading = entry.type === "heading";
    const list = entry.type === "list";
    /* THE FIRST DISPLAY LINE OF AN ITEM IS THE ONLY ONE THAT CARRIES A MARKER
       OR AN ITEM GAP. `lead` says this entry is an item's first SOURCE line —
       an <li> with a <br> in it is several entries and only the first is led —
       and `first !== false` says this is the first WRAPPED piece of that line.
       Both are needed, and blockHeight()'s gap test is the same one. */
    const leads = list && entry.lead && entry.first !== false;
    const above = heading && entry.first !== false ? HEADING_ABOVE
        : (leads && entry.gap ? LIST_ITEM_GAP : 0);
    const below = heading && entry.last !== false ? HEADING_BELOW : 0;
    /* The row's lead, or firstLead() when it opens the window (§13.28). */
    const lead = opens ? firstLead() : L.bodyLead;
    const base = y + above + lead;
    if (leads) {
        ctx.fillStyle = palette.ink;
        if (entry.marker) {
            /* RIGHT-ALIGNED INTO THE COLUMN, so the numeral grows leftward and
               the text edge never moves. textAlign is restored immediately —
               every other draw on this canvas assumes the default. */
            ctx.font = bodyFont();
            ctx.textAlign = "right";
            ctx.fillText(entry.marker, x + LIST_MARKER_COL, base);
            ctx.textAlign = "left";
        } else {
            /* THE SQUARE, CENTRED IN THE SAME COLUMN THE NUMERALS USE — which
               is what makes an <ol> and a <ul> read as one family. (68 - 12) / 2
               = 28 from the left edge, and 20 above the baseline centres it on
               the cap of this line. Both derived where LIST_SQUARE is defined. */
            ctx.fillRect(
                x + (LIST_MARKER_COL - LIST_SQUARE) / 2,
                base - LIST_SQUARE_RISE,
                LIST_SQUARE,
                LIST_SQUARE
            );
        }
    }
    /* NOT ON A QUOTE CARD — see quoteCard, and blockMeasure, which drops the
       width this rule and its inset cost in the same breath. */
    if (entry.type === "quote" && !quoteCard) {
        /* The rule sits where a paragraph's left edge is and the quoted text
           steps in from it, which is the relationship content-cards.css
           describes and the reason the inset is measured from the rule's
           inside face rather than from the margin. */
        ctx.fillStyle = palette.ink;
        ctx.fillRect(x, base - lead, QUOTE_RULE, lead);
    }
    ctx.font = blockFont(entry);
    ctx.fillStyle = palette.ink;
    ctx.fillText(
        entry.text,
        x + (entry.type === "quote" && !quoteCard ? QUOTE_RULE + QUOTE_INSET : 0) + (list ? LIST_INDENT : 0),
        base
    );
    ctx.font = bodyFont();
    return [base + below, base + EDGE_DROP];
};

/* -------------------------------------------------------------------------
 * Painting the front
 * ---------------------------------------------------------------------- */

/*
 * ONE PAINTER, TWO SIZES. The preview and the file the printer gets are the same
 * drawing at two scales, because two layouts would be two things to keep in
 * agreement and nobody would notice the day they stopped agreeing.
 *
 * `scale` maps TRIM space onto the target. `withBleed` decides whether the
 * canvas is the paper (print: 1275x1875, the drawing pushed in by the bleed) or
 * the finished card (preview: the trim only, no bleed, because the reader is
 * looking at a postcard and not at a press sheet).
 */
/*
 * SIZING THE TYPE TO THE PASSAGE. CHECKLIST-v11 §6.5.
 *
 * "Big enough to fill while having some restraint. It should show every word."
 * So the search runs DOWNWARDS from the largest size allowed and takes the
 * first one that fits — the biggest type at which the whole quote is on the
 * card, which is what "fill" means when nothing may be cut.
 *
 * THE CEILING IS THE TITLE SIZE, AND IT IS DERIVED RATHER THAN CHOSEN. The
 * passage never sets larger than the thing naming it: at LAYOUT.titleSize the
 * two are equal and the card has run out of hierarchy, which is the restraint
 * the user asked for expressed as a relationship instead of as a number
 * somebody picked. It is also already a multiple of 4, as is the 4 the search
 * steps by, so every size it can return is on the grid.
 *
 * IT MEASURES WITH THE FUNCTIONS THAT DRAW. wrapLines, entryHeight and
 * bodyBudget are the same three the drawing walks, run under the same
 * withQuoteType() the drawing runs under — so "it fits" here and "it fits"
 * there are the same sentence rather than two arithmetics that have to agree.
 * That includes the widow mend, which is inside wrapLines: the card is sized
 * against the lines it will actually show.
 *
 * NO WINDOW IS CONSULTED. state.start and state.count are the passage window
 * and a quote card has none — paintFront hands the whole wrapped array to
 * windowLines below. So the height walked here is the height of EVERY entry,
 * which is the only honest test of "shows every word".
 *
 * THE FLOOR IS RETURNED WHEN NOTHING FITS. See QUOTE_SIZE_MIN: a passage too
 * long for 28 is drawn at 28 and overflows, in preference to cutting words off
 * a card somebody is paying to mail with no mark to say they were cut.
 */
const fitQuoteType = (ctx, data, state) => {
    const measure = TRIM_W - LAYOUT.marginX * 2;
    const lines = data.lines || [];
    /* THE SAME WRAP FLAG THE PAINT USES. Wrap off packs a picture into a mosaic
       row (288 + MOSAIC_GAP) where wrap on charges FIGURE_H; a fit measured with
       the other flag sizes the type for space that is never drawn (CHECKLIST-13
       §2, refuter). paintFront reads it the same way at its wrapLines call. */
    const wrap = state?.wrap !== false;
    for (let size = LAYOUT.titleSize; size > QUOTE_SIZE_MIN; size -= 4) {
        const fits = withQuoteType(size, () => {
            ctx.font = bodyFont();
            let height = 0;
            for (const entry of wrapLines(ctx, arranged(lines, state), measure, LAYOUT.bodyTrack, wrap)) {
                height += entryHeight(entry);
            }
            return height <= bodyBudget();
        });
        if (fits) return size;
    }
    return QUOTE_SIZE_MIN;
};

/* §13.25 THE READER'S PICTURE ORDER. `order` lists the post's photos
   (bookmarks aside) by src, in the reader's order; a draft from the first
   build lists them as indices in post order, and both are read. photoOrder()
   turns either into post-order indices, or null when it is not an exact
   permutation of the photos in `lines` — a post that gained, lost or swapped a
   picture — so a stale order falls back to the post's. It is resolved where it
   is used, never at restore: loadFigures() splices a picture that failed to
   load out of `lines`, and restore() runs before it, so an order judged then
   would count a picture the mosaic never draws. arranged() deals the packable
   pictures back into their own slots in that order, wrap off only; wrap on
   keeps the post's order beside its text. fitQuoteType and paintFront both
   wrap through it, so the budget and the paint see one order. */
const isPhoto = (e) => isFigure(e) && !isBookmark(e);
export const photoOrder = (lines, order) => {
    const photos = (lines || []).filter(isPhoto);
    const n = photos.length;
    if (!Array.isArray(order) || order.length !== n) return null;
    let idx = order;
    if (order.every((s) => typeof s === "string")) {
        /* By src. Each src claims the first photo not yet claimed, so a post
           that shows one picture twice still resolves. */
        const free = photos.map((_, i) => i);
        idx = order.map((s) => {
            const k = free.findIndex((i) => photos[i].src === s);
            return k < 0 ? -1 : free.splice(k, 1)[0];
        });
    }
    const seen = new Set(idx);
    return seen.size === n && idx.every((i) => Number.isInteger(i) && i >= 0 && i < n) ? idx : null;
};
const arranged = (lines, state) => {
    const order = state?.wrap === false && photoOrder(lines, state.order);
    if (!order) return lines;
    const photos = lines.filter(isPhoto);
    const dealt = order.map((i) => photos[i]).filter(packable);
    let k = 0;
    return lines.map((e) => (packable(e) ? dealt[k++] : e));
};

export const paintFront =(ctx, data, state, { scale = 1, withBleed = false, tokens } = {}) => {
    /* THE QUOTE CARD SIZES ITSELF AND THEN PAINTS ITSELF, IN THAT ORDER AND IN
       ONE ENTRY POINT. Both the preview and the export come through here, so
       neither can be drawn at a size the other did not use. The `!quoteCard`
       test is what stops the recursion: the second call arrives with the
       setting already in force and runs the ordinary path below. */
    if (state?.quote && !quoteCard) {
        const size = fitQuoteType(ctx, data, state);
        return withQuoteType(size, () => paintFront(ctx, data, state, { scale, withBleed, tokens }));
    }
    /* The text step, the same shape: set, paint once with the step spent, restore. */
    if (state?.textStep && !quoteCard) {
        return withTextStep(state.textStep, () => paintFront(ctx, data, { ...state, textStep: 0 }, { scale, withBleed, tokens }));
    }

    const palette = tokens || readTokens();
    const L = LAYOUT;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(scale, scale);

    // The paper, then the card. Filling the full bleed area first means the
    // background runs off every edge no matter where the blade lands.
    ctx.fillStyle = palette.card;
    ctx.fillRect(0, 0, withBleed ? CARD_W : TRIM_W, withBleed ? CARD_H : TRIM_H);

    // THE ONLY PLACE 37.5 IS USED. Everything after this line is trim space.
    if (withBleed) ctx.translate(BLEED, BLEED);

    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = palette.ink;

    // THE HEADER'S SECOND COLUMN IS THE CODE, AND IT IS AS TALL AS THE TWO ROWS
    // BESIDE IT. The column width is derived from the WORST case — a two-row
    // title — for the reason argued at LAYOUT: the width and the row count
    // define each other, and the narrow one is the safe way out of that.
    const measure = TRIM_W - L.marginX * 2;
    const headWidth = measure - headerHeight(2) - L.qrGap;

    // THE BAND IS THE SITE'S FOOTER BAR: beige-dark, a navy rule along its top,
    // and nothing under it. It is pinned to the bottom of the trim rather than
    // to the end of the body, because it is the edge of the card and it does not
    // move when the sender adds a line. Drawn last by both branches below.
    //
    // IT RUNS PAST THE TRIM ON THREE SIDES WHEN THERE IS BLEED. A band that
    // stopped exactly on the trim line would come back from the printer with a
    // sliver of pale card down whichever edge the blade missed by — which is the
    // entire reason the bleed exists. `over` is zero in the preview, where the
    // canvas IS the trim and there is nothing outside it to paint.
    const over = withBleed ? BLEED : 0;
    const bandTop = TRIM_H - L.bandH;
    const drawBand = () => {
        ctx.fillStyle = palette.band;
        ctx.fillRect(-over, bandTop, TRIM_W + over * 2, L.bandH + over);
        ctx.fillStyle = palette.ink;
        ctx.fillRect(-over, bandTop, TRIM_W + over * 2, L.bandRule);

        ctx.font = `800 ${L.wordmarkSize}px "Gill Sans Ultra", sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText("QNTNs", TRIM_W / 2, bandTop + (L.bandH + L.wordmarkSize * 0.72) / 2);
    };

    // Wrapped here, above the header, because the full-front test below needs
    // the entry the window starts on. Measuring sets the body face; the title
    // and meta set their own, and the body loop sets it again before drawing.
    ctx.font = bodyFont();
    const wrapped = wrapLines(ctx, arranged(data.lines || [], state), measure, L.bodyTrack, state.wrap !== false);

    /*
     * THE FULL-FRONT PICTURE. DECISIONS-LOG.md #77, CHECKLIST-13 §7.
     *
     * Expanded is a mode, not an index: the picture is whichever entry the
     * window starts on. When that is a picture, it is drawn alone over the whole
     * trim above the band — no title, meta, QR, ellipses or other entries — and
     * the band goes on top. When it is text, the ordinary card below is painted
     * with the header back (§8).
     *
     * COVER, NOT CONTAIN, and a landscape source is turned a quarter turn first:
     * the area is 1200 x 1656, portrait, so a turned landscape crops less. This
     * is the card's one crop, and the reader sees it before they mail it.
     *
     * THE FIT IS ALWAYS MEASURED AGAINST THE BLEED AREA, the preview included;
     * only the clip follows `withBleed`. So the trim shows the same crop on
     * screen and in the PNG — the preview is the print with its bleed cut off.
     * Centred in the bleed area is centred in the trim, because the bleed runs
     * the same 37.5 past the left, right and top edges.
     *
     * `cap: 1` is what paint() settles state.count against; restoring the
     * count on the way out is §9's.
     */
    const total = wrapped.length;
    let from = Math.max(0, Math.min(state.start, total - 1));
    /* A± on a full-front mosaic rewraps the prose before the run, so the run's
       first row moves and a raw `start` lands on text. The dispatch passes the
       run's id as state.run for that one paint, and the run is found again
       here; the dispatch then takes `from` back into start. §11 B1. */
    if (state.expanded && Number.isInteger(state.run)) {
        const found = wrapped.findIndex((row) => row.type === "mosaic" && row.run === state.run);
        if (found >= 0) from = found;
    }
    const lead = wrapped[from];

    /*
     * THE FULL-FRONT MOSAIC. DECISIONS-LOG.md #77, CHECKLIST-13 §10.
     *
     * Wrap off, and the window starts on a mosaic row: every row cut from that
     * row's run is gathered and its pictures re-packed into the box inside the
     * margins — x marginX…TRIM_W − marginX, y marginTop…bandTop − bandGap
     * (1056 x 1572). Inside the trim, not at the bleed: a no-crop mosaic at the
     * trim edge would lose its outer pictures' edges to the blade.
     *
     * CONTAIN, NEVER CROP. The target row height is searched down from the box
     * height in steps of 4 and the first that packs short enough wins, so every
     * row is still base 4. The block is centred on its widest row, which centres
     * it when the height binds and moves it under 8 when the width does. It sits
     * at the top margin, not centred vertically. Cell widths are aspect x h and
     * cannot sit on the grid in a no-crop pack, so the centring offset is
     * floored to a multiple of 4 and the page's left edge stays on it.
     *
     * A ONE-PICTURE RUN IS A MOSAIC TOO (wrap off), so it contains rather than
     * covers — the user's split is wrap on → §7's cover, wrap off → this.
     *
     * The view spans the whole run (`from` its first row, `size` its rows), so
     * the rail shows the run and step() can jump it in one press.
     */
    if (state.expanded && !quoteCard && lead?.type === "mosaic") {
        let first = from;
        let last = from;
        while (wrapped[first - 1]?.type === "mosaic" && wrapped[first - 1].run === lead.run) first--;
        while (wrapped[last + 1]?.type === "mosaic" && wrapped[last + 1].run === lead.run) last++;
        const pictures = wrapped.slice(first, last + 1).flatMap((row) => row.figures.map((cell) => cell.entry));
        const photos = (data.lines || []).filter(isPhoto);
        const forcedBreaks = new Set((state.breaks || []).filter((i) => Number.isInteger(i) && i >= 0 && i < photos.length));
        const breakAfter = (entry) => forcedBreaks.has(photos.indexOf(entry));
        const boxH = bandTop - L.bandGap - L.marginTop;
        const packedH = (rows) => rows.reduce((sum, row) => sum + row.h, 0) + MOSAIC_GAP * (rows.length - 1);
        let best = 4;
        for (let target = Math.floor(boxH / 4) * 4; target >= 4; target -= 4) {
            if (packedH(mosaicRows(pictures, measure, lead.run, target, breakAfter)) <= boxH) {
                best = target;
                break;
            }
        }
        /*
         * A↑ ZOOMS AND PAGES. DECISIONS-LOG.md #79, CHECKLIST-13 §11.
         *
         * Row target T = min(best + 32 x max(0, step), cap), cap the box height
         * on the 4, so a row is never taller than the box. Nothing is scaled:
         * the run packs once at T and is cut into pages of whole rows that fit
         * the box, each top-aligned. At step ≤ 0 it is one page, as §10 built.
         * state.pic is the run-relative first picture on screen; the page shown
         * is the one holding it, so A± keeps the reader on the same pictures.
         * −1 means the last page.
         *
         * At the fitted step rows justify across the measure. Above it, each
         * row keeps its target height and a following picture starts a new row
         * before it would overrun the measure. A+ therefore always enlarges the
         * photos, including a run whose old justified membership was unchanged.
         */
        const cap = Math.floor(boxH / 4) * 4;
        const at = (s) => mosaicRows(pictures, measure, lead.run, Math.min(best + 32 * Math.max(0, s), cap), breakAfter, s > 0);
        /* The card's own photo zoom, not the text step: A± here moves only the
           pictures and leaves the text size alone (§13.29, #79). */
        const zoom = Math.max(0, Math.min(state.zoom || 0, PHOTO_STEP_MAX));
        const rows = at(zoom);
        const zoomTo = zoom < PHOTO_STEP_MAX ? zoom + 1 : null;
        const zoomOut = zoom > 0 ? zoom - 1 : 0;
        const pagination = mosaicPages(rows, boxH);
        const { pages, count } = pagination;
        const want = state.pic < 0 ? count - 1 : Math.min(state.pic || 0, count - 1);
        const p = pages.filter((page) => page.pic <= want).length - 1;
        const shown = pages[p];
        const page = shown.rows;
        const rowW = (row) => row.figures.reduce((sum, cell) => sum + cell.w, 0) + MOSAIC_GAP * (row.figures.length - 1);
        const wide = Math.max(...page.map(rowW));
        const left = L.marginX + Math.floor((measure - wide) / 8) * 4;
        let top = L.marginTop;
        /* §13.25: each drawn cell in trim units, `i` its photo's post-order
           index, for the reorder drag in the DOM overlay (#37). */
        const cells = [];
        const mosaicRowsOnPage = [];
        for (const row of page) {
            const rowCells = [];
            for (const cell of row.figures) {
                drawFigure(ctx, cell.entry, left + cell.x, top, { w: cell.w, h: row.h });
                const drawn = { x: left + cell.x, y: top, w: cell.w, h: row.h, i: photos.indexOf(cell.entry) };
                cells.push(drawn);
                rowCells.push(drawn);
            }
            mosaicRowsOnPage.push({ y: top, h: row.h, first: rowCells[0]?.i, last: rowCells.at(-1)?.i });
            top += row.h + MOSAIC_GAP;
        }
        drawBand();
        ctx.restore();
        return {
            full: true,
            mosaic: true,
            lines: wrapped,
            run: lead.run,
            from: first,
            size: last - first + 1,
            cap: 1,
            total,
            rail: { total: pagination.total, size: shown.h, from: shown.start },
            visible: wrapped.slice(first, last + 1),
            pageBefore: p > 0,
            pageAfter: p < pages.length - 1,
            prevPic: pages[p - 1]?.pic,
            nextPic: pages[p + 1]?.pic,
            pages: pages.length,
            zoomTo,
            zoomOut,
            hiddenBefore: p > 0 || first > 0,
            hiddenAfter: p < pages.length - 1 || last + 1 < total,
            bodyBottom: bandTop,
            figure: { x: left, y: L.marginTop, w: wide, h: top - MOSAIC_GAP - L.marginTop, index: from, full: true },
            cells,
            mosaicRows: mosaicRowsOnPage
        };
    }

    if (state.expanded && !quoteCard && isFigure(lead) && !isBookmark(lead) && lead.img?.naturalWidth) {
        const img = lead.img;
        const turned = img.naturalWidth > img.naturalHeight;
        const sw = turned ? img.naturalHeight : img.naturalWidth;
        const sh = turned ? img.naturalWidth : img.naturalHeight;
        const areaW = TRIM_W + BLEED * 2;
        const areaH = bandTop + BLEED;
        const k = Math.max(areaW / sw, areaH / sh);
        const w = sw * k;
        const h = sh * k;
        ctx.save();
        ctx.beginPath();
        ctx.rect(-over, -over, TRIM_W + over * 2, bandTop + over);
        ctx.clip();
        drawFigure(ctx, lead, -BLEED + (areaW - w) / 2, -BLEED + (areaH - h) / 2, { w, h }, turned);
        ctx.restore();
        drawBand();
        ctx.restore();
        return {
            full: true,
            lines: wrapped,
            from,
            size: 1,
            cap: 1,
            total,
            visible: [lead],
            hiddenBefore: from > 0,
            hiddenAfter: from + 1 < total,
            bodyBottom: bandTop,
            /* The visible area, not the drawn rect — that runs past the canvas,
               and the buttons sit inside this box's corner. */
            figure: { x: 0, y: 0, w: TRIM_W, h: bandTop, index: from, full: true }
        };
    }

    // Title
    ctx.font = `800 ${L.titleSize}px "Gill Sans Ultra", sans-serif`;

    let y = L.marginTop + L.titleSize;
    const head = titleLines(ctx, data.title, headWidth);
    head.forEach((line, i) => {
        ctx.fillText(line, L.marginX, y + i * L.titleLead);
    });
    y += Math.max(0, head.length - 1) * L.titleLead;

    // Meta — type and URL, separated by a middot. The frame carries no date;
    // the verbal spec did. The frame wins per CLAUDE.md and this is the flag.
    // It is held to the head width rather than the full measure: on a one-line
    // title its baseline is level with the bottom of the code, and a long URL
    // running the full width would run underneath it.
    /*
     * BOLD, GREY, AND IN THE THEME'S META FACE — IBM Plex Mono Bold, which is
     * the article's own meta row rather than a line invented for the card. It
     * used to be OpenDyslexic bold and the two surfaces disagreed; the user
     * reversed that on 2026-09-01 (DECISIONS-LOG #28 supersedes #16) and this
     * is the last surface that was still drawing the old face.
     *
     * WHAT THE SWAP COSTS THIS LINE, MEASURED OFF THE SHIPPED FONT FILES RATHER
     * THAN LOOKED AT. The line is held to the head width, so it has 812 units:
     *
     *     1056  the measure
     *     - 204  headerHeight(2), which is the code's width in the worst case
     *     -  40  qrGap
     *     ----
     *      812
     *
     * IBM Plex Mono Bold is monospaced and its advance is exactly 600/1000 upem
     * — read out of the font's own hmtx table, every glyph the same. At 32px
     * that is 19.2 units a character, and metaTrack adds 1.28, so 20.48 a
     * character and 812 units is 39 CHARACTERS.
     *
     * OpenDyslexic Bold averaged about 0.58em over the characters this line
     * actually uses, which came to roughly 19.8 a character and about 40. So
     * THE SWAP COSTS THIS LINE ONE CHARACTER, not a redesign. Measured on the
     * real strings:
     *
     *     Note  •  qntns.com/brief                     24 ch   490 of 812
     *     Poem  •  qntns.com/milk-tea                  27 ch   552 of 812
     *     Essay  •  qntns.com/doorways                 28 ch   572 of 812
     *
     * THE LONG-SLUG CASE ALREADY OVERFLOWED AND STILL DOES, AND MONO IS NOT
     * WHAT BROKE IT. "Photography  •  qntns.com/the-cobblestone-survey-1961" is
     * 53 characters: 1050 units in OpenDyslexic and 1084 in Plex, against 812
     * either way. Nothing here truncates the meta line, so a long type name
     * plus a long slug ran under the code before this change and runs 34 units
     * further under it now. THAT IS NOW FIXED: metaLine() shaves the line from
     * the end and closes it with an ellipsis, so the slug is what is lost. The
     * user ruled that on 2026-09-01 — DECISIONS-LOG.md #49.
     *
     * VERTICALLY THE SWAP IS FREE HERE, unlike on the content page. Plex Bold's
     * ink box is 1.30em against OpenDyslexic's 1.75em, and its ascent is 1.025em
     * against 1.25em — so it reaches LESS far above the baseline, away from the
     * title, not toward it. A canvas baseline has no line box to be clipped by,
     * so a shorter face simply draws shorter; nothing moves.
     */
    // The face goes on FIRST: metaLine() measures with it, and the width it
    // is held to is the head width — the same 812 units the note above counts.
    // `www.` is stripped inside metaLine(); the reason is on that function.
    ctx.fillStyle = palette.meta;
    ctx.font = `700 ${L.metaSize}px "IBM Plex Mono", ui-monospace, monospace`;
    const meta = metaLine(ctx, data.type, data.url, headWidth);
    y += L.titleGap + L.metaSize;
    fillTracked(ctx, meta, L.marginX, y, L.metaTrack);
    ctx.fillStyle = palette.ink;

    // The code: square, right-aligned to the margin, top-aligned to the first
    // title line, and exactly as tall as the rows it spans — so it finishes on
    // the meta baseline whether the title took one row or two. A card whose URL
    // cannot be encoded still gets printed; the code is a convenience and its
    // absence is not worth losing the postcard over, which is why this cannot
    // throw.
    if (data.url) {
        try {
            const qr = headerHeight(head.length);
            const target = absoluteUrl(data.url);
            // quiet: 0 — the code fills the box exactly, top edge on the title's
            // top and bottom edge on the meta baseline. Its quiet zone is the
            // card's own margins, which are several times the required 4
            // modules on all four sides; see LAYOUT.qrGap for the arithmetic.
            // Left at the default, the code would reserve 8 of its 33 units for
            // a margin it already has and draw at three quarters of the height
            // it was given.
            drawQr(ctx, target, TRIM_W - L.marginX - qr, L.marginTop, qr, palette.ink, { quiet: 0 });
        } catch {
            // Unencodable, or the encoder is not there. Draw the rest of the card.
        }
    }

    // Body — the article's own reading face at the article's own leading, and
    // untracked, so the passage breaks where the article breaks it.
    ctx.font = bodyFont();
    /* Worked here rather than at the call site because this is the only place
       that holds the wrapped entries, and the budget is over entries and not
       over source lines. The window is clamped to it before anything is drawn,
       so a count carried in from a draft — or from a window that has just been
       scrolled onto a run of pictures — cannot print over the wordmark band.
       paint() reads view.cap back out and settles state.count against it. */
    const cap = maxLines(wrapped, state.start, Boolean(state.expanded));
    /* A QUOTE CARD HAS NO WINDOW, so it is handed the whole passage rather than
       a slice of it. windowLines then reports hiddenBefore and hiddenAfter as
       false for free, which is what stops either ellipsis being drawn and what
       leaves both travel chevrons free to mean "the previous post" and "the
       next post" instead. fitQuoteType has already guaranteed this fits — it
       walked exactly these entries against exactly this budget — so `cap` is
       not a bound here, only a number paint() reads back. §6.5. */
    const view = quoteCard
        ? windowLines(wrapped, 0, wrapped.length)
        : windowLines(wrapped, state.start, Math.min(state.count, cap), Boolean(state.expanded));
    view.cap = cap;
    /* The whole wrapped list, because `start` indexes it and step()'s landing()
       has to see the entries a step passes over, not the source lines (§13.8). */
    view.lines = wrapped;
    /* THE NUMBER THE CARD KNOWS AND USED TO TELL NOBODY. Nothing draws it: it
       is here so a caller can express the window as a PROPORTION of the whole
       passage instead of guessing at one. It is not recoverable from anything
       else on `view` — `hiddenBefore`/`hiddenAfter` are booleans, and
       `data.lines.length` is the SOURCE line count, which for prose is 1 while
       `wrapped.length` is dozens. See CHECKLIST-v6 §16.3. */
    view.total = wrapped.length;

    y += L.metaGap;
    /* EDGE_DROP, not 16 — this is the empty-window case and it has to agree
       with the branches in the loop below. */
    let edgeAt = y + EDGE_DROP;

    /*
     * OFF SINCE CHECKLIST-13 §30: the scroll bar says there is more, so the
     * mark is commented out below. This block describes it while it is off.
     *
     * THE LEADING ELLIPSIS IS DRAWN IN THE metaGap, AND IT COSTS THE BODY
     * NOTHING.
     *
     * It used to be a body row and §7.5 removed it, because two reserved rows
     * was two lines of the sender's poem. The reader asked for it back and the
     * row it used to occupy is no longer affordable — the budget's 64-unit
     * remainder was spent on the seventeenth line, and §13.31 gave the closing
     * dots' reserved row to an eighteenth. So it is drawn in
     * the 72-unit metaGap that already sits between the meta rule and the
     * first body row: a gap that is spent whether or not anything is in it,
     * that holds nothing, and that is already inside `used` rather than inside
     * the budget.
     *
     * THIS IS NOT A SECOND COORDINATE SYSTEM. `y` here is the body top, exactly
     * firstLead() above the first body baseline, because the body loop advances
     * BEFORE it draws and its first row advances by firstLead() (§13.28). At
     * step 0 that is one bodyLead, 72, so the mark lands one row up on the
     * body's own grid, the same relationship the closing ellipsis has to the
     * last line. The only unusual thing is where the row was bought, and the
     * sender never sees a purchase.
     *
     * THE CLEARANCE, IN TRIM UNITS, RELATIVE TO THE META BASELINE (M):
     *
     *   M +  8.8   the meta line's descenders end    Plex Mono Bold, 0.275em of 32
     *   M + 64.9   the dots begin                    7.12 of ink, on their baseline
     *   M + 72     THE ELLIPSIS BASELINE = BODY TOP  = metaGap
     *   M + 113…117  the first body line's cap top   firstLead() − 0.729 × size, 40.9…44.7
     *   M + 144    the first body baseline at step 0 = body top + firstLead(), 72
     *
     * 56 units clear above the dots and 40.9…44.7 below them at every text step,
     * read off the shipped font files rather than looked at (the cap top uses
     * the outline cap height, not the 1.25em ascent, which no capital
     * reaches). §11.6 HELPED HERE: the meta face went from OpenDyslexic Bold,
     * which descends 16 units at this size, to Plex Mono Bold, which descends
     * 8.8 — so that swap gave this mark 7 more units of room rather than
     * taking any.
     *
     * THIS MARK MOVES NEITHER THE BUDGET NOR THE CAP. (ELLIPSIS_RESERVE was the
     * closing mark's row, and §13.31 set it to 0 once both were off.) The guarantee that
     * the cap means the same thing at every scroll position is untouched, and
     * kept by the same mechanism as before rather than by an exception to it:
     * the metaGap is unconditional, so the space for this mark is held in all
     * four window states — top, middle, end, and whole-article-fits — whether
     * it is drawn or not. Nothing about hiddenBefore reaches the budget.
     *
     * IT IS CARD, NOT CHROME, so it belongs in paintFront and prints. That is
     * the opposite call from the blue drag edge, which is a control and lives
     * in the DOM overlay; see CLAUDE.md. A reader holding the printed card has
     * to be able to see that the quote started partway into the article.
     */
    /* Off per CHECKLIST-13 §30 (the scroll bar says it). Uncomment to bring it back.
       The leading mark sits in metaGap and costs no row, but bring both back
       together, and the closing one needs ELLIPSIS_RESERVE set to 1 (§13.31). */
    // if (view.hiddenBefore) {
    //     fillTracked(ctx, "…", L.marginX, y, L.bodyTrack);
    // }
    /*
     * THE ROW ADVANCE IS PER ENTRY NOW. `y` is a baseline cursor for text — it
     * advances first and draws on the line it lands on — and a block cursor for
     * a picture, which occupies its block (576 at step 0) below where the last
     * baseline was. Both leave `y` on the bottom edge of what they drew, which is what
     * lets the two kinds sit in one loop.
     *
     * A PICTURE'S BLOCK IS NOT ALL PICTURE:
     *
     *     576  the entry's height at step 0, FIGURE_H = 8 x bodyLead; each A↑
     *          step adds 32, up to FIGURE_STEP_MAX +13 = 992 (§13.27, figureBlock)
     *   -   8  clearance at the top, so a descender on the line above does not
     *          touch it
     *   -   8  clearance at the bottom, the same for the line below
     *   -----
     *     560  the box the image is fitted into, at step 0
     *
     * 8 is a multiple of 4 and is the descender depth of 40px body type, which
     * is the thing being cleared. 560 is a multiple of 4. The entry's total
     * stays a whole number of rows, so the text after a picture is still on the
     * same baseline grid as the text before it. An expanded picture never
     * reaches this loop; it is the full-front branch above.
     */
    /* Set by the figure branch below and handed out on `view`. null on a card
       with no picture in the window, which is what hides the controls. */
    let figure = null;

    /* INDEXED, BECAUSE ONE ENTRY KIND CARES WHERE IT IS. A divider that lands
       last drops the gap below it — see drawBlock — and "last" is a property of
       the window, not of the entry, so it cannot be read off the entry alone.
       Nothing else in this loop uses the index. */
    for (let i = 0; i < view.visible.length; i++) {
        const entry = view.visible[i];
        /* A MOSAIC ROW (#76): the gap above, then each cell at its packed x.
           The first picture of the first row owns the controls, as below. The
           edge sits 8 under the row, the same clearance a picture's gets. */
        if (entry?.type === "mosaic") {
            const top = y + MOSAIC_GAP;
            for (const cell of entry.figures) {
                drawFigure(ctx, cell.entry, L.marginX + cell.x, top, { w: cell.w, h: entry.h });
            }
            if (!figure && entry.figures.length) {
                figure = { x: L.marginX, y: top, w: entry.figures[0].w, h: entry.h, index: view.from + i };
            }
            y += entryHeight(entry);
            edgeAt = y + MOSAIC_GAP;
            continue;
        }
        if (isBookmark(entry)) {
            /* Flush like a picture, and for the same reason: the block's own
               bottom edge is a drawn boundary, so there are no descenders for
               EDGE_DROP to clear. See the note in the figure branch. */
            drawCallout(ctx, entry, L.marginX, y, measure, CALLOUT_H, palette);
            y += CALLOUT_H;
            edgeAt = y;
            continue;
        }
        if (isFigure(entry)) {
            const fit = figureFit(entry);
            drawFigure(ctx, entry, L.marginX, y + 8, fit);
            /*
             * THE PICTURE'S BOX, HANDED BACK THE WAY bodyBottom IS, AND FOR THE
             * SAME REASON: the overlaid expand button is DOM and
             * MUST NOT BE PAINTED HERE. paintPreview() and exportFront() are one
             * function at two scales, so a maximize icon drawn into this
             * function is a maximize icon on a card somebody paid to have
             * mailed. DECISIONS-LOG.md #37, and it is a principle rather than a
             * §2 precaution. All this function hands out is the rectangle only
             * the drawing knows; paint() turns it into percentages.
             *
             * THE FIRST VISIBLE PICTURE OWNS THE CONTROLS. A window can hold
             * several, and two sets of buttons that both drive one window-level
             * setting would be two controls for one thing. The first is the one
             * the eye lands on. `index` is its place in the wrapped array, so
             * expand can start the window on it.
             */
            if (fit && !figure) {
                figure = { x: L.marginX, y: y + 8, w: fit.w, h: fit.h, index: view.from + i };
            }
            y += entryHeight(entry);
            /*
             * A PICTURE'S EDGE IS FLUSH WITH ITS BLOCK, WITH NO DROP ADDED, and
             * that is a decision rather than an omission.
             *
             * A text row's baseline is not the bottom of its ink — the
             * descenders hang about 8 units under it — so EDGE_DROP is buying
             * clearance that does not exist yet. A picture's block already
             * carries its own: the image ends at least 8 units above the
             * block's bottom edge, by the split above. So the two cases land
             * within 4 units of each other:
             *
             *   text     20 below the baseline  =  12 clear below the ink
             *   picture   0 below the block     =   8 clear below the image
             *
             * 4 trim units is about 1.5 CSS px at the desktop maximum. Adding
             * the drop to a picture instead would put the rule 20 units into
             * the following row's space and read as detached from the thing it
             * is marking the end of.
             */
            edgeAt = y;
            continue;
        }
        /* A POEM LINE IS PROSE WITH A HANG: the same row, face and track as the
           branch below, set poemHang() in when it is a wrapped continuation.
           blockHeight() charges it one row, which is what this draws. */
        const poemRow = isBlock(entry) && entry.type === "poem";
        if (isBlock(entry) && !poemRow) {
            [y, edgeAt] = drawBlock(
                ctx, entry, L.marginX, y, measure, palette, i === view.visible.length - 1, i === 0
            );
            continue;
        }
        /* The window's first row sits on the cap height (§13.28, firstLead). */
        y += i === 0 ? firstLead() : L.bodyLead;
        fillTracked(
            ctx,
            entryText(entry),
            L.marginX + (poemRow && entry.first === false ? poemHang() : 0),
            y,
            L.bodyTrack
        );
        edgeAt = y + EDGE_DROP;
    }

    /*
     * CHECKLIST-13 §30: the closing ellipsis is off (commented out below), so
     * the edge sits under the last visible line. Where this block talks about
     * the dots, it describes them while they are off; the reserved row stays.
     *
     * WHERE THE BLUE EDGE SITS, IN TRIM UNITS. The overlay that draws it is a
     * DOM element (see .qntns-postcard__edge) and MUST NOT be painted here —
     * this function is the printed artwork as well as the preview — so all the
     * drawing hands out is the one number only the drawing knows.
     *
     *     y             the baseline of the last visible line
     *   + EDGE_DROP     clearance under it, 20
     *   ------
     *     bodyBottom, CLAMPED to the top of the band
     *
     * 20 rather than 0: body type is 40px, so a descender drops roughly 8 units
     * below the baseline and a rule ON the baseline would be struck through by
     * every g and y. EDGE_DROP clears that with room over, and it is well
     * inside the 72-unit leading, so the rule stays under its own line and off
     * the next one. (This paragraph said 16 until 2026-09-01. EDGE_DROP has
     * been 20 throughout; the comment was simply wrong, and the arithmetic
     * below is why that mattered.)
     *
     * THE CLAMP, AND THE EIGHT UNITS THAT MADE IT NECESSARY. CHECKLIST-v7 §13.
     *
     * The drop is spent out of the gap left under the last row, and that gap is
     * NOT a constant: LAYOUT's comment gives it as bandGap on a two-line title
     * and bandGap + titleLead on a one-line one. bandGap shipped at 12 on
     * 2026-09-01, so on a two-line title at the cap the sum is:
     *
     *     348   the first body baseline, less one bodyLead
     *  + 1296   18 rows, which is the whole budget with remainder 0
     *   -----
     *    1644   the last body baseline  =  bandTop - bandGap, exactly
     *  +   20   EDGE_DROP
     *   -----
     *    1664   8 units BELOW bandTop, which is 1656
     *
     * (Until §13.31 the 1644 row was the closing ellipsis, on the row the
     * reserve held for it, under 17 rows of text. It is now the eighteenth.)
     *
     * So the edge landed inside the band, under its navy rule and on the
     * wordmark. THE BUDGET IS NOT WRONG AND THE CAP IS NOT WRONG: the last
     * line's letter tails end above the band, because maxLines() charges its
     * closingTail() (a g at step 0 ends 1.5 units clear). What overflowed is the CLEARANCE UNDER the last thing drawn — 20
     * asked for out of a gap that is only 12 — and that is a placement fault in
     * one boundary state, not a row the card cannot afford. Taking a line off
     * the budget would have cost every card a row to move this rule by 8 units.
     *
     * The clamp is the honest bound rather than a smaller drop: the edge marks
     * the bottom of what is visible, the band is where the card stops being the
     * passage, and there is no position past that for it to mark. bandTop is
     * TRIM_H - bandH = 1656, a multiple of 4, and it is derived rather than
     * chosen, so no new constant enters the file.
     *
     * AFTER A PICTURE IT IS THE PICTURE'S OWN BOTTOM EDGE, with no drop added;
     * the note in the loop works out why. So `edgeAt` is set by whichever
     * branch ran last rather than computed from `y` afterwards.
     *
     * IT SITS BELOW THE CLOSING ELLIPSIS, AND IT USED TO SIT ABOVE IT.
     *
     * The first version argued that the ellipsis is not part of the quoted
     * passage — it is the mark for the part left out — so the edge belonged
     * above it. That is a fair reading of the model and it was the wrong
     * reading of the card. The dots are drawn, so to the reader they are part
     * of what is showing, and a rule that cuts between the last line and the
     * dots is a rule through the middle of the passage rather than under it.
     * The edge marks the bottom of what is VISIBLE. So the capture moved below
     * the ellipsis block and the ellipsis pays the same EDGE_DROP any other
     * text row does.
     */
    /* Off per CHECKLIST-13 §30 (the scroll bar says it). Uncomment to bring it back,
       AND set ELLIPSIS_RESERVE back to 1: §13.31 gave its row to the text, so
       without it these dots land a row lower, in the band. */
    // if (view.hiddenAfter) {
    //     y += L.bodyLead;
    //     fillTracked(ctx, "…", L.marginX, y, L.bodyTrack);
    //     edgeAt = y + EDGE_DROP;
    // }

    /* Never into the band. See the arithmetic above: at the cap on a two-line
       title the drop asks for 20 units out of the 12 that bandGap leaves. §13. */
    view.bodyBottom = Math.min(edgeAt, bandTop);
    view.figure = figure;

    drawBand();

    ctx.restore();
    return view;
};

/*
 * The preview. Backed at device pixels so the type is not soft on a retina
 * screen, and drawn at the trim only — the reader is looking at a postcard,
 * not at the sheet it gets cut from.
 */
/*
 * THE BACKING STORE MUST NEVER BE TALLER THAN WHAT IS PAINTED INTO IT.
 *
 * This used to round the CSS height and the device height separately, which
 * left the store up to a device pixel taller than the drawing. That last row
 * stayed transparent, the stage's beige showed through it, and the card grew a
 * pale hairline UNDER its navy strip — visible on the front and not on the
 * back, because only the front is a canvas.
 *
 * The fix is to derive both dimensions from ONE integer width and to floor the
 * height, so the paint always covers the store rather than the other way round.
 * Flooring can cost the bottom strip a fraction of a device pixel; a hairline
 * of missing navy against navy is nothing, and a hairline of beige against navy
 * is the bug.
 */
const paintPreview = (canvas, data, state, tokens) => {
    const cssWidth = canvas.clientWidth || 440;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const width = Math.round(cssWidth * dpr);
    canvas.width = width;
    canvas.height = Math.floor((width * TRIM_H) / TRIM_W);
    const ctx = canvas.getContext("2d");
    return paintFront(ctx, data, state, { scale: width / TRIM_W, tokens });
};

/* The print artwork. A detached canvas at the full bleed size — this is the
   only thing that is ever uploaded, and it is built at click time rather than
   held in memory, because a 1275x1875 bitmap is 9MB of RGBA sitting idle. */
export const exportFront = async (data, state, type = "image/png") => {
    await loadCardFonts();
    const canvas = document.createElement("canvas");
    canvas.width = CARD_W;
    canvas.height = CARD_H;
    paintFront(canvas.getContext("2d"), data, state, { scale: 1, withBleed: true });
    return new Promise((resolve) => canvas.toBlob(resolve, type));
};

/* -------------------------------------------------------------------------
 * Reading the article off the page
 * ---------------------------------------------------------------------- */

/*
 * THE CARD IS BUILT FROM THE RENDERED POST, NOT FROM DATA PASSED INTO IT.
 *
 * post.hbs emits `{{content}}` and nothing else about the body — there is no
 * JSON blob of the article anywhere on the page, and adding one would mean the
 * card and the page could disagree about what the post says. Reading the DOM is
 * what guarantees the passage on the postcard is the passage the sender is
 * looking at.
 *
 * PARAGRAPHS BECOME LINES, AND SO DO A POEM'S OWN BREAKS. A poem is marked up
 * as one <p> with <br> between its lines (see the #fixed-lines handling in
 * post.hbs), and those breaks are the poem — re-flowing them would be
 * re-writing it. A prose paragraph is one long line and wrapLines() turns it
 * into several later. Both end up in the same array, which is what lets the
 * window controls work on verse and prose without knowing which they have.
 *
 * By the time this runs the poem's <br>s have usually been replaced by
 * .qntns-content__line spans — see blockLines(), which is where that cost us
 * the line breaks once already.
 *
 * A GHOST CARD IS A <figure> AND IT USED TO BE DROPPED HERE. Every image,
 * gallery, video, embed, bookmark, callout and toggle in an article renders as
 * one, so the card builder could only ever see prose. Figures that carry a
 * picture now become an entry of their own — one per image, so a gallery is
 * every photograph in it; see figureEntries() for which figures count, why the
 * bookmark card is not one of them, and why a video card is drawn as nothing at
 * all.
 *
 * HEADINGS ARE NO LONGER SKIPPED. §2 gave them, the divider, the code block,
 * the quote and the lists an entry of their own, and this line used to say they
 * were skipped, which was true when it was written and is not now.
 *
 * Footnote markers ARE still skipped rather than flattened. A card that quietly
 * included the text of a footnote reference would be quoting something the
 * reader never selected.
 */

/*
 * WHICH FIGURES BECOME A PICTURE, AND WHERE THE PICTURE COMES FROM.
 *
 * An image card has an <img> and a gallery card has several, and each of them
 * is a still the reader has already seen on the page, which is the only kind of
 * thing a printed postcard can carry. An embed with no still — a tweet, an
 * iframe, a piece of HTML — has nothing to draw and yields nothing, so it is
 * dropped exactly as it was before. A VIDEO CARD YIELDS NOTHING EITHER, and
 * that one is a RULING rather than an absence of material: DECISIONS-LOG.md
 * #60, and the full note is on figureEntries() below.
 *
 * THE BOOKMARK CARD IS NOT ONE OF THESE. It is a link with an address, and it
 * gets read whole by bookmarkEntry() below rather than reduced to whichever
 * <img> happened to be inside it. §8 excluded it here with a note pointing
 * forward to this; the exclusion stands and the handling is now real.
 */
/*
 * READING A BOOKMARK CARD WHOLE.
 *
 * NOTHING IS FETCHED. Ghost resolves a link's OG data once, in the editor, and
 * writes it into the post — content-cards.css:748-758 documents this at length.
 * The title, the publisher and the thumbnail's src are literal strings by the
 * time the theme sees them, which is what lets the card builder read a callout
 * without the theme making a network call CLAUDE.md forbids.
 *
 * THE ADDRESS IS ON THE ANCHOR, NOT IN THE TEXT. A paragraph's inline links
 * lose their href to the tag-stripping further down, so a URL from the prose
 * never survives to the card. A bookmark's does, because it is an attribute on
 * `a.kg-bookmark-container` and is read here before anything is flattened.
 *
 * THE ICON IS NOT THE THUMBNAIL. `.kg-bookmark-icon` is the favicon and lives
 * inside the metadata row; the art is `.kg-bookmark-thumbnail img`, and Ghost
 * omits that element entirely when the other site published no OG image. So
 * `src` is undefined rather than empty in the ordinary no-art case, and
 * loadFigures treats that as normal rather than as a failure.
 */
const bookmarkEntry = (figure) => {
    const link = figure.querySelector("a.kg-bookmark-container[href]");
    if (!link) return null;
    const thumb = figure.querySelector(".kg-bookmark-thumbnail img[src]");
    return {
        type: "bookmark",
        href: link.getAttribute("href"),
        title: figure.querySelector(".kg-bookmark-title")?.textContent.trim() || link.getAttribute("href"),
        publisher: figure.querySelector(".kg-bookmark-publisher")?.textContent.trim() || "",
        src: thumb?.currentSrc || thumb?.getAttribute("src") || "",
        alt: ""
    };
};

/*
 * EVERY PICTURE IN A FIGURE, IN DOCUMENT ORDER — AND NONE AT ALL FOR A VIDEO.
 * Returns an ARRAY, which is why it is no longer figureEntry(): an ordinary
 * <figure> gives one entry, a gallery gives one per image, a video gives none.
 *
 * *** A VIDEO CARD IS DELIBERATELY NOT DRAWN. DECISIONS-LOG.md #63, ruled by
 * the user: "don't show video items on the post card. Right now a video item
 * shows an empty image placeholder." ***
 *
 * THIS IS A RULED OMISSION AND NOT A DROPPED BLOCK, and the two are
 * indistinguishable in code six months from now, which is the only reason this
 * paragraph is here. §2 exists BECAUSE blocks were vanishing with nothing
 * indicating it. This one vanishes on purpose.
 *
 * WHAT IT WAS DOING INSTEAD. Ghost emits
 * <figure class="kg-card kg-video-card" data-kg-thumbnail="..._thumb.jpg"> with
 * <video src="....mp4" poster="data:image/gif;base64,R0lGODlhAQABAIAA...">, and
 * THAT POSTER IS THE 1x1 TRANSPARENT GIF — Ghost paints the real thumbnail as a
 * CSS background on the <video> instead. So the img[src] lookup found nothing,
 * the video[poster] fallback matched, `src` was truthy so the !src guard never
 * fired, and the card spent 288 units — four body rows — drawing one invisible
 * pixel. Read off the live post /scotch-tape-runner/, 2026-09-01.
 *
 * MATCHED ON THE CARD CLASS, NOT ON THE PIXEL, and the test is FIRST so it
 * cannot be defeated by Ghost later putting an <img> inside the card. Do not
 * special-case the base64 string: Ghost may change its placeholder and a real
 * image can legitimately be a data URI.
 *
 * DRAWING THE THUMBNAIL WAS CONSIDERED AND REFUSED. `data-kg-thumbnail` carries
 * the real poster and reading it would have cost one attribute. IT MUST NOT BE
 * REACHED FOR LATER AS AN IMPROVEMENT — the user asked for the video not to
 * show, and a thumbnail is the video showing.
 *
 * A GALLERY IS EVERY IMAGE, STACKED, ONE ENTRY EACH. Ghost emits it as ONE
 * <figure class="kg-gallery-card"> holding
 * .kg-gallery-container > .kg-gallery-row > .kg-gallery-image > img, several
 * images deep — content-cards.css:197-218 styles that nesting — so the single
 * querySelector this function used to open with took the FIRST image and
 * dropped the rest silently. A six-photograph gallery drew as one photograph.
 *
 * RULED BY THE USER: "Extra images are like extra lines of text. Stacked and if
 * it fits it shows. Extras would be scrollable into view." So there is NO CAP,
 * NO GRID, NO COMPOSITE and no "+N more" marker.
 *
 * AND THE OVERFLOW NEEDS NO SPECIAL CASE, WHICH IS WHY THAT ANSWER IS THE RIGHT
 * ONE RATHER THAN MERELY THE SIMPLEST. One image is FIGURE_H 576 plus the 72
 * blank readArticle pushes after it = 648 units, so against bodyBudget()'s 1296
 * TWO FILL A WINDOW at step 0 and a third does not (one, against 1224, until
 * §13.31). No single entry is ever oversized — at most 992 against 1296 — so maxLines()'s walk never meets
 * one it has to refuse, which is the exact failure the code block's
 * one-entry-per-line rule was made binding to avoid. A long gallery runs past
 * the window like a long passage and the reader steps through it.
 *
 * THE SINGLE-IMAGE PATH IS UNCHANGED AND MUST STAY THAT WAY: an ordinary
 * <figure> holding one <img> still yields exactly one entry and still costs
 * exactly 648. A gallery of one IS an ordinary figure and the two must not
 * diverge.
 *
 * currentSrc RATHER THAN THE src ATTRIBUTE, so a responsive image hands back
 * the file the browser actually chose off the srcset rather than the fallback,
 * and hands it back absolute. The attribute is the fallback for a detached or
 * not-yet-laid-out <img>, which is what a story fixture is.
 */
const figureEntries = (figure) => {
    if (figure.classList.contains("kg-video-card")) return [];
    const imgs = [...figure.querySelectorAll("img[src]")];
    if (imgs.length) {
        return imgs.map((img) => ({
            type: "image",
            src: img.currentSrc || img.getAttribute("src"),
            alt: img.getAttribute("alt") || ""
        }));
    }
    /* An embed's poster is a real still and still counts; an embed with no
       still at all has nothing to draw and yields nothing, exactly as v6 §8
       shipped it. */
    const poster = figure.querySelector("video[poster]")?.getAttribute("poster");
    return poster ? [{ type: "image", src: poster, alt: "" }] : [];
};
/*
 * A CODE BLOCK IS READ AS TEXT, and it is the one block that must NOT go
 * through the tag-strip below: innerHTML on a <pre> carries the syntax spans
 * and their escaping, and a line of code is exactly the string the writer
 * typed. textContent is that string.
 *
 * NOT TRIMMED, EITHER, unlike every other line here. Leading whitespace in code
 * is the indentation and is content.
 *
 * ONE ENTRY PER CODE LINE — see CODE_SIZE's block for why that is binding.
 *
 * *** BUT BY THE TIME WE RUN, THERE IS NO <pre> AND THERE ARE NO NEWLINES. ***
 *
 * This is the SAME TRAP the splitPoemLines note below documents, walked into a
 * second time, and the story fixture is why it was not caught: the fixture
 * hands readArticle a raw <pre>, so BlockKinds showed the code block working
 * while no live post could. A passing story is not evidence here. ANY FIXTURE
 * ADDED TO THIS FILE'S STORY MUST EXERCISE THE LIVE SHAPE.
 *
 * WHAT THE LIVE SHAPE IS. attachCode(document) runs at page load, from
 * content.js, long before this click handler. code.js's enhance() does
 * `pre.replaceWith(wrapper)` where wrapper is `<div class="qntns-code">`, so
 * the BODY CHILD IS A DIV and a `tagName === "PRE"` test never fires again.
 * Inside it, code.js emits ONE `<span class="qntns-code__line">` per source
 * line, in document order, blank lines included — and joins them with `""`,
 * which is why node.textContent holds NO newline at all and a naive split on
 * "\n" turned a forty-line program into one entry.
 *
 * SO THE LINES ARE READ OFF THE SPANS, WHICH IS THE SPLIT ALREADY DONE FOR US.
 * Each span's textContent is that line's exact source text: highlight() wraps
 * tokens in spans that textContent flattens back, escape() is undone by reading
 * textContent rather than innerHTML, and leading whitespace survives.
 *
 * `data-line` IS NOT READ AND MUST NOT BE. It is String(i + 1).padStart(3, "0")
 * — presentation numbering, so line 7 is "007". It is an ordinal, not content.
 *
 * THE <pre> PATH STAYS. Markup that has not been through attachCode still
 * arrives as a <pre> with real newlines in it — that is the story fixture's raw
 * cell, and it is also what a page that never called attachCode would give us.
 * Only the trailing newline left before </code> is dropped there, because it is
 * markup and not a blank line the writer wrote; the span path needs no such
 * trim, since code.js already stripped it before splitting.
 */
const codeEntries = (node) => {
    const spans = node.querySelectorAll(".qntns-code__line");
    const src = spans.length
        ? [...spans].map((span) => span.textContent)
        : String(node.textContent || "").replace(/\n+$/, "").split("\n");
    return src.map((text, i) => ({
        type: "code",
        text,
        first: i === 0,
        last: i === src.length - 1
    }));
};

/* A FOOTNOTE MARKER IS NOT PART OF THE WORDS. footnotes.js:298 inserts
   `<sup><a href="#fn1">` into p, li, blockquote, figcaption AND h1-h6, so any
   of those can be carrying one by the time we read it. It is a control that
   belongs to the page — there is nothing on a printed card to jump to — so it
   comes off a CLONE, because the live node is the one the reader is still
   looking at. Every branch that reads text off a body child goes through here. */
const withoutRefs = (node) => {
    const clone = node.cloneNode(true);
    for (const drop of clone.querySelectorAll("sup, .qntns-footnote-ref, a[href^='#fn']")) {
        drop.remove();
    }
    return clone;
};

/*
 * THE WORDS OF ONE BLOCK, AS THE LINES THE WRITER TYPED.
 *
 * Shared by the paragraph/blockquote path and by the list, because an <li>'s
 * text is read exactly the way a <p>'s is and two copies of this would drift.
 *
 * A POEM HAS NO <br> LEFT BY THE TIME WE GET HERE, AND THAT WAS A BUG.
 *
 * splitPoemLines() in content.js runs at page load and rewrites every
 * <br>-separated run inside a poem into its own
 * <span class="qntns-content__line">, so each poetic line can hang its own
 * wrap. It is destructive: the <br>s are gone afterwards.
 *
 * This used to convert <br> to "\n" and then strip tags, which on a converted
 * poem found no <br> to convert and then stripped the spans — welding every
 * line to the next with no separator at all. "Leap from me.</span><span>Leave
 * from me." became "Leap from me.Leave from me.". The card silently rewrote the
 * poem.
 *
 * So the spans are read FIRST and each one is a line. The <br> path below still
 * matters: prose paragraphs never had spans, a poem's single-line paragraphs
 * are skipped by splitPoemLines, blockquotes are exempt from it entirely, and
 * readArticle can be called against markup that has not been through it at all.
 *
 * WHICHEVER PATH RUNS, ONE SOURCE LINE IS ONE ARRAY ENTRY. That is the contract
 * wrapLines() depends on and it is what makes the breaks the writer typed the
 * breaks that get printed.
 */
const blockLines = (node) => {
    const clone = withoutRefs(node);
    const fixed = clone.querySelectorAll(".qntns-content__line");
    if (fixed.length) return [...fixed].map((span) => span.textContent.trim());
    // innerHTML rather than textContent so the <br>s survive long enough to
    // become line breaks; the tags are stripped straight after.
    const text = clone.innerHTML
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ");
    const decoded = new DOMParser().parseFromString(text, "text/html").documentElement.textContent;
    return decoded.split("\n").map((line) => line.trim());
};

/*
 * A LIST, ONE ENTRY PER DISPLAY LINE, WITH THE MARKER BUILT HERE.
 *
 * *** THE NUMERALS ARE NOT IN THE DOM AND NEVER WERE. *** The browser draws
 * them from `list-style` / the ::before rule content.css sets, so stripping tags
 * does not LOSE styling here — it loses content that was never there to strip.
 * The numeral has to be BUILT, from the item's position in its own list, and
 * the position is destroyed the moment the <li> becomes a string. So it is
 * attached here, at the only place that still knows it.
 *
 * ONE ENTRY PER <li>, NEVER ONE PER <ol>, which is §2.2's contract and is also
 * what makes the numeral derivable at all. An <li> with a <br> in it is several
 * entries and only the first carries the marker.
 *
 * GHOST'S start="" AND reversed MUST KEEP WORKING, which is exactly why
 * content.css uses counter(list-item) rather than a counter of its own: that is
 * the only counter that honours them, and a hand-rolled one would silently
 * renumber a list the writer deliberately started at 5. This is the same
 * behaviour in JavaScript, and it follows the CSS rules for the built-in
 * counter: `start` wins if it is there, a reversed list without one counts down
 * from the number of items, and an item's own `value` resets the run from
 * there.
 *
 * A NESTED LIST IS FLATTENED TO THE SAME COLUMN, WHICH IS A CHOICE AND IS SAID
 * OUT LOUD HERE. There is no indent design for a nested list on the site — the
 * theme styled no list at all until f0ed972 — so inventing one on the card
 * would be the card deciding something the site has not. What is NOT acceptable
 * is the alternative: leaving the nested <ol> inside its parent's text, where
 * the tag-strip welds its items onto the end of the parent's sentence with no
 * separator. So a nested list is lifted out and read as its own items at the
 * same marker column, numbered from its own start. Nothing is welded and
 * nothing is lost; if the user wants nested lists to step in, that is a design
 * decision and it is theirs.
 */
const listEntries = (list) => {
    const items = [...list.children].filter((node) => node.tagName === "LI");
    const ordered = list.tagName === "OL";
    const reversed = ordered && list.hasAttribute("reversed");
    const start = parseInt(list.getAttribute("start"), 10);
    let n = Number.isFinite(start) ? start : (reversed ? items.length : 1);
    const out = [];
    for (const [index, item] of items.entries()) {
        const value = parseInt(item.getAttribute("value"), 10);
        if (Number.isFinite(value)) n = value;
        /* The nested lists come out of the clone the words are read off, and go
           back in after this item's own lines. */
        const own = item.cloneNode(true);
        const nested = [...own.children].filter((node) => node.tagName === "OL" || node.tagName === "UL");
        for (const sub of nested) sub.remove();
        for (const [i, text] of blockLines(own).entries()) {
            out.push({
                type: "list",
                text,
                /* An item's FIRST source line, which is the only one that gets a
                   marker and the only one that buys the gap above. */
                lead: i === 0,
                /* The empty string for a <ul>: drawBlock reads a falsy marker
                   as "draw the square". */
                marker: i === 0 && ordered ? `${n}.` : "",
                /* Every item but the first pays LIST_ITEM_GAP. The first does
                   not, because the blank entry before the list is already the
                   gap between the list and the paragraph above it. */
                gap: i === 0 && index > 0
            });
        }
        for (const sub of nested) out.push(...listEntries(sub));
        n += reversed ? -1 : 1;
    }
    return out;
};

/*
 * `url` IS AN OVERRIDE, NOT A SECOND SOURCE. Every other field on the object
 * below is read off `root`; the address was the one exception, taken from the
 * browser's location bar. On a post's own page those agree. On the HOME page
 * they do not — the location bar says `/`, and a card built from a post's blob
 * entry would print the home page's address and encode the home page in its QR.
 * So the caller that already knows which post this is may say so, and nobody
 * else has to change. CHECKLIST-v11 §6.2.
 */
export const readArticle = (root = document, { url } = {}) => {
    const body = root.querySelector(".qntns-content__body");
    const lines = [];
    /* A heading and a divider REPLACE the paragraph gap above them rather than
       adding to it, which is what the CSS does: `> * + *` sets margin-top to
       --content-para-gap and each of those rules overrides it. So the blank
       entry the previous block left behind is taken back before their own air
       is spent. */
    const dropGap = () => {
        if (lines[lines.length - 1] === "") lines.pop();
    };

    for (const node of body ? body.children : []) {
        if (node.tagName === "FIGURE") {
            /* THE BOOKMARK STILL WINS. It is a <figure> too and it must be read
               whole rather than reduced to whichever <img> is inside it, so it
               is tried first and short-circuits the picture path entirely. */
            const bookmark = bookmarkEntry(node);
            const figures = bookmark ? [bookmark] : figureEntries(node);
            /* A blank entry after EACH for the same reason a paragraph gets
               one: it is the gap between two things, and the trailing ones are
               popped off below. Per image rather than per figure, so a gallery
               of four costs 4 x 648 and an ordinary picture still costs exactly
               the 648 it always did — the two paths must not diverge. */
            for (const figure of figures) lines.push(figure, "");
            continue;
        }
        /* THE DIVIDER, WHICH IS THE ONE THAT USED TO LEAVE NO TRACE. It has no
           text, so the tag-strip left nothing behind and the two passages
           either side welded together with nothing on the card saying a break
           had ever been there. It carries its own 48/8/48 and needs no gap
           entry around it. */
        if (node.tagName === "HR") {
            dropGap();
            lines.push({ type: "rule" });
            continue;
        }
        /* BOTH SHAPES, AND BOTH ARE REACHABLE. A raw <pre> is what markup that
           has not met attachCode looks like; `div.qntns-code` is what every
           live post looks like, because attachCode replaced the <pre> at page
           load. codeEntries() has the full note. */
        if (node.tagName === "PRE" || node.classList.contains("qntns-code")) {
            lines.push(...codeEntries(node), "");
            continue;
        }
        /* A heading's SIZE is decided here rather than at the draw site,
           because this is the only place that still knows which of h1..h6 it
           was — everything downstream sees an entry. */
        if (HEADING_SIZE[node.tagName]) {
            dropGap();
            lines.push({
                type: "heading",
                size: HEADING_SIZE[node.tagName],
                /* STRIPPED, for the same reason the paragraph path strips —
                   footnotes.js includes h1-h6 in the blocks it marks up, so a
                   heading can arrive carrying "1" welded onto its last word. */
                text: withoutRefs(node).textContent.trim()
            });
            continue;
        }
        /* THE LISTS, AND THE FILTER BELOW IS WHY THEY NEEDED THEIR OWN BRANCH:
           AN <li> IS NOT A CHILD OF THE BODY. It is a child of the <ol> or
           <ul>, which the filter drops whole, so the LI in it has never once
           fired on a real post and widening the filter would not have helped.
           The fix is to descend into the list, which is what listEntries()
           does. The LI is left in the test because removing it would be a change
           nobody asked for, and it costs nothing. */
        if (node.tagName === "OL" || node.tagName === "UL") {
            lines.push(...listEntries(node), "");
            continue;
        }
        if (!/^(P|BLOCKQUOTE|LI)$/.test(node.tagName)) continue;
        /* THE KIND IS CARRIED, THE TEXT IS NOT CHANGED. §2's whole fault was
           that the tag-strip destroys the one thing the drawing needs to know —
           which block this line came out of — and recovering it downstream is
           impossible because by then there is nothing left to recover it from.
           So it is attached here, at the only place that still has the tag. A
           quote of three paragraphs is three entries each marked as quote,
           exactly as three prose paragraphs are three entries. The words
           themselves come out of blockLines(), which the list path shares. */
        const quote = node.tagName === "BLOCKQUOTE";
        /* A `#fixed-lines` post's direct <p>s are poem lines and hang when they
           wrap — see poemHang. Blockquotes stay prose, as content.css keeps
           them. An empty line stays "" so a stanza gap is still a gap. */
        const poem = node.tagName === "P" && body.classList.contains("qntns-content__body--poem");
        for (const text of blockLines(node)) {
            lines.push(quote ? { type: "quote", text } : (poem && text ? { type: "poem", text } : text));
        }
        lines.push("");
    }
    while (lines.length && !lines[lines.length - 1]) lines.pop();

    return {
        title: root.querySelector(".qntns-content__title")?.textContent.trim() || document.title,
        type: root.querySelector(".qntns-content__tag")?.textContent.trim() || "",
        // Host and path, no scheme and no query. The QR code gets the full URL
        // built back up from this, `www.` included, because that host is
        // canonical. The printed meta line drops the `www.` when it draws — see
        // the note in paintFront.
        url: `${url ?? `${location.host}${location.pathname}`}`.replace(/\/$/, ""),
        lines: lines.length ? lines : [document.title]
    };
};

/* -------------------------------------------------------------------------
 * The draft
 * ---------------------------------------------------------------------- */

/*
 * A HALF-WRITTEN POSTCARD SURVIVES THE POPOVER BEING CLOSED.
 *
 * Somebody types a message, gets as far as the address, and closes the sheet to
 * go and find a ZIP code. Losing that is the single most annoying thing this
 * feature could do to a person, and it costs one localStorage key to prevent.
 *
 * ONE DRAFT PER POST, keyed by pathname, because the message is about the
 * article it was written on. Two posts can hold two drafts and neither one
 * surprises you by showing up on the wrong card.
 *
 * WHAT COUNTS AS A DRAFT IS "ANY TYPING AT ALL", not a complete order. The
 * window position is deliberately NOT part of that test: opening the popover
 * and pressing + twice is not a draft, and treating it as one would put a
 * "Draft" badge on the share button of anybody who merely looked.
 *
 * EVERY ACCESS IS WRAPPED. Safari in private mode throws on localStorage rather
 * than returning null, and a postcard that cannot be opened because a browser
 * refused to remember it would be a bad trade for a convenience. Storage
 * failing means no draft, silently, everywhere below.
 */
const DRAFT_PREFIX = "qntns:postcard:";

export const draftKey = (path) =>
    `${DRAFT_PREFIX}${String(path ?? location.pathname).replace(/\/$/, "")}`;

/* The window is stored but does not make a draft — see the note above. */
const hasTyping = (order) =>
    Boolean(
        order &&
            (order.message ||
                order.funder ||
                Object.values(order.address || {}).some(Boolean))
    );

export const readDraft = (key = draftKey()) => {
    try {
        const stored = JSON.parse(localStorage.getItem(key) || "null");
        return hasTyping(stored) ? stored : null;
    } catch {
        return null;
    }
};

/*
 * WRITING AN EMPTY DRAFT DELETES IT. Clearing the fields and closing has to
 * take the badge off the share button, and making the caller decide between
 * write and clear would put that rule in two places.
 */
export const writeDraft = (order, key = draftKey()) => {
    try {
        if (!hasTyping(order)) return localStorage.removeItem(key);
        localStorage.setItem(
            key,
            JSON.stringify({
                message: order.message || "",
                funder: order.funder || "",
                address: order.address || {},
                window: order.window || null
            })
        );
    } catch {
        // No storage. The draft is simply not remembered.
    }
};

export const clearDraft = (key = draftKey()) => {
    try {
        localStorage.removeItem(key);
    } catch {
        // Nothing to do and nothing to report.
    }
};

export const hasDraft = (key = draftKey()) => Boolean(readDraft(key));

/*
 * THE SHARE BUTTON HEARS ABOUT A DRAFT THROUGH AN EVENT, NOT A CALLBACK.
 *
 * assets/js/content.js passes the postcard's mounter into qntns/content.js
 * rather than letting it import this file, so that a page whose postcard module
 * failed still gets its footnotes, its drop caps and its lightbox. Threading a
 * callback back the other way would put the dependency back in by hand.
 *
 * An event costs nothing and keeps the direction: this file announces, the
 * share button listens, and neither one holds a reference to the other. The
 * name is repeated in qntns/content.js and this comment is one half of the pair.
 */
export const DRAFT_EVENT = "qntns:postcard-draft";

const announceDraft = (draft) => {
    try {
        document.dispatchEvent(new CustomEvent(DRAFT_EVENT, { detail: { draft } }));
    } catch {
        // No document, or no CustomEvent. The badge simply does not update.
    }
};

/*
 * EVERY DRAFT, NOT JUST THIS POST'S, BECAUSE THE RECEIPT LANDS SOMEWHERE ELSE.
 *
 * Stripe's success_url is the SITE ROOT with `?posted=1` — the Worker does not
 * know which post the order came from, so the page that learns a card was paid
 * for is never the page the draft belongs to. A reader can only have one order
 * in flight at a time, so clearing all of them on that signal is right, and it
 * is the only thing that can be done from the home page.
 */
export const clearPostedDrafts = () => {
    try {
        if (!new URLSearchParams(location.search).has("posted")) return;
        for (const key of Object.keys(localStorage)) {
            if (key.startsWith(DRAFT_PREFIX)) localStorage.removeItem(key);
        }
    } catch {
        // No storage, or no location. Nothing to clear.
    }
};

/* -------------------------------------------------------------------------
 * The order
 * ---------------------------------------------------------------------- */

/*
 * THE SAME WORKER AS THE READS SYNC AND THE FUNDING QUEUE, and that is the
 * whole reason this is allowed to exist. CLAUDE.md permits this theme exactly
 * one third-party runtime origin; sync.js:68 and fund.js:1222 already name this
 * one, and the postcard is a third route family on it rather than a second
 * origin. It is repeated here rather than imported because those two files own
 * their own constants and a shared one would tie three features together that
 * have no other reason to move at the same time.
 */
const POSTCARD_BASE = "https://qntns-reads.qstaley921.workers.dev";

/*
 * US ONLY, AND CHECKED HERE SO IT CAN STILL BE FIXED FOR FREE.
 *
 * The Worker validates the same shapes again and that copy is the actual rule —
 * anyone can POST to it directly. This copy exists for the sender: a bad
 * address means money taken for a card that can never be delivered, and the one
 * moment it costs nothing to fix is while they are still looking at it.
 *
 * SHAPE, NOT EXISTENCE. Whether 123 Fake St is a real delivery point is the
 * printer's question and PostGrid answers it when the card is created. Two letters of state
 * and five or nine digits of ZIP is what can be known in a browser.
 *
 * There is no country to check. The product is US-only (decision 1.4).
 */
export const validateAddress = (address) => {
    if (!address) return false;
    if (!address.name || !address.line1 || !address.city) return false;
    if (!/^[A-Z]{2}$/.test(address.state || "")) return false;
    if (!/^\d{5}(-?\d{4})?$/.test(address.zip || "")) return false;
    return true;
};

/*
 * UPLOAD THE FRONT, THEN ASK FOR A CHECKOUT URL, THEN LEAVE.
 *
 * Two calls rather than one. The first carries the picture and the address and
 * gets back an id; the second turns that id into a Stripe session. They are
 * separate because the upload is a multipart body of a few hundred kilobytes
 * and the checkout is a small JSON round trip that may fail on its own — and
 * because the id is the thing the webhook reads back, so it has to exist before
 * any money moves.
 *
 * THE PAGE LOADS NO STRIPE SCRIPT. It asks the Worker for a URL and navigates
 * to it. A navigation is not a runtime dependency, which is the distinction
 * fund.js already relies on and the reason the one-origin rule survives this.
 *
 * IT THROWS ON FAILURE and the caller decides what the button says. Swallowing
 * an error here would leave the sender looking at a button that did nothing
 * after they agreed to pay.
 */
export const submitOrder = async (order) => {
    const blob = await exportFront(order.article, order.window);
    if (!blob) throw new Error("front");

    const body = new FormData();
    body.append("front", blob, "front.png");
    body.append("order", JSON.stringify({
        address: order.address,
        message: order.message,
        funder: order.funder
    }));

    const stashed = await fetch(`${POSTCARD_BASE}/postcard/order`, { method: "POST", body });
    if (!stashed.ok) throw new Error(`order ${stashed.status}`);
    const { id } = await stashed.json();

    const checkout = await fetch(`${POSTCARD_BASE}/postcard/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
    });
    if (!checkout.ok) throw new Error(`checkout ${checkout.status}`);

    const { url } = await checkout.json();
    if (typeof url !== "string") throw new Error("checkout url");
    return url;
};

/* -------------------------------------------------------------------------
 * Markup
 * ---------------------------------------------------------------------- */

/*
 * ARIA-DISABLED, NEVER THE DISABLED ATTRIBUTE, on anything that can refuse.
 *
 * A `disabled` button dispatches no click event at all — not to itself and not
 * to an ancestor — so a press on one cannot be answered, and a control at its
 * limit that does nothing at all reads as a broken control rather than as a
 * limit. aria-disabled says the same thing to a screen reader while leaving the
 * button focusable and clickable, which is what a refusal needs. This is the
 * decision pagination.css argues at length and fund.css follows; the postcard is
 * the third and it is deliberately the same one.
 *
 * The consequence is that NOTHING stops the press but this file's own guard in
 * onClick. That is the trade, and it is the same trade in all three places.
 */
const squareButton = (name, label, attr) => `
    <button type="button" class="qntns-postcard__square" ${attr} aria-label="${escapeHtml(label)}">
        ${icon(name, { size: 16, className: "qntns-postcard__icon" })}
    </button>`;

/*
 * THE TWO PICTURE CONTROLS ARE TOGGLES, SO THEY CARRY aria-pressed AND THE
 * STYLESHEET READS IT.
 *
 * A toggle that says which way it will go NEXT rather than what it did last is
 * §2.3's requirement, and it is one attribute doing three jobs here: it
 * announces the state, it swaps the glyph (both are in the button and CSS shows
 * one), and it is what the fill transitions on. Nothing in postcard.js sets a
 * class for any of that.
 *
 * NOT aria-disabled, and this is the one place in the file that differs from
 * the toolbar. These do not refuse — they are never at a limit — so there is
 * nothing for the shake and the error sound to be about.
 */
const imageButton = (name, label, glyphs, extra = "") => `
    <button type="button" class="qntns-postcard__square qntns-postcard__imgbtn"
            data-postcard-${name} aria-pressed="false"
            aria-label="${escapeHtml(label)}" ${extra}>${glyphs}
    </button>`;

/*
 * CITY GETS ITS OWN LINE; STATE AND ZIP SHARE THE ONE UNDER IT.
 *
 * All three were on a single rule, which is how an address is written by hand,
 * but it left the city box squeezed between two fixed-width neighbours and a
 * long city name scrolling inside a few characters of space. The user asked for
 * the split on 2026-08-31. It is still three separate values rather than one
 * parsed string, because the printer wants them separately and parsing them back out of
 * one field works until somebody lives in a two-word city.
 *
 * THERE IS NO COUNTRY FIELD. The frame has one; the product is US-only, so a
 * control whose only legal value is "United States" is a control that can only
 * be got wrong. This is the second deliberate difference from the frame.
 *
 * AND THERE IS NO LONGER A LINE SAYING WHO PRINTS THE ADDRESS. It said the
 * address is added by the postal service rather than shown on the card; the
 * user removed it on 2026-08-31 as noise on a form whose fields already say
 * what they are. The fact it stated has not changed — see the file header and
 * DECISIONS-LOG.md #13 — it is simply no longer said in the interface.
 */
const backForm = (data) => `
    <div class="qntns-postcard__back" data-postcard-back>
        <label class="qntns-postcard__field qntns-postcard__field--message">
            <span class="qntns-postcard__label">Message</span>
            <!-- THERE IS NO maxlength HERE, AND ITS ABSENCE IS THE POINT.
                 The cap is WEIGHTED — 500, where a newline costs 50 — and no HTML
                 attribute can express that. maxlength counts UTF-16 units and
                 knows nothing about returns, so left in place it would wave
                 through ten returns plus 490 characters: 990 by the rule, and a
                 message that does not fit the card. It fails OPEN, onto the money
                 path. The input handler enforces the budget instead, by
                 truncating to the longest prefix that weighs <= 500 — which also
                 catches a paste, where a keydown guard would not.
                 Do not "restore the missing maxlength" as an accessibility fix.
                 aria-live on the counter below is what tells a screen-reader user
                 they have hit the limit, now that the native stop is gone. -->
            <textarea
                class="qntns-postcard__message"
                data-postcard-message
                placeholder="Message"
                rows="6"></textarea>
        </label>
        <p class="qntns-postcard__count" data-postcard-count aria-live="polite">0 / ${MESSAGE_MAX}</p>

        <!-- THE SIGNATURE, AND IT IS ONE FIELD DOING TWO JOBS.
             It sits directly under the message because that is where it sits on
             the printed card — PostGrid renders it as "— Name" beneath the message
             from its own merge variable, kept OUT of the message text so that a
             sender who fills the box to the cap does not push their own name off
             the card.
             The same value is the name that goes on the public funder list,
             because buying a card also buys a funding day and it is one fact
             about one person. Asked for rather than taken from Stripe: Stripe
             hands back a full legal name and the footer shows one word — see
             worker/src/fund.js:179. Defaulted to the Ghost member name when they
             are signed in. -->
        <label class="qntns-postcard__field qntns-postcard__field--from">
            <span class="qntns-postcard__label">Your name</span>
            <span class="qntns-postcard__from-mark" aria-hidden="true">From</span>
            <input type="text" data-postcard-field="funder" placeholder="your name"
                   autocomplete="name" maxlength="40" value="${escapeHtml(data.funder || "")}">
        </label>

        <div class="qntns-postcard__address">
            <label class="qntns-postcard__field">
                <span class="qntns-postcard__label">Recipient name</span>
                <input type="text" data-postcard-field="name" placeholder="Recipient Name"
                       autocomplete="off" maxlength="40" value="${escapeHtml(data.recipient || "")}">
            </label>
            <!--
                THE LIST IS A SIBLING OF THE LABEL, NOT A CHILD OF IT.
                Clicking anything inside a <label> is forwarded to that label's
                control, so a suggestion nested in there would hand the click to
                the input and never fire its own. The wrapper exists to give the
                list something to be positioned against.

                role="combobox" with aria-expanded and aria-activedescendant is
                the pattern a screen reader already knows. Focus never leaves the
                input — the options are not focusable, which is also what keeps
                them out of the popover's Tab trap.
            -->
            <div class="qntns-postcard__suggest-wrap">
                <label class="qntns-postcard__field">
                    <span class="qntns-postcard__label">Address line 1</span>
                    <input type="text" data-postcard-field="line1" placeholder="Address Line 1"
                           autocomplete="off" maxlength="64"
                           role="combobox" aria-expanded="false" aria-autocomplete="list"
                           aria-controls="qntns-postcard-suggest">
                </label>
                <ul class="qntns-postcard__suggest" id="qntns-postcard-suggest"
                    data-postcard-suggest role="listbox" aria-label="Address suggestions" hidden></ul>
            </div>
            <label class="qntns-postcard__field">
                <span class="qntns-postcard__label">Address line 2</span>
                <input type="text" data-postcard-field="line2" placeholder="Address Line 2"
                       autocomplete="off" maxlength="64">
            </label>
            <label class="qntns-postcard__field">
                <span class="qntns-postcard__label">City</span>
                <input type="text" data-postcard-field="city" placeholder="City"
                       autocomplete="off" maxlength="200">
            </label>
            <div class="qntns-postcard__field qntns-postcard__field--row">
                <input type="text" data-postcard-field="state" placeholder="State" aria-label="State"
                       maxlength="2" size="2" autocomplete="off">
                <input type="text" data-postcard-field="zip" placeholder="Zip Code" aria-label="Zip code"
                       maxlength="10" size="5" inputmode="numeric" autocomplete="off">
            </div>
        </div>
    </div>`;

export const renderPostcard = (data) => `
    <div class="qntns-postcard" data-postcard hidden>
        <div class="qntns-postcard__scrim" data-postcard-close></div>
        <div class="qntns-postcard__panel" role="dialog" aria-modal="true"
             aria-label="Send this as a postcard">
            <div class="qntns-postcard__toolbar">
                <div class="qntns-postcard__group">
                    ${squareButton("chevron-up", "Move the passage up one line", "data-postcard-earlier")}
                    ${squareButton("chevron-down", "Move the passage down one line", "data-postcard-later")}
                </div>
                <div class="qntns-postcard__toggle" role="tablist" aria-label="Card side">
                    <button type="button" role="tab" class="qntns-postcard__tab"
                            data-postcard-side="front" aria-selected="true">Front</button>
                    <button type="button" role="tab" class="qntns-postcard__tab"
                            data-postcard-side="back" aria-selected="false">Back</button>
                </div>
                <div class="qntns-postcard__group">
                    ${squareButton("minus", "Show one line fewer", "data-postcard-fewer")}
                    ${squareButton("plus", "Show one line more", "data-postcard-more")}
                </div>
            </div>

            <div class="qntns-postcard__stage">
                <!-- THE SCROLL TRACK. It is DOM and it is NEVER canvas: nothing
                     about it reaches paintFront(), drawFigure() or LAYOUT, and
                     paintPreview()/exportFront() are one function at two
                     scales, so anything drawn is printed. DECISIONS-LOG.md #37.

                     Built here rather than injected after mount, so it is in
                     the first frame the reader sees instead of arriving a tick
                     later at the wrong offset.

                     aria-hidden and NO tabindex, on purpose and not by
                     oversight. The track duplicates [data-postcard-earlier] and
                     [data-postcard-later], which are real buttons with real
                     labels and already reachable. Giving it a tabindex and
                     arrow keys would be a THIRD input path to the same two
                     functions, and a drag-only widget exposed to a screen
                     reader with no keyboard equivalent is worse than one
                     honestly hidden. Styling and the width arithmetic are in
                     postcard.css. -->
                <div class="qntns-track" data-postcard-track aria-hidden="true">
                    <div class="qntns-track__nub" data-postcard-nub>${icon("grip-horizontal", { size: 16 })}</div>
                </div>
                <div class="qntns-postcard__flip" data-postcard-flip>
                    <div class="qntns-postcard__face qntns-postcard__face--front"
                         data-postcard-face="front">
                        <canvas class="qntns-postcard__canvas" data-postcard-canvas
                                role="img" aria-label="The front of the postcard"></canvas>
                        <!-- The bottom edge of the quoted window, laid OVER the
                             canvas and never into it: paintFront() is the file
                             the printer gets, and a blue rule with a grabber on
                             it has no business on a card that gets posted to
                             somebody. It lives inside the front face so it
                             turns, clips and hides with the card for free.

                             aria-hidden, and not a button: it is a second way
                             to do what the four labelled toolbar buttons
                             already do, and a control that can only be dragged
                             is no use to a reader who is not dragging. The
                             buttons and the arrow keys stay the accessible
                             route. -->
                        <!-- THE PICTURE'S OWN CONTROLS, AND THEY ARE CHROME.
                             Same rule as the edge above and the track beside
                             it: nothing here reaches paintFront(), and
                             paintPreview()/exportFront() are ONE function at
                             two scales, so a maximize icon drawn into the
                             canvas is a maximize icon on a card somebody paid
                             to have mailed. DECISIONS-LOG.md #37,
                             CHECKLIST-v7 §2.7.

                             Inside the front face, which buys the rest for
                             nothing: it turns with the card, is clipped by the
                             card's own overflow, and backface-visibility hides
                             it the moment the back comes up. paint() writes
                             left/top/width/height as percentages of the trim,
                             so the box is the drawn picture at any popover
                             width and any device pixel ratio.

                             REAL BUTTONS, ON PURPOSE. Unlike the track — a div
                             that had to be named in NOT_A_SWIPE to stop the
                             stage reading a press on it as a card flip — these
                             match the "button" already in that selector, so
                             they inherit the exclusion. The stage's
                             touch-action is "none" and routes touches the
                             browser used to handle, so they carry the nub's
                             explicit stopPropagation as well; §2.7 says check
                             rather than assume, and both halves are checked.

                             NO ROTATE BUTTON. A picture is shown the way it was
                             taken. CHECKLIST-13 §6. -->
                        <div class="qntns-postcard__imgctl" data-postcard-imgctl hidden>
                            ${imageButton("expand", "Fill the card with this picture", `
                                ${icon("maximize-2", { size: 16, className: "qntns-postcard__icon qntns-postcard__icon--out" })}
                                ${icon("minimize-2", { size: 16, className: "qntns-postcard__icon qntns-postcard__icon--in" })}`)}                        </div>
                        <div class="qntns-postcard__edge" data-postcard-edge aria-hidden="true" hidden>
                            <span class="qntns-postcard__grip">${icon("grip-horizontal", { size: 20 })}</span>
                        </div>
                    </div>
                    <div class="qntns-postcard__face qntns-postcard__face--back"
                         data-postcard-face="back" aria-hidden="true" inert>
                        ${backForm(data)}
                    </div>
                </div>
            </div>

            <div class="qntns-postcard__actions">
                <!-- §13.1: the card's own settings sit left, the outward actions
                     right. A↓ / A↑ (§13.3) go after wrap in this group. Wrap is
                     faded on a card with no pictures and no poem lines (§22),
                     where it would do nothing. -->
                <div class="qntns-postcard__settings">
                    <button type="button" class="qntns-postcard__square qntns-postcard__toggle"
                            data-postcard-wrap aria-pressed="true" aria-label="Wrap text"
                            aria-disabled="${!(data.lines || []).some((e) => isFigure(e) || (isBlock(e) && e.type === "poem"))}">
                        ${icon("wrap-text", { size: 16, className: "qntns-postcard__icon" })}
                    </button>
                    <button type="button" class="qntns-postcard__square qntns-postcard__toggle"
                            data-postcard-smaller aria-label="Smaller text">
                        ${icon("a-arrow-down", { size: 16, className: "qntns-postcard__icon" })}
                    </button>
                    <button type="button" class="qntns-postcard__square qntns-postcard__toggle"
                            data-postcard-larger aria-label="Larger text">
                        ${icon("a-arrow-up", { size: 16, className: "qntns-postcard__icon" })}
                    </button>
                </div>
                ${squareButton("share", "Share the picture", "data-postcard-share")}
                ${squareButton("download", "Download the picture", "data-postcard-download")}
                <button type="button" class="qntns-postcard__mail" data-postcard-mail>$4 &middot; Mail</button>
            </div>
        </div>
    </div>`;

/* -------------------------------------------------------------------------
 * Behaviour
 * ---------------------------------------------------------------------- */

const FOCUSABLE = 'button:not([disabled]), input, textarea, [href], [tabindex]:not([tabindex="-1"])';

/*
 * attachPostcard wires one rendered popover and hands back { open, close,
 * collect, destroy }. destroy() is the teardown every other component in this
 * theme returns, so a story can mount and unmount without leaking a keydown
 * listener onto the document; collect() is the order object the $4 button
 * produces, exposed so a caller can read it without clicking anything.
 *
 * `onMail` is the caller's. This file does not know that Stripe exists.
 */
/*
 * MOUNT ONE ON A REAL POST AND HAND BACK ITS open().
 *
 * The popover is injected rather than emitted by post.hbs, because it is a
 * couple of hundred elements that exist only after somebody presses share and
 * a template that carried them would ship them to every reader of every post.
 * The share button itself IS in the template — it has to be there before any
 * JavaScript runs — and this only changes what pressing it does.
 *
 * It is built LAZILY, on the first press. Nothing is parsed, no canvas is
 * created and no font is loaded for a reader who never shares anything, which
 * is nearly all of them.
 */
export const mountPostcard = (root = document.body) => {
    let card = null;

    return {
        open: () => {
            if (!card) {
                const data = readArticle();
                const host = document.createElement("div");
                host.innerHTML = renderPostcard(data);
                root.appendChild(host);
                card = attachPostcard(host, data);
            }
            card.open();
        },
        destroy: () => card?.destroy()
    };
};

/* -------------------------------------------------------------------------
 * Address autocomplete
 * ---------------------------------------------------------------------- */

/*
 * SUGGESTIONS FOR ADDRESS LINE 1, AND EVERY PART OF THIS IS OPTIONAL.
 *
 * A card sent to a mistyped address is money spent on nothing and there is no
 * way to get it back once it is printed. This is the cheapest thing that
 * reduces that: real addresses to pick from while typing.
 *
 * IT IS OPTIONAL ALL THE WAY DOWN. No network, a refused key, an exhausted
 * daily quota, a 500 — every one of them ends at "no list", never at an error,
 * because the sender can always finish typing the address themselves. That is
 * the rule assets/js/qntns/sync.js already follows for the read receipts and
 * CLAUDE.md requires it of any runtime call. There is no error state to design
 * here because there is no error.
 *
 * THE FILTERS ARE SENT SO THE LIST NARROWS. Whatever is already in city, state
 * and zip goes with the query, which is the difference between eight guesses at
 * "100 Main" and the right one. The Worker forwards them to Geoapify as
 * cityFilter / stateFilter / pcFilter.
 *
 * ONE REQUEST AT A TIME. Each keystroke aborts the request before it, so a slow
 * answer for "210 K" can never arrive after a fast one for "210 King" and
 * repopulate the list with staler results. AbortError is swallowed — it is this
 * function's own doing and not a failure.
 */
const SUGGEST_MIN = 3;
const SUGGEST_DEBOUNCE = 220;

const attachAutocomplete = (el) => {
    const input = el.querySelector('[data-postcard-field="line1"]');
    const list = el.querySelector("[data-postcard-suggest]");
    if (!input || !list) return () => {};

    const field = (name) => el.querySelector(`[data-postcard-field="${name}"]`);

    let items = [];
    let active = -1;
    let timer = null;
    let inflight = null;

    const close = () => {
        list.hidden = true;
        list.innerHTML = "";
        input.setAttribute("aria-expanded", "false");
        input.removeAttribute("aria-activedescendant");
        items = [];
        active = -1;
    };

    /*
     * The active option is marked with aria-selected and a class rather than by
     * moving focus. Focus stays in the input the whole time — that is what lets
     * the sender keep typing to narrow the list, and it is why the options never
     * enter the popover's Tab trap.
     */
    const mark = () => {
        [...list.children].forEach((node, i) => {
            const on = i === active;
            node.classList.toggle("is-active", on);
            node.setAttribute("aria-selected", String(on));
        });
        if (active >= 0) input.setAttribute("aria-activedescendant", `qntns-suggest-${active}`);
        else input.removeAttribute("aria-activedescendant");
    };

    const show = (suggestions) => {
        items = suggestions;
        active = -1;
        if (!items.length) return close();

        list.innerHTML = items
            .map(
                (item, i) => `<li class="qntns-postcard__suggestion" id="qntns-suggest-${i}"
                    role="option" aria-selected="false" data-index="${i}">
                    <span class="qntns-postcard__suggestion-line">${escapeHtml(item.line1)}</span>
                    <span class="qntns-postcard__suggestion-place">${escapeHtml(
                        [item.city, item.state].filter(Boolean).join(", ")
                    )}${item.zip ? ` ${escapeHtml(item.zip)}` : ""}</span>
                </li>`
            )
            .join("");
        list.hidden = false;
        input.setAttribute("aria-expanded", "true");
        mark();
    };

    /*
     * PICKING FILLS ALL FOUR FIELDS, and an absent one is left alone rather
     * than blanked. Geoapify's fields vary with what it matched — a suggestion
     * that has not narrowed to one town carries no city — and overwriting a
     * city the sender typed with an empty string would be worse than useless.
     */
    const pick = (index) => {
        const item = items[index];
        if (!item) return;
        input.value = item.line1 || input.value;
        if (item.city) field("city").value = item.city;
        if (item.state) field("state").value = item.state;
        if (item.zip) field("zip").value = item.zip;
        close();
        input.dispatchEvent(new Event("input", { bubbles: true }));
        field("line2")?.focus();
    };

    const ask = async (query) => {
        inflight?.abort();
        inflight = new AbortController();

        const params = new URLSearchParams({ q: query });
        for (const name of ["city", "state", "zip"]) {
            const value = field(name)?.value.trim();
            if (value) params.set(name, value);
        }

        try {
            const answered = await fetch(`${POSTCARD_BASE}/postcard/suggest?${params}`, {
                signal: inflight.signal
            });
            if (!answered.ok) return close();
            const payload = await answered.json();
            show(Array.isArray(payload?.suggestions) ? payload.suggestions : []);
        } catch {
            // Aborted, offline, blocked, or malformed. No list, no error.
            if (!inflight?.signal.aborted) close();
        }
    };

    const onInput = () => {
        clearTimeout(timer);
        const query = input.value.trim();
        if (query.length < SUGGEST_MIN) return close();
        timer = setTimeout(() => ask(query), SUGGEST_DEBOUNCE);
    };

    /*
     * ESCAPE CLOSES THE LIST AND NOTHING ELSE, WHICH IS WHY THIS STOPS.
     *
     * attachPostcard listens for Escape on the DOCUMENT and closes the whole
     * popover. With a list open that is the wrong thing by a mile: dismissing a
     * dropdown should not throw away a half-written postcard. stopPropagation
     * keeps the key from reaching that listener, and only while the list is
     * actually open — Escape with no list still closes the popover.
     */
    const onKeydown = (event) => {
        if (list.hidden) return;

        if (event.key === "Escape") {
            event.stopPropagation();
            event.preventDefault();
            return close();
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            /* Wraps within the list and never returns to "nothing selected":
               once the sender has started arrowing, Down at the bottom goes to
               the top rather than dropping them back into the text field with no
               row lit. Down from nothing lands on the first row, Up from nothing
               on the last, which is what both arrows do everywhere else. */
            const step = event.key === "ArrowDown" ? 1 : -1;
            active += step;
            if (active < 0) active = items.length - 1;
            if (active >= items.length) active = 0;
            return mark();
        }
        if (event.key === "Enter" && active >= 0) {
            event.preventDefault();
            return pick(active);
        }
        if (event.key === "Tab") close();
    };

    /* mousedown rather than click: the input's blur fires first on a click, and
       a list already emptied by blur has nothing left to pick. */
    const onMouseDown = (event) => {
        const option = event.target.closest?.("[data-index]");
        if (!option) return;
        event.preventDefault();
        pick(Number(option.dataset.index));
    };

    const onBlur = () => setTimeout(close, 0);

    input.addEventListener("input", onInput);
    input.addEventListener("keydown", onKeydown);
    input.addEventListener("blur", onBlur);
    list.addEventListener("mousedown", onMouseDown);

    return () => {
        clearTimeout(timer);
        inflight?.abort();
        input.removeEventListener("input", onInput);
        input.removeEventListener("keydown", onKeydown);
        input.removeEventListener("blur", onBlur);
        list.removeEventListener("mousedown", onMouseDown);
    };
};

/*
 * `deck` TURNS THE UP/DOWN PAIR INTO A POST STEPPER. CHECKLIST-v11 §6.3.
 *
 * Passed as { length, at(i) } — a lazy list of readArticle() results — it says
 * "this postcard is one of several, and the passage window has nothing to
 * scroll". A home-content post is short enough to be one card, so the two
 * travel controls step to the previous / next POST in the section instead of
 * moving a window over one post's lines. Every other postcard in the theme
 * passes no deck and is untouched.
 *
 * `at` is lazy because a section may hold a hundred posts and readArticle
 * parses a whole body; only the ones actually stepped onto are ever built.
 */
export const attachPostcard = (root, data, { onMail, onPaint, deck } = {}) => {
    const el = root.querySelector("[data-postcard]");
    if (!el) return () => {};

    const canvas = el.querySelector("[data-postcard-canvas]");
    const edge = el.querySelector("[data-postcard-edge]");
    const imgctl = el.querySelector("[data-postcard-imgctl]");
    const track = el.querySelector("[data-postcard-track]");
    const nub = el.querySelector("[data-postcard-nub]");
    const flipper = el.querySelector("[data-postcard-flip]");
    const sides = {
        front: el.querySelector('[data-postcard-face="front"]'),
        back: el.querySelector('[data-postcard-face="back"]')
    };
    const count = el.querySelector("[data-postcard-count]");
    const message = el.querySelector("[data-postcard-message]");
    const tabs = [...el.querySelectorAll("[data-postcard-side]")];

    /* NOT COMPUTED ONCE ANY MORE. The largest window that fits is different at
       every position once entries have different heights, so paint() reads it
       back off the drawing on every repaint and settles state.count against it.
       Until the first paint has run it is the all-text answer, which is what
       DEFAULT_LINES is measured against anyway. */
    let cap = maxLines();
    /*
     * EXPANDED IS A MODE ON THE WINDOW, NOT A FLAG ON A PICTURE. While it is on
     * and the window starts on a picture, that picture takes the whole front;
     * while it starts on text, the ordinary card is drawn. So "which picture"
     * is state.start, and there is no second pointer to keep in sync with it —
     * and none to key a draft on, since wrapped indexes shift when the type
     * re-wraps. DECISIONS-LOG.md #77, CHECKLIST-13 §7.
     */
    /* `quote` IS THE CARD KIND, AND IT IS DERIVED FROM THE DECK RATHER THAN
       PASSED BESIDE IT. A deck is exactly the #home-content case — home-postcard.js
       is the only caller that hands one over — so a second option would be a
       second way to say the same thing, with two states to disagree. It rides on
       `state` because `state` is already what reaches paintFront, entryHeight
       and maxLines; see quoteCard in this file for what it turns on. §6.5. */
    /* wrap: pictures each on their own line (true, the default) or packed into
       a mosaic (false, §13.2). */
    /* textStep: the body size, TEXT_STEP_MIN −4 … TEXT_STEP_MAX +13 steps from
       today's (§13.3; §13.18 raised the top from +4). */
    /* pic: a full-front mosaic's first picture on screen, run-relative, −1 for
       its last page (§13.11). */
    /* order: the reader's picture order, post-order photo indices, or null
       for the post's own (§13.25; photoOrder()). */
    /* zoom: a full-front mosaic's photo zoom, 0 (best fit) … PHOTO_STEP_MAX.
       A± moves it there instead of textStep (§13.29). */
    const state = { start: 0, count: DEFAULT_LINES, side: "front", expanded: false, wrap: true, textStep: 0, pic: 0, zoom: 0, order: null, breaks: [], quote: !!deck };
    /* Resolved once. A story mounts several postcards on one page and they must
       not share a draft, so the key follows the article rather than the URL when
       the article carries one. */
    let key = draftKey(data.url ? `/${String(data.url).split("/").slice(1).join("/")}` : undefined);
    /* Which post of `deck` is showing. 0 and unused when there is no deck. */
    let index = 0;
    let tokens = readTokens();
    let view = null;
    let opener = null;

    const control = (name) => el.querySelector(`[data-postcard-${name}]`);
    const block = (name, off) => control(name).setAttribute("aria-disabled", String(off));
    const blocked = (name) => control(name).getAttribute("aria-disabled") === "true";
    /* The A pair fades at the ends of the range, and for good on a quote card. */
    /* A full-front mosaic fades A↓ at best fit and A↑ when no step changes its
       packing (§13.11). */
    const sizeLimits = () => {
        const mosaic = view?.full && view.mosaic;
        block("smaller", state.quote || (mosaic ? state.zoom <= 0 : state.textStep <= TEXT_STEP_MIN));
        block("larger", state.quote || (mosaic ? view.zoomTo === null : state.textStep >= TEXT_STEP_MAX));
    };
    sizeLimits();

    /*
     * THE REFUSAL, SHARED WITH THE PAGINATION STEPS AND THE FUND ARROWS.
     * qntns-refuse is defined once in card-group.css and used by all three, so
     * the theme cannot end up with three slightly different shakes.
     *
     * Restarting a CSS animation on an element that never left the DOM needs the
     * class removed, a reflow forced, and the class re-added. Reading offsetWidth
     * is the reflow; nothing uses the value.
     */
    const REFUSE = "is-refused";
    const refuse = (button) => {
        playError();
        button.classList.remove(REFUSE);
        void button.offsetWidth;
        button.classList.add(REFUSE);
    };

    const paint = () => {
        if (state.side !== "front") return;
        view = paintPreview(canvas, data, state, tokens);
        sizeLimits();
        // The controls report the truth about the window rather than guessing:
        // at the top there is nothing above, and at the cap there is nothing to
        // add. A button that looks live and does nothing is worse than a dead one
        // — which is why these go aria-disabled and then refuse out loud when
        // pressed, rather than going silent.
        /* WITH A DECK THE PAIR REPORTS THE SECTION, NOT THE PASSAGE. One post
           in the section means both ends are the same end, so both go
           aria-disabled and refuse out loud when pressed — the state this
           editor already has for a step that cannot be taken. §6.3. */
        if (deck) {
            block("earlier", index <= 0);
            block("later", index >= deck.length - 1);
        } else if (state.expanded) {
            /* EXPANDED, THE ARROWS ARE DEAD WHEN NO PHOTO LIES THAT WAY, from
               the same `at` step() hands landing(): the entry past the view
               when full, the neighbour of `start` on an expanded text card. A
               zoomed mosaic pages first (§13.11), so a page that way keeps the
               arrow live. Past the last photo, later goes dead and the card
               stays full; the minimize button is the way out. §13.8. */
            block("earlier", !view.pageBefore && photoFrom(view.full ? view.from - 1 : state.start - 1, -1) < 0);
            block("later", !view.pageAfter && photoFrom(view.full ? view.from + view.size : state.start + 1, 1) < 0);
        } else {
            block("earlier", !view.hiddenBefore);
            block("later", !view.hiddenAfter);
        }
        // A full-front picture has no line count to change. §13.8.
        block("fewer", view.full || state.count <= MIN_LINES);
        /* The budget the drawing actually used, and the count settled against
           it. paintFront clamps what it draws; this is the model catching up,
           so the plus button and the window agree about what fits. Scrolling
           onto a run of pictures therefore takes lines off and leaves them off
           — the same rule as the unconditional ellipsis reserve, and for the
           same reason: a count that grew back on its own would put a line in
           front of the reader that they did not ask for. */
        cap = view.cap;
        /* Not while full-front: its cap of 1 is the picture, not a line budget,
           and clamping to it would hand the next text card and the collapsed
           card a one-line window. §13.8. */
        /* NOR WHEN AN EXPANDED TEXT CARD HAS ONLY RUN OUT OF LIST. Expanded
           has no tail clamp, so near the end maxLines counts the entries left
           rather than the lines the budget allows, and writing that number
           into state.count would make it the collapsed card's count for good
           — 6 became 3 on the last text before a picture, and stayed 3 after
           collapse. The card draws min(count, cap) either way; the count is
           settled only when the budget is what bound it. §13.8. */
        const ranOut = state.expanded && view.from + cap >= view.total;
        if (!view.full && !ranOut) state.count = Math.min(state.count, cap);
        /* NOT !hiddenAfter. hiddenAfter asks whether there is anything BELOW,
           and growing the window does not require anything below: windowLines
           clamps `from` down as `size` rises, so at the END of the passage the
           extra line is taken FROM ABOVE, and at the START it is taken from
           below. The honest test is the one that covers both ends — "no budget,
           or the window already shows everything" — and it disables the button
           only when there is nothing in EITHER direction left to pull in.
           CHECKLIST-v7 §9.1. */
        block("more", state.count >= cap || (!view.hiddenBefore && !view.hiddenAfter));
        /* A QUOTE CARD HAS NO LINE COUNT TO ADJUST, so the pair is dead as well
           as hidden. Hidden alone is not enough: nubButton() falls back to
           [data-postcard-more] when the travel button in the direction of a
           drag is disabled, and it tests aria-disabled rather than visibility —
           so a live-but-invisible plus button would let a drag past the last
           post silently grow a window that does not exist. §6.5. */
        if (deck) {
            block("more", true);
            block("fewer", true);
        }

        /* The edge is placed from the drawing rather than from a second copy of
           the body arithmetic: paintFront hands back the baseline it actually
           finished on. A percentage is the whole conversion — the face's
           padding box IS the canvas box, so bodyBottom over the 1800-unit trim
           height is the same fraction on any screen, at any device pixel ratio,
           at whatever width the popover happens to be. */
        /* THE EDGE BAR IS THE BOTTOM OF THE QUOTED WINDOW, so a card with no
           window has nothing for it to mark: on a quote card the passage runs
           to its own last line every time and a rule under it would be a rule
           under the whole card. It stays hidden rather than being pinned to the
           last baseline, because it is also a GRAB HANDLE — a handle that
           cannot change anything is worse than no handle. §6.5. */
        edge.hidden = !!deck;
        edge.style.setProperty("--postcard-edge", `${(view.bodyBottom / TRIM_H) * 100}%`);

        /* THE ONE HOOK, AT THE ONE PLACE EVERYTHING ENDS UP. The chevrons, the
           +/- buttons, the arrow keys, the wheel over the stage and the stage
           drag all run through step(), and step() ends here — so a caller that
           wants to follow the window needs this callback and nothing else.

           Inert unless somebody passes it, and it draws nothing, so no printed
           card is affected. Note the early return at the top of paint(): this
           NEVER fires while the back is showing, which is why anything that has
           to react to the flip must do so off [data-back] rather than off here.
           CHECKLIST-v6 §16.3 and §16.5. */
        /* THE CARD LAYS ITS OWN NUB OUT, and it does NOT route that through
           its own optional callback. onPaint stays what it was — optional,
           unchanged in signature, and the documented hook for a caller that
           wants to follow the window. view.total, view.size and view.from are
           all already in scope here, so the track's layout is one call beside
           it rather than through it; a card that broke because somebody passed
           onPaint themselves would be a card subscribing to itself. */
        /* THE TRACK MEASURES WHAT THE CHEVRONS MOVE, AND WITH A DECK THAT IS
           THE SECTION. `view` describes the passage window — one post, whole,
           so total and size are equal and the nub would fill the track and say
           nothing on every card. In deck units the nub is one post of N and
           sits at `index`, which IS the snap the user asked for: layoutTrack
           has no continuous position to interpolate because there are only N
           of them, and the drag dispatches whole [data-postcard-later] steps
           through nubButton(). §6.5. */
        layoutTrack(deck ? { total: deck.length, size: 1, from: index } : (view.rail || view));
        layoutImageControls(view.figure);
        onPaint?.(view);
    };

    const toggle = el.querySelector("[role=\"tablist\"]");

    /*
     * THE SIDES TURN, THEY DO NOT SWAP.
     *
     * The stage is a perspective box holding one two-faced element — the same
     * mechanic the card group uses for a page turn (flip.js, card-group.css),
     * reading the same --duration-flip and --ease-flip, so the postcard and the
     * deck turn at one speed rather than two.
     *
     * The rotation is ABSOLUTE, not accumulated: the front rests at 0deg and
     * the back rests at -180deg about Y. Front to back therefore winds one way
     * and back to front unwinds through the same half turn the other. That is
     * the whole direction rule — there is no sign to carry here, because the
     * two resting states ARE the two directions. The sign itself lives in
     * postcard.css, once, and is the opposite of the deck's forward page turn.
     *
     * No stagger and no settle. One card is one rotation, so nothing has to be
     * repainted onto a face mid-turn and no timer outlives the transition: the
     * faces are permanent and only the container moves.
     *
     * The face turned away goes inert and hidden from assistive technology, so
     * a keyboard user can never land in the address form while the front is up
     * nor on the canvas while the form is. It is set at the START of the turn,
     * not at its end — the reader has already committed to the other side, and
     * a tab stop that lives for one transition is worse than one that goes
     * early.
     *
     * Turning plays the card group's own flip sample, once. Sound is off by
     * default and playFlip is a no-op until the reader turns it on.
     */
/*
     * THE SCROLL TRACK'S LAYOUT AND ITS DRAG.
     *
     * THE THUMB IS A LINE COUNT, NOT A HEIGHT, AND THAT APPROXIMATION IS NOW
     * SHIPPED. A figure is 576 trim units and a callout 288 where a text row
     * is 72, so on a card with a picture in it the nub is proportionally wrong
     * by up to eight rows. A height-accurate thumb means summing entryHeight() over
     * the whole entry list and exporting a second number, and the only visible
     * symptom is a nub slightly the wrong size. The debt is RECORDED HERE
     * rather than paid; if it bothers the reader it becomes its own item with
     * its own arithmetic. CHECKLIST-v7 §8.4.
     *
     * THE NUB'S HEIGHT AND TOP ARE DERIVED AND WILL LAND OFF THE 4px GRID.
     * Same class of value as --postcard-edge, which is written as a raw
     * percentage of bodyBottom: nobody authored it, it is the arithmetic of a
     * proportion, and rounding it to 4 would make the nub lie about where the
     * reader is. The two numbers a person DID choose — the 16 width in
     * postcard.css and the 16 floor below — are both on the grid.
     */
    // 4 x 4, and the same 16 the track is wide, so the nub floors at a square
    // and always still reads as a thumb.
    const NUB_MIN = 16;

    /* The last window paint() reported, so the drag knows how many steps the
       track is worth without reaching back into paint()'s locals. */
    let trackWin = { total: 1, size: 1, from: 0 };

    const layoutTrack = ({ total, size, from }) => {
        trackWin = { total, size, from };
        const trackH = track?.clientHeight;
        if (!trackH || !nub) return;
        const nubH = Math.max(NUB_MIN, (trackH * size) / total);
        const range = Math.max(0, total - size);
        const top = range ? ((trackH - nubH) * from) / range : 0;
        nub.style.height = `${nubH}px`;
        nub.style.top = `${top}px`;
    };

    /*
     * PUTTING THE TWO PICTURE BUTTONS ON THE PICTURE.
     *
     * paintFront hands back `view.figure` — the drawn image's rectangle in TRIM
     * units — for exactly the same reason it hands back bodyBottom: the buttons
     * are DOM and must never be painted, so the only thing that crosses is the
     * number only the drawing knows. DECISIONS-LOG.md #37.
     *
     * PERCENTAGES, NOT PIXELS, AND THAT IS THE WHOLE CONVERSION. The front
     * face's padding box IS the canvas box — the canvas is width and height
     * 100% with nothing between them — so x over TRIM_W and y over TRIM_H are
     * fractions of the drawing itself at any popover width, at any device pixel
     * ratio, and at the 416 the card became when §8 shipped the scroll track.
     * The card got 5.5% narrower there and none of this arithmetic moves,
     * because none of it is in CSS pixels: it is the same fraction of a smaller
     * box. §8.6.
     *
     * THE 8px INSET IS CHROME AND IS THEREFORE IN CSS PIXELS. §2.3 asks for
     * "8px inset from the image's edge" and 8 CSS px is what a finger meets,
     * not 8 trim units — a button positioned in trim units would be a different
     * physical size on every screen. It is padding on this box in postcard.css,
     * so the buttons sit inside the rectangle rather than on its corner.
     *
     * NO PICTURE IN THE WINDOW MEANS NO CONTROLS. Scrolling past the last
     * picture leaves view.figure null and the box goes hidden — which is §2.6's
     * "scrolling past an image hides it", for free and with no second rule.
     */
    const expandBtn = el.querySelector("[data-postcard-expand]");

    /* §13.25's two drag marks, DOM in the overlay and never painted (#37). */
    const mark = (name) => Object.assign(document.createElement("div"), { className: `qntns-postcard__${name}`, hidden: true });
    const lift = mark("lift");
    const drop = mark("drop");
    imgctl?.append(lift, drop);

    const layoutImageControls = (figure) => {
        if (!imgctl) return;
        imgctl.hidden = !figure;
        /* Only the full-front mosaic hands back cells, so only there does the
           box take presses and a picture stop flipping the card (§13.25). */
        imgctl.toggleAttribute("data-reorder", Boolean(figure && view?.cells));
        if (!figure) return;
        imgctl.style.left = `${(figure.x / TRIM_W) * 100}%`;
        imgctl.style.top = `${(figure.y / TRIM_H) * 100}%`;
        imgctl.style.width = `${(figure.w / TRIM_W) * 100}%`;
        imgctl.style.height = `${(figure.h / TRIM_H) * 100}%`;
        expandBtn?.setAttribute("aria-pressed", String(Boolean(figure.full)));
    };

    /*
     * EXPANDING STARTS THE WINDOW ON THE PICTURE PRESSED. paintFront then draws
     * it full-front and hands back cap 1, which paint() settles the count
     * against. Pressing it on a full-front picture collapses.
     *
     * COLLAPSE PUTS BACK THE WINDOW SAVED AT EXPAND — but only if the reader is
     * still on the picture they expanded. If they stepped while full-front, the
     * card stays where they are now (a COO call, §9). `saved` is a closure, not
     * a state field, so it is never printed or drafted.
     */
    let saved = null;
    const setImage = (next) => {
        Object.assign(state, next);
        paint();
    };
    const toggleExpand = () => {
        if (view?.full) {
            const back = saved && saved.at === state.start ? { start: saved.start, count: saved.count } : {};
            saved = null;
            return setImage({ expanded: false, pic: 0, zoom: 0, ...back });
        }
        const at = view?.figure?.index ?? state.start;
        saved = { start: state.start, count: state.count, at };
        return setImage({ expanded: true, start: at, pic: 0, zoom: 0 });
    };

    /* BELT AND BRACES WITH NOT_A_SWIPE, exactly as the nub is. The selector
       already lists `button` and these are real buttons, so the stage's own
       pointerdown hands them back on the first test; this stops the event
       reaching it at all. Both are wanted because the stage's touch-action is
       `none` and now routes touches the browser used to handle itself — the
       class of thing that passes in Storybook and fails in a hand. §2.7, and
       §8's nub needed both for the same reason. */
    /*
     * §13.25 DRAG TO REORDER THE FULL-FRONT MOSAIC. With data-reorder the box
     * takes presses; one on a cell is a reorder, never a swipe, so it never
     * flips or steps. One in a gap between cells goes on to the stage. The drop
     * moves the lifted photo into the target's place in state.order and
     * repaints; the marks are DOM, placed from view.cells in trim units the way
     * the box is placed from view.figure. A press that never travels DRAG_PX
     * changes nothing, as a still press on a picture does today.
     */
    const DRAG_PX = 8;
    let reorder = null;
    const pointAt = (event) => {
        const f = view?.figure;
        const r = imgctl.getBoundingClientRect();
        if (!f || !view.cells || !r.width || !r.height) return null;
        const x = f.x + ((event.clientX - r.left) / r.width) * f.w;
        const y = f.y + ((event.clientY - r.top) / r.height) * f.h;
        return { x, y };
    };
    const cellAt = (event) => {
        const point = pointAt(event);
        if (!point) return null;
        return view.cells.find((c) => point.x >= c.x && point.x < c.x + c.w && point.y >= c.y && point.y < c.y + c.h) || null;
    };
    const dropAt = (event) => {
        const point = pointAt(event);
        if (!point) return null;
        const cell = view.cells.find((c) => point.x >= c.x && point.x < c.x + c.w && point.y >= c.y && point.y < c.y + c.h);
        if (cell) return { cell };
        const rows = view.mosaicRows || [];
        for (let i = 0; i < rows.length - 1; i++) {
            const above = rows[i], below = rows[i + 1];
            if (point.y >= above.y + above.h && point.y <= below.y) return { before: below.first, breakAfter: above.last, marker: { x: view.figure.x, y: above.y + above.h, w: view.figure.w, h: below.y - (above.y + above.h) } };
        }
        return null;
    };
    const place = (node, c) => {
        const f = view?.figure;
        node.hidden = !c || !f;
        if (node.hidden) return;
        node.style.left = `${((c.x - f.x) / f.w) * 100}%`;
        node.style.top = `${((c.y - f.y) / f.h) * 100}%`;
        node.style.width = `${(c.w / f.w) * 100}%`;
        node.style.height = `${(c.h / f.h) * 100}%`;
    };
    imgctl?.addEventListener("pointerdown", (event) => {
        if (event.target.closest?.("button")) return event.stopPropagation();
        if (event.pointerType === "mouse" && event.button !== 0) return;
        const cell = imgctl.hasAttribute("data-reorder") && cellAt(event);
        if (!cell) return;
        event.stopPropagation();
        reorder = { id: event.pointerId, x: event.clientX, y: event.clientY, from: cell, to: null, moved: false };
        try { imgctl.setPointerCapture(event.pointerId); } catch { /* no capture; a release off the box drops nothing, and the next press starts over. */ }
    });
    imgctl?.addEventListener("pointermove", (event) => {
        if (!reorder || event.pointerId !== reorder.id) return;
        if (!reorder.moved && Math.hypot(event.clientX - reorder.x, event.clientY - reorder.y) < DRAG_PX) return;
        reorder.moved = true;
        const over = dropAt(event);
        reorder.to = over && (over.cell?.i !== reorder.from.i || over.breakAfter !== undefined) ? over : null;
        place(lift, reorder.from);
        place(drop, reorder.to?.marker || reorder.to?.cell);
    });
    const endReorder = (event) => {
        if (!reorder || event.pointerId !== reorder.id) return;
        const { from, to } = reorder;
        reorder = null;
        place(lift, null);
        place(drop, null);
        if (event.type !== "pointerup" || !to) return;
        const photos = data.lines.filter(isPhoto);
        const order = photoOrder(data.lines, state.order)?.slice() || photos.map((_, i) => i);
        const fromAt = order.indexOf(from.i);
        const before = to.cell?.i ?? to.before;
        if (fromAt < 0 || !Number.isInteger(before)) return;
        order.splice(fromAt, 1);
        const at = order.indexOf(before);
        if (at < 0) return;
        order.splice(at, 0, from.i);
        /* Saved by src, so a picture that fails to load on another day, or a
           post that swaps one, cannot shift the rest (photoOrder()). */
        const breaks = new Set((state.breaks || []).filter((i) => i !== from.i && Number.isInteger(i)));
        if (to.breakAfter !== undefined) breaks.add(to.breakAfter);
        setImage({ order: order.map((i) => photos[i].src), breaks: [...breaks], pic: 0 });
    };
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) imgctl?.addEventListener(type, endReorder);

    /*
     * DRAGGING THE NUB, THROUGH THE FRONT DOOR. step() is a closure in here and
     * stays one; nothing is exported to reach it. The toolbar buttons have a
     * click fallback that exists precisely so keyboard and screen-reader
     * activations work without the pointer press-and-hold path, and a
     * dispatched click is a supported way in that needs no new API.
     *
     * THE DIRECTION IS THE WHEEL'S, NOT THE STAGE DRAG'S, AND THAT IS
     * DELIBERATE. Dragging the STAGE down moves the reader EARLIER — the paper
     * moves with the hand. Dragging this nub down moves the reader LATER,
     * because a nub is a scrollbar and not paper, and a scrollbar goes down the
     * document. It is the opposite sense to the gesture six pixels to its
     * right, on purpose. Do not "fix" it to match.
     */
    let nubAnchor = null;
    let nubPerStep = 0;

    /*
     * THE DIVISOR IS RE-MEASURED, NOT CACHED AT THE PRESS.
     *
     * nubPerStep is (track - nub) / (total - size), and a drag that GROWS the
     * window changes `size` — so `range`, so the correct divisor — and
     * layoutTrack has just re-sized the nub as well. Computed once at
     * pointerdown it is right for the first second of a drag and drifts away
     * from the pointer after that. Returns false when there is nothing to
     * travel over, which is the range <= 0 guard and the loop's end condition
     * in one place. CHECKLIST-v7 §9.1.
     */
    const measureNub = () => {
        const range = trackWin.total - trackWin.size;
        // Nothing is hidden: the nub fills the track and the divisor is zero.
        nubPerStep = range > 0 ? (track.clientHeight - nub.offsetHeight) / range : 0;
        return nubPerStep > 0;
    };

    const dead = (button) => !button || button.getAttribute("aria-disabled") === "true";

    /*
     * WHERE ONE STEP OF THE DRAG GOES, AND THE RULE THAT KEEPS IT SAFE.
     *
     * THE INVARIANT THE WHOLE DESIGN RESTS ON, AND IT IS NOT OBVIOUS BELOW:
     * the drag grows the window ONLY when the step button in the direction of
     * travel is aria-disabled, and a disabled step button means, by definition,
     * that the window cannot travel that way. MID-PASSAGE BOTH STEP BUTTONS ARE
     * LIVE, so both drags step and NEITHER grows — an ordinary drag can never
     * resize the window by accident, and that is a property of the rule rather
     * than of a threshold anybody has to tune.
     *
     * BOTH ENDS, AND THE SAME LINE OF CODE DOES BOTH. windowLines() derives
     * `from` from `start` and `size` and clamps it into range, so a window that
     * grows takes its extra line from whichever side has one:
     *
     *   at the END    `later` is dead, `from` clamps DOWN as `size` rises,
     *                 and the line comes in FROM ABOVE
     *   at the START  `earlier` is dead, `from` is already 0 and stays there,
     *                 and the line comes in FROM BELOW
     *
     * The user asked for the first and then ruled for both: a control that
     * works one way and refuses the other reads as broken rather than as
     * deliberate. There is no direction test here because there is nothing to
     * test — the clamp is the mirror. CHECKLIST-v7 §9.1.
     */
    const nubButton = (later) => {
        const travel = el.querySelector(later ? "[data-postcard-later]" : "[data-postcard-earlier]");
        if (!dead(travel)) return travel;
        const grow = el.querySelector("[data-postcard-more]");
        return dead(grow) ? null : grow;
    };

    nub?.addEventListener("pointerdown", (event) => {
        if (event.button > 0) return;
        /* BELT AND BRACES WITH NOT_A_SWIPE, and both are needed. The selector
           stops the stage's own handler claiming the press; this stops the
           event reaching it at all, which matters because the stage's
           touch-action is `none` and it now routes touches the browser used to
           handle itself. THIS IS THE LINE THAT PASSES IN STORYBOOK AND FAILS ON
           A PHONE. */
        event.stopPropagation();
        if (!measureNub()) return;
        /* CAPTURE FIRST, ANCHOR SECOND, AND THE THROW IS SWALLOWED. Ordered the
           other way round, a setPointerCapture that throws on a pointerId the
           browser no longer considers active left nubAnchor set with the
           handler dead — a drag that had already begun and could never end.
           Capture is an optimisation here, not the mechanism: the document
           handlers below end the drag whether it was held or not. §9.2. */
        try { nub.setPointerCapture(event.pointerId); } catch { /* no capture; the drag still ends. */ }
        nubAnchor = event.clientY;
    });

    nub?.addEventListener("pointermove", (event) => {
        if (nubAnchor === null) return;
        while (Math.abs(event.clientY - nubAnchor) >= nubPerStep) {
            const later = event.clientY > nubAnchor;
            const button = nubButton(later);
            // A dead button refuses out loud; a drag past the end should not
            // shake and beep once per pixel.
            if (!button) return;
            button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            // The step just consumed was worth the OLD divisor, so the anchor
            // moves before the re-measure and not after it. The re-measure is
            // unconditional and direction-blind on purpose: a grow at EITHER
            // end changes size, so range, so the pixels a step is worth, and
            // fixing the drift on one path and missing the other is the exact
            // fault this replaces. §9.1.
            nubAnchor += later ? nubPerStep : -nubPerStep;
            if (!measureNub()) return;
        }
    });

    /*
     * EVERY ROUTE OUT OF A DRAG ENDS HERE, and there are five of them.
     *
     *   1. pointerup on the nub, capture held        -> this, off the nub
     *   2. pointercancel on the nub                  -> this, off the nub
     *   3. pointerup anywhere, capture never taken
     *      or lost mid-drag                          -> this, via onPointerUp
     *   4. pointercancel anywhere                    -> this, via onInterrupt
     *   5. the window loses focus and no pointerup
     *      ever arrives at all                       -> this, via onInterrupt
     *
     * 3 to 5 ride the document and window listeners the card ALREADY owns and
     * already tears down, so nothing new is bound and nothing is left behind
     * when the card closes. They clear a variable and return: they neither
     * preventDefault nor stop propagation, so the address form's own releases
     * and the stage's gestures pass through them untouched. The pointerId is
     * optional because route 5 hands us a blur event, which has none.
     * CHECKLIST-v7 §9.2.
     */
    const releaseNub = (event) => {
        nubAnchor = null;
        const id = event?.pointerId;
        if (id !== undefined && nub?.hasPointerCapture(id)) nub.releasePointerCapture(id);
    };
    nub?.addEventListener("pointerup", releaseNub);
    nub?.addEventListener("pointercancel", releaseNub);

        const showSide = (side) => {
        const turning = side !== state.side;
        state.side = side;
        // The thumb's resting position. postcard.css slides it from here; this
        // is the only thing that tells it where to stop, and it is set in the
        // same function that turns the card so the two cannot disagree about
        // which side is showing.
        toggle?.setAttribute("data-side", side);
        flipper?.toggleAttribute("data-back", side === "back");
        for (const [name, face] of Object.entries(sides)) {
            const away = name !== side;
            face?.toggleAttribute("inert", away);
            // "true", not toggleAttribute: aria-hidden is an enumerated
            // attribute, not a boolean one, and aria-hidden="" is not `true`.
            if (away) face?.setAttribute("aria-hidden", "true");
            else face?.removeAttribute("aria-hidden");
        }
        if (turning) playFlip();
        for (const tab of tabs) {
            tab.setAttribute("aria-selected", String(tab.dataset.postcardSide === side));
        }
        // The window controls only move the front. They stay in place on the
        // back and go disabled — the frame shows all four in both states, so
        // hiding them would contradict it, and leaving them live would offer
        // the sender four buttons that do nothing.
        if (side === "back") {
            for (const name of STEPS) block(name, true);
        }
        if (side === "front") paint();
    };

    /*
     * THE CARD ALSO TURNS UNDER A HAND.
     *
     * Pressing a tab is the accessible route and stays the primary one; this is
     * the direct one, for the reader whose hand is already on the card. A
     * horizontal drag across the stage turns it, and so does a two-finger
     * horizontal push on a trackpad, which arrives as a wheel event carrying
     * deltaX rather than as a pointer at all.
     *
     * IT IS A TOGGLE, NOT A DIRECTION, and that is not laziness. The rotation
     * in postcard.css is ABSOLUTE — front rests at 0deg, back at -180deg — so
     * a swipe mapped to "front" while the front is already up would animate
     * nothing at all. Under a direction rule half of every gesture would be a
     * dead gesture. One horizontal push, whichever way it goes, turns the card
     * over; the way it sweeps is the stylesheet's business and stays the same
     * either way.
     *
     * A DRAG THAT STARTS ON A CONTROL IS NOT A SWIPE. The back is a form, and
     * dragging across a text field to select what you typed must not flip the
     * card out from under you. Anything that starts inside a field, a button, a
     * link or the address dropdown is left to that element.
     *
     * VERTICAL WINS TIES, AND IT WINS THEM INTO THE WINDOW. The first move that
     * is more up-and-down than side-to-side stops being a swipe and becomes a
     * drag on the passage — see onStagePointerMove — so the card can only ever
     * be doing one of the two things. On the back, where the passage is not
     * showing, vertical still abandons the gesture and leaves the form alone.
     *
     * touch-action: none in postcard.css is that rule stated to the browser.
     * It used to be pan-y, which handed every vertical touch to the browser as
     * a scroll before pointermove was ever dispatched — fine when vertical did
     * nothing here, and fatal now that it moves the passage.
     *
     * ONE WHEEL GESTURE IS ONE TURN, ON THE HORIZONTAL AXIS ONLY. A trackpad
     * emits a long train of small deltas and keeps emitting them as the fingers
     * coast, so the deltas are summed to a threshold, the turn is spent, and
     * nothing more happens until the train has been quiet for WHEEL_IDLE.
     * Without the latch a single push would spin the card several times. The
     * vertical axis shares the threshold and the idle gap but deliberately not
     * the latch; onStageWheelWindow says why.
     */
    const SWIPE_PX = 48;
    /* Lower than the drag threshold, and deliberately so: a trackpad push is a
       flick rather than a carry, and the deltas of one comfortable two-finger
       swipe add up fast. 48 here needed a shove. */
    const WHEEL_PX = 24;
    /* Not a measurement — a quiet gap between two trackpad gestures, in ms. */
    const WHEEL_IDLE = 200;
    /* [data-postcard-track] earns its place the way [data-postcard-edge] did:
       the track is a plain div and matches none of the tag names above, so
       unlike the toolbar's buttons it does NOT inherit this exclusion for free.
       Without it a press on the nub is read as the start of a card flip. */
    const NOT_A_SWIPE = "input, textarea, select, button, a, [role=\"listbox\"], [data-postcard-suggest], [data-postcard-edge], [data-postcard-track]";

    const stage = el.querySelector(".qntns-postcard__stage");
    const turnOver = () => showSide(state.side === "front" ? "back" : "front");

    let swipe = null;

    const onStagePointerDown = (event) => {
        // Secondary and middle buttons open menus and paste; neither is a drag.
        if (event.pointerType === "mouse" && event.button !== 0) return;
        if (event.target.closest?.(NOT_A_SWIPE)) return;
        swipe = { id: event.pointerId, x: event.clientX, y: event.clientY };
    };

    /* On the document rather than the stage: a finger that leaves the card
       mid-drag has still made the gesture, and its pointerup would otherwise
       never arrive. */
    /*
     * ONE LINE PER ONE LINE'S WORTH OF TRAVEL, in CSS pixels, measured off the
     * preview at whatever size it is currently drawn:
     *
     *     bodyLead / TRIM_H  x  the canvas's rendered height
     *       72    /  1800    x  h        =  h / 25
     *
     * So the passage tracks the hand — a line goes by exactly when the hand has
     * covered a line — on any screen and at any popover width, without a
     * constant that would be right on one of them. 24 only if the canvas has
     * not been laid out yet, which cannot happen from a real gesture.
     *
     * The lead is read under the reader's text size (§13.15) — 40 at −4, 104
     * at +4 — because the step only exists inside withTextStep. Not on a quote
     * card, which paintFront never steps either.
     */
    const linePx = () =>
        (canvas.clientHeight * withTextStep(state.quote ? 0 : state.textStep, () => LAYOUT.bodyLead)) / TRIM_H || 24;

    const onStagePointerMove = (event) => {
        if (!swipe || event.pointerId !== swipe.id) return;

        /* Committed to the window. swipe.y is the last line boundary crossed
           rather than where the finger went down, so the steps come out evenly
           spaced across a long drag instead of all at once at the threshold. */
        if (swipe.mode === "window") {
            const unit = linePx();
            silently(() => {
                while (Math.abs(event.clientY - swipe.y) >= unit) {
                    const down = event.clientY > swipe.y;
                    swipe.y += down ? unit : -unit;
                    // Pulling the card DOWN brings in what is above, the way a
                    // hand on a sheet of paper does. The wheel is the other way
                    // round on purpose: a wheel moves the view, a hand moves
                    // the page. Every reader already has both rules.
                    if (!step(down ? "earlier" : "later")) {
                        swipe.y = event.clientY;
                        break;
                    }
                }
            });
            return;
        }

        const dx = event.clientX - swipe.x;
        const dy = event.clientY - swipe.y;
        if (Math.abs(dy) > Math.abs(dx)) {
            /* VERTICAL STILL WINS TIES — it just wins them into the window now
               rather than into nothing. On the BACK it is abandoned exactly as
               before: that side is a form, and a drag down it is a reader
               reaching for a field, not moving a passage that is not showing. */
            if (state.side !== "front") {
                swipe = null;
                return;
            }
            swipe.mode = "window";
            swipe.y = event.clientY;
            return;
        }
        if (Math.abs(dx) < SWIPE_PX) return;
        swipe = null;
        turnOver();
    };

    /*
     * THE EDGE IS DRAGGED, AND IT PRESSES THE SAME TWO BUTTONS A HAND WOULD.
     *
     * Pulling the rule down shows more of the article and pushing it up shows
     * less, one line per line of travel — the same unit the stage drag uses, so
     * the two gestures cannot feel like different speeds on the same card.
     *
     * It goes through step("more") / step("fewer") and never assigns
     * state.count. Every clamp, the cap, and all four button states live on the
     * far side of that function, and a continuous gesture is precisely the
     * thing that would sail past them unnoticed. silently() is the one
     * concession a drag gets: the limit still holds, it just does not buzz once
     * a frame while the reader leans on it.
     *
     * Pointer capture, so a hand that slides off the card keeps the grip.
     */
    let resize = null;

    const onEdgeDown = (event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        /* CAPTURE FIRST, ANCHOR SECOND, SAME AS THE NUB AND FOR THE SAME REASON.
           Ordered the other way round — and it was — a setPointerCapture that
           throws on a pointerId the browser no longer considers active left
           `resize` set with the handler dead, which is a drag of the edge that
           has begun and can never end. The optional chain and the catch are
           both kept and neither is load-bearing any more: capture is an
           optimisation here, not the mechanism, because the document handlers
           below end the drag whether it was ever held or not. CHECKLIST-v7 §9.2,
           widened from the nub after the user found it on this handler too. */
        try { edge.setPointerCapture?.(event.pointerId); } catch { /* no capture; the drag still ends. */ }
        resize = { id: event.pointerId, y: event.clientY };
        // Stops the stage's own pointerdown reading this as the start of a
        // swipe, and stops a touch-hold raising a selection callout over it.
        event.preventDefault();
        event.stopPropagation();
    };

    const onEdgeMove = (event) => {
        if (!resize || event.pointerId !== resize.id) return;
        const unit = linePx();
        silently(() => {
            while (Math.abs(event.clientY - resize.y) >= unit) {
                const down = event.clientY > resize.y;
                resize.y += down ? unit : -unit;
                if (!step(down ? "more" : "fewer")) {
                    resize.y = event.clientY;
                    break;
                }
            }
        });
    };

    /*
     * EVERY ROUTE OUT OF AN EDGE DRAG ENDS HERE, and they are the nub's five.
     *
     *   1. pointerup on the edge, capture held        -> this, off the edge
     *   2. pointercancel on the edge                  -> this, off the edge
     *   3. pointerup anywhere — capture never taken
     *      (setPointerCapture absent or thrown) or
     *      lost mid-drag                              -> this, via onPointerUp
     *   4. pointercancel anywhere                     -> this, via onInterrupt
     *   5. the window loses focus and no pointerup
     *      ever arrives at all                        -> this, via onInterrupt
     *
     * 3 to 5 ride the document and window listeners the card ALREADY owns and
     * already tears down, so nothing new is bound and nothing is left behind
     * when the card closes. They clear a variable and return — no
     * preventDefault, no stopPropagation — so the address form's own releases
     * and the stage's gestures pass through untouched.
     *
     * NO pointerId AT ALL IS ROUTE 5. A blur event carries none, and there is
     * then no pointer left to match against, so any live resize is over by
     * definition. A pointerId that is present and belongs to a DIFFERENT
     * pointer is somebody else's release and is left alone.
     */
    const onEdgeUp = (event) => {
        const id = event?.pointerId;
        if (!resize || (id !== undefined && id !== resize.id)) return;
        resize = null;
        if (id !== undefined && edge?.hasPointerCapture?.(id)) edge.releasePointerCapture(id);
    };

    /*
     * THE THIRD DRAG SURFACE, AND WHY IT NEVER HAD THE BUG THE OTHER TWO DID.
     *
     * The nub and the edge both took pointer capture and then bound their
     * releases to the captured node — so the moment capture was absent, refused
     * or lost, the release landed somewhere else and the drag could never end.
     * The stage takes NO capture at all: onStagePointerMove is on the document,
     * so its exits were always on the document too, and endSwipe() is reached
     * by onPointerUp, by onInterrupt's document pointercancel and by
     * onInterrupt's window blur. `swipe` cannot be left set with no pointer
     * down, and it never could.
     *
     * THAT IS THE RULE THE OTHER TWO NOW FOLLOW, and it is the one to keep: a
     * gesture's exits belong wherever its moves are heard, and capture is an
     * optimisation on top. A handler that captures and then listens only on the
     * captured node has hidden a stuck-state bug in the failure path of an API
     * that usually works. Found twice, by a user, on this card. §9.2.
     *
     * The press-and-hold repeat on the toolbar buttons is the same shape and is
     * safe for the same reason: onPointerDown takes no capture, and stopRepeat()
     * is reached from both document handlers.
     */
    const endSwipe = () => { swipe = null; };

    let wheelSum = 0;
    let wheelIdle = 0;
    let wheelSpent = false;

    /*
     * THE VERTICAL CHANNEL IS THE WINDOW, AND IT IS A SEPARATE ACCUMULATOR.
     *
     * Horizontal turns the card over; vertical runs the passage. They share the
     * threshold and the idle gap but not the sum, because a diagonal push would
     * otherwise spend one gesture's pixels on the other axis.
     *
     * NO SPENT LATCH HERE, and that is the difference between the two. Turning
     * a card over twice with one flick is a bug; moving the window four lines
     * with one flick is the gesture working. So the sum is drained a step at a
     * time rather than cashed once and locked out.
     */
    let wheelDown = 0;
    let wheelDownIdle = 0;

    const onStageWheelWindow = (event) => {
        if (state.side !== "front") return;
        // Claimed for the whole gesture, coasting deltas included — same reason
        // the horizontal path prevents above its own spent check: an unclaimed
        // tail is handed to the browser's own scroll or overscroll gesture.
        event.preventDefault();

        clearTimeout(wheelDownIdle);
        wheelDownIdle = setTimeout(() => { wheelDown = 0; }, WHEEL_IDLE);

        wheelDown += event.deltaY;
        silently(() => {
            while (Math.abs(wheelDown) >= WHEEL_PX) {
                const down = wheelDown > 0;
                wheelDown -= down ? WHEEL_PX : -WHEEL_PX;
                // Scrolling down walks down the article, which is the same
                // direction the down chevron means.
                if (!step(down ? "later" : "earlier")) {
                    wheelDown = 0;
                    break;
                }
            }
        });
    };

    const onStageWheel = (event) => {
        // A tie or a vertical push moves the passage rather than turning the
        // card. Vertical wins the tie for the same reason it does in the drag.
        if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) {
            onStageWheelWindow(event);
            return;
        }

        /*
         * PREVENTED FIRST, AND FOR THE WHOLE GESTURE — INCLUDING AFTER THE TURN
         * HAS BEEN SPENT. This is above the spent check on purpose. A trackpad
         * keeps emitting deltas long after the fingers have stopped pushing, and
         * every one of those coasting deltas that reaches the browser unclaimed
         * is fed to the back-navigation gesture. Returning early once the card
         * had turned handed the browser the entire tail of the push, which is
         * exactly how a single flip used to leave the page.
         *
         * So the rule is: if a horizontal wheel event arrived over the card, the
         * card has claimed it, turn or no turn.
         */
        event.preventDefault();

        clearTimeout(wheelIdle);
        wheelIdle = setTimeout(() => { wheelSum = 0; wheelSpent = false; }, WHEEL_IDLE);
        if (wheelSpent) return;

        wheelSum += event.deltaX;
        if (Math.abs(wheelSum) < WHEEL_PX) return;
        wheelSum = 0;
        wheelSpent = true;
        turnOver();
    };

    /*
     * ONE STEP OF ONE CONTROL, and the only place the four of them are spelled
     * out. A press, a held press and an arrow key all come through here, so
     * they cannot drift apart.
     *
     * Returns false when the control is spent, which is what lets a hold stop
     * itself rather than hammering a dead button all the way to the end of the
     * poem. Each checks its own aria-disabled first, because nothing else does
     * — see the note on squareButton.
     */
    /*
     * A CONTINUOUS GESTURE DOES NOT GET ANSWERED LIKE A PRESS.
     *
     * refuse() is a buzz and a shake, and it is the right answer to one press
     * of a dead button. A drag held against the bottom of the card asks the
     * same dead question sixty times a second, and sixty buzzes is not sixty
     * answers — it is a fault noise. So a gesture raises this flag and the
     * limit is enforced silently; the button still goes aria-disabled through
     * paint(), which is the part the reader actually needs.
     */
    let quiet = false;
    const silently = (run) => {
        quiet = true;
        try { run(); } finally { quiet = false; }
    };

    /*
     * A DECK STEP ASKS THE DECK, NOT THE BUTTON.
     *
     * aria-disabled is written by paint(), and with a deck setData() does not
     * paint on this frame — it defers to loadFigures().then(paint). So between
     * a step and the moment that post's pictures land, the button's flag still
     * describes the PREVIOUS index. Trusting it let a second press at the last
     * index run deck.at(length) and hand `undefined` to the caller's at(),
     * which threw and left `index` past the end: every later press threw too,
     * and closing wrote the draft under the wrong key. So the bound is
     * recomputed here from `index` and `deck.length`, which are true at press
     * time, and `index` only moves after the step is found legal.
     *
     * The window steps keep asking the button, because nothing about them is
     * deferred: paint() runs inside step() and the flag is never stale.
     */
    const illegal = (name) => {
        if (deck && name === "later") return index >= deck.length - 1;
        if (deck && name === "earlier") return index <= 0;
        return blocked(name);
    };

    /* AN EXPANDED STEP GOES PHOTO TO PHOTO. The user's rule, 2026-09-14,
       reversing the first one ("if there's text in between, the scroll will
       put the text in"): "it should show the next image as full screen, even
       if it skips the text in between." A photo is an entry that paints
       full-front — a mosaic row (wrap off), or a picture that is not a
       bookmark and has a natural width — the same two tests paintFront's
       full-front branches make, so a landing is always drawn full. Blanks,
       text, headings, lists, quotes, code, dividers and bookmarks are passed
       over. photoFrom() is the search, −1 when none that way; paint() asks it
       the same question to make the arrow dead, so a live arrow always moves
       and a step never has nowhere to go. The card that is not expanded still
       steps line by line, blanks and all. The list is the WRAPPED one the view
       carries — `start` indexes it, and with wrap off it is not the source.
       §13.8, DECISIONS-LOG #89. */
    const isPhotoEntry = (e) => e?.type === "mosaic" || (isFigure(e) && !isBookmark(e) && e.img?.naturalWidth > 0);
    const photoFrom = (at, dir) => {
        const lines = view?.lines || (data && data.lines) || [];
        for (let i = at; i >= 0 && i < lines.length; i += dir) if (isPhotoEntry(lines[i])) return i;
        return -1;
    };
    const landing = (at, dir) => {
        const lines = view?.lines || (data && data.lines) || [];
        const last = Math.max(0, lines.length - 1);
        at = Math.min(last, Math.max(0, at));
        if (!state.expanded) return at;
        const photo = photoFrom(at, dir);
        return photo < 0 ? state.start : photo;
    };

    const step = (name) => {
        if (illegal(name)) {
            if (!quiet) refuse(control(name));
            return false;
        }
        if (deck && (name === "earlier" || name === "later")) {
            setData(index + (name === "later" ? 1 : -1));
            return true;
        }
        /* Full-front steps a whole view: one picture (§7), or a whole mosaic
           run (§10), so no press repaints the same mosaic. A zoomed mosaic
           pages first (§11). `pic` follows the DIRECTION of the step, whatever
           view it left: a run entered backwards opens on its last page (−1),
           entered forwards on its first. Set from the view being left, a step
           out of the run to text and back skipped pages. §11 B2, B3. */
        if (name === "earlier" && view?.pageBefore) state.pic = view.prevPic;
        else if (name === "earlier") {
            state.start = landing(view?.full ? view.from - 1 : state.start - 1, -1);
            state.pic = -1;
        }
        if (name === "later" && view?.pageAfter) state.pic = view.nextPic;
        else if (name === "later") {
            state.start = landing(view?.full ? view.from + view.size : state.start + 1, 1);
            state.pic = 0;
        }
        if (name === "fewer") state.count = Math.max(MIN_LINES, state.count - 1);
        if (name === "more") state.count = Math.min(cap, state.count + 1);
        paint();
        return true;
    };

    /*
     * PRESS AND HOLD, AND HOLD AN ARROW KEY.
     *
     * Moving a window six lines down a poem is six presses, and six presses is
     * a worse interface than one press held for a second and a half. So a held
     * button, and a held arrow key, repeat at REPEAT_MS: the press itself is
     * the first step and the repeats follow it, which is why one second of
     * holding is four steps rather than five.
     *
     * The rate is ours and not the operating system's. A held key already
     * autorepeats, but at whatever the reader has their key-repeat set to —
     * on a fast setting that is a line every 15ms and the window is at the end
     * of the poem before the finger is off the key. So `event.repeat` is
     * thrown away and the same interval that drives the buttons drives the
     * keys, and the two feel like one control.
     *
     * A hold ends when the control runs out. Reaching the end refuses ONCE —
     * the shake and the error sound of a dead button — and then stops, rather
     * than shaking on every tick for as long as the finger is down.
     *
     * There is only ever one hold: starting a new one cancels whatever was
     * running, so a second finger or a second key cannot leave a timer behind.
     */
    const REPEAT_MS = 250;
    let repeatTimer = null;
    // The key holding the current repeat, or null when a pointer is holding it.
    // Its keyup is the only one allowed to stop it.
    let repeatKey = null;

    const stopRepeat = () => {
        window.clearInterval(repeatTimer);
        repeatTimer = null;
        repeatKey = null;
    };

    const hold = (name, key = null) => {
        stopRepeat();
        if (!step(name)) return;
        repeatKey = key;
        repeatTimer = window.setInterval(() => {
            if (!step(name)) stopRepeat();
        }, REPEAT_MS);
    };

    const STEPS = ["earlier", "later", "fewer", "more"];
    const stepHit = (target) => STEPS.find((name) => target.closest?.(`[data-postcard-${name}]`));

    /*
     * The press starts on pointerdown, not on click, because a hold has to
     * begin while the button is still down — a click does not arrive until the
     * finger is up, by which time the hold is over.
     *
     * Primary button only. A right-click opens a context menu and would leave
     * the repeat running under it.
     */
    const onPointerDown = (event) => {
        if (event.button > 0) return;
        const name = stepHit(event.target);
        if (name) hold(name);
    };

    /* Released anywhere, not just over the button: a finger that slides off
       mid-hold has still let go, and a pointerup that lands on the scrim would
       otherwise never reach the button that started it. Listening on the
       document is what makes both true. */
    const onPointerUp = (event) => {
        releaseNub(event);
        onEdgeUp(event);
        endSwipe();
        if (repeatKey === null) stopRepeat();
    };

    /*
     * The arrows, and which is which: up and down MOVE the window through the
     * article, left and right RESIZE it. That is the same pairing the toolbar
     * already draws — the chevrons on one side, the minus and plus on the
     * other — so the keys are the buttons and there is nothing extra to learn.
     */
    const ARROWS = {
        ArrowUp: "earlier",
        ArrowDown: "later",
        ArrowLeft: "fewer",
        ArrowRight: "more"
    };

    const onClick = (event) => {
        const hit = (name) => event.target.closest?.(`[data-postcard-${name}]`);

        if (hit("close")) return close();

        const tab = hit("side");
        if (tab) return showSide(tab.dataset.postcardSide);

        /*
         * The four steppers are driven by pointerdown above, so a click that
         * came from a pointer has already been served and would double the
         * step if it were served again.
         *
         * detail is what tells the two apart: a click synthesised by Enter or
         * Space on a focused button carries detail 0, and a click that came
         * from a real press carries the click count. So this branch is the
         * KEYBOARD activation of these buttons and nothing else. A screen
         * reader's click also arrives with detail 0, which is correct — it is
         * an activation with no press behind it, and it should step once.
         */
        const stepper = event.detail === 0 && stepHit(event.target);
        if (stepper) return step(stepper);

        if (hit("expand")) return toggleExpand();

        const wrap = hit("wrap");
        if (wrap) {
            if (dead(wrap)) return refuse(wrap);
            state.wrap = !state.wrap;
            wrap.setAttribute("aria-pressed", String(state.wrap));
            return paint();
        }

        const size = hit("smaller") || hit("larger");
        if (size) {
            if (dead(size)) return refuse(size);
            const larger = size.hasAttribute("data-postcard-larger");
            /* A full-front mosaic jumps its photo zoom to the next step that
               repacks (§13.11) and never touches textStep (§13.29). The run
               re-find by id is from when A± rewrapped the text (§13.11 B1);
               it is now a no-op, left in place. */
            const run = view?.full && view.mosaic ? view.run : undefined;
            if (run !== undefined) state.zoom = larger ? (view.zoomTo ?? state.zoom) : view.zoomOut;
            else state.textStep += larger ? 1 : -1;
            state.run = run;
            sizeLimits();
            paint();
            if (run !== undefined) state.start = view.from;
            delete state.run;
            return;
        }

        if (hit("download")) return download();
        if (hit("share")) return share();
        if (hit("mail")) return startMail(hit("mail"));
    };

    const collect = () => {
        const field = (name) => el.querySelector(`[data-postcard-field="${name}"]`)?.value.trim() || "";
        return {
            article: data,
            /* expanded rides here beside start and count because it is the
               same kind of thing — the window's own setting — and §2.6 requires
               it stored or an expanded card reopens flat. */
            /* This object is also the state submitOrder hands exportFront, so
               it carries every field paintFront reads, or the mailed card is
               not the card on screen. `quote` is for the order only; restore
               ignores it, since the deck decides it. CHECKLIST-13 §13. */
            window: {
                start: state.start,
                count: state.count,
                expanded: state.expanded,
                wrap: state.wrap,
                textStep: state.textStep,
                pic: state.pic,
                zoom: state.zoom,
                order: state.order,
                breaks: state.breaks,
                quote: state.quote
            },
            message: message?.value.trim() || "",
            funder: field("funder"),
            address: {
                name: field("name"),
                line1: field("line1"),
                line2: field("line2"),
                city: field("city"),
                state: field("state").toUpperCase(),
                zip: field("zip")
            }
        };
    };

    const filename = () => `${String(data.title || "postcard").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.png`;

    const download = async () => {
        const blob = await exportFront(data, state);
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename();
        link.click();
        // Revoked on the next frame rather than immediately: a same-tick revoke
        // races the browser's own read of the blob in Safari.
        requestAnimationFrame(() => URL.revokeObjectURL(url));
    };

    /*
     * THE PICTURE AND THE LINK, NOT THE PICTURE ALONE.
     *
     * A card shared as a bare image is a nice image and a dead end — whoever
     * receives it has no way to reach the thing it was made from. The address
     * rides along as plain text so it arrives as a message somebody can tap,
     * whatever the receiving app is.
     *
     * `text` RATHER THAN `url`, WHICH IS NOT PEDANTRY. The Web Share API has a
     * `url` field and several platforms treat a payload carrying both `files`
     * and `url` as a link share, quietly dropping the attachment — the one
     * thing this button exists to send. As `text` it is a string beside the
     * image, and every share target that accepts text renders a bare URL as a
     * tappable link anyway.
     *
     * THE FULL PAYLOAD IS TESTED FIRST AND THE PICTURE IS THE PART WORTH
     * KEEPING. canShare answers about the whole object, so a platform that
     * refuses the combination falls back to sharing the file by itself rather
     * than to nothing. Only a platform that cannot share files at all gets the
     * download, and the reader still ends up holding the card.
     *
     * Two things it must not do, unchanged: treat a cancelled sheet as an
     * error, because dismissing it is the reader saying no; and assume file
     * sharing exists, because most desktops cannot do it.
     */
    const share = async () => {
        const blob = await exportFront(data, state);
        if (!blob) return;

        const file = new File([blob], filename(), { type: "image/png" });
        const title = String(data.title || "");
        const withLink = data.url
            ? { files: [file], title, text: absoluteUrl(data.url) }
            : { files: [file], title };

        const payload = navigator.canShare?.(withLink)
            ? withLink
            : (navigator.canShare?.({ files: [file] }) ? { files: [file], title } : null);

        if (payload) {
            try {
                await navigator.share(payload);
            } catch {
                // Cancelled, or refused by the platform. Either way, silence.
            }
            return;
        }

        await download();
    };

    /*
     * WHAT $4 ACTUALLY DOES.
     *
     * Three states and they are all visible on the button itself, because it is
     * the thing the sender is looking at when they commit money and a spinner
     * somewhere else is a spinner they will miss.
     *
     *   not ready   refuse out loud, move focus to the first bad field
     *   working     the label says so and the button stops accepting presses,
     *               because a double press would upload the card twice and open
     *               two checkouts
     *   failed      the label says so and the button comes back, because the
     *               sender can retry and nothing was charged
     *
     * ON SUCCESS IT NAVIGATES AND NEVER RETURNS. There is no third state for
     * "done" — the page is gone by then.
     *
     * `onMail` short-circuits all of it. Storybook passes one to inspect the
     * order object; the theme passes none.
     */
    let working = false;

    const startMail = async (button) => {
        if (working) return;

        const bad = firstBadField();
        if (bad) {
            refuse(button);
            el.querySelector(`[data-postcard-field="${bad}"]`)?.focus();
            return;
        }

        if (onMail) return onMail(collect());

        working = true;
        const label = button.textContent;
        button.textContent = "Working…";
        button.setAttribute("aria-disabled", "true");

        try {
            location.href = await submitOrder(collect());
        } catch {
            // Nothing was charged — the failure is before Stripe or at the
            // Worker. The button comes back so the sender can try again, and it
            // says what happened rather than silently reverting.
            working = false;
            button.textContent = "Try again";
            button.removeAttribute("aria-disabled");
            setTimeout(() => {
                button.textContent = label;
                refreshMail();
            }, 2400);
        }
    };

    const onKeydown = (event) => {
        if (el.hidden) return;
        if (event.key === "Escape") return close();

        const arrow = ARROWS[event.key];
        if (arrow) {
            // A modifier means the reader is asking the browser or the
            // operating system for something, not asking for a line.
            if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            // The back is a form and its fields own their own arrows. The four
            // controls are disabled over there anyway, so there is nothing
            // here to reach.
            if (state.side !== "front") return;
            if (event.target.closest?.("input, textarea")) return;
            // Up and down scroll a page and left and right can go back a page;
            // both belong to the window while the card is open.
            event.preventDefault();
            // The operating system's autorepeat is discarded — the interval in
            // hold() owns the rate. See the note there.
            if (event.repeat) return;
            return hold(arrow, event.key);
        }

        if (event.key !== "Tab") return;

        // The focus trap. A modal that lets Tab walk out into the post behind it
        // is a modal a screen reader user cannot get back out of.
        // The face turned away is still laid out — both faces have to be, or
        // there is nothing to turn — so offsetParent no longer rules it out the
        // way display:none once did. `inert` is what marks it now, and inert is
        // inherited by the whole subtree, hence closest() rather than a check on
        // the node itself.
        const items = [...el.querySelectorAll(FOCUSABLE)].filter((node) =>
            !node.disabled && node.offsetParent !== null && !node.closest("[inert]"));
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    };

    /*
     * THE $4 BUTTON IS DEAD UNTIL THE ADDRESS IS THE RIGHT SHAPE. aria-disabled
     * rather than disabled, for the reason argued on squareButton: a pressed
     * button that cannot be answered reads as broken. Pressing it early refuses
     * out loud and moves the focus to the first field that is wrong, which is
     * the only thing the sender can act on.
     */
    const mail = el.querySelector("[data-postcard-mail]");

    const REQUIRED = ["name", "line1", "city", "state", "zip"];

    const firstBadField = () => {
        const order = collect();
        for (const name of REQUIRED) {
            if (!order.address[name]) return name;
        }
        if (!/^[A-Z]{2}$/.test(order.address.state)) return "state";
        if (!/^\d{5}(-?\d{4})?$/.test(order.address.zip)) return "zip";
        return null;
    };

    const refreshMail = () => {
        mail?.setAttribute("aria-disabled", String(!validateAddress(collect().address)));
    };

    /*
     * THE COUNTER IS MEASURED IN THE CAP'S OWN UNITS. weighted-used / 500, and
     * nothing else beside it: a sender who presses return and watches the number
     * jump by 50 has been told the rule without a word of copy, and a second
     * number would only invite them to add the two together.
     *
     * Enforcement lives here rather than on a key, because a paste is not a key.
     * The caret is put back where it was, clamped to the text that survived.
     */
    const enforce = () => {
        const clamped = clampWeighted(message.value);
        if (clamped !== message.value) {
            const caret = Math.min(message.selectionStart ?? clamped.length, clamped.length);
            message.value = clamped;
            message.setSelectionRange(caret, caret);
        }
        count.textContent = `${weigh(message.value)} / ${MESSAGE_MAX}`;
    };

    const onInput = (event) => {
        if (event.target === message) enforce();
        refreshMail();
    };

    // A token can move under a theme switch, and the canvas has already been
    // painted by then — it does not re-read anything on its own.
    const onResize = () => { tokens = readTokens(); paint(); };

    /*
     * RESTORE BEFORE ANYTHING IS PAINTED OR FOCUSED, so the sender never sees
     * the empty form flash into the filled one.
     *
     * A missing field is left alone rather than blanked. A draft written by an
     * older build may not carry every key this one asks for, and blanking on
     * absence would quietly delete what it did carry.
     */
    const restore = () => {
        const draft = readDraft(key);
        /* Before the early return: a post with no draft gets its own order,
           not the last post's. Taken as written; photoOrder() judges it
           against the photos that actually loaded, at paint (§13.25). */
        state.order = draft?.window?.order ?? null;
        state.breaks = Array.isArray(draft?.window?.breaks) ? [...new Set(draft.window.breaks.filter((i) => Number.isInteger(i) && i >= 0))] : [];
        if (!draft) return;

        if (message && typeof draft.message === "string") {
            message.value = draft.message;
            // Through the same gate as a keystroke. A draft written by a build
            // with the old 250 cap, or by hand, is weighed and cut here rather
            // than showing a raw count until the first keypress corrects it —
            // a bug that only appears on reload, which is the kind that ships.
            enforce();
        }

        const put = (name, value) => {
            const field = el.querySelector(`[data-postcard-field="${name}"]`);
            if (field && typeof value === "string") field.value = value;
        };
        put("funder", draft.funder);
        for (const [name, value] of Object.entries(draft.address || {})) put(name, value);

        /* The window is not trusted, but it is no longer clamped here: what
           fits depends on the pictures in the window and this runs before the
           paint that knows about them. Only the floor is applied, and paint()
           brings the count down to the budget on the very next repaint. */
        if (draft.window) {
            state.start = Math.max(0, Number(draft.window.start) || 0);
            state.count = Math.max(1, Number(draft.window.count) || state.count);
            /* Coerced rather than trusted, like everything else out of storage.
               A draft written before §2 shipped has no key and comes back
               false, which is the flat card it was saved as. An older draft's
               `rotated` key is ignored. CHECKLIST-13 §6. */
            state.expanded = Boolean(draft.window.expanded);
            /* Missing means a draft from before §13: wrap on, step 0. */
            state.wrap = draft.window.wrap !== false;
            state.textStep = Math.max(TEXT_STEP_MIN, Math.min(TEXT_STEP_MAX, Math.round(Number(draft.window.textStep)) || 0));
            state.pic = Math.max(-1, Math.round(Number(draft.window.pic)) || 0);
            /* Missing means a draft from before §13.29: best fit. */
            state.zoom = Math.max(0, Math.min(PHOTO_STEP_MAX, Math.round(Number(draft.window.zoom)) || 0));
            /* paint() writes neither, so the buttons are told here. */
            control("wrap").setAttribute("aria-pressed", String(state.wrap));
            sizeLimits();
        }

        refreshMail();
    };

    /*
     * STEPPING TO ANOTHER POST, WITHOUT REMOUNTING. CHECKLIST-v11 §6.3.
     *
     * The alternative was destroy-and-remount per post, and it loses the
     * popover's open state, its focus and its scroll position on every step —
     * three regressions bought for nothing, since `data` is only read by
     * paint(), collect() and the draft key and all three can be pointed at a
     * new object.
     *
     * THE DRAFT FOLLOWS THE POST. One draft per post is the promise this
     * editor already makes (see draftKey), so the outgoing post's typing is
     * saved under the key that is leaving, the form is blanked, and the
     * incoming post's draft — if it has one — is restored under the new key.
     * Without the blank, post two would open holding post one's message.
     *
     * THE WINDOW GOES BACK TO THE TOP ONLY FOR A POST THAT HAS NO DRAFT. The
     * assignment below is a default, not the last word: restore() runs after it
     * and reassigns state.start from the incoming post's saved window, so a
     * post left at line 14 with typing in it reopens at line 14. That is the
     * same promise as the draft itself — one saved position per post — and the
     * zero is what a post nobody has edited gets.
     */
    function setData(next) {
        writeDraft(collect(), key);
        index = next;
        data = deck.at(index);
        key = draftKey(data.url ? `/${String(data.url).split("/").slice(1).join("/")}` : undefined);
        state.start = 0;
        if (message) message.value = "";
        for (const field of el.querySelectorAll("[data-postcard-field]")) field.value = "";
        restore();
        enforce();
        refreshMail();
        announceDraft(hasDraft(key));
        /* THE PAIR IS RE-BLOCKED HERE AND NOT LEFT TO paint(). Both flags are
           functions of `index` and deck.length alone, both are known now, and
           paint() may be a whole image download away — a button that says it is
           live when it is not is the lie step() had to stop trusting. */
        if (deck) {
            block("earlier", index <= 0);
            block("later", index >= deck.length - 1);
        }
        /* NOTHING DRAWS THE NEW POST ON THIS FRAME. The card keeps showing the
           PREVIOUS post's text until this resolves — one microtask for a post
           with no pictures, a whole image download for one with them. It is the
           deferral open() makes too, and it is deliberate: paintPreview reads
           the bitmaps to budget the window, so painting first would draw the
           passage against placeholder heights and then re-flow it. The cost is
           a visible lag on a slow picture, not a wrong final card. */
        loadFigures(data).then(paint);
    }

    function open() {
        opener = document.activeElement;
        el.hidden = false;
        document.body.style.overflow = "hidden";
        restore();
        Promise.all([loadCardFonts(), loadFigures(data)]).then(paint);
        el.querySelector(FOCUSABLE)?.focus();
    }

    /*
     * CLOSING SAVES. There is no explicit save and there should not be one —
     * the sender did not come here to manage a document, and the only moment
     * that reliably happens before they lose their typing is this one. It fires
     * for the close button, the scrim, and Escape alike, because all three land
     * here.
     *
     * writeDraft() deletes an empty one, so clearing the fields and closing
     * takes the badge off the share button without a second code path.
     */
    function close() {
        // A hold that was still running has nothing left to drive: end it here
        // rather than let its interval outlive the popover.
        stopRepeat();
        writeDraft(collect(), key);
        announceDraft(hasDraft(key));
        el.hidden = true;
        document.body.style.overflow = "";
        opener?.focus?.();
    }

    /* Only the key that started the repeat may end it, so releasing some other
       key mid-hold does not cut the hold short. */
    const onKeyup = (event) => {
        if (event.key === repeatKey) stopRepeat();
    };

    /* A hold that was interrupted rather than released — the window lost focus,
       the tab went to the background, a context menu opened over the button —
       leaves no keyup and no pointerup to end it. Ending it here is what keeps
       a timer from outliving the press that started it. */
    const onInterrupt = (event) => {
        releaseNub(event);
        onEdgeUp(event);
        endSwipe();
        stopRepeat();
    };

    el.addEventListener("click", onClick);
    el.addEventListener("pointerdown", onPointerDown);
    stage?.addEventListener("pointerdown", onStagePointerDown);
    /* On the edge itself and not on the document: pointer capture redirects the
       whole gesture here, so these three are the complete set. */
    edge?.addEventListener("pointerdown", onEdgeDown);
    edge?.addEventListener("pointermove", onEdgeMove);
    edge?.addEventListener("pointerup", onEdgeUp);
    edge?.addEventListener("pointercancel", onEdgeUp);
    /* passive: false because onStageWheel calls preventDefault; a wheel listener
       is passive by default on the document and its ancestors, and a passive one
       that prevents nothing would let the gesture scroll the page as well. */
    stage?.addEventListener("wheel", onStageWheel, { passive: false });
    document.addEventListener("pointermove", onStagePointerMove);
    el.addEventListener("input", onInput);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onInterrupt);
    document.addEventListener("keydown", onKeydown);
    document.addEventListener("keyup", onKeyup);
    window.addEventListener("blur", onInterrupt);
    window.addEventListener("resize", onResize);

    /* Attached once, on mount rather than on open, because it owns listeners on
       the line1 input and that input is the same node for the popover's whole
       life. Its own teardown is returned and folded into destroy() below. */
    const detachAutocomplete = attachAutocomplete(el);

    /* THE LABELS ARE THE TRUTH OR THEY ARE A LIE. With a deck the pair no
       longer moves a passage, so the names a screen reader reads must change
       with the behaviour. §6.3. */
    if (deck) {
        control("earlier")?.setAttribute("aria-label", "Show the previous post");
        control("later")?.setAttribute("aria-label", "Show the next post");
        /* AND THE +/- PAIR GOES, because there is no line count on a quote card
           to be one more or one fewer of. The whole passage shows and the TYPE
           SIZE is what moved to make that true, which is not a thing the sender
           sets — see fitQuoteType. A control that is visible and refuses every
           press is the failure this editor's aria-disabled state exists to
           avoid, not an instance of it.

           visibility, NOT `hidden`, AND THAT IS THE WHOLE REASON THIS IS NOT A
           ONE-WORD CHANGE. The toolbar is space-between over THREE groups and
           the middle one is the Front/Back toggle — postcard.css says in as
           many words that the toggle stays on the card's centreline "whatever
           the arrows are doing", and it only does so because the two end groups
           balance. Removing the right-hand group from flow leaves two children
           and space-between throws the toggle to the right edge. visibility
           keeps the box, so the toggle does not move, and it still takes the
           buttons out of the tab order and out of the accessibility tree. */
        const counter = control("more")?.closest(".qntns-postcard__group");
        if (counter) counter.style.visibility = "hidden";
    }

    showSide("front");
    refreshMail();
    /* Both before the first paint, never during one: paintFront is synchronous
       and runs on every frame of a drag. See loadFigures(). */
    Promise.all([loadCardFonts(), loadFigures(data)]).then(paint);

    return {
        open,
        close,
        collect,
        destroy: () => {
            detachAutocomplete();
            stopRepeat();
            clearTimeout(wheelIdle);
            el.removeEventListener("click", onClick);
            el.removeEventListener("pointerdown", onPointerDown);
            stage?.removeEventListener("pointerdown", onStagePointerDown);
            edge?.removeEventListener("pointerdown", onEdgeDown);
            edge?.removeEventListener("pointermove", onEdgeMove);
            edge?.removeEventListener("pointerup", onEdgeUp);
            edge?.removeEventListener("pointercancel", onEdgeUp);
            stage?.removeEventListener("wheel", onStageWheel);
            document.removeEventListener("pointermove", onStagePointerMove);
            el.removeEventListener("input", onInput);
            document.removeEventListener("pointerup", onPointerUp);
            document.removeEventListener("pointercancel", onInterrupt);
            document.removeEventListener("keydown", onKeydown);
            document.removeEventListener("keyup", onKeyup);
            window.removeEventListener("blur", onInterrupt);
            window.removeEventListener("resize", onResize);
            document.body.style.overflow = "";
        }
    };
};
