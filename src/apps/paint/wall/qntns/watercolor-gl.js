/*
 * §28d WET FLOW. A small WebGL2 pass over the reader's wet pool
 * (graffiti.js §28b), run only while paint is wet and for SIM_MS after the
 * last wet stroke or water drag (poke), so nothing loops once it settles.
 * pool.d stays the one truth: each tick uploads it over the box (+ SIM_PAD),
 * steps, and reads it back, so the dried PNG is what the sim made.
 * §66 §67: nothing moves the body of the paint and nothing crosses its
 * edge. Pigment diffuses INSIDE the wash only: a pixel trades with a
 * neighbour only where both hold paint above EDGE (no flux across the
 * outline), faster on low grain. So overlapping colour inside a wash
 * fades toward its average, two strokes touching while wet lose the line
 * between them and keep ONE outer edge, and the outer edge itself never
 * softens or creeps: what dries is the stamped, ragged outline, hard, with
 * the paper's grain in it (the §28d swirl slid washes ~9 units and kept
 * going; §66's open diffusion then blurred the edge away over 3 s). The
 * trade is symmetric per edge, so pigment and its centroid are conserved.
 * No webgl2, no EXT_color_buffer_float, a failed shader, or ?nogl in the
 * URL: wetGl returns null and the §28b 2D path (stamp + melt) is all there is.
 * ponytail: one program, no velocity grid, no edge darkening; a dried rim
 * (pigment walking to the outline as it dries) is the upgrade.
 * All values FLAG: the user judges the feel on the tablet.
 */
export const SIM_MS = 3000; // the inside evens out, then stops, this long after a poke
export const SIM_PAD = 16; // px past the box the pass covers (nothing spreads now; kept so a water drag's edge is in)
const STEPS = 10; // steps per 60 Hz frame; a tick takes dt / 16.7 ms x STEPS (at most STEPS_MAX), so a 120 Hz tablet and a slow frame blend the same
const STEPS_MAX = 40;
const DIFF = 0.2, FLOOR = 1e-4; // DIFF <= 0.25 for a stable 4-neighbour step; sqrt(2 x DIFF x STEPS x 180 frames / 3 for the u² fade) ≈ 12 px of blending over SIM_MS
const EDGE = 0.05; // pigment below this (a sixth of a stroke's WASH_FILL: the stamp's faint outer feather) is outside the wash: it neither takes nor gives

