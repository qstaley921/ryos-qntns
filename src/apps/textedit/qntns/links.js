/*
 * QNTNs links — every link in the body of a post opens in a new tab.
 *
 * WHY THIS IS JAVASCRIPT AND NOT A TEMPLATE CHANGE. The links come out of
 * {{content}}, which is Ghost rendering the writer's own HTML. There is no
 * handlebars hook between Koenig's output and the page, and Koenig's link
 * editor has no "open in new tab" control to set the attribute at source. The
 * attribute has to be added after the fact, and the DOM is the only place it
 * can happen.
 *
 * WHAT IS DELIBERATELY LEFT ALONE, because "every link" is never quite true:
 *
 *   - IN-PAGE ANCHORS (`#somewhere`). A link to a place on the page the reader
 *     is already on, opened in a new tab, loads a second copy of the page and
 *     scrolls THAT one. It is the one case where the new tab is not a variant
 *     of the behaviour, it is a bug.
 *   - NON-WEB SCHEMES — mailto:, tel:, and anything else that hands off to
 *     another application. The browser opens the handler and abandons the tab
 *     it made, which is how a reader ends up with a blank window they have to
 *     close.
 *   - ANY LINK THAT ALREADY DECLARES A TARGET. A writer who set one meant it.
 *
 * WHY rel="noopener" AND NOT ALSO noreferrer. noopener closes a real hole: a
 * page opened with target="_blank" can otherwise reach back through
 * window.opener and navigate the tab that opened it, which is the reverse
 * tabnabbing trick. Every current browser implies it for _blank, and it is set
 * anyway because "current browsers" is not a guarantee and the cost is one
 * attribute. noreferrer is NOT set: it also strips the Referer header, so the
 * sites this one links to would stop being able to see that the link came from
 * here. That is a courtesy the writer is extending on purpose, and dropping it
 * is not the same decision as closing a security hole.
 */

/* SAME-ORIGIN LINKS ARE INCLUDED, and that is the part worth arguing with. A
   link from one post to another opening in a new tab is not what most sites
   do, and it leaves a reader with a pile of tabs of one site. It is here
   because the brief said links in content open in a new tab by default, with
   no internal/external split — and because on a site of essays the internal
   link is usually a reference too, offered without asking the reader to give
   up where they are. If that turns out to be wrong, this function is the one
   place to add the test: `new URL(a.href).origin !== location.origin`. */
export const openLinksInNewTab = (scope) => {
    if (!scope) return;
    scope.querySelectorAll("a[href]").forEach((a) => {
        if (a.hasAttribute("target")) return;

        // getAttribute, not .href: the property resolves "#top" against the
        // current document and hands back a full absolute URL, which would
        // make an in-page anchor indistinguishable from a link to this page.
        const href = a.getAttribute("href") ?? "";
        if (href.startsWith("#")) return;

        // Anything with a scheme that is not http(s) hands off to another
        // application. Protocol-relative (//host) and ordinary relative paths
        // have no colon before their first slash and fall through to the
        // rewrite, which is correct — both are web pages.
        const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href);
        if (scheme && !/^https?$/i.test(scheme[1])) return;

        a.target = "_blank";
        // Appended rather than assigned, so a rel the writer set — nofollow on
        // a paid link, say — survives.
        const rel = (a.getAttribute("rel") ?? "").split(/\s+/).filter(Boolean);
        if (!rel.includes("noopener")) rel.push("noopener");
        a.setAttribute("rel", rel.join(" "));
    });
};
