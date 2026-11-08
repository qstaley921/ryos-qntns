import { InternetExplorerAppComponent } from "@/apps/internet-explorer/components/internet-explorer-app/InternetExplorerAppComponent";

// CHECKLIST-37 §79d: Safari's Postcard mode, one post's postcard editor + buy view and nothing else.
// `html` skips the Content API fetch, so it renders here with no ZIP.
const post = {
  id: "story-poem",
  slug: "story-poem",
  title: "Milk Tea",
  type: "post" as const,
  url: "https://www.qntns.com/milk-tea/",
  tags: [{ id: "t1", slug: "hash-fixed-lines", name: "#fixed-lines" }],
  html: `<p>lorem ipsum dolor sit<br>amet consectetur<br>adipiscing elit sunt sint<br>ut qui illum molestias<br>eos labore fugiat<br>possimus eu quis velit<br>tempor est ducimus eos<br>voluptas ducimus iusto</p>
<p>ipsum aut nulla<br>deserunt aliquip<br>repellendus do placeat<br>incididunt ullamco atque</p>`,
};

export default {
  title: "Apps/Postcard",
  component: InternetExplorerAppComponent,
  args: { isWindowOpen: true, isForeground: true, onClose: () => {}, instanceId: "story-postcard" },
};
export const Poem = { args: { initialData: { postcard: post } } };
// A prose post: the window takes any post, not only #fixed-lines poems (§79e).
export const Prose = {
  args: {
    initialData: {
      postcard: { ...post, id: "story-prose", title: "Doorways", url: "https://www.qntns.com/doorways/", tags: [], html: "<p>There is a particular kind of afternoon that only exists in the second week of September, when the light has gone amber but nothing has actually started to die yet, and you can stand in a doorway for eleven minutes without deciding anything at all.</p>" },
    },
  },
};
