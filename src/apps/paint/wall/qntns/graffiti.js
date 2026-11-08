/*
 * QNTNs graffiti wall — a shared whiteboard in the footer, under Fund.
 * CHECKLIST-29 §1–§10, §2a §3b (Phase 1: Storybook, no network).
 *
 * renderGraffiti(state) is the markup; attachGraffiti(root, opts) wires it.
 * The Ghost partial (§15) transcribes renderGraffiti the way fund-section.hbs
 * transcribes renderFund. Signed out, "Login to draw" is a link that opens
 * Ghost Portal's signup (§19a); the wall has no email form of its own.
 *
 * GEOMETRY (§1 §5, answers-3). The section and its box sit in the footer's
 * content column; the canvas is full-bleed (viewport edge to edge). The
 * Subscribe / artist-name corner (left) and Undo, Hand, Pencil, Pen, Eraser, − and + (right)
 * share a 32px strip ABOVE the box, on the column's edges, sticky to the
 * viewport's top while the wall is in view (§3c); no control sits on the canvas. The wall is unbounded in wall units both
 * ways. The default view is a fixed screen scale (§4b): grid dots DOT_PX apart
 * on every screen, so a phone shows less wall than a desktop rather than
 * shrinking the ink. Wall x = 0 is the column's left edge and wall y = 0 the
 * box's top; the full-bleed canvas shows (or crops) whatever lies past them.
 *
 * THE PAGE OWNS Y (answers-3). The wall pans X only; there is no wall Y pan.
 * The box is the whole wall's height at the current scale, and the page
 * scrolls it. The canvas is only the visible slice: a sticky view, at most one
 * viewport tall, so a tall zoomed wall never asks for a giant bitmap.
 *
 *   scale  s  = DOT_PX / GRID * zoom          (0.5 px per wall unit at zoom 1)
 *   screen x  = (wall x - cam.x) * s + ox      ox = column's left inside canvas
 *   screen y  = wall y * s - oy                oy = canvas top below box top
 *
 * Ink is drawn through that transform, so it scales with zoom, and a stroke
 * drawn zoomed in keeps the same wall-unit nib as everyone else's (§4).
 *
 * THE BOX GROWS WITH THE ART (§5, §4 answers-3). Its height in px is the lowest
 * ink at the current scale plus ROOM_CELLS grid cells (30 · GRID wall units, so
 * zoom never changes the count), never less than BOX_MIN, rounded up
 * to 4. Drawing into the margin grows it; zooming scales it, and the page is
 * scrolled so the zoom point stays put.
 *
 * FOG OF WAR (§5, answers-3). X only: the view may go no further than ROOM_CELLS
 * grid cells (§21a) past the leftmost / rightmost ink. The home view is
 * always allowed, so an empty wall is held to it.
 *
 * HOME VIEW (§5a). Load is zoom 1, wall y = 0 at the box top, and the centre
 * of the ink's bounding box (as loaded) on the column's centre:
 *   cam.x = (ink.x0 + ink.x1) / 2 - column width / 2 / base
 * An empty wall keeps the old default, wall x = 0 at the column's left edge.
 *
 * ARTIST TIP (§10a). Under Hand a click that never moved past AXIS_PX picks
 * the topmost stroke within PICK_PX and shows its artist's display name at
 * the click point; the member id never reaches the DOM. Any pointerdown, Esc,
 * a pan or a zoom closes it. Hovering a line under Hand shows a pointer.
 */
import { icon } from "../icon-set.js";
import { showToast } from "./toast.js";
import { wetGl } from "./watercolor-gl.js";
// §25: vendored (MIT, one file, inside assets/), not an npm package.
import { getStrokeOutlinePoints } from "../vendor/perfect-freehand.js";

// The nib: one angle and one base width for everyone (§2). 45deg rising to the
// right is the classic italic pen angle. §22: 8 -> 10, +25%. Wall units, not
// CSS px, so the base-4 rule does not bind it. Width is worked out at paint
// time, so every stroke already on the wall is 25% bolder too.
export const NIB_W = 10;
export const NIB_ANGLE = -Math.PI / 4;
// A stroke travelling along the nib has zero projected width; the hairline is
// the pen's edge, so it still shows.
export const HAIRLINE = 1;
// The default view (§4b): the grid dots are this many screen px apart at
// zoom 1 on every screen width. With GRID 40 wall units that is 0.5 px per
// wall unit, the scale a 1200px column had before.
export const DOT_PX = 20;
// Zoom is a multiple of the default view. MAX_ZOOM 16 keeps the closest view
// where it was (8 x the old default = 16 x this one).
export const MAX_ZOOM = 16;
// Each press of − / + (answers-5: smaller than x2). FLAG for the user.
export const ZOOM_STEP = 1.5;
// answers-7: two − presses past the default (1 / 1.5² ≈ 0.44, the wall at
// under half the default size). The fog still clamps X. FLAG for the user.
export const MIN_ZOOM = ZOOM_STEP ** -2;
// §23: no pinch zoom, two-finger or trackpad; − / + are the only zoom.
// Movement, px, before a Hand drag commits to an axis (answers-7). A slop, not
// a spacing.
const AXIS_PX = 4;
// Box height floor, px, base 4 (§5, §5a).
export const BOX_MIN = 480;
// §10a: a Hand click within this many screen px of a line picks it, at any
// zoom (PICK_PX / scale wall units, passed to hits() as its radius).
export const PICK_PX = 8;
// §2b: Catmull-Rom samples every SAMPLE_STEP wall units of chord (at least
// one per span). The curve's parameter speed is uneven, so real gaps run to
// about 1.1 units (measured, §2b check); at MAX_ZOOM a unit is 8 px, and a
// 1.1-unit chord on an 8-unit radius sags 1.1² / 64 unit ≈ 0.15 px, so no
// facet shows.
export const SAMPLE_STEP = 0.5;
// Dot spacing of the wall's grid, wall units. The grid is what shows a pan or
// zoom happened where there is no ink in view.
const GRID = 40;
// §21a: room past the ink, in grid cells: below the lowest ink, and each side
// of the leftmost / rightmost ink. Wall units, so zoom never changes the count
// (zoomed in it is more px to scroll). ROOM_CELLS * GRID = 1200 wall units.
export const ROOM_CELLS = 30;
// §49 the wide band: bake tile width, bitmap px; the band's total bitmap px (two
// 4096² canvases' worth, 128 MB; FLAG for the user); a tile is painted ahead
// only after IDLE_MS with no frame. Measured spans are in the handoff.
const BAKE_TILE = 1024;
const BAND_AREA = 2 * 4096 * 4096;
const IDLE_MS = 250;
// §49 fling and overscroll, FLAG for the user. FLING_TAU: the release
// velocity decays as e^(-t / FLING_TAU), so a fling travels v × FLING_TAU
// (iOS's normal rate is ~500 ms; this is snappier). FLING_MAX caps v, px/s, so
// the longest fling is 3000 × 0.325 = 975 px. RUBBER: a drag past the end
// shows at most this many px. SPRING: ω, 1/s, of the critically damped spring
// that brings an overscroll back (and stops a fling that runs into the end
// within FLING_MAX / (SPRING × e) = 69 px).
const FLING_TAU = 325;
const FLING_MAX = 3000;
const RUBBER = 128;
const SPRING = 16;

const ANIMALS = ["Otter", "Fox", "Heron", "Badger", "Moth", "Wren", "Hare", "Newt", "Lynx", "Crow", "Stoat", "Vole", "Finch", "Toad", "Seal", "Owl", "Mole", "Ibis", "Yak", "Gecko"];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot" }[c]};`);

/* ---- Artist name (§9) --------------------------------------------------- */

// An animal + "Artist" no one holds; numbered once every animal is taken.
// Phase 1 checks a local list; the server claim is §13.
export const defaultArtistName = (taken = [], rand = Math.random) => {
    const held = new Set(taken.map((t) => t.toLowerCase()));
    const free = ANIMALS.map((a) => `${a}Artist`).filter((n) => !held.has(n.toLowerCase()));
    if (free.length) return free[Math.floor(rand() * free.length)];
    for (let n = 2; ; n++) {
        const name = `${ANIMALS[Math.floor(rand() * ANIMALS.length)]}Artist${n}`;
        if (!held.has(name.toLowerCase())) return name;
    }
};

// One word: whitespace never survives.
export const cleanName = (s) => s.replace(/\s+/g, "");

/* ---- Ink (§2 §2a) ------------------------------------------------------- */

/*
 * PRESSURE (§2, answers-2). Only a pen reports real pressure; a mouse or a
 * finger reports 0.5 while pressed (or 0), and gets the base nib. A pen's nib
 * is base x (0.5 + p): 0 -> half, 50% -> base, 100% -> 1.5x. The centreline
 * hairline is the floor under all of them. Stored per point as a third value,
 * omitted when it is 1, so everyone sees the same ink.
 */
export const widthFactor = (e) =>
    e.pointerType === "pen" && e.pressure > 0 ? 0.5 + Math.min(1, e.pressure) : 1;
/* §46b TILT. A pen's altitude (altitudeAngle, radians, π/2 upright; else from
   tiltX / tiltY, degrees) as 0 upright .. 1 flat, two decimals; 0 for a mouse
   or a finger, which report none. Stored per point as a FOURTH value after the
   width factor (which is then written even at 1), omitted when 0, so every
   viewer sees the shading. It rides through the ink pipeline as the point's
   fourth channel (shape[5]); only graphite reads it (drawGraphite). */
export const tiltOf = (e) => {
    if (e.pointerType !== "pen") return 0;
    const alt = e.altitudeAngle ?? Math.atan(1 / Math.hypot(Math.tan(((e.tiltX || 0) * Math.PI) / 180), Math.tan(((e.tiltY || 0) * Math.PI) / 180)));
    return Math.max(0, Math.min(1, +(1 - alt / (Math.PI / 2)).toFixed(2))) || 0;
};

/* §48: a stroke's points as posted. An Apple Pencil's coalesced events come
   at ~240 Hz, so a stroke past ~8.3 s held more than the Worker's MAX_POINTS
   (2000, worker/src/graffiti.js) and was refused 400 — lost on reload. The
   Worker already runs this same Douglas-Peucker at 0.5 wall units on what it
   keeps, so thinning first changes nothing it stores (a 60 s stroke: 14,400
   points -> ~1,300). Past MAX_POINTS even then, the tolerance doubles until
   it fits. ponytail: a copy of the Worker's simplify; worker/ does not ship. */
const MAX_POINTS = 2000;
const dp = (pts, tol) => {
    if (pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
        const [a, b] = stack.pop();
        const [ax, ay] = pts[a], [bx, by] = pts[b];
        const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
        let worst = -1, at = -1;
        for (let i = a + 1; i < b; i++) {
            const [px, py] = pts[i];
            const d = len ? Math.abs(dy * (px - ax) - dx * (py - ay)) / len : Math.hypot(px - ax, py - ay);
            if (d > worst) [worst, at] = [d, i];
        }
        if (worst > tol) { keep[at] = 1; stack.push([a, at], [at, b]); }
    }
    return pts.filter((_, i) => keep[i]);
};
export const thinForPost = (pts) => {
    let tol = 0.5, out = dp(pts, tol);
    while (out.length > MAX_POINTS) out = dp(pts, (tol *= 2));
    return out;
};

/*
 * §2a: STABILIZED, TAPERED, FEATHERED. Every effect is computed at draw time
 * from the stored points (§10) and the stroke id, in wall units, so every
 * viewer and every redraw sees the same ink at any zoom. The pipeline:
 *   raw points -> speed thinning -> lazy brush -> Catmull-Rom -> taper
 *   -> feathered nib outline (+ a faint bleed halo under it)
 * All the knobs, wall units unless said (at default zoom 1 unit = half a px
 * on a 1200px column). FLAG for the user: every value below is a first guess.
 */
// Lazy brush (Procreate StreamLine, Krita Stabilizer): the drawn point trails
// the pointer on a string this long and only moves when the string is taut.
// In wall units, so zoomed in the string is longer on screen. 0 turns it off.
// §21 (user): 12 -> 4, less trail at speed; Catmull-Rom and the width passes
// still smooth. §26 (user): speed-adaptive, the string is STRING_SLOW when the
// pen crawls (gap <= 1 unit per sample) and shortens to STRING_FAST at
// SPEED_FULL units or more, so fast writing joins up and slow drawing stays
// steady (the 1-euro filter's idea; no time is stored, so speed is the sample
// gap, smoothed by GAP_EMA). Wall units, so base-4 does not bind them. Applied
// at paint time, so every stroke on the wall redraws with it. Tune on the build.
export const STRING_SLOW = 4;
export const STRING_FAST = 0.25;
// §54 (user): "fast" starts earlier and the fastest trails less. The string
// ramps over gaps 1..STRING_SPEED (was SPEED_FULL 12, now 6: half the speed
// counts as fast) down to STRING_FAST (was 1, now 0.25: a quarter the trail).
// SPEED_FULL stays 12 for nib thinning. The line tools keep the old 1 / 12
// (LINE_FAST, LINE_SMOOTHING.top). Watercolor keeps the pre-§54 1 / 12
// (§54a, WATER_SMOOTH below). Paint-time: every fountain stroke on the wall redraws with it.
export const STRING_SPEED = 6;
const LINE_FAST = 1;
export const GAP_EMA = 0.5; // weight of the newest gap in the smoothed gap
// Taper from 0 over the first / last stretch of the stroke; a stroke shorter
// than both together shrinks both, so it still reaches the full nib.
export const TAPER_IN = 16;
export const TAPER_OUT = 32;
// Speed thinning. No time is stored (§10), so speed is the gap between input
// samples: at SPEED_FULL units per sample or more the nib is SPEED_THIN
// (fraction) thinner. ponytail: sample spacing is the proxy; it varies with
// device sample rate and zoom.
export const SPEED_THIN = 0.2;
export const SPEED_FULL = 12;
// Feather: each edge of the nib wobbles by up to FEATHER (fraction of its
// half width), smooth noise with this wavelength, seeded from the stroke id.
// §2b: low and long, a slow swell; the fine edge is the grain below.
export const FEATHER = 0.04;
export const FEATHER_LEN = 32;
// §2b width smoothing: the width factor (pressure x speed) is run through a
// forward-then-backward exponential average over arc length with this time
// constant, wall units, WIDTH_PASSES times, before the taper, so it swells
// instead of rippling. Two passes cut a ripple far harder than one longer
// pass, without dragging a real pressure swell further along the stroke.
export const WIDTH_SMOOTH = 16;
export const WIDTH_PASSES = 2;
// §2b soft edge, replacing the §2a gray halo: the ink casts its own colour
// as a blur EDGE_SOFT wall units wide, so the edge falls off in the ink.
export const EDGE_SOFT = 0.5;
// §2b grain: an ink-on-paper feather along the edge only. A GRAIN_TILE x
// GRAIN_TILE tile of speckles, each GRAIN_CELL wall units (so it scales with
// zoom), GRAIN_DENSITY of them inked at up to GRAIN_ALPHA, is stroked along
// the outline in a band GRAIN_BAND wall units wide; the inner half lands on
// ink and vanishes, the outer half reads as fibres the ink wicked into. Its
// offset is seeded from the stroke id, so each stroke's grain is its own.
export const GRAIN_TILE = 64;
export const GRAIN_CELL = 0.5;
export const GRAIN_DENSITY = 0.3;
export const GRAIN_ALPHA = 0.35;
export const GRAIN_BAND = 2;
const GRAIN_SEED = 0x2b;
/*
 * §40 §40a PROFILE PER TOOL. A tool's profile scales the stages above:
 * slow / fast the lazy-brush string, bend the Catmull-Rom's pull off the
 * straight chord (1 = full spline, 0 = straight segments through the lazy
 * points), width WIDTH_SMOOTH (0 = off), vary the width factor's swing
 * about 1 (pressure x speed thinning x taper; 1 = full, 0.5 = half).
 * The fountain pen (key pen, absent) and watercolor keep the full pipeline.
 * §40 the line tool (key pencil, labelled Pen) and §40a graphite (labelled
 * Pencil), before -> after:
 *   smoothing at LINE_SMOOTH: STRING_SLOW 4 -> 0.6, STRING_FAST 1 -> 0.15,
 *     bend 1 -> 0.15, WIDTH_SMOOTH 16 -> 2.4 (WIDTH_PASSES 2 unchanged)
 *   variation at LINE_VARY: pressure 0.5..1.5 -> 0.75..1.25, speed thinning
 *     SPEED_THIN 0.2 -> 0.1, taper from 0 -> from 0.5 of the line (TAPER_IN 16
 *     / TAPER_OUT 32 lengths unchanged: half the depth, not half the length).
 *     One knob on the final width factor, so all three halve together.
 */
export const LINE_SMOOTH = 0.15;
export const LINE_VARY = 0.5;
export const FULL_SMOOTH = { slow: STRING_SLOW, fast: STRING_FAST, top: STRING_SPEED, bend: 1, width: WIDTH_SMOOTH, vary: 1 };
export const LINE_SMOOTHING = { slow: STRING_SLOW * LINE_SMOOTH, fast: LINE_FAST * LINE_SMOOTH, top: SPEED_FULL, bend: LINE_SMOOTH, width: WIDTH_SMOOTH * LINE_SMOOTH, vary: LINE_VARY };
// §54a: watercolor keeps the pre-§54 string: fast 1, top 12.
export const WATER_SMOOTH = { ...FULL_SMOOTH, fast: LINE_FAST, top: SPEED_FULL };
// Absent tool is the fountain pen, as the Worker says.
export const smoothingOf = (tool) => (tool === "pencil" || tool === "graphite" ? LINE_SMOOTHING : tool === "watercolor" ? WATER_SMOOTH : FULL_SMOOTH);
const vary = (w, sm) => w + (1 - sm.vary) * (1 - w); // exact at vary 1
// One width-smoothing step's carry over a gap: 0 when width smoothing is off.
const carry = (gap, sm) => (sm.width ? Math.exp(-gap / sm.width) : 0);

// Thinner where the samples are far apart (fast). p / n: the neighbours.
const thin = ([x, y, f = 1, t], p, n) => {
    const gap = (Math.hypot(x - p[0], y - p[1]) + Math.hypot(n[0] - x, n[1] - y)) / 2;
    return [x, y, f * (1 - SPEED_THIN * Math.min(1, gap / SPEED_FULL)), t];
};
export const speedThin = (raw) => raw.map((q, i) => thin(q, raw[i - 1] ?? q, raw[i + 1] ?? q));

// One lazy-brush step, shared by stabilize and liveInk so they agree. b is the
// brush { x, y, px, py, g }: position, previous raw point, smoothed gap. Every
// raw point updates the gap, even one the string swallows. Returns true when
// the brush moved.
const gapOf = (b, px, py, sm = FULL_SMOOTH) => {
    const g = b.px === undefined ? 0 : Math.hypot(px - b.px, py - b.py);
    b.g = b.g === undefined ? g : b.g + GAP_EMA * (g - b.g);
    b.px = px; b.py = py;
    return sm.slow + (sm.fast - sm.slow) * Math.min(1, Math.max(0, (b.g - 1) / (sm.top - 1)));
};
export const lazyStep = (b, px, py, sm = FULL_SMOOTH) => {
    const str = gapOf(b, px, py, sm);
    const d = Math.hypot(px - b.x, py - b.y);
    if (d <= str) return false;
    const k = (d - str) / d;
    b.x += (px - b.x) * k;
    b.y += (py - b.y) * k;
    return true;
};

// The lazy brush. `done` (the pen lifted) catches the stroke up to the last
// raw point, so it ends where the pen did; a live stroke keeps its lag.
export const stabilize = (raw, done = true, sm = FULL_SMOOTH) => {
    if (!raw.length) return [];
    const b = { x: raw[0][0], y: raw[0][1] };
    const out = [[b.x, b.y, raw[0][2], raw[0][3]]];
    for (const [px, py, f, t] of raw) if (lazyStep(b, px, py, sm)) out.push([b.x, b.y, f, t]);
    const { x, y } = b;
    const last = raw[raw.length - 1];
    if (done && (x !== last[0] || y !== last[1])) out.push([last[0], last[1], last[2], last[3]]);
    return out;
};

// One Catmull-Rom span, pts[i] to pts[i + 1], sampled into out; bend scales
// its pull off the chord (§40), so bend 0 is the straight segment.
const span = (pts, i, out, bend = 1) => {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const n = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / SAMPLE_STEP));
    for (let s = 0; s < n; s++) {
        const t = s / n, t2 = t * t, t3 = t2 * t;
        out.push([0, 1, 2, 3].map((k) => {
            const a = p0[k], b = p1[k], c = p2[k], d = p3[k];
            const lin = b + (c - b) * t;
            return lin + bend * (0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3) - lin);
        }));
    }
};

// Uniform Catmull-Rom through [x, y, f, t] points (f, the width factor, and
// t, the §46b tilt, are smoothed with them), so fast strokes with sparse
// samples curve, not kink.
export const smooth = (raw, bend = 1) => {
    const pts = raw.map(([x, y, f = 1, t = 0]) => [x, y, f, t]);
    if (pts.length < 3) return pts;
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) span(pts, i, out, bend);
    out.push(pts[pts.length - 1]);
    return out;
};

// Seeded value noise in [-1, 1] along the stroke: FNV-1a of the id, a
// mulberry32 step per lattice point, smoothstep between. Pure, so redraws match.
const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const rnd = (seed, i) => {
    let t = (seed + Math.imul(i, 0x9e3779b1)) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 2 ** 31) - 1;
};
const noise = (seed, d) => {
    const u = d / FEATHER_LEN, i = Math.floor(u), t = u - i, a = rnd(seed, i);
    return a + (rnd(seed, i + 1) - a) * t * t * (3 - 2 * t);
};

/*
 * The drawn centreline: [x, y, w, nl, nr, t] per point, w the final width factor
 * (pressure x speed x taper), nl / nr the feather noise of the two edges, t the
 * §46b tilt (0 when the point carried none).
 * The taper eases out of 0 (t(2 - t)), as a nib does when it touches down.
 */
export const inkShape = ({ id = "", points, tool, size = 1 }, done = true) => {
    const sm = smoothingOf(tool);
    const c = smooth(stabilize(speedThin(points), done, sm), sm.bend);
    let L = 0;
    const d = c.map((p, i) => (L += i ? Math.hypot(p[0] - c[i - 1][0], p[1] - c[i - 1][1]) : 0));
    const k = Math.min(1, L / (TAPER_IN + TAPER_OUT)), seed = hash(id);
    // §2b: forward then backward exponential average of f over arc length.
    const f = c.map((p) => p[2]);
    for (let pass = 0; pass < WIDTH_PASSES; pass++) {
        for (let i = 1; i < f.length; i++) f[i] += (f[i - 1] - f[i]) * carry(d[i] - d[i - 1], sm);
        for (let i = f.length - 2; i >= 0; i--) f[i] += (f[i + 1] - f[i]) * carry(d[i + 1] - d[i], sm);
    }
    return c.map(([x, y, , tilt], i) => {
        const t = L ? Math.min(1, d[i] / (TAPER_IN * k), (L - d[i]) / (TAPER_OUT * k)) : 1;
        return [x, y, vary(f[i] * t * (2 - t), sm) * size, noise(seed, d[i]), noise(seed ^ 0x5bd1e995, d[i]), tilt];
    });
};

/*
 * §21 THE LIVE STROKE, INCREMENTAL. inkShape(st) per frame re-runs the whole
 * stroke, O(points) and growing. liveInk keeps every stage's settled part:
 *   speedThin  point j is final once j + 1 exists
 *   stabilize  carried state; fed only final points
 *   smooth     span i is final once lazy point i + 2 exists
 *   widths     the passes run on a window; a sample more than FREEZE wall
 *              units behind the tip is frozen. After two forward/backward
 *              passes the tip's pull FREEZE back is about
 *              (FREEZE / WIDTH_SMOOTH) e^(-FREEZE / WIDTH_SMOOTH) ≈ 0.003 of
 *              a width change: under 0.02 wall units of nib (checked against
 *              inkShape in the §21 handoff). Taper-out (TAPER_OUT) and the
 *              taper-in's stretch (k < 1 below TAPER_IN + TAPER_OUT) are
 *              inside it.
 * frame(extra) returns { tail, z }: the samples from z - 1 on, recomputed this
 * frame, and z, the frozen count; out[0, z) never changes again, so the
 * caller paints it once. extra: predicted points, drawn, never stored.
 * The tip is the lazy brush caught up to the pen (inkShape's done = true), so
 * the ink reaches the pen every frame and is what lands if the pen lifts now.
 * points is the stroke's own array; frame reads what was pushed since.
 */
export const FREEZE = 128;
export const liveInk = (id, points, sm = FULL_SMOOTH, size = 1) => {
    const seed = hash(id), seed2 = seed ^ 0x5bd1e995;
    const lazy = []; // stabilize's points from final input
    let base = {}, fed = 0; // the brush (lazyStep's), and input points fed to it
    const step = (b, [px, py, f, t = 0], to) => {
        if (!to.length) { b.x = px; b.y = py; gapOf(b, px, py, sm); to.push([px, py, f, t]); return; }
        if (lazyStep(b, px, py, sm)) to.push([b.x, b.y, f, t]);
    };
    const c = [], d = []; // samples (settled first, then this frame's tail), arc length
    let cs = 0, spans = 0; // settled samples, settled spans
    const pass = Array.from({ length: WIDTH_PASSES * 2 }, () => []); // forward, backward, …
    const out = [];
    let z = 0;
    const frame = (extra = []) => {
        const n = points.length;
        if (!n) return { tail: [], z: 0 };
        c.length = d.length = cs;
        // Settle: input 0 .. n - 2 is final.
        const b = { ...base };
        for (; fed < n - 1; fed++) step(b, thin(points[fed], points[fed - 1] ?? points[fed], points[fed + 1]), lazy);
        base = { ...b };
        for (; spans <= lazy.length - 3; spans++) {
            span(lazy, spans, c, sm.bend);
            for (; cs < c.length; cs++) d[cs] = cs ? d[cs - 1] + Math.hypot(c[cs][0] - c[cs - 1][0], c[cs][1] - c[cs - 1][1]) : 0;
        }
        // Provisional: the last input point and the prediction, then catch up.
        const raw = [points[n - 1], ...extra];
        const th = raw.map((q, i) => thin(q, raw[i - 1] ?? points[n - 2] ?? q, raw[i + 1] ?? q));
        const lz = lazy.slice(-3);
        const head = lazy.length - lz.length;
        for (const q of th) step(b, q, lz);
        const last = th[th.length - 1];
        if (b.x !== last[0] || b.y !== last[1]) lz.push(last);
        if (head + lz.length < 3) for (const p of lz) c.push(p);
        else {
            for (let i = spans - head; i < lz.length - 1; i++) span(lz, i, c, sm.bend);
            c.push(lz[lz.length - 1]);
        }
        for (let i = cs; i < c.length; i++) d[i] = i ? d[i - 1] + Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]) : 0;
        const N = c.length, L = d[N - 1], k = Math.min(1, L / (TAPER_IN + TAPER_OUT));
        // The width passes, from z on (in-place passes in inkShape; one array
        // per pass here so the frozen part keeps each pass's value).
        const e = (i) => carry(d[i] - d[i - 1], sm);
        let src = null;
        for (let p = 0; p < WIDTH_PASSES * 2; p += 2) {
            const fw = pass[p], bw = pass[p + 1], f = (i) => (src ? src[i] : c[i][2]);
            for (let i = z; i < N; i++) fw[i] = i ? f(i) + (fw[i - 1] - f(i)) * e(i) : f(i);
            for (let i = N - 1; i >= z; i--) bw[i] = i === N - 1 ? fw[i] : fw[i] + (bw[i + 1] - fw[i]) * e(i + 1);
            src = bw;
        }
        const at = (i) => {
            const t = L ? Math.min(1, d[i] / (TAPER_IN * k), (L - d[i]) / (TAPER_OUT * k)) : 1;
            return [c[i][0], c[i][1], vary(src[i] * t * (2 - t), sm) * size, noise(seed, d[i]), noise(seed2, d[i]), c[i][3] ?? 0];
        };
        for (; k === 1 && z < cs - 1 && d[z] < L - FREEZE; z++) out[z] = at(z);
        const tail = [];
        for (let i = Math.max(0, z - 1); i < N; i++) tail.push(i < z ? out[i] : at(i));
        return { tail, z };
    };
    return { frame, out };
};

const NIB = [Math.cos(NIB_ANGLE), Math.sin(NIB_ANGLE)];

/*
 * THE BROAD NIB. The nib is a fixed-angle segment of half length
 * NIB_W / 2 x w (feathered per edge); moving it
 * from a to b sweeps the quad a+, b+, b-, a-. Its width across the travel
 * direction is the nib's projection on the perpendicular, so a stroke across
 * the nib is full width and one along it is a hairline. The union of the quads
 * is the stroke, filled as polygons, so there are no gaps at any speed. Every
 * quad is wound the same way (flipped when travel crosses the nib), so nonzero
 * fill never cancels an overlap into a hole. Neighbouring quads share their
 * corners, so the feathered edge stays one unbroken line.
 */
// The nib's two ends at each point: [[left x, y], [right x, y]].
export const nibEdges = (shape) => shape.map(([x, y, w, nl, nr]) => {
    const a = (NIB_W / 2) * w, l = a * (1 + FEATHER * nl), r = a * (1 + FEATHER * nr);
    return [[x + NIB[0] * l, y + NIB[1] * l], [x - NIB[0] * r, y - NIB[1] * r]];
});

export const nibQuads = (shape, e = nibEdges(shape)) => {
    const [ux, uy] = NIB;
    const quads = [];
    for (let i = 0; i < shape.length - 1; i++) {
        const [a1, a2] = e[i], [b1, b2] = e[i + 1];
        const q = [a1, b1, b2, a2];
        if ((shape[i + 1][0] - shape[i][0]) * uy - (shape[i + 1][1] - shape[i][1]) * ux < 0) q.reverse();
        quads.push(q);
    }
    return quads;
};

/*
 * §2b grain tile, built once per ink colour: deterministic speckles (rnd with a
 * fixed seed), ink-coloured, GRAIN_DENSITY of the cells at up to GRAIN_ALPHA.
 */
const grainTile = (ink) => {
    const c = document.createElement("canvas");
    c.width = c.height = GRAIN_TILE;
    const g = c.getContext("2d");
    g.fillStyle = ink;
    for (let i = 0; i < GRAIN_TILE * GRAIN_TILE; i++) {
        const r = (rnd(GRAIN_SEED, i) + 1) / 2;
        if (r > GRAIN_DENSITY) continue;
        g.globalAlpha = GRAIN_ALPHA * (1 - r / GRAIN_DENSITY);
        g.fillRect(i % GRAIN_TILE, Math.floor(i / GRAIN_TILE), 1, 1);
    }
    return c;
};

