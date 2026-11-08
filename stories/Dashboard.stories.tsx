import { DashboardAppComponent } from "@/apps/dashboard/components/DashboardAppComponent";

// Imports the component directly (not AppMount), per CHECKLIST-37 §25. Add widgets from the strip or File › Add Widget.
const Dashboard = () => (
  <DashboardAppComponent isWindowOpen isForeground onClose={() => {}} instanceId="story-dashboard" />
);

export default { title: "Apps/Dashboard", component: Dashboard };
export const Empty = {};
