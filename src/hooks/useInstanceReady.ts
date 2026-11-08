import { useCallback, useLayoutEffect, useSyncExternalStore } from "react";
import { useAppStore } from "@/stores/useAppStore";

/**
 * Opt-in "wait for my data". An app calls `const ready = useInstanceReady(instanceId)`
 * and `ready()` once its first data is in (or its fetch failed). Until then the
 * instance stays isLoading (dock icon bounces) and WindowFrame keeps the window
 * mounted but hidden. Forced after HOLD_MS so a window is never stuck hidden.
 */
const HOLD_MS = 8000;
const held = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const isInstanceHeld = (id?: string) => !!id && held.has(id);

function release(id: string) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  if (!held.delete(id)) return;
  emit();
  useAppStore.getState().markInstanceAsLoaded(id);
}

export function useInstanceHeld(id?: string) {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => isInstanceHeld(id)
  );
}

export function useInstanceReady(instanceId?: string) {
  // Layout effect: runs before the sibling LazyLoadSignal's, so the hold is set in time.
  useEffectLayout(instanceId);
  return useCallback(() => {
    if (instanceId) release(instanceId);
  }, [instanceId]);
}

function useEffectLayout(id?: string) {
  useLayoutEffect(() => {
    if (!id) return;
    held.add(id);
    timers.set(id, setTimeout(() => release(id), HOLD_MS));
    emit();
    return () => {
      clearTimeout(timers.get(id));
      timers.delete(id);
      if (held.delete(id)) emit();
    };
  }, [id]);
}