/*
 * One stroke. The quads are one path and one fill, so the stroke is a single
 * continuous region (nonzero; a ribbon outline would cancel into holes where a
 * stroke crosses itself). `grain` (a CanvasPattern) is stroked along the
 * ribbon outline, offset by the stroke's seed.
 */
// Quads per fill. One fill of every quad is superlinear in Chrome: a
// 1,960-point stroke is ~50,000 overlapping quads and took 5.3 s, which froze
// the home page for 28 s (2026-10-15). In fills of 64 it takes 12 ms.
const QUAD_BATCH = 64;
export const drawStroke = (ctx, shape, grain, seed = 0) => {
    const e = nibEdges(shape);
    const quads = nibQuads(shape, e);
    for (let k = 0; k < quads.length; k += QUAD_BATCH) {
        ctx.beginPath();
        for (const q of quads.slice(k, k + QUAD_BATCH)) {
            ctx.moveTo(q[0][0], q[0][1]);
            for (let i = 1; i < 4; i++) ctx.lineTo(q[i][0], q[i][1]);
            ctx.closePath();
        }
        ctx.fill();
    }
    ctx.beginPath();
    if (shape.length === 1) {
        // A tap: the nib's own mark.
        const [x, y, w] = shape[0], r = (NIB_W / 2) * w;
        ctx.moveTo(x - NIB[0] * r, y - NIB[1] * r);
        ctx.lineTo(x + NIB[0] * r, y + NIB[1] * r);
    } else {
        ctx.moveTo(shape[0][0], shape[0][1]);
        for (const [x, y] of shape) ctx.lineTo(x, y);
    }
    ctx.stroke();
    if (!grain || shape.length < 2) return;
    grainAlong(ctx, grain, seed, [...e.map(([l]) => l), ...e.map(([, r]) => r).reverse()]);
};

// §2b grain, stroked along a closed outline [[x, y]…], offset by the seed.
const grainAlong = (ctx, grain, seed, ring) => {
    const span = GRAIN_TILE * GRAIN_CELL;
    grain.setTransform(new DOMMatrix([GRAIN_CELL, 0, 0, GRAIN_CELL, rnd(seed, 1) * span, rnd(seed, 2) * span]));
    ctx.save();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = grain;
    ctx.lineWidth = GRAIN_BAND;
    ctx.beginPath();
    ctx.moveTo(...ring[0]);
    for (const p of ring) ctx.lineTo(p[0], p[1]);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
};

/*
 * §25 THE LINE TOOL (key pencil; labelled Pen since §40): a round shape. The
 * centreline and widths are inkShape's with §40's LINE_SMOOTHING (0.15x the
 * smoothing, half the width swing). perfect-freehand only turns that into a round outline:
 * its own streamline, smoothing and taper are off (they would run the same
 * stages twice), and with thinning 1, no simulated pressure and size NIB_W / 2
 * its radius is size x pressure, so feeding it w gives a disc NIB_W x w across,
 * the nib's full width at the same point. The feather (one value per edge on
 * the nib) is folded into the radius as the mean of the two. Same fill, soft
 * edge (the caller's shadow) and grain as drawStroke; hits() (reachOf) measures
 * a round reach (NIB_W / 2 x w), so the eraser and the tip need nothing new.
 */
// Pencil width: 15% thinner than the nib. A wall-unit value, not a screen
// measurement, so the base-4 rule does not bind it.
export const PENCIL_W = NIB_W * 0.85;
// §45: the Pen's Small size, a stroke's `size` (the Worker's SMALL): inkShape
// scales every width by it, so the outline, eraser reach and inkBounds follow.
// Half of Regular (was 0.6 until 2026-10-07; a stored 0.6 still draws at 0.6).
export const SMALL = 0.5;
const PENCIL = { size: PENCIL_W / 2, thinning: 1, smoothing: 0, simulatePressure: false, start: { taper: false }, end: { taper: false }, last: true };
export const pencilOutline = (shape, opts = PENCIL) => {
    const pts = [];
    for (const [x, y, w, nl, nr] of shape) {
        const q = pts[pts.length - 1];
        if (q && q.point[0] === x && q.point[1] === y) continue;
        const dist = q ? Math.hypot(q.point[0] - x, q.point[1] - y) : 0;
        pts.push({
            point: [x, y],
            pressure: w * (1 + (FEATHER * (nl + nr)) / 2),
            vector: q ? [(q.point[0] - x) / dist, (q.point[1] - y) / dist] : [1, 1],
            distance: dist,
            runningLength: (q?.runningLength ?? 0) + dist
        });
    }
    if (pts[1]) pts[0].vector = pts[1].vector;
    return getStrokeOutlinePoints(pts, opts);
};
// A settled shape's outline is kept with it, so a bake repaint (pan, zoom,
// erase) doesn't re-run perfect-freehand on every pencil stroke.
const outlines = new WeakMap();
export const drawPencil = (ctx, shape, grain, seed = 0) => {
    let o = outlines.get(shape);
    if (!o) outlines.set(shape, (o = pencilOutline(shape)));
    if (!o.length) return;
    ctx.beginPath();
    ctx.moveTo(o[0][0], o[0][1]);
    for (const p of o) ctx.lineTo(p[0], p[1]);
    ctx.closePath();
    ctx.fill();
    if (grain && shape.length > 1) grainAlong(ctx, grain, seed, o);
};
/*
 * §46a §46b §67 GRAPHITE (labelled Pencil): an HB pencil on toothed paper.
 * What reads as pencil is the paper, not the line: the lead rides the
 * paper's tooth and only its peaks take graphite, the valleys stay white
 * until the pressure is enough to push the lead into them. So the mark is
 * ONE line whose coverage of the tooth falls from the centre of the lead
 * (most pressure) to its edge (a speckled fringe), never an outline and
 * never strands. Drawn as GRAPHITE_PASSES concentric strokes of the same
 * centreline: pass k is W x (1 - k / (PASSES + 1)) wide and strokes with a
 * tooth PATTERN holding only the paper cells in one height band, so the
 * passes tile the tooth instead of stacking alpha (a cell is painted once
 * per stroke; stroke over stroke still builds up, source-over, as layered
 * graphite does). The tooth (toothField) is the wall's own PAPER with its
 * 32-unit blotches high-passed away plus a one-unit grit, rank-normalised
 * so a band's coverage share is exact, and read at wall coordinates
 * through the pattern (the context is in wall units when painters run),
 * so every redraw, bake, zoom and reader sees the same grit at the same
 * wall point: a wall unit is ~0.12 mm on a tablet, a real tooth cell.
 * The darkest HB fill is GRAPHITE_A of the ink: a dark grey with the grit
 * still in it, never black.
 * PRESSURE: a sample's w (pressure x speed x taper; a pen's 0.5 .. 1.5
 * reaches inkShape as GRAPHITE_PRESS after LINE_VARY's half swing, 0 in
 * the taper) sets how deep the lead reaches: coverage D from
 * GRAPHITE_FILL[0] to [1], and the contact width from GRAPHITE_THIN x W to
 * W. Quantised to PRESS_LEVELS steps, one path per step; a mouse (w 1) is
 * the middle step.
 * §46b TILT: t (shape[5], 0 upright .. 1 flat) widens the contact by
 * 1 + TILT_WIDE x t and lightens it, D x (1 - TILT_LIGHT x t): the side of
 * the lead shades wide and grainy. TILT_LEVELS steps.
 * The first segment of every call is skipped: paint's live frozen batches
 * and its tail each start one sample back, and a finished stroke's first
 * half unit is inside the taper. Stored strokes are untouched (points,
 * pressure, tilt): every pencil line on the wall re-renders this way.
 * Every value is a first guess, wall units: FLAG all.
 */
export const GRAPHITE_W = PENCIL_W * 0.4; // 3.4: the lead's contact width upright. A wall-unit width, so base 4 does not bind it.
export const GRAPHITE_A = 0.72; // the darkest HB: this much of the ink
export const GRAPHITE_FILL = [0.25, 0.92]; // tooth coverage at the lightest .. hardest press
export const GRAPHITE_THIN = 0.6; // the lightest press's contact width, share of W
export const GRAPHITE_PASSES = 4; // density bands across the lead
export const PRESS_LEVELS = 3; // pressure steps over GRAPHITE_PRESS
export const GRAPHITE_PRESS = [vary(0.5, LINE_SMOOTHING), vary(1.5, LINE_SMOOTHING)]; // w at the lightest .. hardest pen press: 0.75 .. 1.25
export const TILT_WIDE = 2; // a flat lead is this much wider
export const TILT_LIGHT = 0.6; // and this much lighter
export const TILT_LEVELS = 4;
const TOOTH_Q = 16; // tooth bands are 1 / 16 of the cells
const TOOTH_SOFT = 0.04; // a band's edge, in coverage share
const TOOTH_GAIN = 2.5; // the paper's high-pass, scaled
const TOOTH_GRIT = 0.35; // one-unit white noise on top (more: finer, noisier grit; less: the paper's 2..8-unit clumps)
const TOOTH_SEED = 0x7001;
/*
 * §46c SMUDGE (a blending stump). A smudge is a stroke, tool "smudge", that
 * paints nothing: it is a filter on the artist's OWN graphite strokes older
 * than it. A graphite sample within SMUDGE_R of a smudge pass takes one
 * smudge count, n (shape[6]), per pass (a stroke counts once however it
 * wanders), capped at SMUDGE_MAX. A real stump drags graphite off the tooth
 * peaks into the valleys and out past the line: the grit goes grey and
 * even, the line goes wider, lighter and soft-edged. So a smudged sample
 * draws a flat haze under its tooth passes (plain ink at SMUDGE_HAZE x n,
 * SMUDGE_SPREAD x the contact wide, feathered SMUDGE_SOFT units by a
 * shadow), the tooth coverage drops to SMUDGE_KEEP^n and the contact widens
 * by 1 + SMUDGE_WIDE x n. Pen, fountain pen and watercolor are never read or
 * drawn by it, so their pixels are byte-identical with or without a smudge.
 * ponytail: softens, greys and widens in place, does not drag graphite
 * along the pass; a displacement per pass is the upgrade. The drawn extent
 * stays within SMUDGE_R + SMEAR_PAD of a pass (smear): at two passes and a
 * flat lead the haze is 10.2 x 2.2 x 1.6 / 2 + 4 ≈ 22 units from the line.
 * Every number a first guess: FLAG.
 */
export const SMUDGE_R = 12; // a stump's reach, wall units (6 px at zoom 1)
export const SMUDGE_MAX = 2; // passes counted; more change nothing
export const SMUDGE_KEEP = 0.5; // tooth coverage kept per pass
export const SMUDGE_WIDE = 0.6; // the contact widens this much per pass
export const SMUDGE_HAZE = 0.045; // the flat haze's alpha per pass (of GRAPHITE_A); measured: one pass keeps the line's graphite about even (sum of alpha across it x1.2), two x1.6
export const SMUDGE_SPREAD = 1.6; // the haze's width, x the widened contact
export const SMUDGE_SOFT = 4; // the haze's feather, wall units
// Is any segment of `pts` within r of [x, y]? Raw points, so a pass's shape
// is never computed.
const nearPass = (pts, x, y, r) => pts.some((a, i) => {
    const b = pts[i + 1] ?? a, dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l)) : 0;
    return Math.hypot(a[0] + dx * t - x, a[1] + dy * t - y) <= r;
});
// The graphite shape with its smudge count as each sample's 7th value;
// `passes` are the smudge strokes' point arrays. The same shape when none
// reach it. ponytail: every sample against every pass, O(samples × points);
// the pass's bounding box is the cheap first cut if a long sketch lags.
export const smudgeShape = (shape, passes) => {
    const near = passes.filter((pts) => pts.length && shape.some(([x, y]) => nearPass(pts, x, y, SMUDGE_R)));
    if (!near.length) return shape;
    return shape.map((s) => [...s.slice(0, 5), s[5] ?? 0, Math.min(SMUDGE_MAX, near.reduce((n, pts) => n + (nearPass(pts, s[0], s[1], SMUDGE_R) ? 1 : 0), 0))]);
};
// The tooth: PAPER less its 5 x 5 mean (the blotches go, the 2..8-unit
// grain stays), plus one-unit grit, then rank-normalised to 0..1 so the
// share of cells above 1 - d is exactly d. Built once, PAPER_T x PAPER_T.
let tooth = null;
const toothField = () => {
    if (tooth) return tooth;
    const T = PAPER_T, raw = new Float32Array(T * T), hist = new Uint32Array(1025);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
        let s = 0;
        for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) s += paperAt(x + i, y + j);
        const v = 0.5 + (paperAt(x, y) - s / 25) * TOOTH_GAIN + rnd(TOOTH_SEED, y * T + x) * TOOTH_GRIT * 0.5;
        raw[y * T + x] = Math.min(1, Math.max(0, v));
        hist[Math.round(raw[y * T + x] * 1024)]++;
    }
    for (let i = 1; i < hist.length; i++) hist[i] += hist[i - 1];
    tooth = new Float32Array(T * T);
    for (let i = 0; i < raw.length; i++) tooth[i] = hist[Math.round(raw[i] * 1024)] / (T * T);
    return tooth;
};
// A pattern of the tooth cells in the coverage band (lo, hi] (16ths), ink
// coloured at GRAPHITE_A, cached per ink; its repeat is PAPER_T wall units
// from the wall's origin, as the context is in wall units.
const toothPatterns = new Map();
const toothPattern = (ctx, ink, lo, hi) => {
    const key = `${ink}|${lo}|${hi}`;
    let p = toothPatterns.get(key);
    if (p) return p;
    const T = PAPER_T, t = toothField(), c = document.createElement("canvas");
    c.width = c.height = T;
    const g = c.getContext("2d");
    g.fillStyle = ink; g.fillRect(0, 0, 1, 1);
    const [r, gg, b] = g.getImageData(0, 0, 1, 1).data, img = g.createImageData(T, T), d = img.data;
    const sm = (u) => { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u); };
    const edge = (h, th) => sm((h - th) / TOOTH_SOFT + 0.5);
    for (let i = 0; i < t.length; i++) {
        const a = edge(t[i], 1 - hi / TOOTH_Q) - (lo ? edge(t[i], 1 - lo / TOOTH_Q) : 0);
        if (a <= 0) continue;
        d[i * 4] = r; d[i * 4 + 1] = gg; d[i * 4 + 2] = b; d[i * 4 + 3] = a * GRAPHITE_A * 255;
    }
    g.putImageData(img, 0, 0);
    toothPatterns.set(key, p = ctx.createPattern(c, "repeat"));
    return p;
};
// A sample's drawing level: pressure step + PRESS_LEVELS x (tilt step +
// (TILT_LEVELS + 1) x smudge count); one group of passes per run of a level.
const levelOf = ([, , w, , , t = 0, n = 0]) => Math.round(Math.min(1, Math.max(0, (w - GRAPHITE_PRESS[0]) / (GRAPHITE_PRESS[1] - GRAPHITE_PRESS[0]))) * (PRESS_LEVELS - 1)) + PRESS_LEVELS * (Math.round(Math.min(1, t) * TILT_LEVELS) + (TILT_LEVELS + 1) * n);
export const drawGraphite = (ctx, shape) => {
    if (shape.length < 2) return;
    const ink = ctx.fillStyle, s = ctx.getTransform().a; // bitmap px per wall unit
    ctx.save();
    ctx.shadowColor = "transparent";
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.globalAlpha = 1;
    // One run: the samples [i0, i1) at one level, as PASSES pattern strokes.
    const run = (i0, i1, level) => {
        const pq = (level % PRESS_LEVELS) / (PRESS_LEVELS - 1), tl = Math.floor(level / PRESS_LEVELS);
        const tq = (tl % (TILT_LEVELS + 1)) / TILT_LEVELS, n = Math.floor(tl / (TILT_LEVELS + 1));
        const W = GRAPHITE_W * (GRAPHITE_THIN + (1 - GRAPHITE_THIN) * pq) * (1 + TILT_WIDE * tq) * (1 + SMUDGE_WIDE * n);
        const D = (GRAPHITE_FILL[0] + (GRAPHITE_FILL[1] - GRAPHITE_FILL[0]) * pq) * (1 - TILT_LIGHT * tq) * SMUDGE_KEEP ** n;
        ctx.beginPath();
        ctx.moveTo(shape[i0][0], shape[i0][1]);
        for (let i = i0 + 1; i < i1; i++) ctx.lineTo(shape[i][0], shape[i][1]);
        if (n) {
            ctx.strokeStyle = ink;
            ctx.globalAlpha = GRAPHITE_A * SMUDGE_HAZE * n;
            ctx.lineWidth = W * SMUDGE_SPREAD;
            ctx.shadowColor = ink; ctx.shadowBlur = SMUDGE_SOFT * s;
            ctx.stroke();
            ctx.shadowColor = "transparent";
            ctx.globalAlpha = 1;
        }
        for (let k = 0, lo = 0; k < GRAPHITE_PASSES; k++) {
            const hi = Math.round((D * (k + 1)) / GRAPHITE_PASSES * TOOTH_Q);
            if (hi <= lo) continue;
            ctx.strokeStyle = toothPattern(ctx, ink, lo, hi);
            ctx.lineWidth = W * (1 - k / (GRAPHITE_PASSES + 1));
            ctx.stroke();
            lo = hi;
        }
    };
    let i0 = 1, level = levelOf(shape[1]);
    for (let i = 2; i < shape.length; i++) {
        const l = levelOf(shape[i]);
        if (l === level) continue;
        run(i0, i + 1, level); // the changing sample ends this run and starts the next, so the line is unbroken
        i0 = i; level = l;
    }
    if (i0 < shape.length - 1) run(i0, shape.length, level);
    ctx.restore();
};
// A stroke's round reach, wall units, before its width factor.
export const reachOf = (tool) => (tool === "pencil" ? PENCIL_W / 2 : tool === "graphite" ? GRAPHITE_W / 2 : tool === "watercolor" ? WASH_W / 2 : tool === "smudge" ? SMUDGE_R : NIB_W / 2);
// A stroke's painter by its tool (§25): absent is the nib, as the Worker says.
// §46c: a smudge paints nothing of its own (smudgeShape is its whole effect).
export const painter = (tool) => (tool === "pencil" ? drawPencil : tool === "graphite" ? drawGraphite : tool === "smudge" ? () => {} : drawStroke);

/*
 * §28b WATERCOLOR AND WATER (attempt 2). The reader's undried paint is a
 * pigment density field, pool.d: POOL x POOL floats in wall units (1 px per
 * unit), placed where the first wet stroke lands. CHECKLIST-31 §5: it rolls
 * with the brush (roll): a dab nearing its edge recentres it there, and the
 * paint left outside dries into washes then, so a stroke never runs off it.
 * A wet stroke is a run of ragged dabs (stamp) every STAMP_STEP along
 * inkShape's centreline, WASH_W x width across, with no rim and no outline:
 * each dab's edge is pushed in and out by the paper grain at that wall point,
 * over a WASH_SOFT feather. A stroke's own dabs take the max (mask m), so a
 * slow drag lays one WASH_FILL of pigment, not a pile; strokes over strokes
 * add, and a finished stroke melts into the paint under it (wetBlend, §37):
 * its pigment spreads WET_SPREAD into wet paint around it and the paint
 * under it spreads back, so wet on wet has no edge, while an edge on dry
 * paper keeps its rim. Water (waterOn) is a liquify brush: it
 * carries pigment along the drag, thins it WATER_THIN per sample, never past
 * WATER_STAIN of what was there at the press; where there is no paint it
 * changes nothing. The paper is one seamless procedural tile (paperTile)
 * read at wall coordinates, so every stroke, every reader and every dried
 * wash share the same grain at the same wall point; it erodes the shown
 * alpha by PAPER_WET (PAPER_DRY once dried, at DRY_DENSITY). wetBytes turns a
 * pool rect into the RGBA the canvas shows, multiplied over the wall. All
 * wall units unless said; FLAG every value.
 */
export const WASH_W = 32;
export const WASH_FILL = 0.3;
export const WASH_CAP = 0.8;
export const WASH_RAG = 0.5;
export const WASH_SOFT = 0.4;
export const WASH_MIN = 0.5;
export const STAMP_STEP = WASH_W / 8;
export const WET_SPREAD = WASH_W / 2; // §37: how far wet pigment melts into wet paint
export const MELT_MS = 500; // §37a: a finished stroke eases into its melt over this
// §48: a failed save is tried again this long after the last failure; a
// minute is the Worker's rate window (429), so half of one.
const RETRY_MS = 30_000;
export const WET_DRY_MS = 15 * 60_000; // §41: wet paint dries by itself this long after the last wet stroke
export const WATER_R = 48; // user: twice attempt 2's 24
export const WATER_MIX = 0.6;
export const WATER_THIN = 0.01;
export const WATER_STAIN = 0.35;
export const WATER_STEP = 4;
export const PAPER_T = 256;
export const PAPER_GAIN = 2;
export const PAPER_WET = 0.45;
export const PAPER_DRY = PAPER_WET * 1.2;
export const DRY_DENSITY = 0.9;
export const POOL = 1024;
export const POOL_EDGE = 128; // §5: the brush stays this far inside the pool; a dab reaches 36, its melt WET_SPREAD more
export const PIECE = 384; // §5: a wash wider or taller than this goes up in pieces; measured ~1.1 bytes/px, so a piece is ~160 KB, under the Worker's WASH_MAX 256 KB

// The paper: a T x T seamless tile of periodic value noise, five octaves from
// 32 to 2 units, 0..1 about 0.5, contrast PAPER_GAIN. No asset, no load.
export const paperTile = (T = PAPER_T, seed = 0x9e37) => {
    const t = new Float32Array(T * T);
    const h = (x, y, o) => { let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(o, 2246822519) + seed) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
    const sm = (u) => u * u * (3 - 2 * u);
    let amp = 0;
    for (let o = 0, cell = 32, a = 1; cell >= 2; o++, cell /= 2, a *= 0.6) {
        const n = T / cell;
        for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
            const gx = x / cell, gy = y / cell, x0 = Math.floor(gx), y0 = Math.floor(gy), u = sm(gx - x0), v = sm(gy - y0);
            const c = (i, j) => h((x0 + i) % n, (y0 + j) % n, o);
            t[y * T + x] += a * ((c(0, 0) * (1 - u) + c(1, 0) * u) * (1 - v) + (c(0, 1) * (1 - u) + c(1, 1) * u) * v);
        }
        amp += a;
    }
    for (let i = 0; i < t.length; i++) t[i] = Math.min(1, Math.max(0, 0.5 + (t[i] / amp - 0.5) * PAPER_GAIN));
    return t;
};
export const PAPER = paperTile();
// The paper at wall (x, y), integers.
export const paperAt = (x, y, t = PAPER, T = PAPER_T) => t[(((y % T) + T) % T) * T + (((x % T) + T) % T)];

const union = (a, b) => (a ? { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) } : { ...b });

// One ragged dab: radius r at pool px (cx, cy), the pool's origin at wall
// (ox, oy). Into mask m by max; the rise over the old m goes into d (when
// given) as fill x rise. Returns its rect, or null off the pool.
export const stamp = (d, m, W, H, cx, cy, r, ox, oy, fill = WASH_FILL) => {
    const R = r * (1 + WASH_RAG);
    const x0 = Math.max(0, Math.floor(cx - R)), y0 = Math.max(0, Math.floor(cy - R));
    const x1 = Math.min(W, Math.ceil(cx + R) + 1), y1 = Math.min(H, Math.ceil(cy + R) + 1);
    if (x1 <= x0 || y1 <= y0) return null;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const rn = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
        const s = Math.min(1, Math.max(0, (1 - rn + WASH_RAG * (paperAt(x + ox, y + oy) - 0.5) * 2) / WASH_SOFT));
        if (!s) continue;
        const v = s * s * (3 - 2 * s), i = y * W + x;
        if (v > m[i]) { if (d) d[i] += fill * (v - m[i]); m[i] = v; }
    }
    return { x0, y0, x1, y1 };
};

// Dabs along a shape ([x, y, w, ...] samples, pool px) from index `from`,
// one every STAMP_STEP from the last dab (`at`, mutated), the last sample
// always. Returns the rect covered, or null.
export const stampAlong = (d, m, W, H, shape, from, at, ox, oy) => {
    let rect = null;
    for (let i = from; i < shape.length; i++) {
        const [x, y, w] = shape[i];
        if (i < shape.length - 1 && at.p && Math.hypot(x - at.p[0], y - at.p[1]) < STAMP_STEP) continue;
        at.p = [x, y];
        const b = stamp(d, m, W, H, x, y, (WASH_W / 2) * Math.max(WASH_MIN, w), ox, oy);
        if (b) rect = union(rect, b);
    }
    return rect;
};

// §37 A finished stroke (mask m, 0..1) melted into the paint under it. Its
// pigment is WASH_FILL x m (stamp adds fill x rise, m takes the max); the
// rest is what was under it. The new pigment is spread by a WET_SPREAD
// triangle blur where the old paint is wet (0 on dry paper, 1 at a full
// stroke): wet on wet has no edge, on dry paper the stroke keeps its rim.
// Over rect grown by WET_SPREAD; returns that rect. ponytail: one way only
// (the old paint stays put: spreading it by m re-stamps the new stroke's
// silhouette as a dip, measured), no mass bookkeeping at a wet/dry border.
// §37a: with `keep`, the rect carries `dl`, what each of its pixels gained,
// so the caller can show the melt easing in while d already holds the end.
export const wetBlend = (d, m, W, H, { x0, y0, x1, y1 }, R = WET_SPREAD, keep = false) => {
    x0 = Math.max(0, x0 - R); y0 = Math.max(0, y0 - R); x1 = Math.min(W, x1 + R); y1 = Math.min(H, y1 + R);
    const w = x1 - x0, h = y1 - y0, n = w * h;
    const nu = new Float32Array(n), un = new Float32Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y0 + y) * W + x0 + x, j = y * w + x;
        nu[j] = WASH_FILL * m[i]; un[j] = d[i] - nu[j];
    }
    const nb = blur2(nu, w, h, R), dl = keep ? new Float32Array(n) : null;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const j = y * w + x, g = (nb[j] - nu[j]) * Math.min(1, un[j] / WASH_FILL);
        d[(y0 + y) * W + x0 + x] += g;
        if (dl) dl[j] = g;
    }
    return { x0, y0, x1, y1, dl };
};
// Two box blurs of radius R (a triangle kernel, 2R + 1 wide), separable,
// running sums, edges clamped. A new array; a is untouched.
export const blur2 = (a, w, h, R) => {
    const pass = (src, dst, len, stride, lines, lineStride) => {
        const k = 2 * R + 1;
        for (let l = 0; l < lines; l++) {
            const o = l * lineStride, at = (i) => src[o + Math.min(len - 1, Math.max(0, i)) * stride];
            let sum = 0;
            for (let i = -R; i <= R; i++) sum += at(i);
            for (let i = 0; i < len; i++) { dst[o + i * stride] = sum / k; sum += at(i + R + 1) - at(i - R); }
        }
    };
    const t = new Float32Array(a.length), u = new Float32Array(a.length);
    pass(a, t, w, 1, h, w); pass(t, u, h, w, w, 1); pass(u, t, w, 1, h, w); pass(t, u, h, w, w, 1);
    return u;
};

// One water sample at pool px (cx, cy), dragged by (dx, dy) since the last,
// on density d; base is d at the press (the stain floor). Returns how many
// pixels changed: 0 where there is no paint.
export const waterOn = (d, base, W, H, cx, cy, dx, dy) => {
    const R = WATER_R, M = R + Math.ceil(Math.hypot(dx, dy)) + 2;
    const x0 = Math.max(0, Math.floor(cx - M)), y0 = Math.max(0, Math.floor(cy - M));
    const x1 = Math.min(W, Math.ceil(cx + M)), y1 = Math.min(H, Math.ceil(cy + M));
    if (x1 <= x0 || y1 <= y0) return 0;
    const w = x1 - x0, h = y1 - y0, src = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) src[y * w + x] = d[(y0 + y) * W + x0 + x];
    const at = (x, y) => { // bilinear, 0 outside
        const xi = Math.floor(x), yi = Math.floor(y), u = x - xi, v = y - yi;
        const g = (i, j) => (i < 0 || j < 0 || i >= w || j >= h ? 0 : src[j * w + i]);
        return (g(xi, yi) * (1 - u) + g(xi + 1, yi) * u) * (1 - v) + (g(xi, yi + 1) * (1 - u) + g(xi + 1, yi + 1) * u) * v;
    };
    let n = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const px = x0 + x, py = y0 + y, f = 1 - Math.hypot(px + 0.5 - cx, py + 0.5 - cy) / R;
        if (f <= 0) continue;
        const i = py * W + px, s = src[y * w + x];
        const adv = at(x - dx * f, y - dy * f);
        const v = Math.max(base[i] * WATER_STAIN, (s * (1 - WATER_MIX * f) + adv * WATER_MIX * f) * (1 - WATER_THIN * f));
        if (v === d[i]) continue;
        d[i] = v;
        n++;
    }
    return n;
};

// RGBA bytes of the pool rect (x0, y0, w, h): density (plus the live tail t's
// rise over m, when given) capped at WASH_CAP, x dens, eroded by the paper at
// wall coordinates by S. The pool's origin is wall (ox, oy). §37a: e, when
// given, is added to d for the show only (the melt still easing in).
export const wetBytes = (d, W, x0, y0, w, h, rgb, ox, oy, S, dens = 1, t = null, m = null, e = null) => {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y0 + y) * W + x0 + x;
        let v = d[i] + (e ? e[i] : 0);
        if (t && t[i] > m[i]) v += WASH_FILL * (t[i] - m[i]);
        if (v <= 0) continue;
        const o = (y * w + x) * 4;
        out[o] = rgb[0]; out[o + 1] = rgb[1]; out[o + 2] = rgb[2];
        out[o + 3] = Math.min(WASH_CAP, v) * dens * (1 - S * paperAt(x0 + x + ox, y0 + y + oy)) * 255;
    }
    return out;
};

// A dried wash on g, at its box, multiplied. Skipped until its image loads.
export const drawWash = (g, { img, box }) => {
    if (!(img?.naturalWidth ?? img?.width)) return;
    g.save();
    g.shadowColor = "transparent";
    g.globalCompositeOperation = "multiply";
    g.drawImage(img, box.x, box.y, box.w, box.h);
    g.restore();
};

/* ---- Eraser (§3b) ------------------------------------------------------- */

// Eraser reach, wall units, past the ink's own half width. FLAG for the user.
export const ERASE_R = 12;
// §43: what is not in a lasso selection is drawn at this alpha.
export const DIM = 0.5;
// §43: is wall point [x, y] inside the closed polygon? (even-odd ray cast)
export const inside = ([x, y], poly) => {
    let k = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) k = !k;
    }
    return k;
};

