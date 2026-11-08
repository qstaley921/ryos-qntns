import { PhotosAppComponent } from "@/apps/photos/components/PhotosAppComponent";

// Imports the component directly: "photos" has no registry id until CHECKLIST-35 adds it.
const Photos = () => <PhotosAppComponent isWindowOpen isForeground onClose={() => {}} instanceId="story-photos" />;

export default { title: "Apps/Photos", component: Photos };
export const Default = {};
