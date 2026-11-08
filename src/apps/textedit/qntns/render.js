// The post page's body passes (assets/js/qntns/content.js attachContent), in its order,
// minus the page chrome. Copied from QNTNs-ghost; edit there first, then re-copy.
import { demoteHeadings } from "./headings.js";
import { attachDropCaps, fitDropCaps } from "./dropcap.js";
import { attachFootnotes } from "./footnotes.js";
import { openLinksInNewTab } from "./links.js";
import { attachCode } from "./code.js";

// content.js's splitPoemLines + markLineRegions, copied (content.js imports the whole page).
const REGION = /^<(\/?)(prose|fixed-lines)>$/i;
const markLineRegions = (body) => {
    let mode = null;
    body.querySelectorAll(":scope > *").forEach((node) => {
        const marker = node.matches("p") && node.textContent.trim().match(REGION);
        if (marker) {
            mode = marker[1] ? null : marker[2].toLowerCase();
            node.remove();
        } else if (mode) {
            node.classList.add(mode === "prose" ? "qntns-content__prose" : "qntns-content__fixed");
        }
    });
};
const splitPoemLines = (root) => {
    root.querySelectorAll(".qntns-content__body--poem p:not(.qntns-content__prose), .qntns-content__body p.qntns-content__fixed").forEach((p) => {
        if (p.closest("blockquote") || !p.querySelector("br")) return;
        p.innerHTML = p.innerHTML.split(/<br\s*\/?>/i)
            .map((line) => `<span class="qntns-content__line">${line.trim()}</span>`).join("");
    });
};

// Returns a cleanup (footnote listeners, drop-cap observer).
export const renderBody = (root) => {
    const body = root.querySelector(".qntns-content__body");
    if (!body) return () => {};
    demoteHeadings(body);
    attachDropCaps(root);
    const offNotes = attachFootnotes(root);
    openLinksInNewTab(body);
    markLineRegions(body);
    splitPoemLines(root);
    const offCaps = fitDropCaps(root);
    attachCode(root);
    return () => { offNotes(); offCaps(); };
};
