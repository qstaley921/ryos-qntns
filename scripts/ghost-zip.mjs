// `bun run zip` -> dist/qntns-ryos-<version>+<count>.<sha>.zip, a Ghost theme (CHECKLIST-35 §8).
//
// Ghost serves a theme's assets/ at /assets/ and nothing else, so the whole Vite
// build (chunks and public/) ships under assets/r-<stamp>/: Vite is built with
// that base, and absolute public paths the code writes by hand ("/icons/x.png")
// are rewritten to it. A new directory per build, because Ghost caches
// /assets/** for a year (QNTNs-ghost AGENTS.md §6).
//
// default.hbs is filled from the built index.html, so the head author-B edits
// ships as is. SKIP_BUILD=1 packages the existing dist/ (only valid if it was
// built with the same RYOS_BASE).
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const DIST = join(ROOT, "dist");
const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim();
const dirty = git("status", "--porcelain") ? "-dirty" : "";
const stamp = `${git("rev-list", "--count", "HEAD")}.${git("rev-parse", "--short", "HEAD")}${dirty}`;
const BASE = `/assets/r-${stamp}/`;
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

if (!process.env.SKIP_BUILD) {
  execFileSync("bun", ["run", "build"], { cwd: ROOT, stdio: "inherit", env: { ...process.env, RYOS_BASE: BASE } });
}
const html = readFileSync(join(DIST, "index.html"), "utf8");
if (!html.includes(`"${BASE}`)) throw new Error(`dist/ was not built with base ${BASE}; drop SKIP_BUILD`);
if (html.includes("{{")) throw new Error("dist/index.html contains {{, which Handlebars would parse");

const STAGE = mkdtempSync(join(tmpdir(), "qntns-ryos-"));
const OUT_DIR = join(STAGE, "assets", `r-${stamp}`);
// Left out: resources/ (110 MB of icon catalogs no src file references, §8d) and
// the service worker, which the Ghost base never registers (§8c).
const SKIP = new Set(["index.html", "resources", "sw.js"].map((n) => join(DIST, n)));
cpSync(DIST, OUT_DIR, {
  recursive: true,
  filter: (p) => !/\.zip$/.test(p) && !SKIP.has(p) && !/^workbox-.*\.js$/.test(p.slice(DIST.length + 1)),
});

// Hand-written absolute public paths -> BASE. A quote, backtick or "(" before
// the slash; anything already under /assets/r- is Vite's own and is left alone.
// shortcut: paths built as "/" + dir are missed; grep the console for 404s after an upload.
const roots = readdirSync(join(ROOT, "public")).map((n) => n.replace(/[.]/g, "\\.")).join("|");
const PUBLIC = new RegExp(`(["'\`(])/(?!assets/r-)((?:${roots})(?=[/"'\`?#)]))`, "g");
const rewrite = (s) => s.replace(PUBLIC, `$1${BASE}$2`);
const TEXT = /\.(js|mjs|css|json|webmanifest|html|txt)$/;
(function walk(dir) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (TEXT.test(n)) {
      const s = readFileSync(p, "utf8");
      const r = rewrite(s);
      if (r !== s) writeFileSync(p, r);
    }
  }
})(OUT_DIR);

// §8a: the bundle's own tags (stylesheet, modulepreload, module script) are
// written only when the desktop boots, so ?window gets no desktop CSS or JS.
const gate = (tag) => `<script>window.__ryosPlain||document.write(${JSON.stringify(tag).replace(/<\//g, "<\\/")})</script>`;
const bundleTags = (s) =>
  rewrite(s)
    .replace(new RegExp(`<link\\b[^>]*rel="(?:stylesheet|modulepreload)"[^>]*href="${BASE}[^>]*>`, "g"), gate)
    .replace(new RegExp(`<script\\b[^>]*type="module"[^>]*src="${BASE}[^>]*></script>`, "g"), gate);
const head = html
  .match(/<head>([\s\S]*)<\/head>/)[1]
  // Ghost's {{ghost_head}} and {{meta_title}} own the title, description and cards.
  .replace(/<title>[\s\S]*?<\/title>/, "")
  .replace(/<meta\s+(?:property="og:[^"]*"|name="(?:twitter:[^"]*|description)")[^>]*>/g, "");
const bodyTag = html.match(/<body\b[^>]*>/)[0].replace("<body", '<body class="{{body_class}}"');
const bodyInner = html.match(/<body\b[^>]*>([\s\S]*)<\/body>/)[1];
const fill = readFileSync(join(ROOT, "default.hbs"), "utf8")
  .replace("{{!-- ryos:html --}}", html.match(/<html\b[^>]*>/)[0])
  .replace("{{!-- ryos:head --}}", bundleTags(head))
  .replace("{{!-- ryos:body --}}", bodyTag)
  .replace("{{!-- ryos:body-inner --}}", bundleTags(bodyInner));
if (fill.includes("{{!-- ryos:")) throw new Error("default.hbs: a ryos:* marker was not filled");
const stray = fill.match(/ (?:src|href)="\/(?!assets\/)[^"]*"/g);
if (stray) console.warn("default.hbs still has a root path outside /assets/:", stray);
writeFileSync(join(STAGE, "default.hbs"), fill);

for (const n of readdirSync(ROOT)) if (n.endsWith(".hbs") && n !== "default.hbs") cpSync(join(ROOT, n), join(STAGE, n));
cpSync(join(ROOT, "partials"), join(STAGE, "partials"), { recursive: true });
const version = `${pkg.version}+${stamp}`;
writeFileSync(
  join(STAGE, "package.json"),
  JSON.stringify(
    {
      name: "qntns-ryos",
      version,
      description: "qntns.com as a ryOS desktop, served by Ghost.",
      license: pkg.license,
      author: { name: "qstaley921", email: "qstaley921@gmail.com" },
      keywords: ["ghost-theme"],
      engines: pkg.engines,
      config: pkg.config,
    },
    null,
    2,
  ),
);

// gscan is the validator Ghost Admin runs on upload. The fork has no copy; the sibling theme repo does.
const GSCAN = process.env.GSCAN || join(ROOT, "../QNTNs-ghost/node_modules/.bin/gscan");
if (existsSync(GSCAN)) execFileSync(GSCAN, ["--v6", STAGE], { stdio: "inherit" });
else console.warn(`gscan not found at ${GSCAN}; this ZIP is UNVALIDATED.`);

const OUT = join(DIST, `qntns-ryos-${version}.zip`);
execFileSync("zip", ["-r", "-q", "-X", OUT, ".", "-x", "*.DS_Store"], { cwd: STAGE, stdio: "inherit" });
rmSync(STAGE, { recursive: true, force: true });
// Ghost's default theme.uploadLimits.compressedBytes is 1 GiB (core/shared/config/defaults.json); Ghost(Pro) publishes none.
console.log(`${(statSync(OUT).size / 2 ** 20).toFixed(1)} MB zip (Ghost default cap 1024 MB)`);
console.log(`${OUT}\nbuild ${version}\nlive check: curl -s -o /dev/null -w '%{http_code}\\n' https://qntns.com${BASE}version.json`);
