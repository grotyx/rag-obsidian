/**
 * Deterministic force-directed layout (Fruchterman–Reingold) for the citation map.
 * Pure math — no dependency, no `obsidian` import — so the integration suite can check it.
 *
 * Seeding is positional (evenly spaced on a circle by index), never random, so two runs
 * over the same input return identical coordinates.
 */

export interface LayoutNode {
  id: string;
  /** Pinned nodes never move — the active reference sits at the centre. */
  pinned?: boolean;
}

export interface LayoutEdge {
  source: string;
  target: string;
}

export interface Point {
  x: number;
  y: number;
}

export interface LayoutOptions {
  width: number;
  height: number;
  iterations?: number;
}

const DEFAULT_ITERATIONS = 250;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Keep the `max` best-connected nodes (degree desc, then id for a stable tie-break).
 * A hub paper with 200 references is unreadable as a drawing; pinned nodes always survive.
 */
export function topByDegree(nodes: LayoutNode[], edges: LayoutEdge[], max: number): LayoutNode[] {
  if (nodes.length <= max) return nodes.slice();
  const degree: Record<string, number> = {};
  for (const n of nodes) degree[n.id] = 0;
  for (const e of edges) {
    if (e.source in degree) degree[e.source]++;
    if (e.target in degree) degree[e.target]++;
  }
  return nodes
    .slice()
    .sort(
      (a, b) =>
        (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) ||
        degree[b.id] - degree[a.id] ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    )
    .slice(0, max);
}

/** Lay nodes out in a `width`×`height` box. Returns every node's position, all inside the box. */
export function layoutGraph(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  opts: LayoutOptions
): Map<string, Point> {
  const { width, height } = opts;
  const iterations = opts.iterations ?? DEFAULT_ITERATIONS;
  const pos = new Map<string, Point>();
  const n = nodes.length;
  if (n === 0) return pos;

  const cx = width / 2;
  const cy = height / 2;
  const margin = Math.min(width, height) * 0.06;
  const seedRadius = Math.min(width, height) * 0.38;
  nodes.forEach((node, i) => {
    if (node.pinned) {
      pos.set(node.id, { x: cx, y: cy });
      return;
    }
    // Golden-angle offset keeps the seed ring from lining nodes up with their neighbours.
    const a = (2 * Math.PI * i) / n + 0.618;
    pos.set(node.id, { x: cx + seedRadius * Math.cos(a), y: cy + seedRadius * Math.sin(a) });
  });
  if (n === 1) return pos;

  const k = Math.sqrt((width * height) / n) * 0.55; // ideal edge length
  const live = edges.filter((e) => e.source !== e.target && pos.has(e.source) && pos.has(e.target));
  const disp = new Map<string, Point>();
  let temp = Math.min(width, height) / 6;
  const cooling = temp / (iterations + 1);

  for (let it = 0; it < iterations; it++) {
    for (const node of nodes) disp.set(node.id, { x: 0, y: 0 });

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = pos.get(nodes[i].id) as Point;
        const b = pos.get(nodes[j].id) as Point;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d = Math.sqrt(dx * dx + dy * dy);
        if (d < 0.01) {
          // Coincident nodes: nudge apart along a deterministic per-pair direction.
          dx = (((i * 7 + j * 13) % 17) - 8) / 17;
          dy = (((i * 11 + j * 5) % 19) - 9) / 19;
          d = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
        }
        const f = (k * k) / d;
        const da = disp.get(nodes[i].id) as Point;
        const db = disp.get(nodes[j].id) as Point;
        da.x += (dx / d) * f;
        da.y += (dy / d) * f;
        db.x -= (dx / d) * f;
        db.y -= (dy / d) * f;
      }
    }

    for (const e of live) {
      const a = pos.get(e.source) as Point;
      const b = pos.get(e.target) as Point;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
      const f = (d * d) / k;
      const da = disp.get(e.source) as Point;
      const db = disp.get(e.target) as Point;
      da.x -= (dx / d) * f;
      da.y -= (dy / d) * f;
      db.x += (dx / d) * f;
      db.y += (dy / d) * f;
    }

    for (const node of nodes) {
      if (node.pinned) continue;
      const p = pos.get(node.id) as Point;
      const d = disp.get(node.id) as Point;
      d.x += (cx - p.x) * 0.02; // gentle centering so disconnected nodes don't drift to the rim
      d.y += (cy - p.y) * 0.02;
      const len = Math.max(Math.sqrt(d.x * d.x + d.y * d.y), 0.01);
      const step = Math.min(len, temp);
      p.x = clamp(p.x + (d.x / len) * step, margin, width - margin);
      p.y = clamp(p.y + (d.y / len) * step, margin, height - margin);
    }
    temp -= cooling;
  }
  return pos;
}
