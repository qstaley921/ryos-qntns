// @ts-nocheck — a near-verbatim port of QNTNs-ghost assets/js/qntns/slideshow.js, kept untyped so the two diff line for line.
/*
 * THE KEN BURNS PLAYER, ported from QNTNs-ghost assets/js/qntns/slideshow.js
 * (CHECKLIST-37 §13a). The schema (v2), the units and the rules that tie the
 * fields together are documented in that file's header, lines 1–147; this copy
 * plays the same JSON the same way. Dropped from the theme's file: the post
 * page's card (attachSlideshow), prime()/pending() (the feed's fetch-on-play;
 * Photos has the post body before Play is pressed, so play() is always inside
 * the click), and the card's bar fill (the caller gets onstop(spot) instead).
 */
import "./photos.css";

/*
 * THE READER. The show is the post's code injection footer
 * <script id="qntns-slideshow" type="application/json">; here it arrives as the
 * Content API's codeinjection_foot string. Checks only what the player cannot
 * run without, and never throws.
 */
export function readSlideshow(foot: string | null | undefined) {
  if (!foot) return null;
  const el = new DOMParser()
    .parseFromString(foot, "text/html")
    .querySelector('script#qntns-slideshow[type="application/json"]');
  if (!el) return null;
  let show;
  try {
    show = JSON.parse(el.textContent);
  } catch {
    return null;
  }
  if (!show || show.version !== 2 || !Array.isArray(show.photos) || !show.photos.length) {
    return null;
  }
  return { talk: [], fade: 3, ...show };
}

// Music = the post's FIRST .kg-audio-card's <audio src>, voice = the SECOND (schema v2, DECISIONS-LOG #81).
export function soundsOf(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const srcOf = (card) => card?.querySelector("audio")?.getAttribute("src") || "";
  const audio = [...doc.querySelectorAll(".kg-audio-card")].slice(0, 2);
  return { music: srcOf(audio[0]), voice: srcOf(audio[1]) };
}

let show = null;
let stage = null;
let overflow = "";
let music = "";
let voice = "";
let ctx = null;
let tracks = [];
let ending = 0;
let t0 = 0;
let spot = 0;
let tone;
let onstop = null;

const GATE = '<p class="photos-slideshow__label">building...</p>';
const gated = (el) => {
  const gate = document.createElement("div");
  gate.className = "qntns-slideshow__gate";
  gate.setAttribute("aria-hidden", "true");
  gate.innerHTML = GATE;
  el.append(gate);
  return el;
};
const toneOn = () => {
  let meta = document.querySelector('meta[name="theme-color"]');
  if (tone === undefined) tone = meta ? meta.content : null;
  if (!meta) document.head.append(meta = Object.assign(document.createElement("meta"), { name: "theme-color" }));
  meta.content = "#000";
};
const toneOff = () => {
  if (tone === undefined) return;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (tone === null) meta?.remove();
  else if (meta) meta.content = tone;
  tone = undefined;
};

// #126: desktop only; refused or missing API is silent (the stage still covers the page).
const desktop = () => matchMedia("(hover: hover) and (pointer: fine)").matches;
const goFull = (el) => { if (desktop() && !document.fullscreenElement) try { el.requestFullscreen?.()?.catch(() => {}); } catch {} };
const exitFull = () => { if (document.fullscreenElement) document.exitFullscreen?.()?.catch(() => {}); };
const onFull = () => { if (!document.fullscreenElement && !document.hidden && document.hasFocus()) stop(); };
// §98d: sound first in the click, full screen after (requestFullscreen consumes the activation).
let session;
const wake = () => {
  try { if (navigator.audioSession) session ??= navigator.audioSession.type, navigator.audioSession.type = "playback"; } catch {}
  ctx ??= new AudioContext();
  ctx.resume();
};

/*
 * own = { show, music, voice, onstop? }. Must be called in the click: the
 * AudioContext, audio.play() and requestFullscreen all need its gesture.
 */
