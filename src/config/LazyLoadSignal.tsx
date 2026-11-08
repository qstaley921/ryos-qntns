import { useLayoutEffect } from "react";
import { useAppStore } from "@/stores/useAppStore";
import { isInstanceHeld } from "@/hooks/useInstanceReady";

export function LazyLoadSignal({ instanceId }: { instanceId?: string }) {
  const markInstanceAsLoaded = useAppStore((state) => state.markInstanceAsLoaded);

  // Mark loaded as soon as the lazy boundary commits (window can be shown).
  useLayoutEffect(() => {
    // Apps that opted in clear isLoading themselves via ready().
    if (instanceId && !isInstanceHeld(instanceId)) {
      markInstanceAsLoaded(instanceId);
    }
  }, [instanceId, markInstanceAsLoaded]);

  return null;
}
