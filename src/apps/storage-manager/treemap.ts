// Pure layout for the stewardship treemap, ported from QNTNs-ghost goal-stewardship.js
// (drops texture cells, the history chart and sound). Everything is on the 8px grid.
import { WORKER } from "./constants";

export type Item = {
  name: string;
  count?: number;
  children?: Item[];
  image?: string;
  link?: string;
  wish?: boolean;
  price?: number;
  totals?: { date: string; total: number }[];
};
export type Rect = { x: number; y: number; w: number; h: number };
export type Block = { child: Item; count: number; rect: Rect; fill: string; light: boolean; gapRight: number; gapBottom: number };

export const GRID = 8;
export const GAP = 4;
export const MIN_BLOCK = 32;
const GROW_LIMIT = 8;
const T_MAX = 5 / 6;
const LIGHT_BELOW = 0.575;

export const countOf = (n: Item): number =>
  n.children ? n.children.reduce((s, c) => s + countOf(c), 0) : Math.max(0, n.count ?? 1);

const singles = new WeakMap<Item, Item[]>();
export const kids = (n: Item): Item[] => {
  if (n.children) return n.children;
  const c = countOf(n);
  if (c < 2) return [];
  if (!singles.has(n)) singles.set(n, Array.from({ length: c }, (_, i) => ({ ...n, name: `${n.name} ${i + 1}`, count: 1 })));
  return singles.get(n)!;
};
export const canOpen = (n: Item) => kids(n).length > 0;

export const imageSrc = (id: string) => (/^[0-9a-f]{64}$/i.test(id) ? `${WORKER}/goals/images/${id}` : id);
export const linkOf = (n: Item) => (/^https?:\/\//i.test(n.link ?? "") ? n.link! : null);

const prune = (n: Item, wish: boolean): Item | null => {
  if (!n.children) return Boolean(n.wish) === wish ? n : null;
  const children = n.children.map((c) => prune(c, wish)).filter((c): c is Item => !!c);
  return children.length ? { ...n, children } : null;
};
export const viewOf = (tree: Item, wish: boolean): Item => ({ ...tree, children: prune(tree, wish)?.children ?? [] });

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const worst = (row: number[], side: number) => {
  const s = sum(row);
  return Math.max((side * side * Math.max(...row)) / (s * s), (s * s) / (side * side * Math.min(...row)));
};
const layRow = (row: number[], box: Rect, out: Rect[]): Rect => {
  const s = sum(row);
  if (box.w >= box.h) {
    const cw = s / box.h;
    let y = box.y;
    for (const a of row) { out.push({ x: box.x, y, w: cw, h: a / cw }); y += a / cw; }
    return { x: box.x + cw, y: box.y, w: box.w - cw, h: box.h };
  }
  const rh = s / box.w;
  let x = box.x;
  for (const a of row) { out.push({ x, y: box.y, w: a / rh, h: rh }); x += a / rh; }
  return { x: box.x, y: box.y + rh, w: box.w, h: box.h - rh };
};
// values sorted descending, all > 0.
const squarify = (values: number[], box: Rect): Rect[] => {
  const total = sum(values);
  if (!total) return [];
  const areas = values.map((v) => (v * box.w * box.h) / total);
  const out: Rect[] = [];
  let rest = { ...box };
  let row: number[] = [];
  for (let i = 0; i < areas.length;) {
    const side = Math.min(rest.w, rest.h);
    const next = [...row, areas[i]];
    if (!row.length || worst(next, side) <= worst(row, side)) { row = next; i += 1; }
    else { rest = layRow(row, rest, out); row = []; }
  }
  if (row.length) layRow(row, rest, out);
  return out;
};

const g = (v: number) => Math.round(v / GRID + 1e-9) * GRID;
const sized = (n: Item) =>
  kids(n).map((child) => ({ child, count: countOf(child) })).filter((e) => e.count > 0).sort((a, b) => b.count - a.count);

// rampColor from ramp.js: hsl(222 s l), s 55→0, l 21→81.
const rampColor = (i: number, total: number) => {
  const t = total <= 1 ? 0 : i / (total - 1);
  return `hsl(222 ${(55 * (1 - t)).toFixed(2)}% ${(21 + 60 * t).toFixed(2)}%)`;
};

export const mapBox = (outer: number, portrait: boolean): Rect => {
  const w = Math.max(GRID * 8, Math.floor(outer / GRID) * GRID);
  return { x: 0, y: 0, w, h: g(portrait ? (w * 5) / 3 : (w * 3) / 5) };
};

const lay = (node: Item, box: Rect) => {
  const entries = sized(node);
  const n = entries.length;
  const blocks = squarify(entries.map((e) => e.count), box).map((r, i) => {
    const x = g(r.x), y = g(r.y);
    return { ...entries[i], rect: { x, y, w: g(r.x + r.w) - x, h: g(r.y + r.h) - y } };
  });
  // Tone by reading order (top, then left), as the page does.
  const order = [...blocks].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  return blocks.map((b): Block => {
    const k = order.indexOf(b);
    const r = b.rect;
    const along = (o: typeof b, a: "x" | "y", d: "w" | "h") => Math.min(r[a] + r[d], o.rect[a] + o.rect[d]) - Math.max(r[a], o.rect[a]) > 0;
    return {
      ...b,
      fill: rampColor(5 * k, 6 * (n - 1) + 1),
      light: (n > 1 ? (k / (n - 1)) * T_MAX : 0) < LIGHT_BELOW,
      gapRight: blocks.some((o) => o !== b && o.rect.x === r.x + r.w && along(o, "y", "h")) ? GAP : 0,
      gapBottom: blocks.some((o) => o !== b && o.rect.y === r.y + r.h && along(o, "x", "w")) ? GAP : 0,
    };
  });
};

// Grows the map's height in 8px steps until every block meets MIN_BLOCK.
export const layout = (node: Item, box: Rect) => {
  let grown = box;
  let blocks = lay(node, grown);
  while (blocks.some((b) => b.rect.w < MIN_BLOCK || b.rect.h < MIN_BLOCK) && grown.h < box.h * GROW_LIMIT) {
    grown = { ...grown, h: grown.h + GRID };
    blocks = lay(node, grown);
  }
  return { blocks, box: grown };
};