// Does the eraser at p touch this drawn shape (its centreline plus nib)?
export const hits = (shape, [px, py], r = ERASE_R, half = NIB_W / 2) => shape.some((a, i) => {
    const b = shape[i + 1] ?? a, dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l)) : 0;
    return Math.hypot(a[0] + dx * t - px, a[1] + dy * t - py) <= r + half * Math.max(a[2], b[2]);
});

// Bounding box of all ink, wall units, nib included; null on an empty wall.
export const inkBounds = (strokes, b = null) => {
    const add = (x0, y0, x1, y1) => {
        b = b ? { x0: Math.min(b.x0, x0), y0: Math.min(b.y0, y0), x1: Math.max(b.x1, x1), y1: Math.max(b.y1, y1) } : { x0, y0, x1, y1 };
    };
    for (const st of strokes) {
        // §28b: a dried wash is its box.
        if (st.box) { add(st.box.x, st.box.y, st.box.x + st.box.w, st.box.y + st.box.h); continue; }
        for (const p of st.points) {
            const r = reachOf(st.tool) * (p[2] ?? 1) * (st.size ?? 1);
            add(p[0] - r, p[1] - r, p[0] + r, p[1] + r);
        }
    }
    return b;
};

// Clamp one axis of the view: [v, v + len] inside [lo, hi].
export const clampAxis = (v, len, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi - len));

// Box height, px, at scale s (§5).
// §21c: the session's undo history, memory only (never sent anywhere, gone on
// refresh). One entry per action: a drawn stroke, or one eraser rub (all the
// strokes it cut). undo() pops the newest and reverses it: a draw is taken off
// the wall with remove(st) (skipped if it is already gone), a rub puts its
// strokes back with add(st). Strokes are mutated in place when re-saved, so an
// entry keeps pointing at the right stroke after the Worker gives it a new id.
export const makeUndo = ({ add, remove, has }) => {
    const h = [], r = []; // r: what undo took, newest last; any new action empties it
    const put = (a) => { r.length = 0; h.push(a); };
    return {
        draw: (st) => put({ st }),
        erase: (sts) => { if (sts.length) put({ sts }); },
        // §43: any other one-step action, undone by calling fn, redone by redo.
        push: (fn, redo) => put({ fn, redo }),
        size: () => h.length,
        rsize: () => r.length,
        undo: () => {
            let a;
            while ((a = h.pop())) {
                if (a.fn) { a.fn(); if (a.redo) r.push(a); return true; }
                if (a.sts) { a.sts.forEach(add); r.push(a); return true; }
                if (has(a.st)) { remove(a.st); r.push(a); return true; }
            }
            return false;
        },
        // Redo a draw re-saves it (add), a rub cuts again (remove).
        redo: () => {
            const a = r.pop();
            if (!a) return false;
            if (a.fn) a.redo();
            else if (a.sts) a.sts.filter(has).forEach(remove);
            else add(a.st);
            h.push(a);
            return true;
        }
    };
};
export const boxHeight = (bottom, s) => Math.max(BOX_MIN, Math.ceil(((bottom + ROOM_CELLS * GRID) * s) / 4) * 4);

/* ---- Markup (§1 §3 §4 §8 §9) -------------------------------------------- */

/* §8 §9, answers-7; §19a: the corner is one of two states, one height
   (graffiti.css, --graffiti-control-h):
     signed in    [user square][name input]     fixed width
     signed out   [user-plus  Login to draw]    one navy link
   Signed out it opens Ghost Portal's signup (§19a, user): Portal owns the
   email, the code / magic link, the sign-in and the newsletter. Portal binds
   [data-portal] and also watches the #/portal/ hash, so the link works even
   if Portal's click binding missed it. */
export const renderCorner = (name) => name
    ? `<div class="qntns-graffiti__name">
           <span class="qntns-graffiti__sq">${icon("user", { size: 16, className: "qntns-graffiti__icon" })}</span>
           <input class="qntns-graffiti__artist" type="text" value="${esc(name)}" maxlength="24" readonly spellcheck="false" autocomplete="off" aria-label="Artist name, press to edit" data-graffiti-name>
       </div>
       <p class="qntns-graffiti__note" role="status" data-graffiti-note></p>`
    : `<a class="qntns-graffiti__go" href="#/portal/signup" data-portal="signup" data-graffiti-login aria-label="Login to draw">${icon("user-plus", { size: 16, className: "qntns-graffiti__icon" })}<span class="qntns-graffiti__label">Login to draw</span></a>`;

/* §27: the page menu, right of the corner's name / "Login to draw". The views
   menu's button, menu and rows (views-menu.css), so it is not a new look;
   graffiti.css only turns it to open downward and fills the active row navy.
   The button shows the active page's icon. Misc. is the default; strokes
   are not split by page yet (§27a). */
export const PAGES = [
    { key: "misc", icon: "dices", label: "Misc." },
    { key: "drawings", icon: "line-squiggle", label: "Drawings" },
    { key: "signatures", icon: "signature", label: "Autographs" },
    { key: "notes", icon: "brain", label: "Notes to self" },
    { key: "prayers", icon: "om", label: "World prayers" }
];
/* §36: every page opens at /graffiti/?wall=<slug>, the slug its
   label's words (world-prayers, notes-to-self); the key is taken too. Unknown
   or absent = Misc., silently. */
export const wallSlug = (p) => p.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const wallOf = (q) => (PAGES.find((p) => q && (p.key === q || wallSlug(p) === q)) || PAGES[0]).key;
/* §27c: a labelled button (the page menu) carries the active item's label in
   both layers, the login link's qntns-graffiti__label; graffiti.css hides it
   on a narrow strip, where the button is the 32 square. */
const menuLayers = (it, labelled) => {
    const inner = ico(it.icon) + (labelled ? `<span class="qntns-graffiti__label">${esc(it.label)}</span>` : "");
    return `<span class="qntns-views__layer qntns-views__layer--outline">${inner}</span><span class="qntns-views__layer qntns-views__layer--fill">${inner}</span>`;
};
/* The page menu's dropdown (§27). The §27b tool menu used it too until §35
   unfolded the tools for good. `kind` names the data hooks: data-graffiti-<kind>s on
   the wrapper, -button, -menu, and data-graffiti-<kind>-row on each row.
   `off` is a set of keys rendered aria-disabled (signed-out drawing tools). */
// §28f: the Water row ships aria-disabled; signed in its title says why.
const offTitle = (key, signedIn) => (!signedIn ? "Log in to draw" : key === "water" ? "Paint first: water only moves wet paint" : key === "smudge" ? "Sketch first: smudge only blends your pencil" : "Log in to draw");
// §33a: a draft's label is the MCP's text, so it is escaped.
const renderRow = (kind, p, active, off = [], signedIn = false) => `                <button class="qntns-views__row" type="button" role="menuitemradio" aria-checked="${p.key === active}" tabindex="-1" data-graffiti-${kind}-row="${p.key}"${off.includes(p.key) ? ` aria-disabled="true" title="${offTitle(p.key, signedIn)}"` : ""}><span class="qntns-views__glyph">${icon(p.icon, { size: 16, className: "qntns-views__row-icon" })}</span><span class="qntns-views__label">${esc(p.label)}</span></button>`;
const renderMenu = ({ kind, label, items, active, labelled = false, off = [], signedIn = false }) => `<div class="qntns-views qntns-graffiti__${kind}s" data-graffiti-${kind}s>
            <button class="qntns-views__button" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="qntns-graffiti-${kind}s-menu" aria-label="${label}${labelled ? `: ${esc(items.find((p) => p.key === active).label)}` : ""}" data-graffiti-${kind}s-button>${menuLayers(items.find((p) => p.key === active), labelled)}</button>
            <div class="qntns-views__menu" id="qntns-graffiti-${kind}s-menu" role="menu" aria-label="${label}" hidden data-graffiti-${kind}s-menu>
${items.map((p) => renderRow(kind, p, active, off, signedIn)).join("\n")}
            </div>
        </div>`;
export const renderPages = (page = "misc") => renderMenu({ kind: "page", label: "Wall page", items: PAGES, active: page, labelled: true });


/* §57: lucide "link" (ISC), inline until it is vendored into
   assets/icons/lucide and tools/build-icons.mjs is re-run; then drop this. */
const LINK_PATHS = `<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>`;
// §58: lucide "image" and "move-diagonal-2" (ISC), the same shim.
const EXTRA_ICONS = { link: LINK_PATHS, image: `<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>`, "move-diagonal-2": `<path d="M19 13v6h-6"/><path d="M5 11V5h6"/><path d="m5 5 14 14"/>` };
const iconAny = (n, o) => (EXTRA_ICONS[n] ? icon("x", o).replace(/(<svg[^>]*>)[\s\S]*/, `$1${EXTRA_ICONS[n]}</svg>`) : icon(n, o));
const ico = (n) => iconAny(n, { size: 16, className: "qntns-graffiti__icon" });
/* §42 §45: the eraser's and the Pen's panels, the views menu's rows (24 box,
   fill rising behind the check) in a popover, so the bar's overflow-x (§47)
   cannot clip them; attachGraffiti places one above its own button. The
   eraser's rows are the drawn kinds in bar order, all on; the Pen's two
   sizes, Regular on. Smudges are Pencil here (§42): the Pencil row erases
   the reader's pencil lines and their smudges, or neither. §59: the Lasso
   opens the same rows (pickPanel "lasso"), with its own ticks. */
const ERASES = [["pencil", "Pen", "dot-regular"], ["pen", "Fountain pen", "pen-tool"], ["graphite", "Pencil", "pencil"], ["watercolor", "Watercolor", "brush"], ["image", "Images", "image"], ["link", "Links", "link"]];
const SIZES = [["regular", "Regular", "dot-regular"], ["small", "Small", "dot-small"]];
// §47: the paper under the wall, a viewer's choice for the session; Dot grid on.
const PAPERS = [["dots", "Dot grid", "paper-dots"], ["grid", "Square grid", "paper-grid"], ["lines", "Lines", "paper-lines"], ["wide", "Wide lines", "paper-wide"], ["iso", "Isometric", "paper-iso"], ["none", "None", "paper-none"]];
const pickPanel = (kind, label, role, rows) => `
        <div class="qntns-views__menu qntns-graffiti__pick" id="qntns-graffiti-${kind}-panel" role="menu" aria-label="${label}" popover="manual" data-graffiti-pick="${kind}">
${rows.map(([key, text, glyph], i) => `            <button class="qntns-views__row" type="button" role="${role}" aria-checked="${role === "menuitemcheckbox" || !i}" data-graffiti-${kind}-row="${key}"><span class="qntns-views__box"><span class="qntns-views__box-fill"></span>${icon("check", { size: 16, className: "qntns-views__box-check" })}</span><span class="qntns-views__glyph">${iconAny(glyph, { size: 16, className: "qntns-views__row-icon" })}</span><span class="qntns-views__label">${text}</span></button>`).join("\n")}
        </div>`;
// `name` set = signed in. Ghost knows @member; the partial emits the same.
// §3c: the corner (left) and toolbar (right) share one sticky strip above the
// box, inside the column; the canvas below them is never covered at rest.
// §35: the Tool group left the strip for its own bar after the box, sticky
// 16 above the viewport bottom (graffiti.css), every tool always shown.
export const renderGraffiti = ({ name = "" } = {}) => `
<section class="qntns-graffiti" id="graffiti" data-graffiti data-graffiti-page="misc">
    <!-- ryOS fork: diverges from the theme. No "Graffiti Wall" heading, and the Postcard button is hidden; Paint's File > Postcard... clicks it (CHECKLIST-36 §24b). -->
    <div class="qntns-graffiti__head" style="display:none">
        <button type="button" class="qntns-content__share qntns-card-group__postcard" data-graffiti-postcard aria-pressed="false" aria-label="Postcard: frame part of the wall and mail it">${icon("send", { size: 18, className: "qntns-content__share-icon" })}<span class="qntns-card-group__postcard-label">Postcard</span></button>
    </div>
    <div class="qntns-graffiti__strip">
        <div class="qntns-graffiti__corner" data-graffiti-corner>${renderCorner(name)}${renderPages()}</div>
        <div class="qntns-graffiti__bar">
            <div class="qntns-graffiti__group" role="group" aria-label="Undo">
                <button class="qntns-graffiti__btn" type="button" data-graffiti-undo aria-label="Undo your last line"${name ? " disabled" : ` aria-disabled="true" title="Log in to draw"`}>${ico("undo-2")}</button>
                <button class="qntns-graffiti__btn" type="button" data-graffiti-redo aria-label="Redo the line you undid"${name ? " disabled" : ` aria-disabled="true" title="Log in to draw"`}>${ico("redo-2")}</button>
            </div>
            <div class="qntns-graffiti__group" role="group" aria-label="Zoom">
                <button class="qntns-graffiti__btn" type="button" data-graffiti-zoom="-1" aria-label="Zoom out">${ico("minus")}</button>
                <button class="qntns-graffiti__btn" type="button" data-graffiti-fit aria-label="Fit the whole wall">${ico("fullscreen")}</button>
                <button class="qntns-graffiti__btn" type="button" data-graffiti-zoom="1" aria-label="Zoom in">${ico("plus")}</button>
            </div>
        </div>
    </div>
    <div class="qntns-graffiti__wall">
    <div class="qntns-graffiti__box" data-tool="hand">
        <div class="qntns-graffiti__view" data-graffiti-view>
            <canvas class="qntns-graffiti__canvas" data-graffiti-canvas aria-label="Graffiti wall. Hand moves it sideways, pen, pencil and fountain pen draw, watercolor paints, water spreads wet paint, smudge blends your pencil, lasso moves your own marks, eraser removes your own lines, minus and plus zoom."></canvas>
        </div>
        <p class="qntns-graffiti__tip" role="status" hidden data-graffiti-tip></p>
    </div>
    <div class="qntns-graffiti__tools">
    <div class="qntns-graffiti__scroll">
    <div class="qntns-graffiti__group" role="group" aria-label="Paper">
        <button class="qntns-graffiti__btn" type="button" data-graffiti-paper aria-label="Paper: the wall's background" aria-controls="qntns-graffiti-paper-panel" aria-expanded="false">${ico("paper-dots")}</button>${pickPanel("paper", "Paper", "menuitemradio", PAPERS)}
    </div>
    <div class="qntns-graffiti__group" role="group" aria-label="Move and erase">
        <button class="qntns-graffiti__btn" type="button" data-graffiti-tool="hand" aria-pressed="true" aria-label="Hand: move the wall">${ico("hand")}</button>
        <button class="qntns-graffiti__btn" type="button" data-graffiti-tool="lasso" aria-pressed="false" aria-label="Lasso: pick up your own marks and move them" aria-controls="qntns-graffiti-lasso-panel" aria-expanded="false"${name ? "" : ` aria-disabled="true" title="Log in to draw"`}>${ico("lasso")}</button>${pickPanel("lasso", "Lasso picks", "menuitemcheckbox", ERASES)}
        <button class="qntns-graffiti__btn" type="button" data-graffiti-tool="eraser" aria-pressed="false" aria-label="Eraser: remove your own lines" aria-controls="qntns-graffiti-erase-panel" aria-expanded="false"${name ? "" : ` aria-disabled="true" title="Log in to draw"`}>${ico("eraser")}</button>${pickPanel("erase", "Eraser removes", "menuitemcheckbox", ERASES)}
    </div>
    <div class="qntns-graffiti__group" role="group" aria-label="Pens">
        <button class="qntns-graffiti__btn" type="button" data-graffiti-tool="pencil" aria-pressed="false" aria-label="Pen: draw a line" aria-controls="qntns-graffiti-size-panel" aria-expanded="false"${name ? "" : ` aria-disabled="true" title="Log in to draw"`}>${ico("dot-regular")}</button>${pickPanel("size", "Pen size", "menuitemradio", SIZES)}
        <button class="qntns-graffiti__btn" type="button" data-graffiti-tool="pen" aria-pressed="false" aria-label="Fountain pen: draw with the broad nib"${name ? "" : ` aria-disabled="true" title="Log in to draw"`}>${ico("pen-tool")}</button>
    </div>
    <div class="qntns-graffiti__group" role="group" aria-label="Pencil">
        <button class="qntns-graffiti__btn" type="button" data-graffiti-tool="graphite" aria-pressed="false" aria-label="Pencil: sketch in graphite"${name ? "" : ` aria-disabled="true" title="Log in to draw"`}>${ico("pencil")}</button>
        <button class="qntns-graffiti__btn" type="button" data-graffiti-tool="smudge" aria-pressed="false" aria-label="Smudge: blend your pencil lines" aria-disabled="true" title="${offTitle("smudge", !!name)}">${ico("smudge")}</button>
    </div>
    <div class="qntns-graffiti__group" role="group" aria-label="Paint">
        <button class="qntns-graffiti__btn" type="button" data-graffiti-tool="watercolor" aria-pressed="false" aria-label="Watercolor: paint in blue"${name ? "" : ` aria-disabled="true" title="Log in to draw"`}>${ico("brush")}</button>
        <button class="qntns-graffiti__btn" type="button" data-graffiti-tool="water" aria-pressed="false" aria-label="Water: move wet paint" aria-disabled="true" title="${offTitle("water", !!name)}">${ico("droplet")}</button>
    </div>
    <div class="qntns-graffiti__group" role="group" aria-label="Link and image">
        <button class="qntns-graffiti__btn" type="button" data-graffiti-tool="link" aria-pressed="false" aria-label="Link: pin a link card to the wall"${name ? "" : ` aria-disabled="true" title="Log in to draw"`}>${ico("link")}</button>
        <button class="qntns-graffiti__btn" type="button" data-graffiti-tool="image" aria-pressed="false" aria-label="Image: put a meme on the wall"${name ? "" : ` aria-disabled="true" title="Log in to draw"`}>${ico("image")}</button>
    </div>
    </div>${name ? renderSave() : ""}
    </div>
    </div>
</section>`;

/* §48: the save status, its own group at the bar's right end; signed in only.
   All three words sit in one grid cell, so the button is always the widest's
   width and never reflows as they swap. The panel is a popover: the top
   layer, so the bar's overflow-x scroll (§47) cannot clip it. */
const renderSave = () => `
    <div class="qntns-graffiti__group" role="group" aria-label="Save">
        <button class="qntns-graffiti__btn qntns-graffiti__save" type="button" data-graffiti-save data-state="saved" aria-controls="qntns-graffiti-save-panel" aria-expanded="false"><span class="qntns-graffiti__light" aria-hidden="true"></span><span class="qntns-graffiti__says"><span>Saved</span><span>Saving</span><span>Failed</span></span></button>
        <div class="qntns-graffiti__panel" id="qntns-graffiti-save-panel" popover data-graffiti-save-panel>
            <button class="qntns-graffiti__btn qntns-graffiti__now" type="button" data-graffiti-save-now>Save now</button>
        </div>
    </div>`;

/* ---- Behaviour ---------------------------------------------------------- */

/*
 * The corner on its own (§8 §9), so the §9a story can show it without the
 * wall. `root` holds renderCorner's markup (and the .qntns-graffiti class the
 * corner rules key on). Returns { open, setName, detach }: open() is what
 * the signed-out pen calls.
 */
export const attachCorner = (root, { taken = [], onName } = {}) => {
    // Signed out: open() is the signed-out pen pressing "Login to draw".
    const open = () => root.querySelector("[data-graffiti-login]")?.click();

    /* Artist name (§9, answers-5). The input is the name; editing only drops
       readonly, so nothing moves or grows. */
    const input = root.querySelector("[data-graffiti-name]");
    const note = root.querySelector("[data-graffiti-note]");
    let was = input?.value;
    // §9b: the field fits the name. field-sizing: content does it in CSS;
    // where that is missing, the size attribute (characters) stands in.
    const fit = CSS.supports?.("field-sizing", "content") ? () => {} : () => { input.size = Math.max(1, input.value.length); };
    if (input) fit();
    const edit = () => {
        if (!input.readOnly) return;
        was = input.value;
        input.readOnly = false;
        input.setAttribute("aria-label", "Artist name, one word");
        input.select();
    };
    /* §17: a taken name, refused locally (Phase 1 list) or by the Worker's
       409 (onName resolves "taken"), puts the old name back and shows the
       site's toast. The inline note no longer says it: the toast does.
       Copy is the user's to approve. A network failure is not "taken" and
       keeps the new name, silently (CLAUDE.md). */
    const refuse = (name, old) => {
        input.value = old;
        fit();
        showToast(document, { title: "Name taken", body: `${name} is already someone's. Try another.` });
    };
    const done = (keep) => {
        if (input.readOnly) return;
        const next = cleanName(input.value), old = was;
        let ok = keep && next && next !== was;
        if (ok && taken.some((t) => t.toLowerCase() === next.toLowerCase())) { ok = false; refuse(next, old); }
        else if (ok) Promise.resolve(onName?.(next)).then((r) => { if (r === "taken" && input.value === next) refuse(next, old); });
        input.value = ok ? next : was;
        fit();
        input.readOnly = true;
        input.removeAttribute("aria-invalid");
        input.setAttribute("aria-label", "Artist name, press to edit");
        note.textContent = "";
        input.setSelectionRange(0, 0);
    };
    const onBefore = (e) => { if (e.data && !e.data.trim()) e.preventDefault(); };
    const onInput = () => {
        const c = cleanName(input.value);
        if (c !== input.value) input.value = c;
        fit();
        input.removeAttribute("aria-invalid");
        note.textContent = "";
    };
    const onNameKey = (e) => {
        if (e.key === "Enter") { e.preventDefault(); input.readOnly ? edit() : done(true); }
        if (e.key === "Escape") done(false);
    };
    const onBlur = () => done(true);
    input?.addEventListener("click", edit);
    input?.addEventListener("beforeinput", onBefore);
    input?.addEventListener("input", onInput);
    input?.addEventListener("keydown", onNameKey);
    input?.addEventListener("blur", onBlur);

    return {
        open,
        // The name the Worker holds (§16, GET /graffiti/me), set after load.
        setName: (name) => { if (input?.readOnly) { input.value = name; fit(); } },
        detach: () => {
            input?.removeEventListener("click", edit);
            input?.removeEventListener("beforeinput", onBefore);
            input?.removeEventListener("input", onInput);
            input?.removeEventListener("keydown", onNameKey);
            input?.removeEventListener("blur", onBlur);
        }
    };
};

/*
 * §27: the page menu's wiring, the views menu's (views-menu.js) for a radio
 * group. Picking a row sets `data-graffiti-page` on `section` and closes the
 * menu. Arrows / Home / End walk the rows, Escape and Tab close, a press
 * outside closes without taking focus. ponytail: no storage, no Worker —
 * §27a decides what a page is. Returns detach().
 */
export const attachPages = (section, { onPage } = {}) => {
    const m = attachMenu(section, "page", PAGES, (key) => {
        section.dataset.graffitiPage = key;
        m.set(key);
        onPage?.(key);
    });
    // §36: a ?wall= page arrives already open (connectGraffiti set it).
    if (section.dataset.graffitiPage !== "misc") m.set(section.dataset.graffitiPage);
    const detach = () => m.detach();
    // §33a: the Worker's drafts [{key, label}], after the fixed pages, pencil
    // icon. A draft gone from the list takes its row; if it was open, Misc.
    detach.drafts = (drafts) => {
        const next = [...PAGES, ...drafts.map((d) => ({ key: d.key, icon: "pencil", label: d.label }))];
        const cur = section.dataset.graffitiPage;
        const key = next.some((p) => p.key === cur) ? cur : "misc";
        section.dataset.graffitiPage = key;
        m.setItems(next, key);
        if (key !== cur) onPage?.(key);
    };
    return detach;
};

// The dropdown's wiring for either kind. pick() closes and hands the key to
// onPick, which owns the state and calls set() to show it. Returns { set, detach }.
const attachMenu = (section, kind, items, onPick) => {
    const wrap = section.querySelector(`[data-graffiti-${kind}s]`);
    if (!wrap) return { set: () => {}, detach: () => {} };
    const button = wrap.querySelector(`[data-graffiti-${kind}s-button]`);
    const menu = wrap.querySelector(`[data-graffiti-${kind}s-menu]`);
    const attr = `data-graffiti-${kind}-row`;
    let rows, list = items;
    const labelled = !!button.querySelector(".qntns-graffiti__label");
    // The rise runs top row first: this menu drops (graffiti.css).
    const grab = () => {
        rows = [...menu.querySelectorAll(`[${attr}]`)];
        rows.forEach((r, i) => r.style.setProperty("--rise-i", i));
    };
    grab();
    const isOpen = () => button.getAttribute("aria-expanded") === "true";
    const home = () => rows.find((r) => r.getAttribute("aria-checked") === "true") || rows[0];
    // §27d: the navy bar (graffiti.css, menu::before) slides to row r.
    const hi = (r) => {
        rows.forEach((x) => x.toggleAttribute("data-hi", x === r));
        menu.style.setProperty("--hi-y", `${r.offsetTop}px`);
        menu.style.setProperty("--hi-h", `${r.offsetHeight}px`);
    };
    const open = () => {
        button.setAttribute("aria-expanded", "true");
        menu.hidden = false;
        hi(home());
        home().focus();
    };
    // §27: focus comes back to the button after a pick, with the ring only
    // when the pick was a key (Enter/Space); a mouse/touch pick returns it
    // quietly. focusVisible is ignored where unsupported (the browser's own
    // heuristic then decides).
    const close = (focus, ring = true) => {
        if (!isOpen()) return;
        button.setAttribute("aria-expanded", "false");
        menu.hidden = true;
        if (focus) button.focus({ focusVisible: ring });
    };
    let byPointer = false;
    const onDown = () => { byPointer = true; };
    const set = (key) => {
        rows.forEach((r) => r.hasAttribute("aria-checked") && r.setAttribute("aria-checked", String(r.getAttribute(attr) === key)));
        const it = list.find((x) => x.key === key);
        button.innerHTML = menuLayers(it, labelled);
        // The visible label is in the accessible name (label-in-name).
        if (labelled) button.setAttribute("aria-label", `${menu.getAttribute("aria-label")}: ${it.label}`);
    };
    const onButton = () => (isOpen() ? close(true) : open());
    const onRow = (e) => { const r = e.target.closest(`[${attr}]`); if (r) { close(true, !byPointer); onPick(r.getAttribute(attr)); } };
    const onKey = (e) => {
        byPointer = false;
        const at = rows.indexOf(document.activeElement);
        const go = (i) => rows[(i + rows.length) % rows.length].focus();
        if (e.key === "ArrowDown") go(at + 1);
        else if (e.key === "ArrowUp") go(at - 1);
        else if (e.key === "Home") go(0);
        else if (e.key === "End") go(rows.length - 1);
        else if (e.key === "Escape") close(true);
        else if (e.key === "Tab") return close(false);
        else return;
        e.preventDefault();
    };
    const onButtonKey = (e) => { if (e.key === "Escape") close(true); };
    // §27d: a greyed (aria-disabled) row is skipped; the bar stays put.
    const onOver = (e) => { const r = e.target.closest(`[${attr}]`); if (r && r.getAttribute("aria-disabled") !== "true") hi(r); };
    const onLeave = () => hi(home());
    const onOutside = (e) => { if (!wrap.contains(e.target)) close(false); };
    button.addEventListener("click", onButton);
    button.addEventListener("keydown", onButtonKey);
    menu.addEventListener("click", onRow);
    menu.addEventListener("keydown", onKey);
    menu.addEventListener("pointerover", onOver);
    menu.addEventListener("pointerdown", onDown);
    menu.addEventListener("focusin", onOver);
    menu.addEventListener("pointerleave", onLeave);
    document.addEventListener("pointerdown", onOutside);
    // §33a: swap the rows when the item list changed (keys or labels).
    const setItems = (next, active) => {
        if (next.map((p) => p.key + p.label).join("\n") === list.map((p) => p.key + p.label).join("\n")) return;
        list = next;
        menu.innerHTML = next.map((p) => renderRow(kind, p, active)).join("\n");
        grab();
        set(active);
    };
    return {
        set,
        setItems,
        detach: () => {
            button.removeEventListener("click", onButton);
            button.removeEventListener("keydown", onButtonKey);
            menu.removeEventListener("click", onRow);
            menu.removeEventListener("keydown", onKey);
            menu.removeEventListener("pointerover", onOver);
            menu.removeEventListener("pointerdown", onDown);
            menu.removeEventListener("focusin", onOver);
            menu.removeEventListener("pointerleave", onLeave);
            document.removeEventListener("pointerdown", onOutside);
        }
    };
};

/* ---- The Worker (§16) -------------------------------------------------- */

// The Worker's tile edge, wall units (worker/src/graffiti.js TILE), and its
// cap on tiles per GET (MAX_GET_TILES).
export const TILE = 1024;
const GET_TILES = 64;
// Pause after the last pan / zoom / scroll before the tiles in view are asked
// for, ms. FLAG for the user.
export const LOAD_DEBOUNCE = 300;
// §52 the live socket (worker/src/graffiti.js LIVE_POINTS, LIVE_TOOLS): the
// reader's line goes out every LIVE_MS (~20 messages/s); another artist's
// name stays LABEL_MS after their last point, a finished live line at most
// GONE_MS waiting for its saved stroke; a dropped socket retries after
// LIVE_RETRY_MS. FLAG the times for the user.
export const LIVE_MS = 50;
// CHECKLIST-31 §3: the live messages a second one page's drawers share. The
// whole wall is one Durable Object (~1,000 messages/s before it overloads, and
// each message fans out to every socket on the page), so with `drawers` people
// drawing the reader sends every liveGap ms: LIVE_MS alone and up to 25, 200
// at 100. The Worker drops past LIVE_RATE (30) a socket. FLAG for the user.
export const LIVE_BUDGET = 500;
export const liveGap = (drawers) => Math.max(LIVE_MS, (drawers * 1000) / LIVE_BUDGET);
export const LIVE_POINTS = 64;
export const LIVE_TOOLS = ["pencil", "graphite", "pen"];
export const LABEL_MS = 2000;
export const GONE_MS = 10_000;
export const LIVE_RETRY_MS = 5000;

// §10b: a stroke's line id as the tip shows it, upper-case hex of at least 2
// chars, growing: 00…FF, 100… (the Worker's lineLabel, worker/src/graffiti.js;
// worker/ does not ship, so it is not imported).
export const lineLabel = (n) => n.toString(16).toUpperCase().padStart(2, "0");

// Every tile "tx,ty" a wall-unit box touches.
export const tilesIn = (x0, y0, x1, y1) => {
    const out = [], t = (v) => Math.floor(v / TILE);
    for (let tx = t(x0); tx <= t(x1); tx++) for (let ty = t(y0); ty <= t(y1); ty++) out.push(`${tx},${ty}`);
    return out;
};

/*
 * The five graffiti calls (CLAUDE.md), each resolving to the reply, true for a
 * 204, "taken" for a 409 {"error":"taken"}, or null on any failure — never
 * throws, never waits past TIMEOUT. The member token is Ghost's, fetched once
 * by sync.js's getToken; the tile read goes without it (public, cached).
 * sync.js is imported lazily, as counts.js does, so Storybook never loads it.
 */