export function play(startAt = 0, own) {
  stop();
  document.body.querySelectorAll(".qntns-slideshow").forEach((el) => el.remove());
  if (!own?.show) return off();
  ({ show, music, voice } = own);
  onstop = own.onstop ?? null;
  t0 = 0;
  spot = startAt;
  stage = gated(document.createElement("div"));
  stage.className = "qntns-slideshow";
  const frame = document.createElement("div");
  frame.className = "qntns-slideshow__frame";
  const imgs = show.photos.map((_, i) => {
    const img = new Image();
    img.className = "qntns-slideshow__photo";
    img.alt = "";
    // Earlier photos on top: the one fading out is always above the next.
    img.style.zIndex = show.photos.length - i;
    frame.append(img);
    return img;
  });
  stage.append(frame);
  document.body.append(stage);
  // One frame rule (§5b, §6b): landscape = letterboxed 16:9, portrait = the viewport's own aspect.
  const A = stage.clientWidth / stage.clientHeight;
  const portrait = A < 1;
  const aspect = portrait ? A : 16 / 9;
  show = timelineFor(show, portrait);
  const selectedLast = show.photos.at(-1);
  if (startAt >= selectedLast.start + selectedLast.duration) startAt = 0;
  spot = startAt;
  frame.style.setProperty("--frame-aspect", aspect);
  overflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = "hidden";
  toneOn();
  stage.addEventListener("click", () => stop());
  document.addEventListener("keydown", onKey);
  document.addEventListener("fullscreenchange", onFull);
  // Music and voice start here, in the click, before any await. A failed mp3 stays silent (§29a).
  if (music || voice) {
    try {
      wake();
      tracks = [music, voice].filter(Boolean).map((src) => ({ ...track(src), music: src === music }));
    } catch {}
  }
  goFull(stage);
  run(stage, imgs, startAt, portrait, aspect);
}

async function run(mine, imgs, startAt, portrait, aspect) {
  const { photos } = show;
  const at = (t) => photos.findLastIndex((p) => p.start <= t);
  const first = Math.max(0, at(startAt));
  const live = () => stage === mine;
  const gate = mine.querySelector(".qntns-slideshow__gate");
  const last = photos.at(-1);
  const T = last.start + last.duration;
  const { duration: fade } = endingFor(show);
  // §98e: held while the opening photos decode, and whenever a photo reaches its cue undecoded.
  let held = startAt;
  let next = 0;
  let frozen = [];
  const clock = () => held ?? (performance.now() - t0) / 1000;
  // §98e: one ahead. Photo i loads when photo i − 1 comes on screen.
  const ok = [];
  const loads = [];
  const get = (i) => photos[i] && (loads[i] ??= (live() ? load(imgs[i], photos[i].src) : Promise.resolve(false)).then((good) => {
    ok[i] = true;
    if (good && live()) animate(i);
    return good;
  }));
  const animate = (i) => {
    const p = photos[i];
    const timing = { duration: p.duration * 1000, delay: p.start * 1000, fill: "none" };
    const framing = portrait ? p.portrait ?? p : p;
    const move = imgs[i].animate(moveOf(imgs[i], framing, aspect), { ...timing, easing: motionEasing(framing) });
    const fadeOut = imgs[i].animate(fadeOf(i), timing);
    fadeOut.onfinish = () => imgs[i].removeAttribute("src");
    [move, fadeOut].forEach((a) => {
      a.currentTime = clock() * 1000;
      if (held !== null) a.pause(), frozen.push(a);
    });
  };
  const tick = (k) => {
    if (!live() || !photos[k]) return;
    get(k + 1);
    if (!ok[k]) return hold(), loads[k].then(go);
    after(k + 1);
  };
  const after = (k) => { if (photos[k]) next = setTimeout(() => tick(k), (photos[k].start - clock()) * 1000); };
  const hold = () => {
    held = spot = clock();
    t0 = 0;
    clearTimeout(ending);
    clearTimeout(next);
    frozen = imgs.flatMap((img) => img.getAnimations()).filter((a) => a.playState === "running");
    frozen.forEach((a) => a.pause());
    try {
      tracks.forEach(({ el, gain }) => {
        el.pause();
        gain.gain.cancelScheduledValues(0);
        gain.gain.setValueAtTime(0, ctx.currentTime);
      });
    } catch {}
    if (gate) mine.append(gate);
  };
  // §98e: one press, one start. Tracks are cued to the show time before the clock and gain start.
  const go = async () => {
    if (!live()) return;
    const t = held;
    await Promise.all(tracks.map(({ el }) => cue(el, t)));
    if (!live() || held !== t) return;
    gate?.remove();
    t0 = performance.now() - t * 1000;
    held = null;
    frozen.forEach((a) => a.play());
    frozen = [];
    ending = setTimeout(stop, Math.max(0, T - t) * 1000);
    try {
      const now = ctx?.currentTime;
      // The music dips under the voice (§20), only when there is a voice.
      tracks.forEach(({ gain, music }) => schedule(gain.gain, music && voice ? dips(show.talk) : [[0, 1]], now, t, T, fade));
    } catch {}
    after(at(t) + 1);
  };
  await Promise.all([get(first), get(first + 1)]);
  go();
}

