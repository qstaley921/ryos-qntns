import { AboutDialog } from "@/components/dialogs/AboutDialog";
import { AboutFinderDialog } from "@/components/dialogs/AboutFinderDialog";
import { AboutQntnsDialog } from "@/components/dialogs/AboutQntnsDialog";
import { appMetadata } from "@/apps/finder/metadata";

export default { title: "Apps/About", component: AboutDialog };
export const AboutApp = () => (
  <AboutDialog isOpen onOpenChange={() => {}} metadata={appMetadata} appId="finder" />
);
export const AboutFinder = () => <AboutFinderDialog isOpen onOpenChange={() => {}} />;
export const AboutQntns = () => <AboutQntnsDialog isOpen onOpenChange={() => {}} />;