const TIMEOUT = 8000;
export const graffitiApi = () => {
    let token, sync;
    // sync and token are memoised: one task hop at most per call.
    // §48: no keepalive any more; browsers cap its body near 64 KB, under a
    // big wash (WASH_MAX 256 KB). The §41 browser copy waits for a real POST.
    // §68: Ghost's member token lives 10 minutes. It was fetched once per
    // page, so every POST and DELETE past minute 10 got a 401 — and a failed
    // erase is silent, so the mark came back on reload. Now a 401, or a token
    // that never came, drops the token; the call fetches a fresh one and is
    // sent once more.
    const call = async (path, { method = "GET", body, auth = true } = {}, again = auth) => {
        try {
            const { SYNC_BASE, getToken } = await (sync ??= import("./sync.js"));
            const headers = {};
            if (auth) {
                token ??= getToken().catch(() => null);
                const t = await token;
                if (!t) { token = undefined; return again ? call(path, { method, body, auth }, false) : null; }
                headers.Authorization = `Bearer ${t}`;
            }
            // §28b: a wash's body is its PNG, sent as is.
            const png = body instanceof Blob;
            if (body) headers["Content-Type"] = png ? "image/png" : "application/json";
            const res = await fetch(`${SYNC_BASE}${path}`, { method, headers, body: png ? body : body && JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT) });
            if (res.status === 401 && again) { token = undefined; return call(path, { method, body, auth }, false); }
            if (res.status === 409) return (await res.json()).error === "taken" ? "taken" : null;
            // §68b: the erase queue tells "wait and resend" (429, the Worker's
            // 120 writes a minute) from any other failure.
            if (res.status === 429 && path === "/graffiti/erase") return "slow";
            if (!res.ok) return null;
            return res.status === 204 ? true : await res.json();
        } catch {
            return null;
        }
    };
    return {
        me: () => call("/graffiti/me"),
        // §27a: page rides on both; misc is sent as absent, so the GET's URL
        // (and its cache) for Misc. is the one it always was. A Worker from
        // before §27a ignores page: everything lands on, and reads as, Misc.
        // §28b: each wash comes back with its PNG's URL as `src`.
        load: async (tiles, page = "misc") => {
            const r = await call(`/graffiti?tiles=${tiles.join(";")}${page === "misc" ? "" : `&page=${page}`}`, { auth: false });
            if (r?.washes?.length || r?.cards?.length) {
                const { SYNC_BASE } = await import("./sync.js");
                for (const w of r.washes ?? []) w.src = `${SYNC_BASE}/graffiti/washes/${encodeURIComponent(w.id)}`;
                for (const c of r.cards ?? []) c.src = c.image ? `${SYNC_BASE}/graffiti/images/${c.image}` : null;
            }
            return r;
        },
        // §65: link previews, memes, saved cards. The Worker's image id rides as imageId; src is its URL.
        link: async (url) => {
            const r = await call(`/graffiti/link?url=${encodeURIComponent(url)}`);
            if (!r) return null;
            const { SYNC_BASE } = await import("./sync.js");
            return { ...r, imageId: r.image, image: r.image ? `${SYNC_BASE}/graffiti/images/${r.image}` : null };
        },
        memes: (q, offset = 0) => call(`/graffiti/memes?q=${encodeURIComponent(q)}&offset=${offset}`),
        card: (body) => call("/graffiti/cards", { method: "POST", body }),
        // §28a: the box rides in the query, the PNG is the body.
        // CHECKLIST-31 §7a: cid, this tab's id for the mark, comes back in the socket's `ink` (see heard).
        wash: (png, { x, y, w, h }, page = "misc", cid) => call(`/graffiti/washes?x=${x}&y=${y}&w=${w}&h=${h}${page === "misc" ? "" : `&page=${page}`}&cid=${cid}`, { method: "POST", body: png }),
        // §25: tool rides along; a Worker from before §25 ignores it.
        save: (points, tool, page = "misc", size, cid) => call("/graffiti/strokes", { method: "POST", body: { points, tool, size, cid, ...(page === "misc" ? {} : { page }) } }),
        // CHECKLIST-31 §1: strokes, washes and cards together, ERASE_BATCH at most; true on 204.
        eraseMany: (ids) => call("/graffiti/erase", { method: "POST", body: { ids } }),
        rename: (name) => call("/graffiti/name", { method: "POST", body: { name } }),
        /* §52: the page's live socket. A member's carries a fresh token in the
           query (a browser socket sends no header); without one it only
           watches. `on` gets each message parsed (a wash with its `src`),
           `gone` the close. Resolves {send, close}, or null if it could not open. */
        live: async (page, on, gone, member) => {
            try {
                const { SYNC_BASE, getToken } = await (sync ??= import("./sync.js"));
                const t = member ? await getToken().catch(() => null) : null;
                const ws = new WebSocket(`${SYNC_BASE.replace(/^http/, "ws")}/graffiti/live?page=${encodeURIComponent(page)}${t ? `&token=${encodeURIComponent(t)}` : ""}`);
                ws.onmessage = (e) => {
                    let m;
                    try { m = JSON.parse(e.data); } catch { return; }
                    if (m.wash) m.wash.src = `${SYNC_BASE}/graffiti/washes/${encodeURIComponent(m.wash.id)}`;
                    if (m.card?.image) m.card.src = `${SYNC_BASE}/graffiti/images/${m.card.image}`;
                    on(m);
                };
                ws.onclose = gone;
                return { send: (m) => ws.readyState === 1 && ws.send(JSON.stringify(m)), close: () => { ws.onclose = null; ws.close(); } };
            } catch {
                return null;
            }
        }
    };
};

// The page's entry (§15 calls it): signed in is the markup's say (the partial
// renders the name field from @member); the name itself comes from the Worker.
// §36: ?wall= opens that page; /graffiti/ (the Ghost page, slug graffiti) or a
// ?wall= link lands on the wall, which sits in every page's footer.
export const connectGraffiti = (root) => {
    const q = new URLSearchParams(location.search).get("wall");
    root.dataset.graffitiPage = wallOf(q);
    if (q !== null || location.pathname === "/graffiti/") root.scrollIntoView();
    // §39a: while the wall is on screen the address bar carries ?wall=<open page>; off screen it is dropped.
    // replaceState, so no reload and no history entry. ponytail: path, other params, hash kept.
    let seen = false;
    const sync = () => {
        const u = new URL(location.href);
        if (seen) u.searchParams.set("wall", root.dataset.graffitiPage || "misc");
        else u.searchParams.delete("wall");
        if (u.href !== location.href) history.replaceState(history.state, "", u);
    };
    if (typeof IntersectionObserver === "function") {
        new IntersectionObserver((e) => { seen = e[e.length - 1].isIntersecting; sync(); }).observe(root);
        new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ["data-graffiti-page"] });
    }
    return attachGraffiti(root, { member: root.querySelector("[data-graffiti-name]") ? { id: null } : null, api: graffitiApi() });
};

// Palm rejection (§7): once any pen is seen on this page, touches stop drawing.
let penSeen = false;

/* §24 two-finger double tap. A tap is { down, up, move, n }: when its second
   finger went down and its last came up (ms), how far any finger strayed
   (px), and the most fingers down. Two of them make a double tap when each is
   two fingers, short and still, and the second starts soon after the first
   ends. Slop and timings, not spacings; FLAG for the user. */
export const TAP_MS = 300;
export const TAP_HOLD = 250;
export const TAP_SLOP = 12;
export const UNDO_TOAST_MS = 1600;
export const doubleTap = (a, b) =>
    !!a && !!b && [a, b].every((t) => t.n === 2 && t.up - t.down <= TAP_HOLD && t.move <= TAP_SLOP) && b.down - a.up <= TAP_MS;

/*
 * opts:
 *   member   { id } signed in, or null. The id goes on every stroke and is
 *            never shown (§10).
 *   strokes  [{ id, artist, at, points: [[x, y, f?]…], tool? }] — drawn in
 *            `at` order, later over earlier (§10). tool "pencil" or "pen"
 *            (§25); absent is "pen", the nib every older stroke was drawn in.
 *            page (§27a) one of PAGES' keys; absent is "misc". Only the
 *            current page's strokes are drawn.
 *   washes   [{ id, artist, at, box: { x, y, w, h }, page?, src }] — dried
 *            watercolor (§28b), drawn in `at` order with the strokes; src is
 *            the PNG (the Worker's URL, or a fixture's data URL).
 *   taken    names already held, for the uniqueness check (§9, Phase 1).
 *   artists  { memberId: display name } for the §10a tip; Phase 2 (§12 §13)
 *            fills it from the Worker. Missing -> "Unknown artist".
 *   onStroke(stroke), onErase(id), onName(name)  — hooks (Storybook logs).
 *            onName may resolve "taken" (§17).
 *   api      graffitiApi() on the page (§16); absent in Storybook, so the
 *            fixture path makes no call. With it the wall loads the tiles in
 *            view, saves each finished stroke, deletes erased ones, takes the
 *            name and member id from GET /graffiti/me and claims edits with
 *            POST /graffiti/name. A saved stroke keeps its local id (its ink
 *            is seeded from it) and gets the server's as `sid`, plus its `line`.
 *            A failed save keeps the local stroke; a failed erase is silent.
 * Returns detach().
 */
