import { useEffect } from "react";
import { AppMount } from "./mount";
import { constrainOpenWindowsToViewport, useAppStore } from "@/stores/useAppStore";

// §22d: with no store instance, useWindowManager cascades by appIds index; Journal is last (27),
// so its window opened at y = 40 + 27*20 = 580, below a short canvas (preview clips at 100vh).
// Before render: seed the instance at 16,40, then let §43's clamp fit 1120x740 into the viewport.
const seedWindow = () => {
  useAppStore.setState((s) => ({
    instances: {
      ...s.instances,
      "story-journal": { instanceId: "story-journal", appId: "journal", isOpen: true, isForeground: true, createdAt: 0, position: { x: 16, y: 40 }, size: { width: 1120, height: 740 } },
    },
  }));
  constrainOpenWindowsToViewport();
  return {};
};

// The store persists, so drop the seeded instance on leaving, or Desktop stories would draw it.
const DropOnLeave = ({ children }: { children: React.ReactNode }) => {
  useEffect(() => () => {
    useAppStore.setState((s) => {
      const { ["story-journal"]: _, ...instances } = s.instances;
      return { instances };
    });
  }, []);
  return children;
};
const dropWindow = (Story: React.ComponentType) => <DropOnLeave><Story /></DropOnLeave>;

export default { title: "Apps/Journal", component: AppMount, args: { id: "journal" }, loaders: [seedWindow], decorators: [dropWindow] };
export const Empty = {}; // alts: add named exports with { args: { initialData } }
