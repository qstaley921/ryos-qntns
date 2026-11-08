import { useLayoutEffect, useState, type RefObject } from "react";

export function isKeyboardDeleteTargetEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  if (target.closest("[contenteditable='true']")) return true;
  return false;
}

/** Row height that fills the scroll area: the zoomed `hourHeight` is the minimum, then the grid scrolls. */
export function useFilledHourHeight(ref: RefObject<HTMLElement | null>, hourHeight: number, hours: number) {
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    setH(el.clientHeight);
    return () => ro.disconnect();
  }, [ref]);
  return Math.max(hourHeight, h / Math.max(1, hours));
}