export const attachGraffiti = (root, { member = null, strokes = [], washes = [], taken = [], artists = {}, links = [], onStroke, onErase, onName, api = null, wetDryMs = WET_DRY_MS, scrollRoot = window } = {}) => {
    // Fork only (CHECKLIST-36 §24a, diverges from the theme): the theme's page scrolls
    // window; in ryOS the Paint window's div does. vTop/vBot are its visible edges.
    const sr = scrollRoot;
    const vTop = () => (sr === window ? 0 : sr.getBoundingClientRect().top);
    const vBot = () => (sr === window ? innerHeight : sr.getBoundingClientRect().bottom);
    // The page passes the section itself (home.js etc.), Storybook a wrapper.
    const section = root.matches?.("[data-graffiti]") ? root : root.querySelector("[data-graffiti]");
    if (!section) return () => {};
    const box = section.querySelector(".qntns-graffiti__box");
    if (penSeen) box.setAttribute("data-pen-seen", ""); // §23: a pen seen before this mount
    const view = section.querySelector("[data-graffiti-view]");
    const canvas = section.querySelector("[data-graffiti-canvas]");
    // §21: desynchronized lets Chrome put the canvas on screen without waiting
    // for the page's compositor; browsers without it ignore the hint.
    const ctx = canvas.getContext("2d", { desynchronized: true });
    const css = getComputedStyle(section);
    const ink = css.getPropertyValue("--color-ink").trim() || "navy";
    const dots = css.getPropertyValue("--graffiti-dot").trim() || ink;
    // §28b: the watercolor blue as bytes (wetBytes writes pixels).
    const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    probe.canvas.width = probe.canvas.height = 1;
    probe.fillStyle = css.getPropertyValue("--graffiti-wash").trim() || "royalblue";
    probe.fillRect(0, 0, 1, 1);
    const washRgb = [...probe.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    // A loaded wash's image; it repaints the bake when it arrives.
    const washImg = (src) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => { ver++; schedule(); };
        img.src = src;
        return img;
    };

    const corner = attachCorner(section, {
        taken,
        onName: async (n) => {
            const r = await onName?.(n);
            if (r === "taken" || !api) return r;
            const got = await api.rename(n);
            if (got?.id) artists[got.id] = got.name;
            return got;
        }
    });
    /* §27 §27a: each page is its own wall. `walls` holds every page's strokes
       (a fixture's `page`, absent = misc); `all` is the current page's, and
       everything that draws, picks, erases or undoes reads `all` alone.
       Switching swaps it, re-homes on that page's ink and loads its tiles. */
    let page = section.dataset.graffitiPage || "misc";
    const walls = {};
    const dried = washes.map((w) => ({ ...w, tool: "wash", img: washImg(w.src) }));
    for (const st of [...strokes, ...dried].sort((a, b) => a.at - b.at)) (walls[st.page ?? "misc"] ??= []).push(st);
    let all = (walls[page] ??= []);
    const pagesOff = attachPages(section, { onPage: (k) => switchPage(k) });
    const cam = { x: 0, zoom: 1 };
    let tool = "hand";
    let live = null;
    let frame = 0;
    let ox = 0;
    let inkBox = inkBounds(all);
    // §5a: the loaded ink's centre, wall units; null on an empty wall.
    let mid = inkBox && (inkBox.x0 + inkBox.x1) / 2;
    let homed = false;
    // §73: the cards' box, set by a fit (cards are not in inkBox); cleared by home.
    let cardBox = null;
    const bottom = () => Math.max(0, inkBox?.y1 ?? 0, cardBox?.y1 ?? 0);

    const base = () => DOT_PX / GRID;
    const scale = () => base() * cam.zoom;
    const home = () => (mid === null ? 0 : mid - box.clientWidth / 2 / base());
    // Client px -> wall units. Y is measured from the box's top: the page
    // owns it.
    const toWall = (cx, cy) => {
        const r = canvas.getBoundingClientRect(), s = scale();
        return [(cx - r.left - ox) / s + cam.x, (cy - box.getBoundingClientRect().top) / s];
    };
    const point = (e) => {
        const [x, y] = toWall(e.clientX, e.clientY), f = widthFactor(e), t = tiltOf(e);
        const p = [+x.toFixed(2), +y.toFixed(2)];
        if (f !== 1 || t) p.push(+f.toFixed(2));
        if (t) p.push(t); // §46b
        return p;
    };

    // The fog (§5, answers-3, X only): the view stays inside the home view
    // (§5a) joined with the ink's left/right edges pushed out by ROOM_CELLS grid cells.
    // §49: camRange() is cam.x's [min, max]; a drag or fling may run past it
    // (the overscroll) and springs back; everything else clamps hard.
    const camRange = () => {
        const b0 = base(), s = scale(), w = canvas.clientWidth;
        const fog = ROOM_CELLS * GRID;
        let x0 = home() - ox / b0, x1 = home() + (w - ox) / b0;
        for (const k of [inkBox, cardBox]) if (k) { x0 = Math.min(x0, k.x0 - fog); x1 = Math.max(x1, k.x1 + fog); }
        // §51: a view wider than the range (a fit, or zoomed far out) centres
        // it rather than pinning it to the left edge.
        if (x1 - x0 < w / s) x0 = x1 = (x0 + x1 - w / s) / 2;
        return [x0 + ox / s, clampAxis(Infinity, w / s, x0, x1) + ox / s];
    };
    const clampView = () => {
        const [a, b] = camRange();
        cam.x = Math.min(Math.max(cam.x, a), b);
    };

    // A settled stroke's drawn shape never changes, so it is computed once.
    const shapes = new WeakMap();
    let grain = null;
    const shapeOf = (st) => { let sh = shapes.get(st); if (!sh) shapes.set(st, sh = inkShape(st)); return sh; };
    /* §46c: a graphite stroke's shape as painted, its own artist's later
       smudges (and the live one) counted in. Cached per wall version: a
       smudge drawn, erased or undone bumps `ver`, as does every live smudge
       frame. Hit tests keep shapeOf: the eraser's reach does not widen. */
    const smudged = new WeakMap();
    const smudgedOf = (st) => {
        if (st.tool !== "graphite") return shapeOf(st);
        const had = smudged.get(st);
        if (had?.ver === ver) return had.sh;
        const passes = all.filter((s) => s.tool === "smudge" && s.artist === st.artist && s.at > st.at).map((s) => s.points);
        if (live?.tool === "smudge" && live.artist === st.artist) passes.push(live.points);
        const sh = smudgeShape(shapeOf(st), passes);
        smudged.set(st, { ver, sh });
        return sh;
    };

    /* §10a. The topmost stroke (latest `at`, the last in `all`) within PICK_PX
       screen px of a client point, or undefined. */
    const pick = (cx, cy) => {
        const p = toWall(cx, cy), r = PICK_PX / scale();
        return all.findLast((st) => touches(st, p, r));
    };
    /* Does wall point p, within r, touch this stroke or wash? A wash is hit by
       its box, then by its alpha at the nearest point inside (§28b); an image
       that cannot be read (CORS) counts as a hit. */
    const touches = (st, p, r) => {
        if (!st.box) return hits(shapeOf(st), p, r, reachOf(st.tool));
        const { x, y, w, h } = st.box;
        if (p[0] < x - r || p[1] < y - r || p[0] > x + w + r || p[1] > y + h + r) return false;
        try {
            probe.clearRect(0, 0, 1, 1);
            probe.drawImage(st.img, x - Math.min(Math.max(p[0], x), x + w - 1), y - Math.min(Math.max(p[1], y), y + h - 1), w, h);
            return probe.getImageData(0, 0, 1, 1).data[3] > 0;
        } catch {
            return true;
        }
    };
    const tip = section.querySelector("[data-graffiti-tip]");
    const strip = section.querySelector(".qntns-graffiti__strip");
    const closeTip = () => { tip.hidden = true; };
    // The tip sits 8 above the click (graffiti.css), or 8 below it when above
    // would run under the sticky strip; its centre is clamped so it keeps a
    // 16 gutter inside the viewport and never makes the page scroll sideways.
    const showTip = (e) => {
        const st = pick(e.clientX, e.clientY);
        if (!st) return;
        const mine = member && st.artist === member.id && section.querySelector("[data-graffiti-name]")?.value;
        // §10b: name then the line's number; separator FLAG for the user.
        tip.textContent = (mine || artists[st.artist] || "Unknown artist") + (Number.isInteger(st.line) ? ` ${lineLabel(st.line)}` : "");
        tip.hidden = false;
        const b = box.getBoundingClientRect(), half = tip.offsetWidth / 2;
        const vw = document.documentElement.clientWidth;
        const x = Math.min(Math.max(e.clientX, 16 + half), vw - 16 - half);
        tip.style.left = `${x - b.left}px`;
        tip.style.top = `${e.clientY - b.top}px`;
        tip.toggleAttribute("data-below", e.clientY - 8 - tip.offsetHeight < strip.getBoundingClientRect().bottom);
    };
    // Hover (§10a add): pointer cursor over a line under Hand, mouse / pen with
    // no button down. One hit test per frame.
    let hoverAt = null;
    const hover = (e) => {
        if (e.pointerType === "touch") return;
        if (e.buttons || (tool !== "hand" && !sel && !pending && !holding)) { unhover(); return; }
        if (!hoverAt) requestAnimationFrame(() => {
            if (hoverAt && tool === "hand") {
                box.toggleAttribute("data-over-ink", !!pick(...hoverAt));
                // §62a: the reader's own link card under the cursor (its body lets presses through to here; the link line is its own <a>).
                const c = cards.findLast((c) => c.page === page && hitCard(c, toWall(...hoverAt)));
                box.toggleAttribute("data-over-own", !!member && !!c && c.kind !== "image" && c.artist === member.id);
            }
            if (hoverAt) box.toggleAttribute("data-over-sel", tool === "lasso" ? overSel(toWall(...hoverAt)) : tool === "link" && hitCard(pending, toWall(...hoverAt))); // §43b §57
            if (hoverAt && tool === "image" && holding) { const z = zone(holding, ...hoverAt); if (z) box.dataset.imgZone = cursorOf(z, holding.rot); else delete box.dataset.imgZone; } // §58
            hoverAt = null;
        });
        hoverAt = [e.clientX, e.clientY];
    };
    const unhover = () => { hoverAt = null; box.removeAttribute("data-over-ink"); box.removeAttribute("data-over-own"); box.removeAttribute("data-over-sel"); if (!gesture) delete box.dataset.imgZone; };

    /* §21 LAYERS. `bake` holds the grid and every settled stroke, painted for
       one zoom, dpr and `ver` of the stroke set, over a band up to 3
       view-heights (4096 rows) tall from bakeTop (§32a) and as wide as §49's
       tiles reach; a scroll or pan frame is a blit of the band's slice, and it
       is repainted only when one of those changes or the view leaves the band. A
       stroke that lands on top is added to it, not a repaint. `wet` holds the
       live stroke's frozen part (liveInk), painted once per sample. A frame
       while drawing is two blits and the live stroke's tail. */
    const wet = document.createElement("canvas"), wctx = wet.getContext("2d");
    let ver = 0, wetKey = "", wetZ = 0, bakeTop = 0;
    // §47: the paper lasts the session (sessionStorage); a new visit is Dot grid.
    let paper = "dots";
    try { const p = sessionStorage.getItem("graffiti-paper"); if (PAPERS.some(([k]) => k === p)) paper = p; } catch { /* Dot grid */ }
    // §43: the lasso. sel = { sts, cards, dx, dy }, the picked marks (§59: and cards) and how far
    // they have been dragged (whole wall units); loop = the lasso being drawn.
    const dim = document.createElement("canvas");
    let sel = null, loop = null;
    /* §28b the wet layer: pool.d is the pigment field in wall units from
       pool.at (null when dry), pool.c the RGBA it shows (wetBytes), redone over
       pool.dirty on the next frame; box = the painted extent in pool px.
       m is the live stroke's mask (its own dabs by max), t the live tail's,
       redone each frame; waterBase is the field at a water press.
       ponytail: four POOL² float arrays (16 MB), allocated at the first wet
       stroke; halve to bytes if a phone minds. */
    const pool = { c: document.createElement("canvas"), at: null, box: null, dirty: null, d: null, m: null, t: null, e: null };
    const pctx = pool.c.getContext("2d", { willReadFrequently: true });
    let sim; // §28d: the WebGL flow, made at the first wet stroke; null = 2D only
    let waterBase = null, stampAt = { p: null }, tailRect = null, strokeRect = null, wetN = 0;
    /* §37a THE MELT. d takes a finished stroke's whole blend at once (§37's
       field, exactly); what the reader sees eases from the stamped look to it
       over MELT_MS: pool.e is -dl x (1 - f) summed over the melts still
       running, rebuilt each frame and added to d for the show only, f a
       smoothstep of the time since the stroke ended. Nothing in d waits, so
       a stroke begun mid-melt blends into the same paint it would have. */
    const melts = [];
    const meltStep = () => {
        if (!melts.length) return;
        const now = performance.now();
        let U = null;
        for (const r of melts) U = union2(U, r);
        clearOver(pool.e, U);
        for (let k = melts.length - 1; k >= 0; k--) {
            const r = melts[k], u = Math.min(1, (now - r.t0) / MELT_MS), f = u * u * (3 - 2 * u);
            if (u >= 1) { melts.splice(k, 1); continue; }
            const w = r.x1 - r.x0;
            for (let y = r.y0; y < r.y1; y++) for (let x = r.x0, j = (y - r.y0) * w; x < r.x1; x++, j++) pool.e[y * POOL + x] -= r.dl[j] * (1 - f);
        }
        pool.dirty = union2(pool.dirty, U);
        if (melts.length) schedule();
    };
    /* §28c §28f: while anything is wet the "Watercolor is wet" toast stands
       with its Dry button, and Water is enabled; dry (any way) or undo takes
       both back, and Water falls back to Watercolor if it was the tool. */
    let wetToast = null, wetOn = false;
    const waterBtns = () => section.querySelectorAll('[data-graffiti-tool="water"]');
    const setWet = (on) => {
        wetOn = on;
        status(); // §56: a wet wash is unsaved ink
        if (on && !wetToast) wetToast = showToast(document, { title: "Watercolor is wet", body: "", icon: "brush", action: { label: "Dry watercolor", icon: "droplet", onClick: () => dry() } });
        if (!on && wetToast) { wetToast(); wetToast = null; }
        waterBtns().forEach((b) => { if (on) { b.removeAttribute("aria-disabled"); b.removeAttribute("title"); } else { b.setAttribute("aria-disabled", "true"); b.setAttribute("title", offTitle("water", true)); } });
        if (!on && tool === "water") setTool("watercolor");
    };
    const poolStart = (x, y) => {
        if (pool.at) return;
        setWet(true);
        pool.c.width = pool.c.height = POOL; // also clears it
        pool.d ??= new Float32Array(POOL * POOL); pool.d.fill(0);
        pool.m ??= new Float32Array(POOL * POOL); pool.m.fill(0);
        pool.t ??= new Float32Array(POOL * POOL); pool.t.fill(0);
        pool.e ??= new Float32Array(POOL * POOL); pool.e.fill(0);
        melts.length = 0;
        if (sim === undefined) sim = wetGl(POOL, PAPER, PAPER_T);
        sim?.reset();
        pool.at = { x: Math.round(x) - POOL / 2, y: Math.round(y) - POOL / 2 };
        pool.box = null;
    };
    const union2 = (a, b) => (a && b ? { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) } : a || b);
    const clearOver = (a, r) => { if (r) for (let y = r.y0; y < r.y1; y++) a.fill(0, y * POOL + r.x0, y * POOL + r.x1); };
    const wetGrow = (r) => {
        if (!r) return;
        pool.box = union2(pool.box, r);
        pool.dirty = union2(pool.dirty, r);
    };
    // Shape samples (wall) to pool px.
    const toPool = (sh) => sh.map((p) => [p[0] - pool.at.x, p[1] - pool.at.y, p[2]]);
    // pool.c over pool.dirty: what the wet layer shows, live tail included.
    const flush = () => {
        const r = pool.dirty;
        if (!r) return;
        pool.dirty = null;
        const w = r.x1 - r.x0, h = r.y1 - r.y0;
        if (w <= 0 || h <= 0) return;
        pctx.putImageData(new ImageData(wetBytes(pool.d, POOL, r.x0, r.y0, w, h, washRgb, pool.at.x, pool.at.y, PAPER_WET, 1, live?.tool === "watercolor" ? pool.t : null, pool.m, pool.e), w, h), r.x0, r.y0);
    };
    /* §5 THE POOL ROLLS. A dab within POOL_EDGE of the pool's edge recentres
       the pool near it (ax): what falls outside the new pool dries now (bakeWash per
       band, one undo entry), the rest shifts with every rect and point that
       names pool px. Melts in flight finish at once.
       ponytail: paint left behind dries, so wet-on-wet and Water reach only
       the last 1024 units; a pre-save from before a roll still holds the
       dried part, so a tab killed mid-stroke (no pagehide) posts it twice. */
    const inPool = (p) => { const x = p[0] - pool.at.x, y = p[1] - pool.at.y; return x >= POOL_EDGE && y >= POOL_EDGE && x < POOL - POOL_EDGE && y < POOL - POOL_EDGE; };
    const shiftA = (a, sx, sy) => { // new (x, y) = old (x + sx, y + sy)
        const n = new Float32Array(POOL * POOL);
        if (a && Math.abs(sx) < POOL && Math.abs(sy) < POOL) for (let y = Math.max(0, -sy); y < Math.min(POOL, POOL - sy); y++) n.set(a.subarray((y + sy) * POOL + Math.max(0, sx), (y + sy) * POOL + Math.min(POOL, POOL + sx)), y * POOL + Math.max(0, -sx));
        return n;
    };
    const roll = (p) => {
        if (inPool(p)) return;
        // Per axis: the new centre as near the middle of the paint and brush
        // as keeps the brush 3 POOL_EDGE (384) inside, so the next roll is 256 away.
        const b = pool.box, R = POOL / 2 - 3 * POOL_EDGE, ax = (c, b0 = c, b1 = c) => Math.round(Math.min(c + R, Math.max(c - R, (Math.min(b0, c) + Math.max(b1, c)) / 2))) - POOL / 2;
        const sx = ax(p[0] - pool.at.x, b?.x0, b?.x1), sy = ax(p[1] - pool.at.y, b?.y0, b?.y1);
        const mv = (r) => { const q = r && { x0: Math.max(0, r.x0 - sx), y0: Math.max(0, r.y0 - sy), x1: Math.min(POOL, r.x1 - sx), y1: Math.min(POOL, r.y1 - sy) }; return q && q.x1 > q.x0 && q.y1 > q.y0 ? q : null; };
        if (b) {
            const W = { x0: sx, y0: sy, x1: sx + POOL, y1: sy + POOL }, my0 = Math.max(b.y0, W.y0), my1 = Math.min(b.y1, W.y1);
            const bands = [
                { x0: b.x0, y0: b.y0, x1: b.x1, y1: Math.min(b.y1, W.y0) },
                { x0: b.x0, y0: Math.max(b.y0, W.y1), x1: b.x1, y1: b.y1 },
                { x0: b.x0, y0: my0, x1: Math.min(b.x1, W.x0), y1: my1 },
                { x0: Math.max(b.x0, W.x1), y0: my0, x1: b.x1, y1: my1 }
            ].filter((r) => r.x1 > r.x0 && r.y1 > r.y0);
            commitWash(bands.flatMap((r) => { const st = bakeWash(r); return st ? split(st) : []; }));
        }
        pool.d = shiftA(pool.d, sx, sy); pool.m = shiftA(pool.m, sx, sy);
        if (waterBase) waterBase = shiftA(waterBase, sx, sy);
        pool.t.fill(0); pool.e.fill(0); melts.length = 0; tailRect = null;
        pool.at = { x: pool.at.x + sx, y: pool.at.y + sy };
        pool.box = mv(b); strokeRect = mv(strokeRect);
        if (stampAt.p) stampAt.p = [stampAt.p[0] - sx, stampAt.p[1] - sy];
        pctx.clearRect(0, 0, POOL, POOL);
        pool.dirty = pool.box && { ...pool.box };
    };
    // Wall samples sh[from..] dabbed into d and m (strokeRect grows), the
    // pool rolled before any of them nears its edge.
    const dabWet = (sh, from) => {
        for (let i = from, j; i < sh.length; i = j) {
            roll(sh[i]);
            for (j = i + 1; j < sh.length && inPool(sh[j]); j++);
            wetGrow(strokeRect = union2(strokeRect, stampAlong(pool.d, pool.m, POOL, POOL, toPool(sh.slice(i, j)), 0, stampAt, pool.at.x, pool.at.y)));
        }
    };
    // The live wet stroke this frame: frozen samples dab into d once, the
    // tail into t afresh.
    const liveWet = () => {
        const { tail, z } = live.ink.frame(live.pred);
        if (!tail.length) return;
        if (wetN === 0) { poolStart(tail[0][0], tail[0][1]); stampAt = { p: null }; }
        if (wetN < z) { dabWet(live.ink.out.slice(wetN, z), 0); wetN = z; }
        clearOver(pool.t, tailRect); wetGrow(tailRect);
        wetGrow(tailRect = stampAlong(null, pool.t, POOL, POOL, toPool(tail), 0, { p: stampAt.p }, pool.at.x, pool.at.y));
    };
    // A finished wet stroke: the rest of its dabs, blended into the paint under it.
    const wetPaint = (st) => {
        const sh = inkShape(st);
        if (!sh.length) return;
        if (wetN === 0) { poolStart(sh[0][0], sh[0][1]); stampAt = { p: null }; }
        clearOver(pool.t, tailRect); wetGrow(tailRect); tailRect = null;
        dabWet(sh, Math.min(wetN, sh.length - 1));
        const r = strokeRect;
        wetN = 0; strokeRect = null;
        if (!r) return;
        const r2 = wetBlend(pool.d, pool.m, POOL, POOL, r, WET_SPREAD, true); // §37: grows r by WET_SPREAD
        clearOver(pool.m, r);
        wetGrow(r2);
        melts.push({ ...r2, t0: performance.now() }); // §37a
        wetTouch();
    };
    // One water sample at wall p, dragged from q. Nothing while dry.
    const wetWater = (p, q) => {
        if (!pool.at) return;
        waterBase ??= pool.d.slice();
        const cx = p[0] - pool.at.x, cy = p[1] - pool.at.y, dx = p[0] - q[0], dy = p[1] - q[1];
        if (!waterOn(pool.d, waterBase, POOL, POOL, cx, cy, dx, dy)) return;
        const M = WATER_R + Math.ceil(Math.hypot(dx, dy)) + 2;
        wetGrow({ x0: Math.max(0, Math.floor(cx - M)), y0: Math.max(0, Math.floor(cy - M)), x1: Math.min(POOL, Math.ceil(cx + M)), y1: Math.min(POOL, Math.ceil(cy + M)) });
    };
    // How far the sticky view has slid down the box, px.
    const slide = () => canvas.getBoundingClientRect().top - box.getBoundingClientRect().top;
    const viewKey = () => `${canvas.width},${canvas.height},${devicePixelRatio},${cam.x},${cam.zoom},${ox}`;
    // Band height in bitmap px: up to 3 views, capped at 4096 rows. Measured
    // (§32a): Chromium drops ink past row 4096 of a taller bake. 4096 rows also
    // keeps each §49 tile (BAKE_TILE × 4096 = 4.2M px) far under iOS Safari's
    // 16,777,216 px per-canvas cap. Never under one view.
    const bandPx = () => Math.max(canvas.height, Math.min(3 * canvas.height, 4096));
    // §49: the view's left edge in band bitmap px (wall x × scale × dpr),
    // whole px so a tile blit is never resampled; every layer draws at it.
    const viewL = () => Math.round((cam.x * scale() - ox) * (devicePixelRatio || 1));
    // Ink settings for wall-unit drawing on any of the three contexts; lx is
    // the drawn area's left edge in band px / dpr.
    const inkOn = (c, oy, lx = viewL() / (devicePixelRatio || 1)) => {
        const dpr = devicePixelRatio || 1, s = scale();
        c.setTransform(dpr * s, 0, 0, dpr * s, -dpr * lx, -dpr * oy);
        c.fillStyle = c.strokeStyle = ink;
        c.lineCap = c.lineJoin = "round";
        c.lineWidth = HAIRLINE;
        // §2b soft edge: the ink's own colour, blurred EDGE_SOFT wall units
        // (shadowBlur is in bitmap px, untouched by the transform).
        c.shadowColor = ink;
        c.shadowBlur = EDGE_SOFT * s * dpr;
        grain ||= c.createPattern(grainTile(ink), "repeat");
    };
    const sized = (c, hh = canvas.height, ww = canvas.width) => {
        if (c.width !== ww || c.height !== hh) { c.width = ww; c.height = hh; }
        const g = c.getContext("2d");
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, c.width, c.height);
        return g;
    };
    /* §49 THE BAND IS WIDE TOO. The bake is BAKE_TILE-column tiles anchored to the
       wall (tile i is band columns i·BAKE_TILE to (i+1)·BAKE_TILE, band px = wall x ×
       scale × dpr), all bandPx() rows tall from bakeTop. A sideways pan or
       fling only blits the tiles under the view. A tile is painted when the
       view reaches one that is missing; once no frame has run for IDLE_MS
       the band is topped up, one tile per task, nearest the view first,
       up to BAND_AREA px, never past where the camera can go. A wall whose
       whole reach fits in BAND_AREA is then baked whole: no pan repaints. */
    const tiles = new Map();
    let tileKey = "", topT = 0;
    const bandKey = () => `${bandPx()},${devicePixelRatio},${cam.zoom},${ver},${paper}`;
    const drop = (i) => { const t = tiles.get(i); t.width = t.height = 0; tiles.delete(i); };
    // A new key, or the view leaving the band's rows, drops every tile and
    // centres the band's rows on the view, an equal margin above and below.
    const band = (oy) => {
        const dpr = devicePixelRatio || 1;
        if (tileKey === bandKey() && oy >= bakeTop && (oy - bakeTop) * dpr + canvas.height <= bandPx()) return;
        for (const i of [...tiles.keys()]) drop(i);
        tileKey = bandKey();
        bakeTop = oy - (bandPx() / dpr - canvas.clientHeight) / 2;
    };
    // §70: with `clip` (a wall-unit rect) and the tile present, only that
    // rect of it is cleared and repainted, in place; the rest is kept, and
    // only the strokes whose bounds (reach in, plus SMEAR_PAD for the soft
    // edge and a smudge's spread) touch the rect are drawn into it.
    const bounds = new WeakMap();
    const inRect = (st, c) => { // not `hits`: that name is the module's stroke hit test, which touches() calls
        let b = bounds.get(st);
        if (!b) bounds.set(st, b = inkBounds([st]));
        return b.x0 - SMEAR_PAD < c.x1 && b.x1 + SMEAR_PAD > c.x0 && b.y0 - SMEAR_PAD < c.y1 && b.y1 + SMEAR_PAD > c.y0;
    };
    const paintTile = (i, clip) => {
        const had = clip && tiles.get(i);
        if (!had) canvas.bakes = (canvas.bakes || 0) + 1; // §49 check: tiles painted, read headless
        const t = had || document.createElement("canvas"), g = had ? t.getContext("2d") : sized(t, bandPx(), BAKE_TILE);
        const dpr = devicePixelRatio || 1, s = scale(), L = (i * BAKE_TILE) / dpr, h = t.height / dpr, top = bakeTop;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (had) {
            const cx = clip.x0 * s - L, cy = clip.y0 * s - top, cw = (clip.x1 - clip.x0) * s, ch = (clip.y1 - clip.y0) * s;
            g.save();
            g.beginPath();
            g.rect(cx, cy, cw, ch);
            g.clip();
            g.clearRect(cx, cy, cw, ch);
        }
        // §47 §50 the paper, anchored to the wall like the tile. Dots 2px and
        // lines 1px (the hairline exemption) at zoom 1, scaled with the zoom
        // like ink, capped at 8 / 4 zoomed in. Under 1px they fade (alpha =
        // size) and under 0.25px are not drawn, at any zoom, a §51 fit below
        // MIN_ZOOM included. Bake only: never in a posted PNG.
        const w = BAKE_TILE / dpr, x0 = L / s, x1 = (L + w) / s, y0 = top / s, y1 = (top + h) / s;
        const mark = Math.min(paper === "dots" ? 8 : 4, (paper === "dots" ? 2 : 1) * cam.zoom);
        if (paper !== "none" && mark >= 0.25) {
            g.fillStyle = dots;
            g.shadowBlur = 0; // paper is crisp
            g.globalAlpha = Math.min(1, mark);
            const m = Math.max(1, mark), step = paper === "wide" ? 2 * GRID : GRID;
            // Snapped to whole px: a 1px hairline lands on one row, not two at half alpha.
            const X = (gx) => Math.round(gx * s - L - m / 2), Y = (gy) => Math.round(gy * s - top - m / 2);
            if (paper === "dots")
                for (let gx = Math.ceil(x0 / GRID) * GRID; gx < x1; gx += GRID)
                    for (let gy = Math.ceil(y0 / GRID) * GRID; gy < y1; gy += GRID)
                        g.fillRect(X(gx), Y(gy), m, m);
            for (let gy = Math.ceil(y0 / step) * step; paper !== "dots" && paper !== "iso" && gy < y1; gy += step)
                g.fillRect(0, Y(gy), w, m);
            for (let gx = Math.ceil(x0 / GRID) * GRID; paper === "grid" && gx < x1; gx += GRID)
                g.fillRect(X(gx), 0, m, h);
            if (paper === "iso") {
                // Isometric: lines at 30° and 150°, GRID apart measured
                // vertically, and verticals through every crossing, GRID·√3/2
                // apart (≈ 34.6 units: the geometry, not a base-4 measure).
                const t = Math.tan(Math.PI / 6), dx = (GRID * Math.sqrt(3)) / 2;
                for (let gx = Math.ceil(x0 / dx) * dx; gx < x1; gx += dx) g.fillRect(X(gx), 0, m, h);
                g.strokeStyle = dots;
                g.lineWidth = m;
                g.beginPath();
                for (const d of [t, -t])
                    for (let k = Math.floor((y0 - Math.max(d * x0, d * x1)) / GRID); k * GRID <= y1 - Math.min(d * x0, d * x1); k++) {
                        g.moveTo(x0 * s - L, (k * GRID + d * x0) * s - top);
                        g.lineTo(x1 * s - L, (k * GRID + d * x1) * s - top);
                    }
                g.stroke();
            }
            g.globalAlpha = 1;
        }
        inkOn(g, top, L);
        if (!sel) for (const st of all) { if (!had || inRect(st, clip)) paintOne(g, st); }
        else {
            // §43: a lasso selection is drawn live on top (paint); everything
            // else goes on its own layer, laid over the grid at DIM alpha, so
            // a stroke's hairline and grain don't darken where they overlap.
            // Picking or putting down bumps `ver`: every tile repaints once.
            const d = sized(dim, t.height, BAKE_TILE);
            inkOn(d, top, L);
            for (const st of all) if (!sel.sts.has(st)) paintOne(d, st);
            g.setTransform(1, 0, 0, 1, 0, 0);
            g.globalAlpha = DIM;
            g.shadowColor = "transparent";
            g.drawImage(dim, 0, 0);
            g.globalAlpha = 1;
        }
        if (had) g.restore();
        tiles.set(i, t);
        return t;
    };
    // The tiles the band keeps: as many as BAND_AREA holds, centred on the
    // view, inside the camera's range plus the overscroll.
    const wanted = () => {
        const dpr = devicePixelRatio || 1, s = scale(), [a, b] = camRange(), n = Math.max(1, Math.floor(BAND_AREA / (BAKE_TILE * bandPx())));
        const lo = Math.floor(((a * s - ox - RUBBER) * dpr) / BAKE_TILE), hi = Math.floor(((b * s - ox + RUBBER) * dpr + canvas.width) / BAKE_TILE);
        const i0 = Math.max(lo, Math.min(Math.round((viewL() + canvas.width / 2) / BAKE_TILE - n / 2), hi - n + 1));
        return [i0, Math.min(hi, i0 + n - 1)];
    };
    const topUp = (ms = IDLE_MS) => {
        clearTimeout(topT);
        topT = setTimeout(() => {
            if (frame || flinging) return topUp();
            const [i0, i1] = wanted(), vx = viewL(), v0 = Math.floor(vx / BAKE_TILE), v1 = Math.floor((vx + canvas.width - 1) / BAKE_TILE);
            for (const i of [...tiles.keys()]) if ((i < i0 || i > i1) && (i < v0 || i > v1)) drop(i);
            const c = (v0 + v1) / 2, miss = [];
            for (let i = i0; i <= i1; i++) if (!tiles.has(i)) miss.push(i);
            if (!miss.length) return;
            miss.sort((p, q) => Math.abs(p - c) - Math.abs(q - c));
            paintTile(miss[0]);
            if (miss.length > 1) topUp(0); // next task: input still gets in between
        }, IDLE_MS);
    };
    // A finished stroke is the topmost: draw it on every tile if the band is
    // current; a stale one is repainted with it anyway.
    const bakeOn = (st) => {
        if (tileKey !== bandKey()) return;
        for (const [i, t] of tiles) {
            const g = t.getContext("2d");
            inkOn(g, bakeTop, (i * BAKE_TILE) / (devicePixelRatio || 1));
            paintOne(g, st);
        }
    };
    /* §46c on §49's tiles: a live smudge sample forgets the reader's smudged
       graphite and dirties the rect around its new segment, out to its reach
       (SMUDGE_R plus a lead's width and soft edge, SMEAR_PAD); the next
       paint() repaints just that rect of the tiles it touches (§70: a whole
       tile was 60-80 ms a move with a full wall; the rect is a few ms), so
       the blend shows under the stump on the move that made it. */
    const SMEAR_PAD = 32;
    let rub = null; // the wall-unit rect dirtied since the last frame
    const smear = ([x, y]) => {
        for (const g of all) if (g.tool === "graphite" && g.artist === live.artist) smudged.delete(g);
        const [px, py] = live.points.at(-2) ?? [x, y], r = SMUDGE_R + SMEAR_PAD;
        rub = union2(rub, { x0: Math.min(x, px) - r, y0: Math.min(y, py) - r, x1: Math.max(x, px) + r, y1: Math.max(y, py) + r });
    };
    const flushRub = () => {
        if (!rub) return;
        const k = (scale() * (devicePixelRatio || 1)) / BAKE_TILE;
        for (let i = Math.floor(rub.x0 * k); i <= Math.floor(rub.x1 * k); i++) if (tiles.has(i)) paintTile(i, rub);
        rub = null;
    };
    const paintOne = (g, st) => (st.box ? drawWash(g, st) : painter(st.tool)(g, smudgedOf(st), grain, hash(st.id)));
    const paint = () => {
        frame = 0;
        const raw = slide(), dpr = devicePixelRatio || 1;
        band(raw);
        // Snap down to a whole bitmap row of the band (never past its end), so
        // the slice blit is not resampled; the live layers use the same oy.
        const sy = Math.floor((raw - bakeTop) * dpr), oy = bakeTop + sy / dpr, vx = viewL();
        flushRub(); // §70: a live smudge's dirtied rect, before the tiles are blitted
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.shadowBlur = 0;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (let i = Math.floor(vx / BAKE_TILE); i * BAKE_TILE < vx + canvas.width; i++)
            ctx.drawImage(tiles.get(i) || paintTile(i), 0, sy, BAKE_TILE, canvas.height, i * BAKE_TILE - vx, 0, BAKE_TILE, canvas.height);
        topUp();
        // §28b: a live wet stroke dabs into the pool first; then the wet
        // layer over the bake, multiplied. §41: a live ink stroke goes under
        // the wet layer, where the bake will put it, so drying flips nothing.
        if (live?.tool === "watercolor") liveWet();
        else if (live) {
            const { tail, z } = live.ink.frame(live.pred);
            const key = `${viewKey()},${oy},${live.id}`;
            if (wetKey !== key) { sized(wet); wetKey = key; wetZ = 0; }
            // A one-sample head would draw as a tap; it waits for the next.
            if (z > Math.max(1, wetZ)) {
                inkOn(wctx, oy);
                painter(live.tool)(wctx, live.ink.out.slice(Math.max(0, wetZ - 1), z), grain, hash(live.id));
                wetZ = z;
            }
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.drawImage(wet, 0, 0);
            inkOn(ctx, oy);
            painter(live.tool)(ctx, tail, grain, hash(live.id));
        }
        paintRemote(oy); // §52
        if (cards.length) placeCards(); // §57
        // §43: the selection at its drag offset, over everything dimmed.
        // CHECKLIST-31 §4: painted once per pick (ver, zoom, dpr) onto its own
        // canvas over its ink box, PAD css px each side for the soft edge, and
        // blitted at the drag offset each frame; repainting it every frame was
        // ~170 ms a frame with 330 marks picked. Past SEL_MAX bitmap px it
        // falls back to painting every frame.
        if (sel) {
            const s = scale(), b = sel.sts.size && inkBounds([...sel.sts]), PAD = 32, SEL_MAX = 4096 * 4096;
            const lx = b && b.x0 * s - PAD, ly = b && b.y0 * s - PAD;
            const w = b && Math.ceil(((b.x1 - b.x0) * s + 2 * PAD) * dpr), h = b && Math.ceil(((b.y1 - b.y0) * s + 2 * PAD) * dpr);
            if (b && w * h <= SEL_MAX) {
                const key = `${ver},${s},${dpr}`;
                if (sel.key !== key) {
                    sel.key = key;
                    sel.img ??= document.createElement("canvas");
                    const g = sized(sel.img, h, w);
                    inkOn(g, ly, lx);
                    for (const st of all) if (sel.sts.has(st)) paintOne(g, st);
                }
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.shadowColor = "transparent";
                ctx.drawImage(sel.img, Math.round(dpr * (lx + sel.dx * s) - vx), Math.round(dpr * (ly + sel.dy * s - oy)));
            } else if (b) {
                inkOn(ctx, oy);
                ctx.translate(sel.dx, sel.dy);
                for (const st of all) if (sel.sts.has(st)) paintOne(ctx, st);
            }
        }
        // The lasso: a 1px dashed line (a hairline, not a measurement), dashes 4.
        if (loop?.length > 1) {
            const s = scale();
            inkOn(ctx, oy);
            ctx.shadowColor = "transparent";
            ctx.lineWidth = 1 / s;
            ctx.setLineDash([4 / s, 4 / s]);
            ctx.beginPath();
            for (const p of loop) ctx.lineTo(p[0], p[1]);
            ctx.closePath();
            ctx.stroke();
            ctx.setLineDash([]);
        }
        if (pool.at) {
            // §28d: the wet paint flows for SIM_MS after a touch, then rAF stops.
            if (pool.box && sim?.on()) {
                const r = sim.tick(pool.d, pool.box, pool.at);
                pool.box = r.box; pool.dirty = union2(pool.dirty, r.rect);
                canvas.dataset.wetMs = sim.ms.toFixed(1);
                frame ||= requestAnimationFrame(paint);
            }
            meltStep();
            flush();
            inkOn(ctx, oy);
            ctx.shadowColor = "transparent";
            ctx.globalCompositeOperation = "multiply";
            ctx.drawImage(pool.c, pool.at.x, pool.at.y);
            ctx.globalCompositeOperation = "source-over";
            ctx.setTransform(1, 0, 0, 1, 0, 0);
        }
    };
    const schedule = () => { frame ||= requestAnimationFrame(paint); queueLoad(); setSmudge(); };

    /* §16 LOADING. LOAD_DEBOUNCE after the view last moved, the tiles in view
       not yet asked for are fetched (GET_TILES per call) and merged by server
       id. Until the first reply the view may re-home on what it brings, if no
       one has moved it. ponytail: a tile is asked for once per page; others'
       new lines show on reload. Add a poll if the wall should be live. */
    // asked: per page, a tile asked for on one page is not asked on another.
    const askedBy = {}, known = new Set();
    let asked = (askedBy[page] ??= new Set());
    let loadT = 0, moved = false, firstLoad = true;
    /* §64: the site's gate bar (rules inline in default.hbs, same markup) over
       the canvas from a view's first fetch until every batch has answered or
       GATE_MAX passes. Its 400 ms card delay hides a fast reply. `gating`: the
       next loadView is a first view (mount, page switch); later pans show none. */
    const GATE_MAX = 5000;
    const gate = document.createElement("div");
    gate.className = "qntns-gatebar qntns-graffiti__gate";
    gate.setAttribute("aria-hidden", "true");
    gate.innerHTML = '<div class="qntns-gatebar__card"><p class="qntns-gatebar__label">building<span class="qntns-gatebar__dots"><span class="qntns-gatebar__dot">.</span><span class="qntns-gatebar__dot">.</span><span class="qntns-gatebar__dot">.</span></span></p><div class="qntns-gatebar__rail"><span class="qntns-gatebar__fill"></span></div></div>';
    view.append(gate);
    let gating = true, gateT = 0, gateN = 0;
    const gateOff = () => { clearTimeout(gateT); gateN = 0; gate.classList.remove("is-on"); };
    const queueLoad = () => {
        if (!api) return;
        clearTimeout(loadT);
        loadT = setTimeout(loadView, LOAD_DEBOUNCE);
    };
    const loadView = () => {
        const s = scale(), w = canvas.clientWidth;
        const oy = canvas.getBoundingClientRect().top - box.getBoundingClientRect().top;
        const want = tilesIn(cam.x - ox / s, Math.max(0, oy / s), cam.x + (w - ox) / s, (oy + canvas.clientHeight) / s).filter((t) => !asked.has(t));
        const gated = gating && want.length > 0;
        if (gated) {
            gating = false;
            gateN = Math.ceil(want.length / GET_TILES);
            gate.classList.add("is-on");
            gateT = setTimeout(gateOff, GATE_MAX);
        }
        const done = () => { if (gated && --gateN <= 0) gateOff(); };
        for (let i = 0; i < want.length; i += GET_TILES) {
            const batch = want.slice(i, i + GET_TILES);
            batch.forEach((t) => asked.add(t));
            const at = page, from = asked;
            api.load(batch, at).then((r) => (r ? merge(r, at) : batch.forEach((t) => from.delete(t))), () => batch.forEach((t) => from.delete(t))).finally(done);
        }
    };
    // `at`: the page the tiles were asked for; a reply that lands after a
    // switch goes into that page's wall and draws nothing now.
    const merge = ({ strokes: got = [], washes: wet = [], cards: cs = [], artists: names = {}, drafts }, at = page) => {
        Object.assign(artists, names);
        if (drafts) pagesOff.drafts(drafts); // §33a
        cs.forEach((k) => addSaved(k, at)); // §65
        // A known stroke only takes its line id: a merge (§14a) may relabel it.
        const fresh = [];
        for (const st of [...got, ...wet]) {
            if (!known.has(st.id)) { known.add(st.id); fresh.push(st); continue; }
            const had = all.find((s) => s.sid === st.id);
            if (had) had.line = st.line;
        }
        if (!fresh.length) return;
        const wall = (walls[at] ??= []);
        for (const st of fresh) wall.push(st.box ? { ...st, tool: "wash", page: at, sid: st.id, img: washImg(st.src) } : { ...st, page: at, sid: st.id });
        wall.sort((a, b) => a.at - b.at);
        if (at !== page) return;
        ver++;
        inkBox = inkBounds(all);
        if (firstLoad && !moved) { firstLoad = false; mid = (inkBox.x0 + inkBox.x1) / 2; cam.x = home(); }
        clampView();
        grow();
        schedule();
    };

    const switchPage = (k) => {
        if (k === page) return;
        dry(); // §28b: wet paint dries onto the page it was painted on
        putDown(); // §43: a moved selection is saved on its own page
        closeLink(); // §57: a card being placed stays on its own page
        closeImage(); // §58: so does an image
        page = k;
        gateOff(); gating = true; // §64
        relive(); // §52
        all = (walls[k] ??= []);
        asked = (askedBy[k] ??= new Set());
        live = null;
        ver++;
        closeTip();
        inkBox = inkBounds(all);
        mid = inkBox && (inkBox.x0 + inkBox.x1) / 2;
        stopFling();
        cam.x = home();
        clampView();
        grow();
        canUndo();
        schedule();
    };

    // The box's height follows the ink at the current scale (§5). The sticky
    // view inside it is at most a viewport tall, so this resizes the canvas
    // only while the box is shorter than that.
    const grow = () => {
        const h = boxHeight(bottom(), scale());
        if (box.clientHeight !== h) { box.style.height = `${h}px`; schedule(); }
    };

    const fit = () => {
        // A width change moves the scale and so the box height. Resizing the
        // box from inside the observer that watches the view inside it is a
        // ResizeObserver loop, so it waits a frame.
        requestAnimationFrame(grow);
        const dpr = devicePixelRatio || 1;
        canvas.width = Math.round(canvas.clientWidth * dpr);
        canvas.height = Math.round(canvas.clientHeight * dpr);
        ox = box.getBoundingClientRect().left - canvas.getBoundingClientRect().left;
        if (!homed && box.clientWidth) { homed = true; cam.x = home(); }
        closeTip();
        clampView();
        paint();
        queueLoad();
    };
    // §16: the member's own artist id and name. Lines drawn before it came
    // back take the id now, so the eraser knows them.
    if (api && member) api.me().then((me) => {
        if (!me?.id) return;
        member.id = me.id;
        artists[me.id] = me.name;
        corner.setName(me.name);
        for (const st of Object.values(walls).flat()) st.artist ??= me.id;
        wetRestore(); // §41
        strokesRestore(); // §48
        erasesRestore(); // §68b
    });

    const ro = new ResizeObserver(fit);
    ro.observe(view);
    // The sticky canvas shows a different slice of the wall as the page moves.
    sr.addEventListener("scroll", schedule, { passive: true });

    /* Zoom (§4 buttons; §23: the buttons only). */
    const zoomOut = section.querySelector('[data-graffiti-zoom="-1"]');
    const zoomIn = section.querySelector('[data-graffiti-zoom="1"]');
    // Keep the wall point (wx, wy) under client (cx, cy) at the new zoom: X by
    // the camera, Y by growing the box and scrolling the page (the page owns
    // Y). ponytail: the box's top is the scroll anchor; it never moves on zoom
    // because the box only grows downward.
    const zoomAt = (zoom, cx, cy, wx, wy) => {
        const r = canvas.getBoundingClientRect();
        closeTip();
        stopFling();
        unfit();
        moved = true;
        cam.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
        const s = scale();
        cam.x = wx - (cx - r.left - ox) / s;
        clampView();
        grow();
        sr.scrollBy(0, box.getBoundingClientRect().top + wy * s - cy);
        zoomOut.disabled = cam.zoom <= MIN_ZOOM + 1e-9;
        zoomIn.disabled = cam.zoom >= MAX_ZOOM;
        schedule();
    };
    // Buttons zoom about the visible centre: the middle of the viewport's
    // slice of the box.
    const zoomBy = (dir) => {
        const r = box.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = (Math.max(r.top, vTop()) + Math.min(r.bottom, vBot())) / 2;
        zoomAt(cam.zoom * ZOOM_STEP ** dir, cx, cy, ...toWall(cx, cy));
    };
    /* §51 FIT. The middle button fits every mark on this page in the view,
       centred, by the tighter of width and height: 16 inside each side, 64
       clear of the top and bottom (the strip and the tool bar float there;
       FLAG). It may go under MIN_ZOOM, else a big wall could not fit (FLAG).
       The fit is to the screen: innerHeight, the page scrolled so the ink's
       centre sits mid-screen. Its icon then turns to house, and a second
       press goes home (§5a): zoom 1, the load-time home X, the box top
       scrolled to the screen top (wall y 0, the first marks). Any other zoom
       or a pan puts the icon back. An empty wall: a no-op (FLAG). */
    const fitBtn = section.querySelector("[data-graffiti-fit]");
    let fitted = false;
    const fitIcon = (on) => {
        fitted = on;
        fitBtn.innerHTML = ico(on ? "house" : "fullscreen");
        fitBtn.setAttribute("aria-label", on ? "Home view" : "Fit the whole wall");
    };
    const unfit = () => { if (fitted) fitIcon(false); };
    const fitAll = () => {
        if (fitted) {
            closeTip();
            stopFling();
            cam.zoom = 1;
            cardBox = null;
            cam.x = home();
            clampView();
            grow();
            sr.scrollBy(0, box.getBoundingClientRect().top - vTop());
            zoomOut.disabled = cam.zoom <= MIN_ZOOM + 1e-9;
            zoomIn.disabled = cam.zoom >= MAX_ZOOM;
            fitIcon(false);
            schedule();
            return;
        }
        // §73: ink, washes (their box) and this page's cards, rotated corners included.
        cardBox = null;
        for (const c of cards) {
            if (c.page !== page) continue;
            const cw = c.w ?? CARD_W, ch = c.h ?? CARD_H, a = ((c.rot || 0) * Math.PI) / 180;
            const hx = (Math.abs(cw * Math.cos(a)) + Math.abs(ch * Math.sin(a))) / 2, hy = (Math.abs(cw * Math.sin(a)) + Math.abs(ch * Math.cos(a))) / 2;
            const cx = c.x + cw / 2, cy = c.y + ch / 2;
            cardBox = inkBounds([{ box: { x: cx - hx, y: cy - hy, w: 2 * hx, h: 2 * hy } }], cardBox);
        }
        const fb = cardBox && inkBox ? inkBounds([{ box: { x: cardBox.x0, y: cardBox.y0, w: cardBox.x1 - cardBox.x0, h: cardBox.y1 - cardBox.y0 } }], inkBox) : inkBox ?? cardBox;
        if (!fb) return;
        closeTip();
        stopFling();
        moved = true;
        const w = canvas.clientWidth, b0 = base();
        const zw = (w - 32) / ((fb.x1 - fb.x0) * b0), zh = (vBot() - vTop() - 128) / ((fb.y1 - fb.y0) * b0);
        cam.zoom = Math.min(MAX_ZOOM, zw, zh);
        const s = scale();
        cam.x = (fb.x0 + fb.x1) / 2 - (w / 2 - ox) / s;
        clampView();
        grow();
        sr.scrollBy(0, box.getBoundingClientRect().top + ((fb.y0 + fb.y1) / 2) * s - (vTop() + vBot()) / 2);
        zoomOut.disabled = cam.zoom <= MIN_ZOOM + 1e-9;
        zoomIn.disabled = cam.zoom >= MAX_ZOOM;
        fitIcon(true);
        schedule();
    };

    /* Tools (§3). The pencil, pen and eraser are aria-disabled, not disabled, while signed out, so
       pressing it can open the sign-up rather than doing nothing. data-tool on
       the box sets touch-action in graffiti.css (§6). */
    const tools = section.querySelectorAll("[data-graffiti-tool]");
    const setTool = (t) => {
        if (t !== "hand" && !member) return corner.open();
        if (t === "water" && !pool.at) return; // §28f: nothing wet to move
        if (t === "smudge" && !hasGraphite()) return; // §46c: nothing to blend
        if (t !== "lasso") putDown(); // §43: leaving the lasso is Done
        if (t !== "link") closeLink(); // §57: leaving Link is Done
        if (t !== "image") closeImage(); // §58: leaving Image is Done
        // §41: switching tools never dries; the wash stays wet (toast and
        // all) until Dry watercolor, the WET_DRY_MS timeout, or the page goes.
        tool = t;
        box.dataset.tool = t;
        tools.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.graffitiTool === t)));
        if (t === "link") openLink();
        if (t === "image" && !holding) openMemes(); // §62: a re-selected meme skips the picker
    };

    /* §46c: Smudge is inert, like Water, until the page holds the reader's
       own graphite; checked on every schedule (a scan of `all`, early exit).
       Losing the last pencil line under Smudge falls back to Pencil. */
    const hasGraphite = () => !!member && all.some((s) => s.tool === "graphite" && s.artist === member.id);
    const smudgeBtns = section.querySelectorAll('[data-graffiti-tool="smudge"]');
    let smudgeOn = null;
    const setSmudge = () => {
        const on = hasGraphite();
        if (on === smudgeOn) return;
        smudgeOn = on;
        smudgeBtns.forEach((b) => { if (on) { b.removeAttribute("aria-disabled"); b.removeAttribute("title"); } else { b.setAttribute("aria-disabled", "true"); b.setAttribute("title", offTitle("smudge", !!member)); } });
        if (!on && tool === "smudge") setTool("graphite");
    };
    /* §42 §45 THE PANELS. Each opens above its own button: fixed, from the
       button's box as §48's Save panel, left edges flush, kept 16 inside the
       viewport, and moved with the bar when it scrolls sideways (§47). The
       first tap of a session on the eraser or the Pen picks it AND opens its
       panel, so readers learn it is there; after that a tap on the tool
       already picked opens or closes it. Without sessionStorage, the first
       tap of each load. Escape, a press outside, a page scroll or another
       tool close it. The eraser removes only the reader's own marks whose
       kind is ticked (a wash is Watercolor); the Pen draws Regular or Small.
       Both last the session. */
    const sget = (k) => { try { return sessionStorage.getItem(k); } catch { return null; } };
    const sset = (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* the session forgets */ } };
    const bar = section.querySelector(".qntns-graffiti__scroll");
    const penBtn = section.querySelector('[data-graffiti-tool="pencil"]');
    const panels = { eraser: section.querySelector('[data-graffiti-pick="erase"]'), lasso: section.querySelector('[data-graffiti-pick="lasso"]'), pencil: section.querySelector('[data-graffiti-pick="size"]'), paper: section.querySelector('[data-graffiti-pick="paper"]') };
    const paperBtn = section.querySelector("[data-graffiti-paper]");
    const seen = new Set();
    // §59: the eraser's and the Lasso's ticks, one Set per panel, each its own session key.
    const tickKey = { erase: "graffiti-erases-3", lasso: "graffiti-lasso-1" };
    const ticks = {};
    for (const [n, k] of Object.entries(tickKey)) { ticks[n] = new Set(ERASES.map(([e]) => e)); try { const e = JSON.parse(sget(k)); if (Array.isArray(e)) ticks[n] = new Set(e); } catch { /* all on */ } }
    const erases = ticks.erase;
    let penSize = sget("graffiti-pen-size") === "small" ? "small" : "regular", shown = null;
    // §57 §58: "-3", so a session's ticks from before the Link and Image rows start with them on.
    const cardKind = (c) => (c.kind === "image" ? "image" : "link");
    const kindOf = (st) => (st.box || st.tool === "watercolor" ? "watercolor" : st.tool === "smudge" ? "graphite" : st.tool ?? "pen"); // §59: no tool paints as drawStroke, the Fountain pen
    const paintPicks = () => {
        for (const n in ticks) section.querySelectorAll(`[data-graffiti-${n}-row]`).forEach((r) => r.setAttribute("aria-checked", String(ticks[n].has(r.getAttribute(`data-graffiti-${n}-row`)))));
        panels.pencil?.querySelectorAll("[data-graffiti-size-row]").forEach((r) => r.setAttribute("aria-checked", String(r.dataset.graffitiSizeRow === penSize)));
        if (penBtn) penBtn.innerHTML = ico(penSize === "small" ? "dot-small" : "dot-regular");
        panels.paper?.querySelectorAll("[data-graffiti-paper-row]").forEach((r) => r.setAttribute("aria-checked", String(r.dataset.graffitiPaperRow === paper)));
        if (paperBtn) paperBtn.innerHTML = ico(PAPERS.find(([k]) => k === paper)[2]);
    };
    paintPicks();
    Object.values(panels).forEach((p) => p?.querySelectorAll("[role^=menuitem]").forEach((r, i, all) => r.style.setProperty("--rise-i", all.length - 1 - i)));
    const pinned = () => matchMedia("(pointer: coarse)").matches && !!shown && shown.panel.contains(document.activeElement) && document.activeElement.matches("input");
    const place = () => {
        if (!shown) return;
        const r = shown.btn.getBoundingClientRect(), p = shown.panel;
        p.style.left = `${Math.max(16, Math.min(r.left, innerWidth - 16 - p.offsetWidth))}px`;
        const vv = window.visualViewport;
        // §72: while its search has focus the picker pins 8 above the keyboard (iOS shrinks only visualViewport).
        p.style.top = `${pinned() && vv ? vv.offsetTop + vv.height - 8 - p.offsetHeight : r.top - 8 - p.offsetHeight}px`;
    };
    const shutPanel = (focus) => {
        if (!shown) return;
        shown.panel.hidePopover();
        shown.btn.setAttribute("aria-expanded", "false");
        if (focus) shown.btn.focus();
        const was = shown.panel;
        shown = null;
        if (was === memes) memesShut(); // §58
    };
    const showPanel = (btn, panel, kb) => {
        if (!panel?.showPopover) return;
        btn.scrollIntoView({ block: "nearest", inline: "nearest" });
        panel.showPopover();
        btn.setAttribute("aria-expanded", "true");
        shown = { btn, panel };
        place();
        if (kb) (panel.querySelector('[aria-checked="true"]') ?? panel.querySelector("[role^=menuitem]")).focus();
    };
    const tapTool = (btn, kb) => {
        const t = btn.dataset.graffitiTool, panel = panels[t];
        if (t === "image" && shown?.panel === memes) return shutPanel(); // §58: the button shuts its picker
        if (panel && member && tool === t) return shown?.panel === panel ? shutPanel() : showPanel(btn, panel, kb);
        shutPanel();
        setTool(t);
        if (!panel || tool !== t || seen.has(t) || sget(`graffiti-seen-${t}`)) return;
        seen.add(t);
        sset(`graffiti-seen-${t}`, "1");
        showPanel(btn, panel, kb);
    };
    const onPick = (e) => {
        const er = e.target.closest("[data-graffiti-erase-row], [data-graffiti-lasso-row]"), sz = e.target.closest("[data-graffiti-size-row]"), pp = e.target.closest("[data-graffiti-paper-row]");
        if (pp) {
            paper = pp.dataset.graffitiPaperRow;
            sset("graffiti-paper", paper); // a new bandKey(): the tiles repaint
            schedule();
            shutPanel(e.detail === 0);
        } else if (er) {
            const n = er.dataset.graffitiEraseRow ? "erase" : "lasso", k = er.getAttribute(`data-graffiti-${n}-row`);
            if (!ticks[n].delete(k)) ticks[n].add(k);
            sset(tickKey[n], JSON.stringify([...ticks[n]]));
        } else if (sz) {
            penSize = sz.dataset.graffitiSizeRow;
            sset("graffiti-pen-size", penSize);
            shutPanel(e.detail === 0);
        }
        paintPicks();
    };
    const onPanelKey = (e) => {
        const rows = [...shown.panel.querySelectorAll("[role^=menuitem]")], at = rows.indexOf(document.activeElement);
        if (e.key === "Escape") shutPanel(true);
        else if (e.key === "ArrowDown" || e.key === "ArrowUp") rows[(at + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length].focus();
        else return;
        e.preventDefault();
    };
    const onOutside = (e) => { if (shown && !shown.panel.contains(e.target) && !shown.btn.contains(e.target)) shutPanel(); };
    const onEsc = (e) => { if (e.key === "Escape" && shown && !shown.panel.contains(e.target)) shutPanel(); };
    Object.values(panels).forEach((p) => { p?.addEventListener("click", onPick); p?.addEventListener("keydown", onPanelKey); });
    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("keydown", onEsc);
    // §72: the keyboard scrolls the page to lift the field; that must not shut the picker.
    const onPageScroll = () => { if (!pinned()) shutPanel(); };
    visualViewport?.addEventListener("resize", place);
    visualViewport?.addEventListener("scroll", place);
    document.addEventListener("focusin", () => requestAnimationFrame(place));
    document.addEventListener("focusout", () => requestAnimationFrame(place));
    sr.addEventListener("scroll", onPageScroll, { passive: true });
    bar?.addEventListener("scroll", place, { passive: true });

    const onClick = (e) => {
        // §24a: the same undo as the two-finger double tap; signed out it
        // opens the sign-up, as the pen does.
        if (e.target.closest("[data-graffiti-undo]")) return member ? undo() : corner.open();
        if (e.target.closest("[data-graffiti-redo]")) return member ? redo() : corner.open();
        const t = e.target.closest("[data-graffiti-tool]");
        if (t) return tapTool(t, e.detail === 0);
        // §47: the paper button only opens and closes its panel.
        if (e.target.closest("[data-graffiti-paper]")) return shown?.panel === panels.paper ? shutPanel() : (shutPanel(), showPanel(paperBtn, panels.paper, e.detail === 0));
        const z = e.target.closest("[data-graffiti-zoom]");
        if (z) zoomBy(+z.dataset.graffitiZoom);
        if (e.target.closest("[data-graffiti-fit]")) fitAll();
    };
    section.addEventListener("click", onClick);

    /* §6a DESKTOP. (a) Holding Space with Pen or Eraser pressed and the wall
       in view is Hand until it is let go; the page does not scroll, and a
       text field keeps its Space. (b) §23: a trackpad pinch (wheel + ctrlKey)
       is left to the browser; the wall no longer zooms on it. (c) A sideways wheel or trackpad scroll (deltaX, or Shift + wheel)
       over the wall pans it in X inside the fog; an up/down one is the page's
       and is never touched. */
    let spaceHeld = null;
    const typing = (t) => t.closest?.("input, textarea, select, [contenteditable]");
    const inView = () => { const r = box.getBoundingClientRect(); return r.bottom > vTop() && r.top < vBot(); };
    const spaceUp = () => { if (spaceHeld) { setTool(spaceHeld); spaceHeld = null; } };
    const onKeyDown = (e) => {
        if (e.key === "Escape") { closeTip(); if (e.target.matches?.(".qntns-graffiti__link-url")) closeLink(); if (!typing(e.target)) { if (sel) putDown(); closeLink(); closeImage(); } } // §43a §57 §58: Escape = Done
        if (e.code !== "Space" || typing(e.target)) return;
        if (spaceHeld) return e.preventDefault(); // key repeat
        if (tool === "hand" || tool === "link" || tool === "image" || !inView()) return; // §57 §58: Link and Image already move the wall
        e.preventDefault();
        spaceHeld = tool;
        setTool("hand");
    };
    const onKeyUp = (e) => { if (e.code === "Space" && spaceHeld) { e.preventDefault(); spaceUp(); } };
    addEventListener("keydown", onKeyDown);
    addEventListener("keyup", onKeyUp);
    // A Space let go in another window never sends keyup here.
    addEventListener("blur", spaceUp);

    const onWheel = (e) => {
        if (e.ctrlKey) return; // §23: the browser's own pinch
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
        const dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * unit;
        if (!dx || (!e.shiftKey && Math.abs(e.deltaX) < Math.abs(e.deltaY))) return;
        e.preventDefault();
        closeTip();
        stopFling();
        unfit();
        moved = true;
        cam.x += dx / scale();
        clampView();
        schedule();
    };
    box.addEventListener("wheel", onWheel, { passive: false });

    /*
     * THE POINTER ROUTER (§6 §7). One router for mouse, touch and pen.
     * `down` holds every pointer on the canvas; `gesture` is the one thing they
     * are doing, and it names the pointer ids it owns.
     *
     *   pen pointer        erases under Eraser, else draws (signed in); marks
     *                      penSeen and drops any touch gesture under it
     *   1 touch / mouse    Pen / Eraser: draws / erases (a touch only until a
 *                      pen is seen);
     *                      Hand tool: pans
     *   2nd touch          cancels the first finger's stroke and starts
     *                      nothing (§23: no pinch zoom); on a pen tablet,
     *                      signed in, two of these in quick succession undo
     *                      the reader's last stroke (§24)
     *   touch under a pen  ignored: it is the palm
     *
     * touch-action (answers-3, graffiti.css): pan-y under Hand, so a finger's
     * vertical movement scrolls the page and its sideways movement pans the
     * wall; none under Pen. The wall pans X only, inside the fog (§5). §21: a
     * pen draws under Hand too, on the pan-y canvas, so iPad Safari would take
     * a mostly vertical pen stroke as a scroll and cancel it; the canvas's
     * touchstart is cancelled for a stylus (Touch.touchType, Safari only).
     */
    const down = new Map();
    let gesture = null;

    /* §49 FLING AND OVERSCROLL. A drag past the camera's range shows e px of
       it as at most RUBBER px (iOS's rubber band, 0.55). On release, v (wall
       units/s) decays by FLING_TAU inside the range; past an end a critically
       damped spring (SPRING) brings it back, solved exactly per frame so a
       long frame cannot blow it up. Each frame paints at once: a pan frame is
       tile blits (no repaint inside the band). */
    let flinging = 0;
    const stopFling = () => { cancelAnimationFrame(flinging); flinging = 0; };
    const rubber = (x) => {
        const [a, b] = camRange(), s = scale(), e = (x < a ? x - a : x > b ? x - b : 0) * s;
        if (!e) return x;
        return (e < 0 ? a : b) + (Math.sign(e) * (1 - 1 / ((Math.abs(e) * 0.55) / RUBBER + 1)) * RUBBER) / s;
    };
    const fling = (v) => {
        stopFling();
        let t0 = performance.now();
        const step = (now) => {
            const dt = Math.min(0.1, (now - t0) / 1000), s = scale(), [a, b] = camRange();
            t0 = now;
            const edge = cam.x < a ? a : cam.x > b ? b : null;
            if (edge === null) {
                const k = Math.exp((-dt * 1000) / FLING_TAU);
                cam.x += v * (FLING_TAU / 1000) * (1 - k);
                v *= k;
            } else {
                const x = cam.x - edge, c = v + SPRING * x, k = Math.exp(-SPRING * dt);
                cam.x = edge + (x + c * dt) * k;
                v = (v - SPRING * c * dt) * k;
            }
            const e = cam.x < a ? cam.x - a : cam.x > b ? cam.x - b : 0;
            if (Math.abs(v * s) < 8 && Math.abs(e * s) < 0.5) { cam.x -= e; flinging = 0; } else flinging = requestAnimationFrame(step);
            cancelAnimationFrame(frame);
            paint();
            queueLoad();
        };
        flinging = requestAnimationFrame(step);
    };

    /* HAND (answers-7). The axis is picked once per drag, from the first
       movement past AXIS_PX: sideways pans the wall, up/down scrolls the page.
       A touch's vertical drag is the browser's own (touch-action: pan-y, and
       the pointer is not captured, so nothing holds it back; the browser then
       sends pointercancel). A mouse or pen never scrolls natively, so its
       vertical drag is window.scrollBy. ponytail: no momentum on a mouse
       scroll-drag; add it if it feels dead. §49: a sideways drag runs past
       the ends on a rubber band and flings on release. */
    const pan = (e) => {
        const sx = e.clientX, x0 = cam.x, hist = [];
        let sy = e.clientY, axis = null;
        return {
            kind: "pan",
            ids: [e.pointerId],
            move: (ev) => {
                const dx = ev.clientX - sx, dy = ev.clientY - sy;
                axis ??= Math.hypot(dx, dy) < AXIS_PX ? null : Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
                if (axis === "y") {
                    if (ev.pointerType !== "touch") { sr.scrollBy(0, -dy); sy = ev.clientY; }
                    return;
                }
                if (axis !== "x") return;
                moved = true;
                unfit();
                hist.push([ev.timeStamp, ev.clientX]);
                cam.x = rubber(x0 - dx / scale());
                schedule();
            },
            // A Hand click that never chose an axis is a pick (§10a). §49:
            // the release velocity is the last 80 ms of moves, px/s.
            end: (ev) => {
                if (axis !== "x") {
                    fling(0); // a wall caught mid-bounce springs back
                    if (!axis && !reselect(ev)) showTip(ev); // §62
                    return;
                }
                const h = [...hist, [ev.timeStamp, ev.clientX]].filter((p) => p[0] >= ev.timeStamp - 80);
                const dt = h.at(-1)[0] - h[0][0], v = dt > 0 ? ((h.at(-1)[1] - h[0][1]) / dt) * 1000 : 0;
                fling(-Math.max(-FLING_MAX, Math.min(FLING_MAX, v)) / scale());
            },
            cancel: () => fling(0)
        };
    };

    const draw = (e) => {
        // §25: Pencil is the default ink: a stylus under Hand (or any tool but
        // Pen) draws round; only Pen draws the nib.
        const st = { id: crypto.randomUUID(), artist: member.id, at: Date.now(), points: [], tool: tool === "pen" || tool === "watercolor" || tool === "graphite" || tool === "smudge" ? tool : "pencil", page };
        if (st.tool === "pencil" && penSize === "small") st.size = SMALL; // §45
        // §21: liveInk and the predicted points (never stored) ride beside it.
        live = { ...st, ink: liveInk(st.id, st.points, smoothingOf(st.tool), st.size), pred: [] };
        const extend = (p) => {
            live.points.push(p);
            if (st.tool === "smudge") { smear(p); return; } // §46c: repaint the graphite under it; never grows the wall
            const was = bottom();
            inkBox = inkBounds([{ points: [p] }], inkBox);
            if (bottom() > was) grow();
        };
        extend(point(e));
        schedule();
        drawing++; // §56: Saving from pen-down
        status();
        return {
            kind: "draw",
            pen: e.pointerType === "pen",
            ids: [e.pointerId],
            move: (ev) => {
                for (const c of ev.getCoalescedEvents?.() ?? [ev]) extend(point(c));
                // §21: where the pen is about to be, drawn this frame only.
                live.pred = (ev.getPredictedEvents?.() ?? []).map(point);
                schedule();
            },
            end: () => {
                live = null;
                drawing--; status(); // save() / wetOn below keep the light on
                // §28b: wet paint goes into the pool, not onto the wall.
                if (st.tool === "watercolor") { wetPaint(st); inkBox = inkBounds(all); grow(); canUndo(); schedule(); return; }
                // §46c: a smudge that reached none of the reader's graphite is dropped, not saved.
                // No ver++: the tiles already show it, painted live by smear().
                if (st.tool === "smudge") { if (!all.some((g) => g.tool === "graphite" && g.artist === member.id && smudgeShape(shapeOf(g), [st.points]) !== shapeOf(g))) return schedule(); }
                all.push(st);
                hist().draw(st);
                canUndo();
                bakeOn(st);
                schedule();
                onStroke?.(st);
                save(st);
            },
            cancel: () => {
                live = null;
                drawing--; status();
                if (st.tool === "smudge") ver++; // §46c: the graphite goes back
                if (st.tool === "watercolor") wetPaint(st); // §28b: what was dabbed stays
                inkBox = inkBounds(all);
                grow();
                schedule();
            }
        };
    };

    // §28b: a wash's PNG; a loaded one is redrawn to get it (CORS allows it).
    const pngOf = (st) => new Promise((res) => {
        try {
            let c = st.img;
            if (!(c instanceof HTMLCanvasElement)) {
                c = document.createElement("canvas");
                c.width = st.box.w; c.height = st.box.h;
                c.getContext("2d").drawImage(st.img, 0, 0);
            }
            c.toBlob(res, "image/png");
        } catch { res(null); }
    });
    /* §48 NOTHING LOST. A stroke is copied to IndexedDB ("s:<id>", the §41
       store) before its POST and dropped when the POST lands, so a closed tab
       or a failed save keeps it; the next visit posts it (strokesRestore).
       A failed mark (stroke or wash) waits in `unsaved`, still on screen, and
       is retried RETRY_MS after the last failure, when the browser comes back
       online, or on Save now. The button: Saving (green, blinking) while any
       POST is out, Failed (red) while anything waits, else Saved (green).
       No toast here; a stalled erase has its own (CHECKLIST-31 §2, below).
       ponytail: a POST that landed but whose reply was lost is posted again
       (a double line); add an idempotency key to the Worker if that shows. */
    const unsaved = new Set();
    const sent = new Set(); // CHECKLIST-31 §7a: ids of every mark this tab posted
    let flying = 0, retryT = 0, drawing = 0; // §56: drawing = a pointer stroke in hand
    const onWall = (st) => walls[st.page ?? "misc"]?.includes(st);
    const keepKey = (st) => `s:${st.id}`;
    const forget = (st) => !st.box && idb("readwrite", (s) => s.delete(keepKey(st)));
    /* §68b ERASES. Live, a delete-all of 181 strokes fired 181 DELETEs at
       once; the Worker allows 120 writes a minute, 429'd the rest, and call
       returned null, so 64 marks stayed. Every erase now goes into a queue
       kept in IndexedDB (e:<kind>:<id>) and is sent one at a time until the
       Worker says 204 (true) or that it is gone (403/404): a 429 waits for
       the next minute, any other failure RETRY_MS, a closed tab resumes on
       the next visit (erasesRestore), and nothing is dropped silently.
       CHECKLIST-31 §1: sent ERASE_BATCH ids a request (POST /graffiti/erase,
       any mix of kinds), so a delete-all of 181 is 4 requests, not 181; the
       Worker answers 204 for the batch, skipping ids not the reader's or gone.
       §2: ERASE_STALL failed tries in a row (offline, refused, 429) put up a
       toast with the count left, closed when the queue empties. The happy
       path shows none: Save already reads Saving while the queue drains. */
    const ERASE_BATCH = 50, ERASE_STALL = 2;
    const eraseQ = new Map();
    let eraseT = 0, erasing = false, stalls = 0, stallToast = null;
    const eraseKey = (kind, id) => `e:${kind}:${id}`;
    const stalled = () => {
        const t = `Deleting ${eraseQ.size} ${eraseQ.size === 1 ? "mark" : "marks"}…`;
        if (eraseQ.size && stalls >= ERASE_STALL) {
            if (!stallToast) { stallToast = { bye: showToast(document, { title: t, body: "", icon: "trash-2" }) }; stallToast.el = document.body.lastElementChild; }
            stallToast.el.querySelector(".qntns-toast__title").textContent = t;
        } else if (!eraseQ.size && stallToast) { stallToast.bye(); stallToast = null; }
    };
    const drainErases = async () => {
        if (erasing || !api) return;
        erasing = true;
        clearTimeout(eraseT);
        while (eraseQ.size) {
            const batch = [...eraseQ.keys()].slice(0, ERASE_BATCH);
            const r = await api.eraseMany?.(batch.map((k) => eraseQ.get(k).id));
            if (r !== true) {
                // Next minute by the clock for a 429, RETRY_MS for anything else.
                eraseT = setTimeout(drainErases, r === "slow" ? 61_000 - (Date.now() % 60_000) : RETRY_MS);
                stalls++;
                break;
            }
            stalls = 0;
            for (const k of batch) { eraseQ.delete(k); idb("readwrite", (s) => s.delete(k)); }
        }
        erasing = false;
        stalled();
        status();
    };
    const unpost = (kind, id) => {
        if (!api || !id) return;
        const k = eraseKey(kind, id);
        eraseQ.set(k, { kind, id });
        idb("readwrite", (s) => s.put({ kind, id }, k));
        status();
        queueMicrotask(drainErases); // §1: after the rest of this delete is queued, so it goes in full batches
    };
    const erasesRestore = () => idb("readonly", (s) => s.getAll(IDBKeyRange.bound("e:", "e:\uffff"))).then((list) => {
        for (const e of list ?? []) eraseQ.set(eraseKey(e.kind, e.id), e);
        drainErases();
    });
    addEventListener("online", drainErases);
    const saveBtn = section.querySelector("[data-graffiti-save]");
    const savePanel = section.querySelector("[data-graffiti-save-panel]");
    const status = () => {
        if (!saveBtn) return;
        saveBtn.dataset.state = api && drawing || flying || eraseQ.size ? "saving" : unsaved.size ? "unsaved" : api && wetOn ? "saving" : "saved"; // §56: a stroke in hand reads Saving even over Failed
        saveBtn.toggleAttribute("data-unsaved", unsaved.size > 0); // Save now can open
        if (!unsaved.size) savePanel?.hidePopover?.();
    };
    const save = (st) => {
        if (!api) return Promise.resolve(null);
        if (!st.box) idb("readwrite", (s) => s.put({ id: st.id, at: st.at, points: st.points, tool: st.tool, size: st.size, page: st.page, old: st.old }, keepKey(st)));
        flying++;
        status();
        const v = st.v; // §43: a move re-saves; an older save's reply is stale
        sent.add(st.id); // §7a: its echo is skipped here
        return (st.box ? pngOf(st).then((png) => png && api.wash(png, st.box, st.page, st.id)) : api.save(thinForPost(st.points), st.tool, st.page, st.size, st.id)).then((r) => {
            flying--;
            if (st.v !== v) { status(); if (r?.id) unpost(st.box ? "wash" : "stroke", r.id); return; }
            if (!r?.id) {
                if (onWall(st)) { unsaved.add(st); clearTimeout(retryT); retryT = setTimeout(retry, RETRY_MS); } else forget(st);
                return status();
            }
            status();
            forget(st);
            if (unsaved.size) retry(); // one landed: the line is back, try the rest
            if (st.slot && !(st.left && --st.left.n)) { slotDrop(st.slot); st.slot = 0; } // §41: saved, so the pre-save can go (§5: once its last piece is)
            known.add(r.id);
            Object.assign(st, { sid: r.id, line: r.line });
            // §43: moved — the copy at the old place goes once this one landed.
            if (st.old) { unpost(st.box ? "wash" : "stroke", st.old); st.old = undefined; }
            // Erased while the save was in flight.
            if (!onWall(st)) return unpost(st.box ? "wash" : "stroke", r.id);
            // Its line joined older ones (§14a): re-read the view so
            // the relabelled strokes show their new id.
            if (r.merged?.length && st.page === page) { asked.clear(); loadView(); }
        });
    };
    // Every waiting mark, once more; resolves true when none is left waiting.
    const retry = () => {
        clearTimeout(retryT);
        const due = [...unsaved];
        unsaved.clear();
        return Promise.all(due.map((st) => (onWall(st) ? save(st) : forget(st)))).then(() => !unsaved.size);
    };
    addEventListener("online", retry);
    // The panel is fixed: a page scroll would leave it behind, so it closes.
    const shut = () => savePanel?.hidePopover?.();
    sr.addEventListener("scroll", shut, { passive: true });
    // Red: the button opens the panel above itself (fixed, from the button's box).
    saveBtn?.addEventListener("click", () => {
        if (!unsaved.size || !savePanel?.showPopover) return;
        saveBtn.scrollIntoView({ block: "nearest", inline: "nearest" }); // §47: a bar scrolled sideways
        const r = saveBtn.getBoundingClientRect();
        savePanel.style.left = `${r.right}px`;
        savePanel.style.top = `${r.top}px`;
        savePanel.togglePopover();
    });
    savePanel?.addEventListener("toggle", (e) => saveBtn.setAttribute("aria-expanded", e.newState === "open"));
    section.querySelector("[data-graffiti-save-now]")?.addEventListener("click", () => {
        savePanel.hidePopover();
        retry().then((ok) => showToast(document, ok ? { title: "Saved", body: "", icon: "check" } : { title: "Couldn't save. Try again.", body: "", icon: "x" }));
    });
    // Every stroke a closed tab or a failed save left behind: back on its
    // wall, and posted. Ids already on a wall (this visit's) are skipped.
    const strokesRestore = () => idb("readonly", (s) => s.getAll(IDBKeyRange.bound("s:", "s:\uffff"))).then((list) => {
        const ids = new Set(Object.values(walls).flat().map((s) => s.id));
        for (const k of list ?? []) {
            if (ids.has(k.id)) continue;
            const st = { ...k, artist: member.id, page: k.page ?? "misc" };
            (walls[st.page] ??= []).push(st);
            walls[st.page].sort((a, b) => a.at - b.at);
            save(st);
        }
        ver++;
        inkBox = inkBounds(all);
        grow();
        schedule();
    });

    // Take one stroke off the wall, and off the Worker once it has an id (one
    // still in flight is erased when its save returns, in draw's end).
    const unmark = (st) => {
        all.splice(all.indexOf(st), 1);
        ver++;
        onErase?.(st.id);
        if (st.sid) unpost(st.box ? "wash" : "stroke", st.sid);
        if (st.old) { unpost(st.box ? "wash" : "stroke", st.old); st.old = undefined; } // §43
        // §68: and out of this browser's copies, or the next visit's
        // strokesRestore / wetRestore posts it again as a new mark.
        unsaved.delete(st);
        forget(st);
        if (st.slot) { slotDrop(st.slot); st.slot = 0; }
        status();
        canUndo();
    };

    /* §24 / §21c UNDO. One in-memory history of this page's actions, newest
       last (draws and eraser rubs); the button and the two-finger double tap
       both pop it. */
    let undoToast = null;
    // §24a: the button is disabled while the history is empty. Signed out it
    // stays aria-disabled from the markup.
    const undoBtn = section.querySelector("[data-graffiti-undo]");
    const redoBtn = section.querySelector("[data-graffiti-redo]");
    const canUndo = () => {
        if (member && undoBtn) undoBtn.disabled = !hist().size() && !pool.box;
        if (member && redoBtn) redoBtn.disabled = !hist().rsize();
    };
    // §27a: one history per page, so undo never reaches another page's wall.
    const histories = {};
    const hist = () => (histories[page] ??= makeUndo(undoOps));
    const undoOps = ({
        has: (st) => all.includes(st),
        remove: unmark,
        // A cut stroke comes back as the same object, re-saved: it gets a new
        // sid (and maybe line) from the Worker; nothing else is told.
        add: (st) => {
            st.sid = undefined;
            all.push(st);
            ver++;
            bakeOn(st);
            onStroke?.(st);
            save(st);
        }
    });
    const undo = () => {
        putDown(); // §43: a move in progress is put down first, so undo takes it back
        // §28b: wet paint is the newest thing; undo throws it all away.
        if (pool.at && pool.box) { pool.at = pool.box = null; setWet(false); wetDrop(); }
        else if (!hist().undo()) return;
        canUndo();
        inkBox = inkBounds(all);
        grow();
        schedule();
        undoToast?.();
        const bye = (undoToast = showToast(document, { title: "Undone", body: "", icon: "undo-2" }));
        setTimeout(bye, UNDO_TOAST_MS);
    };

    // §69 REDO: brings back what undo took. Wet paint undo threw away (the
    // pool) is not redoable. Any new mark, erase or move empties the stack.
    const redo = () => {
        putDown();
        if (!hist().redo()) return;
        canUndo();
        inkBox = inkBounds(all);
        grow();
        schedule();
        undoToast?.();
        const bye = (undoToast = showToast(document, { title: "Redone", body: "", icon: "redo-2" }));
        setTimeout(bye, UNDO_TOAST_MS);
    };

    /* ERASER (§3b). Whole-stroke: any stroke of the signed-in artist the
       eraser touches goes, and only theirs. The drag is stepped every ERASE_R
       so a fast swipe skips nothing. */
    const erase = (e) => {
        let last = toWall(e.clientX, e.clientY);
        const cut = [], cutCards = [];
        // One rub is one history entry, however many strokes and cards it cut.
        const keep = () => {
            if (cutCards.length) hist().push(() => { cut.forEach(undoOps.add); cutCards.forEach(putCard); }, () => { cut.filter((st) => all.includes(st)).forEach(unmark); cutCards.forEach(dropCard); });
            else hist().erase(cut);
            canUndo();
        };
        const rub = ([x, y]) => {
            const n = Math.max(1, Math.ceil(Math.hypot(x - last[0], y - last[1]) / ERASE_R));
            for (let i = 1; i <= n; i++) {
                const p = [last[0] + ((x - last[0]) * i) / n, last[1] + ((y - last[1]) * i) / n];
                for (const st of all.filter((s) => s.artist === member.id && erases.has(kindOf(s)) && touches(s, p, ERASE_R))) { unmark(st); cut.push(st); }
                for (const c of cards.filter((c) => c.page === page && c.artist === member.id && erases.has(cardKind(c)) && c !== holding && hitCard(c, p, ERASE_R))) { dropCard(c); cutCards.push(c); }
            }
            last = [x, y];
            inkBox = inkBounds(all);
            grow();
            schedule();
        };
        rub(last);
        return {
            kind: "erase",
            pen: e.pointerType === "pen",
            ids: [e.pointerId],
            move: (ev) => { for (const c of ev.getCoalescedEvents?.() ?? [ev]) rub(toWall(c.clientX, c.clientY)); },
            end: keep,
            cancel: keep
        };
    };
    /* §43 LASSO. A press on the selection (its ink box, PICK_PX of slop)
       drags it; anywhere else puts down what was picked and draws a new loop.
       Lifting the loop picks every one of the reader's own marks it touches,
       crosses or encloses — whole marks, never part of one — and dims the
       rest (paintBake). The "Moving" toast's Done, another tool, a page
       switch or undo puts the selection down: each moved mark is re-posted
       at its new place and its old copy deleted once the new one has landed
       (save, st.old), one undo step for the whole move. No new route. */
    let moveToast = null, undoMove = null;
    const shift = (sts, dx, dy) => {
        for (const st of sts) {
            if (st.box) st.box = { ...st.box, x: st.box.x + dx, y: st.box.y + dy };
            else st.points = st.points.map(([x, y, ...f]) => [+(x + dx).toFixed(2), +(y + dy).toFixed(2), ...f]);
            shapes.delete(st);
            // On top, where it was drawn while moving and where the Worker's
            // fresh `at` puts it after a reload.
            st.at = Date.now();
            if (all.includes(st)) all.push(...all.splice(all.indexOf(st), 1));
            st.old = st.sid ?? st.old;
            st.sid = undefined;
            st.v = (st.v ?? 0) + 1;
            unsaved.delete(st);
            save(st);
        }
        ver++;
        inkBox = inkBounds(all);
        clampView();
        grow();
        schedule();
    };
    // §59: a lassoed card or meme moves by its x, y (whole wall units), in memory as §57/§58 keep it.
    const shiftCards = (cs, dx, dy) => { for (const c of cs) { c.x += dx; c.y += dy; } schedule(); };
    const putDown = () => {
        if (!sel) return;
        const { sts, cards: cs, dx, dy } = sel;
        sel = null;
        box.removeAttribute("data-over-sel");
        moveToast?.();
        moveToast = null;
        ver++;
        schedule();
        if (!dx && !dy) return;
        shift([...sts], dx, dy);
        shiftCards(cs, dx, dy);
        hist().push(() => { shift([...sts].filter((st) => all.includes(st)), -dx, -dy); shiftCards([...cs].filter((c) => cards.includes(c)), -dx, -dy); }, () => { shift([...sts].filter((st) => all.includes(st)), dx, dy); shiftCards([...cs].filter((c) => cards.includes(c)), dx, dy); });
        canUndo();
    };
    // §43 Trash: every selected mark goes through the eraser's DELETE path
    // (unmark), from where it was picked; one undo step re-posts them all.
    const trashSel = () => {
        if (!sel) return;
        const cut = [...sel.sts].filter((st) => all.includes(st)), cutCards = [...sel.cards].filter((c) => cards.includes(c));
        sel = null;
        box.removeAttribute("data-over-sel");
        moveToast?.();
        moveToast = null;
        cut.forEach(unmark);
        cutCards.forEach(dropCard);
        if (cutCards.length) hist().push(() => { cut.forEach(undoOps.add); cutCards.forEach(putCard); }, () => { cut.filter((st) => all.includes(st)).forEach(unmark); cutCards.forEach(dropCard); });
        else hist().erase(cut);
        canUndo();
        inkBox = inkBounds(all);
        grow();
        schedule();
    };
    // The selection's hit area: its ink box plus PICK_PX of slop. A press and §43b's grab cursor share it.
    const overSel = (p) => {
        if (!sel) return false;
        const slop = PICK_PX / scale(), q = [p[0] - sel.dx, p[1] - sel.dy], b = inkBounds([...sel.sts]);
        // §59b: a card or meme by its own (turned) outline, as hitCard; the ink by its box.
        return [...sel.cards].some((c) => hitCard(c, q, slop)) || (!!b && q[0] >= b.x0 - slop && q[0] <= b.x1 + slop && q[1] >= b.y0 - slop && q[1] <= b.y1 + slop);
    };
    const lasso = (e) => {
        const p0 = toWall(e.clientX, e.clientY), slop = PICK_PX / scale();
        if (overSel(p0)) {
            const { dx, dy } = sel;
            return {
                kind: "pan", // the grabbing cursor
                pen: e.pointerType === "pen",
                ids: [e.pointerId],
                // Whole wall units, so a moved wash keeps a whole-unit box.
                move: (ev) => { const p = toWall(ev.clientX, ev.clientY); sel.dx = dx + Math.round(p[0] - p0[0]); sel.dy = dy + Math.round(p[1] - p0[1]); schedule(); },
                end: () => { if (sel && (sel.dx || sel.dy)) undoMove?.removeAttribute("aria-disabled"); },
                cancel: () => {}
            };
        }
        putDown();
        loop = [p0];
        // Every sample, plus steps of slop between far ones, so a fast loop
        // still crosses a thin line it passed over.
        const add = (p) => {
            const q = loop[loop.length - 1], n = Math.max(1, Math.ceil(Math.hypot(p[0] - q[0], p[1] - q[1]) / slop));
            for (let i = 1; i <= n; i++) loop.push([q[0] + ((p[0] - q[0]) * i) / n, q[1] + ((p[1] - q[1]) * i) / n]);
        };
        const pick = () => {
            const ring = loop;
            loop = null;
            schedule();
            if (ring.length < 2) return;
            // CHECKLIST-31 §4: every loop sample against every segment of every
            // own mark was O(loop x ink), seconds on a busy wall (4.1 s, 300
            // strokes), the toast late and dead meanwhile. Now only the samples
            // in a mark's box (plus slop) are hit-tested, and one point stands
            // for enclosure: the ring is sampled every slop, so a mark it does
            // not touch is wholly inside or wholly outside.
            const want = ticks.lasso; // §59: only the ticked kinds
            const got = all.filter((st) => {
                if (st.artist !== member.id || !want.has(kindOf(st))) return false;
                const b = inkBounds([st]);
                if (!b) return false;
                if (ring.some((p) => p[0] >= b.x0 - slop && p[0] <= b.x1 + slop && p[1] >= b.y0 - slop && p[1] <= b.y1 + slop && touches(st, p, slop))) return true;
                return inside(st.box ? [st.box.x + st.box.w / 2, st.box.y + st.box.h / 2] : st.points[0], ring);
            });
            // §59: the reader's own cards and memes too, touched or centre enclosed.
            const gotCards = cards.filter((c) => c.page === page && c.artist === member.id && want.has(cardKind(c)) && c !== holding && c !== pending
                && (ring.some((p) => hitCard(c, p, slop)) || inside([c.x + (c.w ?? CARD_W) / 2, c.y + (c.h ?? CARD_H) / 2], ring)));
            if (!got.length && !gotCards.length) return;
            sel = { sts: new Set(got), cards: new Set(gotCards), dx: 0, dy: 0 };
            ver++;
            const n = got.length + gotCards.length;
            moveToast = showToast(document, { title: `Moving ${n} mark${n === 1 ? "" : "s"}`, body: "", icon: "lasso", action: [
                { label: "Undo move", icon: "undo-2", onClick: () => {} },
                { label: "Done", icon: "check", onClick: () => { moveToast = null; putDown(); } },
                { label: "Delete", icon: "trash-2", onClick: () => { moveToast = null; trashSel(); } }
            ] });
            // Undo is the cancel: it puts the selection back where it was picked up,
            // still held. The toast dismisses on every action, so a capture
            // listener on the toast stops the press before that (toast.js is not ours).
            const tEl = document.body.lastElementChild;
            undoMove = tEl.querySelector(".qntns-toast__close");
            undoMove.setAttribute("aria-disabled", "true");
            tEl.addEventListener("click", (ev) => {
                if (ev.target.closest(".qntns-toast__close") !== undoMove) return;
                ev.stopPropagation();
                if (undoMove.getAttribute("aria-disabled") === "true" || !sel) return;
                sel.dx = sel.dy = 0;
                undoMove.setAttribute("aria-disabled", "true");
                schedule();
            }, true);
        };
        schedule();
        return {
            kind: "lasso",
            pen: e.pointerType === "pen",
            ids: [e.pointerId],
            move: (ev) => { for (const c of ev.getCoalescedEvents?.() ?? [ev]) add(toWall(c.clientX, c.clientY)); schedule(); },
            end: pick,
            cancel: () => { loop = null; schedule(); }
        };
    };
    /* §57 LINK (Storybook draft: api.link is the stories' stub, cards live in
       memory; no Worker route yet, so the button hides without api.link).
       A card is a DOM overlay in the box, not canvas ink: the image, the
       one-line title and link line are the browser's own <img> and
       line-clamp, sized in wall units through --graffiti-s so it scales with
       zoom like ink, and its 1px hairline stays a device hairline.
       ponytail: share images (a §57 follow-up) will need it drawn to canvas.
       The Link tool opens a toast: URL + square add (+, then x to remove);
       the add puts a card at the view's centre, which drags under Link until
       the toast's check (Done; x when there is no card) places it. */
    const CARD_W = 480, CARD_H = 368, CARD_SHORT = 120; // wall units = 240 x 184 screen px at zoom 1 (base scale 0.5; §57b rescope 2); no image: 240 x 60 (§57d)
    const cards = [];
    let pending = null, linkToast = null;
    const linkBtn = section.querySelector('[data-graffiti-tool="link"]');
    if (linkBtn && !api?.link) linkBtn.hidden = true;
    // http(s) only for the href; an image may also be a data:image (the stub's).
    const safeUrl = (u, img) => { try { const p = new URL(u).protocol; return p === "https:" || p === "http:" || (img && /^data:image\//.test(u)) ? u : ""; } catch { return ""; } };
    // A card is CARD_W x CARD_H; an image (§58) has its own w x h, turned
    // `rot` degrees about its centre, so the point is turned back first.
    const hitCard = (c, [x, y], r = 0) => {
        if (!c) return false;
        const w = c.w ?? CARD_W, h = c.h ?? CARD_H, a = ((c.rot || 0) * Math.PI) / 180, dx = x - c.x - w / 2, dy = y - c.y - h / 2;
        return Math.abs(dx * Math.cos(a) + dy * Math.sin(a)) <= w / 2 + r && Math.abs(dy * Math.cos(a) - dx * Math.sin(a)) <= h / 2 + r;
    };
    // §57b: a <div>; the link line is the card's one <a>, stretched over the
    // whole card (CSS ::after) so the card is still one link. §62: on the
    // reader's own card (data-own) only the line is the link; the rest of the
    // card lets presses through, and a Hand click there picks it up (reselect).
    const cardEl = (c) => {
        const el = Object.assign(document.createElement("div"), { className: "qntns-graffiti__card" });
        const src = safeUrl(c.image || "", true), href = safeUrl(c.url);
        // §57d: no image (or one that fails to load) makes the short card, the text
        // alone; its own c.h carries the height to hitCard (eraser, Link's drag).
        const short = () => { c.h = CARD_SHORT; el.toggleAttribute("data-short", true); };
        el.innerHTML = `${src ? `<img class="qntns-graffiti__card-img" alt="" draggable="false">` : ""}<span class="qntns-graffiti__card-text"><strong class="qntns-graffiti__card-title"></strong><a class="qntns-graffiti__card-url" target="_blank" rel="noopener noreferrer" draggable="false">${iconAny("link", { size: 16, className: "icon" })}<span></span></a></span>`;
        const img = el.querySelector("img");
        if (img) { img.src = src; img.onerror = () => { img.remove(); short(); }; } else short();
        const a = el.querySelector("a");
        if (href) a.href = href;
        // textContent: the title and URL are another site's words. No description (§57b rescope 2).
        el.querySelector("strong").textContent = c.title || c.url;
        // host without www., then the path; CSS cuts it with an ellipsis.
        let line = c.url || "";
        try { const u = new URL(c.url); line = u.hostname.replace(/^www\./, "") + (u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "")); } catch {}
        a.querySelector("span").textContent = line;
        return el;
    };
    const placeCards = () => {
        const s = scale(), dx = canvas.getBoundingClientRect().left - box.getBoundingClientRect().left + ox;
        box.style.setProperty("--graffiti-s", s);
        for (const c of [...cards]) flushCard(c);
        for (const c of cards) {
            c.el.style.display = c.page === page ? "" : "none";
            c.el.style.left = `${dx + (c.x - cam.x) * s}px`;
            c.el.style.top = `${c.y * s}px`;
            c.el.toggleAttribute("data-own", !!member && c.artist === member.id); // §62; member.id may land late (§16)
            c.el.toggleAttribute("data-dim", !!sel && !sel.cards.has(c)); // §59c: CSS dims it at DIM
            if (sel?.cards.has(c)) { c.el.style.left = `${dx + (c.x + sel.dx - cam.x) * s}px`; c.el.style.top = `${(c.y + sel.dy) * s}px`; } // §59: lassoed, at the drag offset
            if (c.kind === "image") { c.el.style.setProperty("--w", c.w); c.el.style.setProperty("--h", c.h); c.el.style.setProperty("--r", `${c.rot}deg`); c.el.toggleAttribute("data-held", c === holding); }
            if (c.page === page) overlay(c);
        }
    };
    /* §71: the wall stacks by `at`, newest on top. Cards keep `cards` and their
       DOM order in `at` order (putCard, flushCard); a mark newer than a card is
       drawn again on the card's own canvas (.qntns-graffiti__over), clipped to
       the card and turned with it, so it sits over that card and under every
       newer card. ponytail: repainted whole when the wall, zoom or card
       changes; a line still being drawn (own or live, §52) and the wet pool go
       under cards until they land. */
    const overlay = (c) => {
        const s = scale(), dpr = devicePixelRatio || 1, w = c.w ?? CARD_W, h = c.h ?? CARD_H, held = !!sel?.cards.has(c);
        const key = `${ver},${all.length},${s},${dpr},${c.x},${c.y},${w},${h},${c.rot},${c.at},${held}`;
        if (c.overKey === key) return;
        c.overKey = key;
        const r = Math.hypot(w, h) / 2, cx = c.x + w / 2, cy = c.y + h / 2;
        const near = (b) => b && b.x0 < cx + r && b.x1 > cx - r && b.y0 < cy + r && b.y1 > cy - r;
        const on = held ? [] : all.filter((st) => st.at > c.at && !sel?.sts.has(st) && near(inkBounds([st])));
        if (!on.length) { c.over?.remove(); return; }
        c.over ??= Object.assign(document.createElement("canvas"), { className: "qntns-graffiti__over" });
        if (c.over.parentNode !== c.el) c.el.prepend(c.over); // first child: under an image's handles
        c.over.width = Math.ceil(w * s * dpr);
        c.over.height = Math.ceil(h * s * dpr);
        const g = c.over.getContext("2d");
        inkOn(g, 0);
        g.setTransform(new DOMMatrix().scale(s * dpr).translate(w / 2, h / 2).rotate(-(c.rot || 0)).translate(-cx, -cy));
        for (const st of on) paintOne(g, st);
    };
    const putCard = (c) => {
        c.at ??= Date.now();
        const i = cards.findIndex((k) => k.at > c.at);
        if (i < 0) { cards.push(c); box.append(c.el); } else { cards[i].el.before(c.el); cards.splice(i, 0, c); }
        schedule();
    };
    // Cards already on the wall (the stories' fixtures until a Worker route exists).
    for (const c of links) {
        const d = { ...c, page: c.page ?? page };
        if (d.kind === "image") { d.el = Object.assign(document.createElement("div"), { className: "qntns-graffiti__img" }); d.el.innerHTML = `<img alt="" draggable="false">`; d.el.firstChild.src = d.src; } else d.el = cardEl(d);
        putCard(d);
    }
    const dropCard = (c) => { const i = cards.indexOf(c); if (i < 0) return; cards.splice(i, 1); c.el.remove(); flushCard(c); schedule(); };
    /* §65 SAVING. A card is saved once placed (not pending, not held), reposted
       when it moves, deleted when it goes; the Worker has no PATCH. c.saved is
       the key last sent (false = none), c.sid the Worker's id. A reply that
       lands after the card moved on or went erases its own post.
       ponytail: a failed post is retried on the next frame that sees the key differ. */
    const cardIds = new Set();
    const cardKey = (c) => [c.x, c.y, c.rot ?? 0, c.kind === "image" ? `${c.w},${c.h}` : ""].join();
    const flushCard = (c) => {
        if (!api?.card || !member || c.artist !== member.id || c === pending || c === holding) return;
        const k = cards.includes(c) && cardKey(c), old = c.sid;
        if (k === (c.saved ?? false)) return;
        c.saved = k;
        c.sid = undefined;
        if (old) { cardIds.delete(old); unpost("card", old); }
        if (!k) return;
        // §71: a (re)post is the Worker's newest card; on top here too, as a lasso move puts a stroke.
        c.at = Date.now();
        cards.push(...cards.splice(cards.indexOf(c), 1));
        box.append(c.el);
        const body = c.kind === "image"
            ? { kind: "image", x: c.x, y: c.y, w: c.w, h: c.h, rot: c.rot, image: c.meme, ...(c.name ? { title: c.name.slice(0, 200) } : {}) }
            : { kind: "link", x: c.x, y: c.y, url: c.url, title: (c.title || "").slice(0, 200), host: c.host, path: c.path, image: c.imageId ?? null, h: c.h ?? CARD_H };
        if (c.page !== "misc") body.page = c.page;
        body.cid = c.id; // §7a
        sent.add(c.id);
        api.card(body).then((r) => {
            if (!r?.id) { if (c.saved === k) c.saved = undefined; return; }
            if (c.saved === k && cards.includes(c)) { c.sid = r.id; cardIds.add(r.id); } else unpost("card", r.id);
        });
    };
    // A card the Worker holds (GET /graffiti, or the socket's "ink"); others' and the reader's own, once.
    const addSaved = (k, at) => {
        if (cardIds.has(k.id)) return;
        cardIds.add(k.id);
        const c = k.kind === "image"
            ? { kind: "image", meme: k.image, name: k.title, src: k.src, w: k.w, h: k.h, rot: k.rot }
            : { url: k.url, title: k.title, host: k.host, path: k.path, image: k.src, imageId: k.image, h: k.h };
        Object.assign(c, { id: crypto.randomUUID(), sid: k.id, artist: k.artist, at: k.at, page: at, x: k.x, y: k.y, rot: k.rot });
        c.el = k.kind === "image" ? imgEl(k.src, k.title) : cardEl(c);
        c.saved = cardKey(c);
        putCard(c);
    };
    /* §62 RE-EDIT. A Hand click on the reader's own card or meme picks it up
       again (Link's or Image's held state); c.was is where it stood. Done is
       one undo step back to c.was (a new one's is "remove it"); Delete drops
       it, one undo step putting it back (a new one's Delete has no step). */
    const settle = (c) => {
        const was = c.was, now = { x: c.x, y: c.y, w: c.w, h: c.h, rot: c.rot };
        delete c.was;
        return was ? [() => { Object.assign(c, was); schedule(); }, () => { Object.assign(c, now); schedule(); }] : [() => dropCard(c), () => putCard(c)];
    };
    // CHECKLIST-31 §7: let go first. flushCard skips the held card, so a
    // re-picked card's Remove read Saved and sent no DELETE; reload brought it back.
    const cutHeld = (c) => { if (pending === c) pending = null; if (holding === c) holding = null; dropCard(c); const was = c.was; delete c.was; if (was) { hist().push(() => { Object.assign(c, was); putCard(c); }, () => dropCard(c)); canUndo(); } };
    const reselect = (ev) => {
        if (!member) return false;
        const p = toWall(ev.clientX, ev.clientY), c = cards.findLast((c) => c.page === page && hitCard(c, p));
        if (!c || c.artist !== member.id) return false; // the top card only; another's meme is inert
        c.was = { x: c.x, y: c.y, w: c.w, h: c.h, rot: c.rot };
        if (c.kind === "image") { holding = c; setTool("image"); imgHeldToast(); }
        else { setTool("link"); pending = c; linkToast.input.value = c.url || ""; linkUi(); }
        schedule();
        return true;
    };
    // §57 rescope: one row, [url][+] until a card is in, then [url][x][check];
    // + stays aria-disabled until the field holds something.
    const linkUi = () => {
        if (!linkToast) return;
        const { add, del, done, input } = linkToast;
        add.hidden = !!pending;
        del.hidden = done.hidden = !pending;
        if (input.value.trim()) add.removeAttribute("aria-disabled"); else add.setAttribute("aria-disabled", "true");
    };
    const closeLink = () => {
        if (!linkToast) return;
        const { bye } = linkToast;
        linkToast = null;
        bye();
        if (pending) { hist().push(...settle(pending)); canUndo(); }
        pending = null;
        if (tool === "link") setTool("hand");
        schedule(); // CHECKLIST-31 §7a: the frame's placeCards posts the card now, not on the next unrelated frame
    };
    const openLink = () => {
        if (linkToast) return;
        const bye = showToast(document, { title: "", body: "", icon: "link", action: [] });
        const el = document.body.lastElementChild;
        el.classList.add("qntns-graffiti__link-toast");
        el.querySelector(".qntns-toast__icon").innerHTML = iconAny("link", { size: 20, className: "icon" });
        const form = Object.assign(document.createElement("form"), { className: "qntns-graffiti__link", noValidate: true });
        // All three are the toast's own 32 square; x is the outlined one.
        const sq = (cls, type, label, name) => `<button class="qntns-toast__close${cls}" type="${type}" aria-label="${label}">${iconAny(name, { size: 16, className: "icon" })}</button>`;
        form.innerHTML = `<input class="qntns-graffiti__link-url" type="url" inputmode="url" placeholder="Paste a link" aria-label="Link" autocomplete="off" spellcheck="false">${sq("", "submit", "Add the card", "plus")}${sq(" qntns-graffiti__sq-out", "button", "Remove the card", "x")}${sq("", "button", "Done", "check")}`;
        el.querySelector(".qntns-toast__text").replaceWith(form);
        const input = form.querySelector("input");
        const [add, del, done] = form.querySelectorAll("button");
        linkToast = { bye, add, del, done, input };
        linkUi();
        input.addEventListener("input", linkUi);
        del.addEventListener("click", () => { if (pending) cutHeld(pending); pending = null; linkUi(); input.focus(); });
        done.addEventListener("click", closeLink);
        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            if (pending) return;
            const v = input.value.trim(), url = safeUrl(/^[a-z]+:/i.test(v) ? v : `https://${v}`);
            if (!v || !url) return input.focus();
            const t = linkToast, r = await api.link(url).catch(() => null);
            if (!r || linkToast !== t || pending) return;
            // The centre of the canvas's on-screen part, so the card is in sight.
            const s = scale(), cr = canvas.getBoundingClientRect(), cy = (Math.max(cr.top, vTop()) + Math.min(cr.bottom, vBot())) / 2;
            const snap = (n) => Math.round(n / 4) * 4; // base 4, wall units
            pending = { id: crypto.randomUUID(), artist: member.id, page, url: safeUrl(r.url || "") || url, title: r.title, description: r.description, image: r.image, imageId: r.imageId, host: r.host, path: r.path,
                x: snap(cam.x + (canvas.clientWidth / 2 - ox) / s - CARD_W / 2), y: Math.max(0, snap((cy - box.getBoundingClientRect().top) / s - CARD_H / 2)) };
            pending.el = cardEl(pending);
            putCard(pending);
            linkUi();
        });
        input.focus();
    };
    // Under Link a press on the card being placed drags it (whole 4s, like
    // the lasso's move); anywhere else moves the wall, as Hand.
    /* CHECKLIST-31 §7b: a press off the held card still pans the wall; one
       that lifts within AXIS_PX (a tap) lets the card go, as Done does. It
       never draws, erases or places: this press belongs to Link / Image. */
    const tapOff = (g, e, off) => {
        let far = false;
        return { ...g, move: (ev) => { far ||= Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) > AXIS_PX; g.move(ev); }, end: (ev) => { g.end(ev); if (!far) off(); } };
    };
    const linkDrag = (e) => {
        const p0 = toWall(e.clientX, e.clientY), c = pending;
        if (!c) return pan(e);
        if (!hitCard(c, p0)) return tapOff(pan(e), e, closeLink);
        const { x, y } = c;
        return {
            kind: "pan", // the grabbing cursor
            pen: e.pointerType === "pen",
            ids: [e.pointerId],
            move: (ev) => { const p = toWall(ev.clientX, ev.clientY); c.x = x + Math.round((p[0] - p0[0]) / 4) * 4; c.y = Math.max(0, y + Math.round((p[1] - p0[1]) / 4) * 4); schedule(); },
            end: () => {},
            cancel: () => {}
        };
    };
    /* §58 IMAGE (Storybook draft: api.memes is the stories' stub, images live
       in memory; no Worker route yet, so the button hides without api.memes).
       An image is a §57-style DOM overlay kept in `cards` (kind "image"), so
       placeCards, the eraser and undo carry it as they carry a card. Picking
       Image opens the picker (search on top, a grid of memes); a pick puts the
       image at the view's centre, held, with a toast: check places it (one
       undo step), trash drops it. While held, under Image:
           body          move, whole 4s (like the lasso)
           corner, edge  resize about the opposite corner / edge, ratio locked,
                         longest side IMG_MIN..IMG_MAX wall units
           ball, or just outside a corner   rotate, clamped to +-TURN_MAX deg
       The zones are measured in screen px (the handles do not zoom), in the
       image's own turned frame:
           ball     12 across, its centre 26 above the top edge (20 line + 6)
           corner   the 24 grip square centred on each corner (+-12)
           rotate   out to 28 past a corner, outside that square
           edge     +-8 across an edge
       ponytail: no captions (the user did not ask). */
    const IMG_MAX = 200, IMG_MIN = 48, IMG_START = 160, TURN_MAX = 60; // wall units; 48 is the smallest that still shows a meme
    let holding = null, imgToast = null, memeAsk = 0, loading = false;
    // Shut with nothing picked (outside press, Escape, scroll, its button): back to Hand.
    const memesShut = () => { if (!holding && !loading && tool === "image") setTool("hand"); };
    const imgBtn = section.querySelector('[data-graffiti-tool="image"]');
    if (imgBtn && !api?.memes) imgBtn.hidden = true;
    if (linkBtn?.hidden && imgBtn?.hidden) linkBtn.parentElement.hidden = true;
    let memes = null;
    if (imgBtn && api?.memes) {
        // The search field is the postcard address line (a rule under the
        // words, no box): its wrapper class, reused as it stands.
        memes = Object.assign(document.createElement("div"), { className: "qntns-views__menu qntns-graffiti__pick qntns-graffiti__memes", id: "qntns-graffiti-memes", popover: "manual" });
        memes.setAttribute("role", "dialog");
        memes.setAttribute("aria-label", "Pick an image");
        memes.innerHTML = `<div class="qntns-postcard__address"><input type="search" placeholder="Search memes" aria-label="Search memes" autocomplete="off" spellcheck="false"></div><div class="qntns-graffiti__meme-grid" role="list"></div>`;
        imgBtn.setAttribute("aria-controls", memes.id);
        imgBtn.setAttribute("aria-expanded", "false");
        imgBtn.after(memes);
        const q = memes.querySelector("input"), grid = memes.querySelector("[role=list]");
        // Paged in the request: api.memes(q, offset) answers { items (<=12), more }.
        let wait = 0, list = [], more = false;
        const MEME_PAGE = 12;
        const ask = (add) => {
            const n = ++memeAsk, from = add ? list.length : 0;
            api.memes(q.value.trim(), from).catch(() => null).then((r) => {
                if (n !== memeAsk) return; // a newer search has gone out
                const got = ((r && r.items) || []).slice(0, MEME_PAGE).filter((m) => safeUrl(m.src || "", true));
                more = !!(r && r.more) && got.length > 0;
                if (!add) list = [];
                const first = list.length;
                list = list.concat(got);
                grid.querySelector(".qntns-graffiti__meme-more")?.remove();
                if (!add) grid.innerHTML = list.length ? "" : `<p class="qntns-graffiti__meme-none">No memes match</p>`;
                got.forEach((m, k) => {
                    const b = Object.assign(document.createElement("button"), { className: "qntns-graffiti__meme", type: "button", title: m.name });
                    b.setAttribute("role", "listitem");
                    b.dataset.meme = first + k;
                    b.setAttribute("aria-label", m.name);
                    b.innerHTML = `<img alt="" draggable="false">`;
                    b.firstChild.src = m.src;
                    grid.append(b);
                });
                if (more) grid.append(Object.assign(document.createElement("button"), { className: "qntns-graffiti__meme-more", type: "button", textContent: "Load more" }));
            });
        };
        q.addEventListener("input", () => { clearTimeout(wait); wait = setTimeout(() => ask(), 160); });
        memes.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); shutPanel(true); } });
        memes.addEventListener("click", (e) => { if (e.target.closest(".qntns-graffiti__meme-more")) return ask(true); const b = e.target.closest("[data-meme]"); if (b) putMeme(list[+b.dataset.meme]); });
        ask();
    }
    const openMemes = () => {
        if (!memes || shown?.panel === memes) return;
        shutPanel();
        showPanel(imgBtn, memes);
        memes.querySelector("input").focus();
    };
    const keepHeld = () => {
        if (!holding) return;
        const c = holding;
        holding = null;
        hist().push(...settle(c));
        canUndo();
        schedule();
    };
    const closeImage = () => {
        if (!holding && !imgToast && shown?.panel !== memes) return;
        if (shown?.panel === memes) shutPanel();
        if (imgToast) { const bye = imgToast; imgToast = null; bye(); }
        keepHeld();
        delete box.dataset.imgZone;
        if (tool === "image") setTool("hand");
    };
    const imgEl = (src, name) => {
        const el = Object.assign(document.createElement("div"), { className: "qntns-graffiti__img" });
        el.innerHTML = `<img alt="" draggable="false"><span class="qntns-graffiti__img-turn"></span><span class="qntns-graffiti__img-grip">${iconAny("move-diagonal-2", { size: 16, className: "icon" })}</span>`;
        el.firstChild.src = src;
        el.firstChild.alt = name || "";
        return el;
    };
    const putMeme = (m) => {
        loading = true; // so the picker shutting does not drop the tool
        shutPanel();
        keepHeld(); // a second pick places the first
        const img = new Image();
        img.onerror = () => { loading = false; memesShut(); };
        img.onload = () => {
            loading = false;
            if (tool !== "image") return;
            const k = IMG_START / Math.max(img.naturalWidth, img.naturalHeight), w = img.naturalWidth * k, h = img.naturalHeight * k;
            // The centre of the canvas's on-screen part, as §57's card.
            const s = scale(), cr = canvas.getBoundingClientRect(), cy = (Math.max(cr.top, vTop()) + Math.min(cr.bottom, vBot())) / 2;
            const snap = (n) => Math.round(n / 4) * 4;
            const mx = snap(cam.x + (canvas.clientWidth / 2 - ox) / s), my = Math.max(snap(h / 2), snap((cy - box.getBoundingClientRect().top) / s));
            holding = { id: crypto.randomUUID(), kind: "image", artist: member.id, page, meme: m.id, name: m.name, src: m.src, w, h, rot: 0, x: mx - w / 2, y: my - h / 2 };
            holding.el = imgEl(m.src, m.name);
            putCard(holding);
            imgHeldToast();
        };
        img.src = m.src;
    };
    const imgHeldToast = () => {
        if (imgToast) return;
        imgToast = showToast(document, { title: "Move, resize or turn it", body: "", icon: "image", action: [
            { label: "Delete", icon: "trash-2", onClick: () => { imgToast = null; if (holding) cutHeld(holding); holding = null; setTool("hand"); } },
            { label: "Done", icon: "check", onClick: () => { imgToast = null; closeImage(); } }
        ] });
        document.body.lastElementChild.querySelector(".qntns-toast__icon").innerHTML = iconAny("image", { size: 20, className: "icon" });
        document.body.lastElementChild.querySelector(".qntns-toast__close").classList.add("qntns-graffiti__sq-out"); // §57: outlined delete, solid check
    };
    // Where a press lands on the holding image, in its own turned frame (px).
    const zone = (c, cx, cy) => {
        const s = scale(), [x, y] = toWall(cx, cy), a = (c.rot * Math.PI) / 180, dx = (x - c.x - c.w / 2) * s, dy = (y - c.y - c.h / 2) * s;
        const lx = dx * Math.cos(a) + dy * Math.sin(a), ly = dy * Math.cos(a) - dx * Math.sin(a);
        const hw = (c.w * s) / 2, hh = (c.h * s) / 2, ox_ = Math.abs(lx) - hw, oy_ = Math.abs(ly) - hh, sx = Math.sign(lx) || 1, sy = Math.sign(ly) || 1;
        if (Math.hypot(lx, ly + hh + 26) <= 12) return { kind: "turn" };
        if (Math.abs(ox_) <= 12 && Math.abs(oy_) <= 12) return { kind: "size", sx, sy };
        if (ox_ > -12 && oy_ > -12 && ox_ <= 28 && oy_ <= 28) return { kind: "turn" };
        if (Math.abs(ox_) <= 8 && oy_ < 0) return { kind: "size", sx, sy: 0 };
        if (Math.abs(oy_) <= 8 && ox_ < 0) return { kind: "size", sx: 0, sy };
        return ox_ < 0 && oy_ < 0 ? { kind: "move" } : null;
    };
    // The resize cursor nearest the handle's on-screen direction.
    const cursorOf = (z, rot) => (z.kind !== "size" ? z.kind : ["ew", "nwse", "ns", "nesw"][Math.round((((((Math.atan2(z.sy, z.sx) * 180) / Math.PI + rot) % 180) + 180) % 180) / 45) % 4]);
    const imgDrag = (e) => {
        const c = holding, z = c && zone(c, e.clientX, e.clientY);
        if (!z) return c ? tapOff(pan(e), e, closeImage) : pan(e);
        const p0 = toWall(e.clientX, e.clientY), { x, y, w, h, rot } = c, cx = x + w / 2, cy = y + h / 2;
        let last = null, turned = rot; // the turn adds up step by step, so a long drag never wraps at 180
        const a = (rot * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
        const ang = (p) => (Math.atan2(p[0] - cx, cy - p[1]) * 180) / Math.PI; // 0 straight up, clockwise +
        const to = z.kind === "move"
            ? (p) => { c.x = x + Math.round((p[0] - p0[0]) / 4) * 4; c.y = Math.max(0, y + Math.round((p[1] - p0[1]) / 4) * 4); }
            : z.kind === "turn"
                ? (p) => { last ??= ang(p0); const a1 = ang(p); turned += ((a1 - last + 540) % 360) - 180; last = a1; c.rot = Math.max(-TURN_MAX, Math.min(TURN_MAX, Math.round(turned))); }
                : (p) => {
                    // The pointer in the image's frame, projected on the anchor -> handle
                    // line: k is the new size over the old, both sides alike.
                    const dx = p[0] - cx, dy = p[1] - cy, lx = dx * cos + dy * sin, ly = dy * cos - dx * sin;
                    const vx = z.sx * w, vy = z.sy * h, big = Math.max(w, h);
                    const k = Math.min(IMG_MAX / big, Math.max(IMG_MIN / big, ((lx + vx / 2) * vx + (ly + vy / 2) * vy) / (vx * vx + vy * vy)));
                    const nw = w * k, nh = h * k, mx = (z.sx * (nw - w)) / 2, my = (z.sy * (nh - h)) / 2;
                    Object.assign(c, { w: nw, h: nh, x: cx + mx * cos - my * sin - nw / 2, y: cy + mx * sin + my * cos - nh / 2 });
                };
        return {
            kind: z.kind === "move" ? "pan" : "image", // pan: the grabbing cursor
            pen: e.pointerType === "pen",
            ids: [e.pointerId],
            move: (ev) => { to(toWall(ev.clientX, ev.clientY)); schedule(); },
            end: () => {},
            cancel: () => {}
        };
    };
    /* §28b WATER. The press is one sample, the drag one every WATER_STEP, each
       carrying the paint from the last. On a dry wall it does nothing. */
    const water = (e) => {
        let last = toWall(e.clientX, e.clientY);
        const rub = (p) => {
            const n = Math.max(1, Math.ceil(Math.hypot(p[0] - last[0], p[1] - last[1]) / WATER_STEP));
            for (let i = 1; i <= n; i++) {
                const q = [last[0] + ((p[0] - last[0]) * (i - 1)) / n, last[1] + ((p[1] - last[1]) * (i - 1)) / n];
                wetWater([last[0] + ((p[0] - last[0]) * i) / n, last[1] + ((p[1] - last[1]) * i) / n], q);
            }
            last = p;
            schedule();
        };
        wetWater(last, last);
        schedule();
        return {
            kind: "water",
            pen: e.pointerType === "pen",
            ids: [e.pointerId],
            move: (ev) => { for (const c of ev.getCoalescedEvents?.() ?? [ev]) rub(toWall(c.clientX, c.clientY)); },
            end: () => { waterBase = null; wetTouch(); },
            cancel: () => { waterBase = null; wetTouch(); }
        };
    };
    /* §28b DRY. The wet paint, cropped to its alpha, becomes one wash: a
       canvas now, a PNG on the Worker. It lands on top like a stroke, one
       undo entry. The toast's Dry (§28c) will call this too. */
    // The pool (§5: or its rect b) as a wash stroke (not yet on the wall), or null when empty.
    const bakeWash = (b = pool.box) => {
        const at = pool.at, d = pool.d;
        if (!at || !b) return null;
        let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
        for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) if (d[y * POOL + x] > 0) {
            x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
        if (x1 < 0) return null;
        const box = { x: at.x + x0, y: at.y + y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
        const img = document.createElement("canvas");
        img.width = box.w; img.height = box.h;
        img.getContext("2d").putImageData(new ImageData(wetBytes(d, POOL, x0, y0, box.w, box.h, washRgb, at.x, at.y, PAPER_DRY, DRY_DENSITY), box.w, box.h), 0, 0);
        return { id: crypto.randomUUID(), artist: member?.id, at: Date.now(), tool: "wash", page, box, img };
    };
    /* §5: a wash over PIECE either way, cut into near-equal pieces of at most
       PIECE (empty ones dropped), each its own wash, so no POST is over the
       Worker's WASH_MAX. Pieces share `left`, so a pre-save slot goes only
       when the last one lands. ponytail: a fixed size from one measurement;
       halve a piece on a 413 if a wash ever compresses worse. */
    const split = (st) => {
        const { x, y, w, h } = st.box, nx = Math.ceil(w / PIECE), ny = Math.ceil(h / PIECE);
        if (nx * ny === 1) return [st];
        const pw = Math.ceil(w / nx), ph = Math.ceil(h / ny), left = { n: 0 }, out = [];
        for (let by = 0; by < h; by += ph) for (let bx = 0; bx < w; bx += pw) {
            const img = document.createElement("canvas"), bw = Math.min(pw, w - bx), bh = Math.min(ph, h - by);
            img.width = bw; img.height = bh;
            const g = img.getContext("2d", { willReadFrequently: true });
            g.drawImage(st.img, -bx, -by);
            const a = g.getImageData(0, 0, bw, bh).data;
            let k = 3;
            while (k < a.length && !a[k]) k += 4;
            if (k < a.length) out.push({ ...st, id: crypto.randomUUID(), box: { x: x + bx, y: y + by, w: bw, h: bh }, img, left });
        }
        left.n = out.length;
        return out;
    };
    // Dried washes onto the wall: on top, one undo entry, saved.
    const commitWash = (sts) => {
        if (!sts.length) return canUndo();
        all.push(...sts);
        if (sts.length === 1) hist().draw(sts[0]);
        else hist().push(() => sts.filter(undoOps.has).forEach(unmark), () => sts.forEach(undoOps.add));
        canUndo();
        inkBox = inkBounds(all);
        grow();
        for (const st of sts) { bakeOn(st); onStroke?.(st); save(st); }
    };
    /* §41 PRE-SAVE. After every finished wet stroke (or water drag) the
       pool, dried as it would be now, is kept as a PNG in IndexedDB (one
       slot per browser; there is one pool) and in `held`, so a closed tab
       loses nothing: pagehide POSTs `held` with keepalive and clears the
       slot; the next visit (below, wetRestore) POSTs whatever is still
       there, once. The same touch restarts the WET_DRY_MS auto-dry clock.
       ponytail: one slot, one try per visit; a wash the Worker refuses
       twice is gone from the slot but still on that visit's screen. */
    const idb = (mode, op) => new Promise((res) => {
        try {
            const o = indexedDB.open("qntns-graffiti", 1);
            o.onupgradeneeded = () => o.result.createObjectStore("wet");
            o.onerror = () => res(null);
            o.onsuccess = () => {
                try {
                    const rq = op(o.result.transaction("wet", mode).objectStore("wet"));
                    rq.onsuccess = () => res(rq.result ?? null);
                    rq.onerror = () => res(null);
                } catch { res(null); }
            };
        } catch { res(null); }
    });
    let held = null, dryT = 0, presaveN = 0;
    // Empty the slot; given `at`, only if it still holds that pre-save.
    const slotDrop = (at = 0) => idb("readwrite", (s) => { const g = s.get("wet"); g.addEventListener("success", () => { if (!at || g.result?.at === at) s.delete("wet"); }); return g; });
    const wetDrop = (slot = true) => { clearTimeout(dryT); melts.length = 0; held = null; presaveN++; if (slot) slotDrop(); };
    const wetTouch = () => {
        sim?.poke(); // §28d
        clearTimeout(dryT);
        dryT = setTimeout(dry, wetDryMs);
        const st = bakeWash(), n = ++presaveN;
        if (!st) return;
        pngOf(st).then((png) => {
            if (!png || n !== presaveN) return; // a newer pool state, or dropped
            held = { png, box: st.box, page: st.page, at: st.at };
            idb("readwrite", (s) => s.put(held, "wet"));
        });
    };
    // Leaving the page dries, as Dry does (§48): the slot stays until a POST
    // lands, so a real unload that kills the POST leaves it for the next
    // visit (wetRestore); a bfcache return finishes or retries it here.
    // ponytail: a POST that landed as the page died is posted again next visit.
    const onHide = () => dry();
    addEventListener("pagehide", onHide);
    // What a closed tab left wet: dried, POSTed once, and shown here if it
    // is this page's. A reader not signed in cannot have painted it; it waits.
    // §48: the slot is emptied only when that POST lands (save's st.slot);
    // until then the wash waits in `unsaved` like any other mark.
    const wetRestore = () => member && api && idb("readonly", (s) => s.get("wet")).then(async (h) => {
        if (!h?.png) return;
        const img = await createImageBitmap(h.png).catch(() => null);
        if (!img) return;
        const sts = split({ id: crypto.randomUUID(), artist: member.id, at: h.at, tool: "wash", page: h.page ?? "misc", box: h.box, img, slot: h.at });
        if (!sts.length) return slotDrop(h.at);
        (walls[sts[0].page] ??= []).push(...sts);
        ver++;
        inkBox = inkBounds(all);
        grow();
        schedule();
        sts.forEach(save);
    });
    const dry = () => {
        if (!pool.at) return;
        const st = bakeWash(), h = held;
        pool.at = pool.box = null;
        setWet(false);
        wetDrop(false); // the slot waits for the POST to land (save)
        schedule();
        if (!st) return canUndo();
        st.slot = h?.at;
        commitWash(split(st));
    };
    const mark = (e) => (tool === "eraser" ? erase(e) : tool === "water" ? water(e) : tool === "lasso" ? lasso(e) : tool === "link" ? linkDrag(e) : tool === "image" ? imgDrag(e) : draw(e));

    const start = (g) => {
        gesture?.cancel();
        gesture = g;
        box.toggleAttribute("data-dragging", g?.kind === "pan");
    };

    // §24: the two-finger tap in progress, and the last one that ended.
    let tap = null, lastTap = null;
    const stylus = (e) => { if ([...e.changedTouches].some((t) => t.touchType === "stylus")) e.preventDefault(); };

    const onDown = (e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        stopFling(); // §49: a touch catches the wall
        const isPen = e.pointerType === "pen", isTouch = e.pointerType === "touch";
        if (isPen) penSeen = true;
        // §23 attempt 2: graffiti.css gives the canvas pan-y under Pen too, so a
        // finger scrolls the page; the Pencil's touchstart is still cancelled
        // (stylus, above), so the pen keeps drawing.
        if (isPen) box.setAttribute("data-pen-seen", "");
        // The palm: a touch while a pen is drawing.
        if (isTouch && gesture?.pen) return;
        // Capture keeps a mouse / pen drag on the canvas past its edge. A touch
        // is never captured: under Hand its vertical drag belongs to the page.
        if (!isTouch) canvas.setPointerCapture(e.pointerId);
        if (isPen) {
            for (const id of down.keys()) down.delete(id);
            down.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY });
            return start(member ? mark(e) : pan(e));
        }
        down.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY });
        if (tap) tap.n = Math.max(tap.n, down.size);
        if (isTouch && down.size === 2) {
            tap = { down: e.timeStamp, up: 0, move: 0, n: 2, from: new Map([...down].map(([id, p]) => [id, [p.x, p.y]])) };
            return start(null);
        }
        if (down.size !== 1) return; // a third finger joins nothing
        const inking = tool !== "hand" && member && !(isTouch && penSeen);
        start(inking ? mark(e) : pan(e));
    };
    const onMove = (e) => {
        hover(e);
        const p = down.get(e.pointerId);
        if (!p) return;
        p.x = e.clientX;
        p.y = e.clientY;
        const o = tap?.from.get(e.pointerId);
        if (o) tap.move = Math.max(tap.move, Math.hypot(p.x - o[0], p.y - o[1]));
        if (gesture?.ids.includes(e.pointerId)) gesture.move(e);
    };
    const onUp = (e) => {
        if (!down.delete(e.pointerId)) return;
        if (tap && e.type === "pointercancel") tap.move = Infinity;
        if (tap && !down.size) {
            tap.up = e.timeStamp;
            const yes = penSeen && member && doubleTap(lastTap, tap);
            lastTap = yes ? null : tap;
            tap = null;
            if (yes) undo();
        }
        if (!gesture?.ids.includes(e.pointerId)) return;
        // A cancelled pointer (the browser took it to scroll) loses its
        // stroke, unless it already has a line's worth of points (§21).
        if (e.type === "pointercancel" && !(gesture.kind === "draw" && live?.points.length >= 2)) gesture.cancel(); else gesture.end(e);
        gesture = null;
        box.removeAttribute("data-dragging");
    };

    /* §52 LIVE. While the wall is on screen it holds one socket to its page
       (api.live); off screen it is closed, and a page switch reopens it on
       the new page. Every LIVE_MS the reader's line in progress goes out as
       the points added since (ink tools only: smudge paints nothing, and
       watercolor dries into a wash). Others' lines come in to `remote` and
       are drawn over the bake each frame, never into it, with the artist's
       name at their pen tip until LABEL_MS after their last point. A saved
       mark arrives as "ink" and joins the wall as a loaded one does (merge),
       and takes the place of that artist's oldest finished live line; an
       erase drops it. This tab's own ink is skipped by its cid (§7a, `mine`):
       it can land before the POST's reply names its id. The same artist's
       other tabs and devices apply it. A reopened socket re-reads the view,
       for anything saved while it was shut.
       ponytail: an erase missed while shut shows on reload. */
    const remote = new Map(); // "artist:s" -> { id, artist, tool, size, points, end, t }
    const labels = new Map(); // artist -> { el, r, t }
    let sock = null, liveT = 0, liveN = 0, liveAt = 0, out = null, onScreen = false, opened = false;
    const liveOpen = () => {
        if (!api?.live || sock || !onScreen) return;
        const at = page, me = (sock = {});
        const gone = () => { if (sock === me) { sock = null; liveT = setTimeout(liveOpen, LIVE_RETRY_MS); } };
        api.live(at, (m) => sock === me && heard(m, at), gone, !!member).then((ws) => {
            if (sock !== me) return ws?.close();
            if (!ws) return gone();
            me.ws = ws;
            if (opened) { asked.clear(); queueLoad(); }
            opened = true;
        });
    };
    const liveShut = () => {
        clearTimeout(liveT);
        sock?.ws?.close();
        sock = null;
        remote.clear();
        for (const l of labels.values()) { clearTimeout(l.t); l.el.remove(); }
        labels.clear();
    };
    const relive = () => { liveShut(); liveOpen(); };
    const seenBy = typeof IntersectionObserver === "function" && new IntersectionObserver((e) => { onScreen = e[e.length - 1].isIntersecting; onScreen ? liveOpen() : liveShut(); });
    seenBy?.observe(box);
    // The reader's line out, LIVE_POINTS at most a message; `end` once it lifts and all is sent.
    const liveTick = () => {
        if (!out && member && LIVE_TOOLS.includes(live?.tool)) out = { id: live.id, s: ++liveN, tool: live.tool, size: live.size, pts: live.points, n: 0 };
        if (!out) return;
        // Drawers: the reader and every artist labelled (live in the last LABEL_MS).
        // Half a tick of slack, so a lone drawer's interval jitter never skips one.
        const now = Date.now();
        if (now - liveAt < liveGap(labels.size + 1) - LIVE_MS / 2) return;
        liveAt = now;
        const done = live?.id !== out.id, points = out.pts.slice(out.n, out.n + LIVE_POINTS);
        out.n += points.length;
        const end = done && out.n >= out.pts.length;
        if (points.length || end) sock?.ws?.send({ t: "live", s: out.s, tool: out.tool, ...(out.size ? { size: out.size } : {}), points, ...(end ? { end: true } : {}) });
        if (end) out = null;
    };
    const liveEvery = setInterval(liveTick, LIVE_MS);
    /* CHECKLIST-31 §7a: skip only this tab's own echo, by the id it posted
       the mark under (cid), so the same artist's other devices apply every
       save. It used to skip any mark by the reader's artist, so a second
       device saw its own lines only on reload. With no cid (a Worker from
       before §7a) it falls back to that. */
    const mine = (m, o) => (m.cid ? sent.has(m.cid) : !!member && o.artist === member.id);
    const heard = (m, at) => {
        if (m.t === "live") {
            const k = `${m.artist}:${m.s}`;
            let r = remote.get(k);
            if (!r) remote.set(k, (r = { id: k, artist: m.artist, tool: m.tool, size: m.size, points: [] }));
            r.points.push(...m.points);
            r.end = !!m.end;
            r.t = Date.now();
            if (m.name) artists[m.artist] ??= m.name;
            const l = labels.get(m.artist) ?? { el: Object.assign(document.createElement("p"), { className: "qntns-graffiti__live", ariaHidden: "true" }) };
            if (!l.el.isConnected) box.append(l.el);
            l.el.textContent = m.name || artists[m.artist] || "Unknown artist";
            l.r = r;
            clearTimeout(l.t);
            l.t = setTimeout(() => { l.el.remove(); labels.delete(m.artist); }, LABEL_MS);
            labels.set(m.artist, l);
            if (r.end) setTimeout(schedule, GONE_MS);
            return schedule();
        }
        if (m.t !== "ink") return;
        if (m.kind === "card") {
            if (!m.card || mine(m, m.card)) return;
            addSaved(m.card, at);
            if (m.merged?.length && at === page) { asked.clear(); queueLoad(); }
            return;
        }
        if (m.kind === "erase") {
            // §7: the reader's own too: the same artist on another device. This tab's own erase finds nothing (dropCard went first).
            // §1: a batch's ids ride together; a Worker from before §1 sends one `id`.
            const ids = new Set(m.ids ?? [m.id]);
            for (const gone of cards.filter((c) => ids.has(c.sid))) { cardIds.delete(gone.sid); gone.saved = false; dropCard(gone); } // saved = false: already off the Worker, so flushCard sends no DELETE of its own
            let cut = false;
            for (const w of Object.values(walls)) for (let i = w.length - 1; i >= 0; i--) if (ids.has(w[i].sid)) { known.delete(w[i].sid); w.splice(i, 1); cut = true; }
            if (cut) { ver++; inkBox = inkBounds(all); schedule(); }
            return;
        }
        const st = m.stroke ?? m.wash;
        if (!st || mine(m, st)) return;
        for (const [k, r] of remote) if (r.artist === st.artist && r.end) { remote.delete(k); break; }
        merge({ [m.stroke ? "strokes" : "washes"]: [st], artists: m.name ? { [st.artist]: m.name } : {} }, at);
        // Its line joined older ones (§14a): re-read, as save() does for the reader's own.
        if (m.merged?.length && at === page) { asked.clear(); queueLoad(); }
    };
    // Others' lines in progress, over the bake; each name where its line's last point is.
    const paintRemote = (oy) => {
        const now = Date.now();
        for (const [k, r] of remote) if (now - r.t > GONE_MS) remote.delete(k);
        if (remote.size) inkOn(ctx, oy);
        for (const r of remote.values()) if (r.points.length > 1) painter(r.tool)(ctx, inkShape(r, r.end), grain, hash(r.id));
        if (!labels.size) return;
        const s = scale(), dx = canvas.getBoundingClientRect().left - box.getBoundingClientRect().left + ox;
        for (const { el, r } of labels.values()) {
            const [x, y] = r.points[r.points.length - 1] ?? [0, 0];
            el.style.left = `${dx + (x - cam.x) * s}px`;
            el.style.top = `${y * s}px`;
        }
    };

    /* §30 POSTCARD FROM THE WALL. The postcard button lays a dotted frame over
       the wall at the card's full-front picture area (postcard.js paintFront:
       TRIM_W x (TRIM_H - LAYOUT.bandH) = 1200 x 1656, ratio 0.7246), the wall
       outside it faded; the frame drags, Select captures it, Escape cancels.
       Frame, fade and Select are DOM over the canvas (DECISIONS-LOG #37): the
       capture re-renders the ink into its own canvas, so none of them can
       reach the pixels. The capture is the art area WITH its bleed, 1275 x
       1694 (1693.5 up): paintFront cover-fits a full-front picture to that box,
       so this size fits it 1:1 and the trim shows exactly what the frame held.
       Framing blocks drawing and the hand drag (a press moves the frame); the
       zoom buttons and a sideways wheel still move the wall under it.
       ponytail: link cards and memes are DOM, not ink, and are not captured;
       draw them in capture() when a postcard should carry them. */
    const pcBtn = section.querySelector("[data-graffiti-postcard]");
    let framing = null, pcHost = null, pcCard = null;
    const capture = (pc, r) => {
        const s = scale(), [x0, y0] = toWall(r.left, r.top), k = pc.TRIM_W / (r.width / s), B = pc.BLEED;
        const c = document.createElement("canvas"), g = c.getContext("2d");
        c.width = pc.TRIM_W + B * 2;
        c.height = Math.ceil(pc.TRIM_H - pc.LAYOUT.bandH + B);
        let e = box; // the paper: the first painted background under the transparent canvas
        while (e.parentElement && getComputedStyle(e).backgroundColor === "rgba(0, 0, 0, 0)") e = e.parentElement;
        g.fillStyle = getComputedStyle(e).backgroundColor;
        g.fillRect(0, 0, c.width, c.height);
        g.setTransform(k, 0, 0, k, B - k * x0, B - k * y0);
        g.fillStyle = g.strokeStyle = ink;
        g.lineCap = g.lineJoin = "round";
        g.lineWidth = HAIRLINE;
        g.shadowColor = ink;
        g.shadowBlur = EDGE_SOFT * k;
        grain ||= g.createPattern(grainTile(ink), "repeat");
        for (const st of all) paintOne(g, st);
        return c;
    };
    const onFrameKey = (e) => { if (e.key === "Escape") unframe(); };
    const unframe = () => {
        framing?.remove();
        framing = null;
        pcBtn?.setAttribute("aria-pressed", "false");
        removeEventListener("keydown", onFrameKey);
    };
    const sendCard = (pc, src) => {
        pcCard?.destroy();
        pcHost?.remove();
        const data = { title: "Graffiti Wall", type: "", url: `${location.host}/graffiti`, lines: [{ type: "image", src, alt: "" }] };
        pcHost = document.createElement("div");
        pcHost.innerHTML = pc.renderPostcard(data);
        document.body.append(pcHost);
        pcCard = pc.attachPostcard(pcHost, data);
        pcCard.open();
        // Full-front: the card's own expand button, pressed once its picture is painted.
        const ex = pcHost.querySelector("[data-postcard-expand]");
        const press = (n) => (ex.closest("[hidden]") ? n && setTimeout(press, 50, n - 1) : ex.getAttribute("aria-pressed") !== "true" && ex.click());
        if (ex) press(200); // 10 s
    };
    const frameUp = async () => {
        const pc = await import("./postcard.js");
        if (framing) return;
        const layer = document.createElement("div"), fr = document.createElement("div"), sel = document.createElement("button");
        layer.className = "qntns-graffiti__framing";
        fr.className = "qntns-graffiti__frame";
        sel.className = "qntns-graffiti__select";
        sel.type = "button";
        sel.textContent = "Select";
        fr.append(sel);
        layer.append(fr);
        box.append(layer);
        const ratio = pc.TRIM_W / (pc.TRIM_H - pc.LAYOUT.bandH);
        const L = layer.getBoundingClientRect(), b = box.getBoundingClientRect();
        // Sized to the wall's on-screen height, with room for Select (8 + 32)
        // above and below; centred on the visible part (put() clamps it).
        const vh = Math.min(b.height, vBot() - vTop()), vis = Math.max(0, Math.min(b.bottom, vBot()) - Math.max(b.top, vTop()));
        const h = Math.max(48, Math.min(vh - 80, (b.width - 32) / ratio, 640)), w = h * ratio;
        const at = { x: b.left - L.left + (b.width - w) / 2, y: Math.max(b.top, vTop()) - L.top + (vis - h) / 2 };
        const put = () => {
            at.x = clampAxis(at.x, w, 0, layer.clientWidth);
            at.y = clampAxis(at.y, h, 0, layer.clientHeight);
            Object.assign(fr.style, { left: `${at.x}px`, top: `${at.y}px`, width: `${w}px`, height: `${h}px` });
            // Select under the bottom-right corner, over the top-right with no room below.
            fr.toggleAttribute("data-flip", at.y + h + 40 > layer.clientHeight);
        };
        put();
        let drag = null;
        fr.addEventListener("pointerdown", (e) => {
            if (e.target === sel) return;
            drag = { id: e.pointerId, x: e.clientX - at.x, y: e.clientY - at.y };
            fr.setPointerCapture(e.pointerId);
        });
        fr.addEventListener("pointermove", (e) => { if (drag?.id === e.pointerId) { at.x = e.clientX - drag.x; at.y = e.clientY - drag.y; put(); } });
        fr.addEventListener("pointerup", () => { drag = null; });
        fr.addEventListener("pointercancel", () => { drag = null; });
        sel.addEventListener("click", () => {
            const r = fr.getBoundingClientRect();
            unframe();
            let src;
            try { src = capture(pc, r).toDataURL("image/png"); } catch { return showToast(document, { title: "Couldn't capture the wall", body: "Try again." }); }
            sendCard(pc, src);
        });
        framing = layer;
        pcBtn?.setAttribute("aria-pressed", "true");
        addEventListener("keydown", onFrameKey);
        sel.focus({ preventScroll: true });
    };
    const onPcBtn = () => (framing ? unframe() : frameUp());
    pcBtn?.addEventListener("click", onPcBtn);

    canvas.addEventListener("touchstart", stylus, { passive: false });
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", unhover);
    // Any press anywhere closes the tip; a Hand click on a line reopens it.
    addEventListener("pointerdown", closeTip, true);

    return () => {
        unframe(); // §30
        pcBtn?.removeEventListener("click", onPcBtn);
        pcCard?.destroy();
        pcHost?.remove();
        closeLink();
        closeImage();
        cards.forEach((c) => c.el.remove());
        ro.disconnect();
        seenBy?.disconnect(); // §52
        clearInterval(liveEvery);
        liveShut();
        sr.removeEventListener("scroll", schedule);
        removeEventListener("pagehide", onHide);
        removeEventListener("online", retry);
        sr.removeEventListener("scroll", shut);
        sr.removeEventListener("scroll", onPageScroll);
        bar?.removeEventListener("scroll", place);
        document.removeEventListener("pointerdown", onOutside);
        document.removeEventListener("keydown", onEsc);
        clearTimeout(retryT);
        clearTimeout(dryT);
        cancelAnimationFrame(frame);
        stopFling();
        clearTimeout(topT);
        clearTimeout(loadT);
        section.removeEventListener("click", onClick);
        removeEventListener("keydown", onKeyDown);
        removeEventListener("keyup", onKeyUp);
        removeEventListener("blur", spaceUp);
        box.removeEventListener("wheel", onWheel);
        corner.detach();
        pagesOff();
        canvas.removeEventListener("touchstart", stylus);
        canvas.removeEventListener("pointerdown", onDown);
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerup", onUp);
        canvas.removeEventListener("pointercancel", onUp);
        canvas.removeEventListener("pointerleave", unhover);
        removeEventListener("pointerdown", closeTip, true);
    };
};
