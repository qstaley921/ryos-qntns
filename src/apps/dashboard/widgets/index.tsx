import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { StewardshipTreemap } from "@/apps/storage-manager/components/StewardshipTreemap";
import { attachGoal } from "./qntns/goal-embed.js";
import "@/apps/printer/css/fonts.css";
import "@/apps/printer/css/tokens.css";
import "./css/tokens.css";
import "./css/pagination.css";
import "./css/footnotes.css";
import "./css/fund.css";
import "./css/goal-meditation.css";
import "./css/goal-projects.css";
import "./css/goal-savings.css";
import "./css/goal-friends.css";
import "./css/goal-log.css";
import "./css/goal-mood.css";
import "./css/goal-spending.css";

// The Dashboard's whole widget library (CHECKLIST-37 §25): the goal embeds and Fund, nothing of ryOS's.
// Spending and Fund (§82): 360 square, the embed laid out at NATURAL_W 480 and scaled 0.75 (or less, if taller).
const ALL_WIDGETS = [
  { type: "meditation", label: "Meditation", icon: "🧘", size: { width: 400, height: 280 } },
  { type: "mastery", label: "Mastery", icon: "🏆", size: { width: 480, height: 400 } },
  { type: "mood", label: "Mood", icon: "🙂", size: { width: 400, height: 280 } },
  { type: "projects", label: "Projects", icon: "📋", size: { width: 400, height: 360 } },
  { type: "savings", label: "Savings", icon: "🏦", size: { width: 400, height: 240 } },
  { type: "spending", label: "Spending", icon: "💸", size: { width: 360, height: 360 } },
  { type: "stewardship", label: "Storage Manager", icon: "📦", size: { width: 480, height: 360 } },
  { type: "friends", label: "Friends", icon: "👥", size: { width: 400, height: 240 } },
  { type: "fund", label: "Fund", icon: "💰", size: { width: 360, height: 360 } },
] as const;

// §82: the only widgets offered, defaulted or rendered. Add a type back here to bring it back.
const SHOWN: readonly string[] = ["spending", "fund"];

export const QNTNS_WIDGETS = ALL_WIDGETS.filter((w) => SHOWN.includes(w.type));

// §82a: adding widgets (the "+" button, its strip, File › Add Widget) comes back with the hidden widgets.
export const CAN_ADD_WIDGETS = QNTNS_WIDGETS.length === ALL_WIDGETS.length;

export type QntnsWidgetType = (typeof ALL_WIDGETS)[number]["type"];

export const isQntnsWidget = (type: string): type is QntnsWidgetType =>
  QNTNS_WIDGETS.some((w) => w.type === type);

// One theme module per widget, mounted into a plain div as the theme's embed does.
function GoalEmbed({ name }: { name: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let off: (() => void) | undefined;
    let gone = false;
    attachGoal(el, name, () => !gone).then((t) => (gone ? t?.() : (off = t)));
    return () => {
      gone = true;
      off?.();
      el.replaceChildren();
    };
  }, [name]);
  return <div ref={host} data-qntns-goal={name} />;
}

// The embed's layout width: the 480 tile it was sized at before §82.
const NATURAL_W = 480;

// Lays the embed out at NATURAL_W and scales it to fit the tile both ways, so nothing clips or scrolls.
// A transform, not `zoom`: offsetHeight stays the unscaled layout height, so measuring cannot feed back.
function Fit({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const o = outer.current!;
    const i = inner.current!;
    const fit = () => {
      const s = Math.min(o.clientWidth / NATURAL_W, o.clientHeight / Math.max(1, i.offsetHeight));
      i.style.transform = `translateX(-50%) scale(${s})`;
      // Read these off the DOM to check §82's numbers.
      o.dataset.natural = `${NATURAL_W}x${i.offsetHeight}`;
      o.dataset.scale = s.toFixed(3);
    };
    const ro = new ResizeObserver(fit);
    ro.observe(o);
    ro.observe(i);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={outer} className="relative h-full w-full overflow-hidden">
      <div ref={inner} className="absolute left-1/2 top-0" style={{ width: NATURAL_W, transformOrigin: "top center" }}>
        {children}
      </div>
    </div>
  );
}

export function QntnsWidget({ type }: { type: QntnsWidgetType }) {
  return (
    <div className="qntns-widget h-full w-full overflow-hidden" style={{ background: "var(--color-page)", color: "var(--color-ink)" }}>
      {type === "stewardship" ? <StewardshipTreemap /> : <Fit><GoalEmbed name={type} /></Fit>}
    </div>
  );
}