const cue = (el, t) => new Promise((done) => {
  setTimeout(done, 3000);
  try {
    el.pause();
    el.currentTime = t;
  } catch {}
  const start = () => el.play().then(done, done);
  if (el.seeking) el.addEventListener("seeked", start, { once: true });
  else start();
});

// The sharpest photo: Ghost's camera original (name_o.ext), fitted inside 4000 × 4000; falls back to src.
const SHARP = "size/w4000h4000/";
export const sharp = (src) =>
  src.replace(/\/content\/images\/(?!size\/)(.+)(\.\w+)$/, `/content/images/${SHARP}$1_o$2`);

async function load(img, src) {
  for (const url of new Set([sharp(src), src])) {
    img.src = url;
    try {
      await img.decode();
      return true;
    } catch {}
  }
  return false;
}

// One track: <audio> → MediaElementSource → gain → destination. crossOrigin before src, or it plays silence.
function track(src) {
  const el = new Audio();
  el.crossOrigin = "anonymous";
  el.src = src;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  ctx.createMediaElementSource(el).connect(gain).connect(ctx.destination);
  el.play().catch(() => {});
  return { el, gain };
}

// The music dips while the voice talks (§20). Tuned by ear; keep equal to the theme's.
const DIP = 0.3;
const DIP_RAMP = 1.5;

function dips(talk) {
  const levels = [[0, 1]];
  talk.forEach(([a, b], k) => {
    const down = Math.min(DIP_RAMP, k ? (a - talk[k - 1][1]) / 2 : a);
    const up = Math.min(DIP_RAMP, k < talk.length - 1 ? (talk[k + 1][0] - b) / 2 : Infinity);
    levels.push([a - down, 1], [a, DIP], [b, DIP], [b + up, 1]);
  });
  return levels;
}

function schedule(g, levels, now, startAt, T, fade) {
  const at = (t) => now + t - startAt;
  const levelAt = (t) => {
    const i = levels.findLastIndex(([x]) => x <= t);
    const [x0, y0] = levels[i];
    const next = levels[i + 1];
    return next && next[0] > x0 ? y0 + (next[1] - y0) * (t - x0) / (next[0] - x0) : y0;
  };
  const endAt = T - fade;
  const left = Math.max(0, T - startAt);
  g.setValueAtTime(levelAt(Math.min(startAt, endAt)) * (fade ? Math.min(1, left / fade) : 1), now);
  levels
    .filter(([t]) => t > startAt && t < endAt)
    .forEach(([t, y]) => g.linearRampToValueAtTime(y, at(t)));
  if (endAt > startAt) g.linearRampToValueAtTime(levelAt(endAt), at(endAt));
  g.linearRampToValueAtTime(0, at(T));
}

