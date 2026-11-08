// A qntns.com book as a real EPUB (CHECKLIST-36 §14f), built in memory so it
// opens in Books' own EPUB reader: paging, contents, progress, highlights.
// Live shape (Worker /lock/ishta/…, 2026-11-08): every poem is an <h1>, the
// front matter has none, and a <p>&lt;toc&gt;</p> marks where the site prints
// its contents. One section per <h1>; the marker becomes a linked contents list.
import { strToU8, zipSync } from "fflate";
import type { GhostBook } from "@/lib/ghost";
import {
  clean,
  fetchEpub,
  fetchFree,
  forgetPhrase,
  parseBook,
  rememberPhrase,
  savedPhrase,
  unlock,
} from "./qntnsBook";

const XHTML = "http://www.w3.org/1999/xhtml";
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** "Ishta Book" → "Ishta": the post title carries a word the cover doesn't. */
export const bookTitle = (book: GhostBook) => book.title.replace(/\s+book$/i, "");

type Section = { title: string; nodes: Node[] };

function sections(html: string, frontTitle: string): Section[] {
  const doc = new DOMParser().parseFromString(clean(html), "text/html");
  // Ghost's audio player needs its own script; a plain control plays the same file.
  for (const card of doc.querySelectorAll(".kg-audio-card")) {
    const src = card.querySelector("audio")?.getAttribute("src");
    if (!src) {
      card.remove();
      continue;
    }
    const audio = doc.createElement("audio");
    audio.setAttribute("controls", "");
    audio.setAttribute("preload", "none");
    audio.setAttribute("src", src);
    card.replaceWith(audio);
  }
  const out: Section[] = [{ title: frontTitle, nodes: [] }];
  for (const node of [...doc.body.children]) {
    if (node.tagName === "H1") out.push({ title: node.textContent!.trim() || `Poem ${out.length}`, nodes: [] });
    out.at(-1)!.nodes.push(node);
  }
  // No front matter: start at the first poem.
  return out[0].nodes.length ? out : out.slice(1);
}

const page = (title: string, body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="${XHTML}" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${esc(title)}</title></head><body>${body}</body></html>`;

const contents = (secs: Section[]) =>
  `<nav epub:type="toc"><h2>Contents</h2><ol>${secs
    .map((s, i) => `<li><a href="s${i}.xhtml">${esc(s.title)}</a></li>`)
    .join("")}</ol></nav>`;

const isTocMarker = (n: Node) => n instanceof Element && n.tagName === "P" && n.textContent!.trim().toLowerCase() === "<toc>";

/** EPUB bytes from the post's own HTML: free half, plus the paid half when
 *  the saved phrase still opens it. A refused phrase is forgotten and the book
 *  ends on a locked page (the reader buys or restores it in Store). Calls only
 *  /lock/… (CLAUDE.md); with the Worker down, the post as typed. */
export async function buildQntnsEpub(book: GhostBook): Promise<Blob> {
  const parsed = parseBook(book);
  const title = bookTitle(book);
  const saved = parsed.draft ? savedPhrase(parsed.draft) : null;
  if (saved) {
    const epub = await fetchEpub(book.slug, saved);
    if (epub) return epub.type ? epub : new Blob([epub], { type: "application/epub+zip" });
  }
  let html = parsed.head + parsed.tail;
  let locked = false;
  if (parsed.draft) {
    const free = await fetchFree(book.slug, parsed.draft);
    if (free) {
      html = String(free.html ?? "");
      const phrase = savedPhrase(parsed.draft);
      const opened = phrase ? await unlock(book.slug, parsed.draft, phrase) : null;
      if (typeof opened === "string") {
        rememberPhrase(parsed.draft, phrase);
        html += opened;
      } else {
        if (opened === null && phrase) forgetPhrase(parsed.draft);
        locked = true;
      }
    }
  }

  const secs = sections(html, title);
  if (locked) {
    const p = document.createElement("p");
    p.textContent = "The rest of this book is locked. Buy it or restore your purchase in Store.";
    secs.push({ title: "Locked", nodes: [p] });
  }
  const ser = new XMLSerializer();
  const hasMarker = secs.some((s) => s.nodes.some(isTocMarker));
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    // First and stored, as the EPUB container requires.
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(
      `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
    ),
  };
  secs.forEach((s, i) => {
    let body = s.nodes.map((n) => (isTocMarker(n) ? contents(secs) : ser.serializeToString(n))).join("");
    // No marker in the text: the contents follow the front matter.
    if (!hasMarker && i === 0) body += contents(secs);
    files[`OEBPS/s${i}.xhtml`] = strToU8(page(s.title, body));
  });
  files["OEBPS/nav.xhtml"] = strToU8(page("Contents", contents(secs)));
  const items = secs.map((_, i) => `<item id="s${i}" href="s${i}.xhtml" media-type="application/xhtml+xml"/>`).join("");
  const spine = secs.map((_, i) => `<itemref idref="s${i}"/>`).join("");
  files["OEBPS/content.opf"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">${esc(
      book.url
    )}</dc:identifier><dc:title>${esc(title)}</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${items}</manifest><spine>${spine}</spine></package>`
  );
  return new Blob([zipSync(files)], { type: "application/epub+zip" });
}
