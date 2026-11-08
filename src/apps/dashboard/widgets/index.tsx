import { useEffect, useRef } from "react";
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
// Sizes are a first guess on the 4px grid; the user judges them.
export const QNTNS_WIDGETS = [
  { type: "meditation", label: "Meditation", icon: "🧘", size: { width: 400, height: 280 } },
  { type: "mastery", label: "Mastery", icon: "🏆", size: { width: 480, height: 400 } },
  { type: "mood", label: "Mood", icon: "🙂", size: { width: 400, height: 280 } },
  { type: "projects", label: "Projects", icon: "📋", size: { width: 400, height: 360 } },
  { type: "savings", label: "Savings", icon: "🏦", size: { width: 400, height: 240 } },
  { type: "spending", label: "Spending", icon: "💸", size: { width: 480, height: 440 } },
  { type: "stewardship", label: "Storage Manager", icon: "📦", size: { width: 480, height: 360 } },
  { type: "friends", label: "Friends", icon: "👥", size: { width: 400, height: 240 } },
  { type: "fund", label: "Fund", icon: "💰", size: { width: 480, height: 480 } },
] as const;

export type QntnsWidgetType = (typeof QNTNS_WIDGETS)[number]["type"];

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

export function QntnsWidget({ type }: { type: QntnsWidgetType }) {
  return (
    <div className="qntns-widget h-full w-full overflow-auto" style={{ background: "var(--color-page)", color: "var(--color-ink)" }}>
      {type === "stewardship" ? <StewardshipTreemap /> : <GoalEmbed name={type} />}
    </div>
  );
}
