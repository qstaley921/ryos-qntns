import { AppMount } from "./mount";

export default { title: "Apps/TextEdit", component: AppMount, args: { id: "textedit" } };
export const Empty = {}; // the stock editor, for any non-Ghost file

// A Ghost post, read-only (CHECKLIST-36 §12). `html` skips the Content API fetch.
// Body exercises: heading demotion (h2 → h3), a |T| drop cap, a [footnote],
// a code card, #fixed-lines poem breaks, a goal embed button.
const html = `
<p>|T|his is the opening paragraph of a post, long enough to wrap over three lines so the drop cap has room to sink, with a note at the end of it.[A footnote, lifted to the foot of the page and shown in a popover on press.]</p>
<h2>A section heading</h2>
<p>Second line one<br>second line two, which is a long line that should wrap to a hanging indent in a poem<br>second line three</p>
<pre><code class="language-js">const hello = (name) =&gt; \`hi \${name}\`; // a comment</code></pre>
<div data-qntns-goal="meditation"></div>
<p>A <a href="https://example.com">link</a> that opens in a new tab.</p>
`;
const ghost = {
  id: "story-post",
  slug: "story-post",
  title: "A Story Post",
  type: "post" as const,
  url: "https://www.qntns.com/story-post/",
  published_at: "2026-11-01T00:00:00.000Z",
  feature_image: null,
  excerpt: null,
  tags: [{ id: "t1", slug: "hash-fixed-lines", name: "#fixed-lines" }],
  html,
};

// §12a View-menu alts: what View holds beyond Bigger / Smaller / Actual Size / Font.
export const Post = { args: { initialData: { ghost, viewAlt: "base" } } };
export const ViewWithColumnWidth = { args: { initialData: { ghost, viewAlt: "width" } } };
export const ViewWithComments = { args: { initialData: { ghost, viewAlt: "comments" } } };
// No `html`: a fetch by an id that does not exist, so the empty state ("-").
export const FetchFails = { args: { initialData: { ghost: { ...ghost, id: "missing", html: undefined } } } };

// §12c: File › Print is shown for a #fixed-lines poem (Post above) and hidden for any other post.
export const NotAPoemNoPrint = { args: { initialData: { ghost: { ...ghost, tags: [] } } } };

// §46: own-site link opens that document in TextEdit; example.com opens a new tab.
export const OwnSiteLink = {
  args: { initialData: { ghost: { ...ghost, html: `<p>See <a href="https://www.qntns.com/western-ode/">another post</a> and <a href="https://example.com">outside</a>.</p>` } } },
};

// §44: one view bump per open; the Like heart is disabled unless a member session exists (none in Storybook, so it shows disabled). Worker calls fail silently offline.
export const LikeDisabledSignedOut = { args: { initialData: { ghost } } };

// §53d: the Info drawer, open. Public tags only (#fixed-lines is hidden), a YouTube Share link from the body.
export const InfoDrawer = {
  args: {
    initialData: {
      infoOpen: true,
      ghost: {
        ...ghost,
        tags: [...ghost.tags, { id: "t2", slug: "poems", name: "Poems" }],
        html: `${html}<p><a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">Watch</a></p>`,
      },
    },
  },
};
