import { BaseApp, VideosInitialData } from "../base/types";
import { VideosAppComponent } from "./components/videos-app/VideosAppComponent";

// Re-export metadata from separate file to avoid eager loading of components
export { appMetadata, helpItems } from "./metadata";

// Import for local use
import { appMetadata, helpItems } from "./metadata";

export const VideosApp: BaseApp<VideosInitialData> = {
  id: "videos",
  name: "Videos",
  icon: { type: "image", src: "/icons/default/videos.png" },
  description: "A retro-style playlist player for qntns.com videos",
  component: VideosAppComponent,
  helpItems,
  metadata: appMetadata,
};
