import { InternetExplorerAppComponent } from "@/apps/internet-explorer/components/internet-explorer-app/InternetExplorerAppComponent";

// Imports the component directly (CHECKLIST-37 §28). From Storybook's origin the
// Worker's CORS refuses /frame-ok, so every site shows its link-out card here.
export default {
  title: "Apps/Safari",
  component: InternetExplorerAppComponent,
  args: { isWindowOpen: true, isForeground: true, onClose: () => {}, instanceId: "story-safari" },
};
export const Bookmarks = {};
