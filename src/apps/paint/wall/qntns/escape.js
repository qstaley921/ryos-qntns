// One HTML escaper, shared. It was written out four times in four components
// before this file existed, which is four chances for one of them to drift.
export const escapeHtml = (value) => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