const VS = `#version 300 es
void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2. - 1., 0., 1.); }`;
// Pigment: pool px c; T the paper tile (256), O the pool's wall origin, A the
// fade over SIM_MS. A pixel under EDGE is outside the wash: no trade either way,
// so the EDGE contour of the stamp is the dried outline, a cliff from the inside.
const FP = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D P, T; uniform ivec2 O; uniform float A;
out vec4 o;
float pt(ivec2 w){ return texelFetch(T, w & 255, 0).r; }
float at(ivec2 c){ return texelFetch(P, c, 0).r; }
float trade(ivec2 c, ivec2 n, float p){
  float q = at(n);
  return q > ${EDGE} ? (q - p) * (1.5 - 0.5 * (pt(O + c) + pt(O + n))) / 1.5 : 0.;
}
void main(){
  ivec2 c = ivec2(gl_FragCoord.xy), X = ivec2(1, 0), Y = ivec2(0, 1);
  float p = at(c);
  if (p > ${EDGE}) p += ${DIFF} * A * (trade(c, c + X, p) + trade(c, c - X, p) + trade(c, c + Y, p) + trade(c, c - Y, p));
  o = vec4(p < ${FLOOR} ? 0. : p, 0., 0., 1.);
}`;

// A sim over a W x W pool, paper the T x T grain tile (T must be 256), or null.
export const wetGl = (W, paper, T) => {
    try {
        if (typeof document === "undefined" || T !== 256 || /[?&]nogl\b/.test(location.search)) return null;
        const gl = document.createElement("canvas").getContext("webgl2", { alpha: false, depth: false, antialias: false });
        if (!gl || !gl.getExtension("EXT_color_buffer_float")) return null;
        const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
        const p = gl.createProgram();
        gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FP)); gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
        gl.useProgram(p);
        ["P", "T"].forEach((k, i) => gl.uniform1i(gl.getUniformLocation(p, k), i));
        const uO = gl.getUniformLocation(p, "O"), uA = gl.getUniformLocation(p, "A");
        const tex = (n) => {
            const t = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, t);
            gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, n, n);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            return t;
        };
        const target = (t) => {
            const f = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, f);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("fbo");
            return { t, f };
        };
        let P = [target(tex(W)), target(tex(W))];
        const paperT = tex(T);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, T, T, gl.RED, gl.FLOAT, paper);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, paperT);
        // Read straight into d when the driver reads R32F as RED/FLOAT, else via RGBA.
        gl.bindFramebuffer(gl.FRAMEBUFFER, P[0].f);
        const red = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT) === gl.RED && gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE) === gl.FLOAT;
        let rgba = new Float32Array(0), t0 = -Infinity, last = 0;
        gl.pixelStorei(gl.UNPACK_ROW_LENGTH, W);
        if (red) gl.pixelStorei(gl.PACK_ROW_LENGTH, W);
        gl.viewport(0, 0, W, W);
        const sim = {
            ms: 0, // mean tick time, upload to readback, ms
            // A fresh pool: empty textures, still.
            reset: () => {
                t0 = -Infinity;
                gl.disable(gl.SCISSOR_TEST); gl.clearColor(0, 0, 0, 0);
                for (const x of P) { gl.bindFramebuffer(gl.FRAMEBUFFER, x.f); gl.clear(gl.COLOR_BUFFER_BIT); }
            },
            poke: () => { t0 = last = performance.now(); },
            on: () => performance.now() - t0 < SIM_MS,
            // Steps d (W x W) over box (pool px rect) grown by SIM_PAD, `at` the
            // pool's wall origin. Returns { rect } it rewrote and the new { box }.
            tick: (d, box, at) => {
                const s = performance.now(), u = 1 - (s - t0) / SIM_MS, A = u * u;
                const steps = Math.min(STEPS_MAX, Math.max(1, Math.round(((s - last) / (1000 / 60)) * STEPS)));
                last = s;
                const x0 = Math.max(0, box.x0 - SIM_PAD), y0 = Math.max(0, box.y0 - SIM_PAD);
                const x1 = Math.min(W, box.x1 + SIM_PAD), y1 = Math.min(W, box.y1 + SIM_PAD), w = x1 - x0, h = y1 - y0;
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, P[0].t);
                gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, w, h, gl.RED, gl.FLOAT, d, y0 * W + x0);
                gl.enable(gl.SCISSOR_TEST); gl.scissor(x0, y0, w, h);
                gl.uniform2i(uO, at.x, at.y); gl.uniform1f(uA, A);
                for (let k = 0; k < steps; k++) {
                    gl.bindFramebuffer(gl.FRAMEBUFFER, P[1].f);
                    gl.bindTexture(gl.TEXTURE_2D, P[0].t);
                    gl.drawArrays(gl.TRIANGLES, 0, 3);
                    P = [P[1], P[0]];
                }
                gl.bindFramebuffer(gl.FRAMEBUFFER, P[0].f);
                if (red) gl.readPixels(x0, y0, w, h, gl.RED, gl.FLOAT, d, y0 * W + x0);
                else {
                    if (rgba.length < w * h * 4) rgba = new Float32Array(w * h * 4);
                    gl.readPixels(x0, y0, w, h, gl.RGBA, gl.FLOAT, rgba);
                    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[(y0 + y) * W + x0 + x] = rgba[(y * w + x) * 4];
                }
                // The painted extent after the pass, for bakeWash.
                let bx0 = W, by0 = W, bx1 = 0, by1 = 0;
                for (let y = y0; y < y1; y++) for (let x = x0, i = y * W + x0; x < x1; x++, i++) if (d[i] > 0) {
                    if (x < bx0) bx0 = x; if (x >= bx1) bx1 = x + 1; if (y < by0) by0 = y; by1 = y + 1;
                }
                sim.ms += (performance.now() - s - sim.ms) * 0.1;
                return { rect: { x0, y0, x1, y1 }, box: bx1 ? { x0: bx0, y0: by0, x1: bx1, y1: by1 } : box };
            }
        };
        sim.reset();
        return sim;
    } catch {
        return null;
    }
};
