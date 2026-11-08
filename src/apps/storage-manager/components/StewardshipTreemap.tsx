import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { WORKER } from "../constants";
import { canOpen, countOf, imageSrc, layout, linkOf, mapBox, viewOf, type Item } from "../treemap";

const unit = (n: number) => `${n} ${n === 1 ? "item" : "items"}`;

// Reads GET /goals/stewardship once; any failure (or 4s timeout) is an empty tree, silently.
export function useStewardship(): Item | null {
  const [tree, setTree] = useState<Item | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    fetch(`${WORKER}/goals/stewardship`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setTree(d && typeof d === "object" ? (d as Item) : { name: "All materials", children: [] }))
      .catch(() => setTree({ name: "All materials", children: [] }))
      .finally(() => clearTimeout(timer));
    return () => { ctl.abort(); clearTimeout(timer); };
  }, []);
  return tree;
}

// The stewardship treemap on its own, so the Dashboard widget (§25) can mount it too.
// Pass `tree` to skip the fetch (stories, tests).
export function StewardshipTreemap({ tree: given }: { tree?: Item }) {
  const fetched = useStewardship();
  const tree = given ?? fetched;
  const [wish, setWish] = useState(false);
  const [trail, setTrail] = useState<number[]>([]); // child indices into each level's sized order
  const [hover, setHover] = useState(-1);
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 720));
    ro.observe(el);
    setWidth(el.clientWidth || 720);
    return () => ro.disconnect();
  }, [tree]);

  const root = useMemo(() => (tree ? viewOf(tree, wish) : null), [tree, wish]);
  const nodes = useMemo(() => {
    if (!root) return [];
    const out = [root];
    for (const i of trail) {
      const here = layout(out[out.length - 1], mapBox(width, width < 600)).blocks[i]?.child;
      if (!here || !canOpen(here)) break;
      out.push(here);
    }
    return out;
  }, [root, trail, width]);

  if (!root) return <div ref={host} style={{ padding: 16, font: "12px system-ui" }}>-</div>;
  const node = nodes[nodes.length - 1];
  const { blocks, box } = layout(node, mapBox(width, width < 600));
  const open = (i: number) => {
    const b = blocks[i];
    if (canOpen(b.child)) { setTrail([...trail.slice(0, nodes.length - 1), i]); setHover(-1); return; }
    const link = linkOf(b.child);
    if (link) window.open(link, "_blank", "noopener");
  };
  const shown = blocks[hover];

  return (
    <div ref={host} style={{ font: "12px system-ui", padding: 8, width: "100%" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
        <button type="button" disabled={!trail.length} aria-label="Zoom out" onClick={() => setTrail(trail.slice(0, -1))}>−</button>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {nodes.map((n, i) => (
            <span key={i}>
              {i > 0 && " / "}
              {i < nodes.length - 1
                ? <button type="button" onClick={() => setTrail(trail.slice(0, i))}>{i === 0 ? ".." : n.name}</button>
                : n.name}
            </span>
          ))}
          {shown && <span style={{ opacity: 0.5 }}> / {shown.child.name}</span>}
        </span>
        <span>{unit(shown ? shown.count : countOf(node))}</span>
        {(["Purchases", "Wishes"] as const).map((label) => (
          <button key={label} type="button" aria-pressed={(label === "Wishes") === wish}
            onClick={() => { setWish(label === "Wishes"); setTrail([]); }}>{label}</button>
        ))}
      </div>
      {blocks.length === 0 ? <div>-</div> : (
        <div role="group" aria-label={node.name} style={{ position: "relative", width: box.w, height: box.h }}>
          {blocks.map((b, i) => {
            const c = b.child;
            const item = !c.children;
            const action = canOpen(c) ? "Open" : linkOf(c) ? "Opens where to buy it in a new tab" : "Select";
            return (
              <button key={c.name + i} type="button" aria-label={`${c.name}, ${unit(b.count)}. ${action}.`}
                onClick={() => open(i)} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(-1)}
                style={{
                  position: "absolute", left: b.rect.x, top: b.rect.y, width: b.rect.w - b.gapRight, height: b.rect.h - b.gapBottom,
                  background: b.fill, color: c.image ? "#fff" : b.light ? "#fffaf4" : "#14213d", border: 0, padding: 8,
                  textAlign: "left", overflow: "hidden", cursor: "pointer",
                  opacity: hover >= 0 && hover !== i ? 0.6 : 1,
                }}>
                {c.image && (
                  // A failed image drops out silently: the plain block stays.
                  <img src={imageSrc(c.image)} alt="" loading="lazy" decoding="async"
                    onError={(e) => e.currentTarget.remove()}
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                )}
                <span style={{ position: "relative", textShadow: c.image ? "0 0 8px #000" : undefined }}>
                  {c.name}
                  {item && typeof c.price === "number" && ` • $${c.price.toLocaleString("en-US")}`}
                  {item && linkOf(c) && " ↗"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