export function opacityKeyframes(duration, fadeIn, fadeOut) {
  const on = { visibility: "visible" };
  const frames = [{ ...on, opacity: fadeIn ? 0 : 1, offset: 0 }];
  if (fadeIn) frames.push({ ...on, opacity: 1, offset: fadeIn / duration });
  if (fadeOut) frames.push({ ...on, opacity: 1, offset: (duration - fadeOut) / duration });
  frames.push({ ...on, opacity: fadeOut ? 0 : 1, offset: 1 });
  return frames;
}

export function endingFor(source) {
  const last = source.photos.at(-1);
  const end = last.start + last.duration;
  const duration = Math.min(source.fade ?? 3, last.duration);
  return { start: end - duration, end, duration };
}

export function fadeFramesFor(source, i) {
  const { photos } = source;
  const p = photos[i];
  const transition = p.transition ?? source.transition ?? "dissolve";
  const into = i === 0 || transition === "dissolve" ? 0 : p.fade ?? source.fade ?? 3;
  const out = i < photos.length - 1 ? photos[i + 1].fade ?? source.fade ?? 3 : source.fade ?? 3;
  return opacityKeyframes(p.duration, into, out);
}
function fadeOf(i) { return fadeFramesFor(show, i); }

export function timelineFor(source, portrait = false) {
  if (!portrait) return source;
  let start = 0;
  return { ...source, photos: source.photos.map((p, i) => {
    const duration = p.portrait?.duration ?? p.duration;
    const next = { ...p, duration, start, fade: p.portrait?.fade ?? p.fade ?? source.fade ?? 3, transition: p.portrait?.transition ?? p.transition ?? source.transition ?? "dissolve" };
    const following = source.photos[i + 1];
    start += duration - (following?.portrait?.fade ?? following?.fade ?? source.fade ?? 3);
    return next;
  }) };
}

export function motionEasing(frame) { return frame.easing ?? "ease"; }

// The Ken Burns move (§6): laid out at the move's largest zoom, transform only scales down, centre clamped.
export function moveOf(img, { from, to, letterbox = false }, aspect) {
  const a = img.naturalWidth / img.naturalHeight / aspect;
  const ew = letterbox ? Math.min(a, 1) : Math.max(a, 1);
  const eh = letterbox ? Math.min(1 / a, 1) : Math.max(1 / a, 1);
  const top = Math.max(0.1, from.zoom, to.zoom);
  img.style.width = `${ew * top * 100}%`;
  img.style.height = `${eh * top * 100}%`;
  const view = ({ x, y, zoom }) => {
    const z = Math.max(0.1, zoom);
    const clamp = (c, e) => {
      const half = 1 / (2 * e * z);
      if (half >= 0.5) return 0.5;
      return Math.min(Math.max(c, half), 1 - half);
    };
    const tx = ((0.5 / ew - clamp(x, ew) * z) * 100) / top;
    const ty = ((0.5 / eh - clamp(y, eh) * z) * 100) / top;
    return { transform: `translate(${tx}%, ${ty}%) scale(${z / top})` };
  };
  return [view(from), view(to)];
}

const off = () => {
  toneOff();
  document.removeEventListener("keydown", onKey);
  document.removeEventListener("fullscreenchange", onFull);
  exitFull();
  try { if (session !== undefined) navigator.audioSession.type = session; } catch {}
  session = undefined;
};

// Every exit (§9): a click, Esc, or T. Remembers the spot (§23); inside the final fade counts as finished (0).
export function stop() {
  if (!stage) return;
  if (t0) spot = (performance.now() - t0) / 1000;
  if (spot >= endingFor(show).start) spot = 0;
  clearTimeout(ending);
  off();
  tracks.forEach(({ el, gain }) => {
    el.pause();
    gain.disconnect();
  });
  tracks = [];
  document.documentElement.style.overflow = overflow;
  stage.remove();
  stage = null;
  try { onstop?.(spot); } catch {}
}

function onKey(event) {
  if (event.key === "Escape") stop();
}
