import type { GraphNode, GraphRel } from "../lib/queries";

// Hand-rolled SVG, deterministic layout, readable on a projector.
// Relationships are drawn as clickable things too: in the snapshot they are
// records with their own IRI, not just lines.

const COLORS: Record<string, string> = {
  Person: "#0b297d",
  Movie: "#c2185b",
};

const REL_COLORS: Record<string, string> = {
  ACTED_IN: "#006fd6",
  DIRECTED: "#e65100",
  WROTE: "#2e7d32",
  PRODUCED: "#6d4c41",
  REVIEWED: "#8e24aa",
  FOLLOWS: "#455a64",
};

interface Props {
  nodes: GraphNode[];
  rels: GraphRel[];
  /** Left-to-right order for a chain (e.g. a proof path); otherwise a bipartite layout. */
  order?: string[];
  highlight?: Set<string>;
  onSelect?: (id: string) => void;
  height?: number;
  emptyHint?: string;
}

const WIDTH = 1000;

export default function GraphView({ nodes, rels, order, highlight, onSelect, height = 340, emptyHint }: Props) {
  if (nodes.length === 0) {
    return (
      <div className="graph-container graph-empty" style={{ minHeight: 120 }}>
        {emptyHint ?? "Nothing to show yet"}
      </div>
    );
  }

  const pos = new Map<string, { x: number; y: number }>();
  if (order && order.length) {
    const step = (WIDTH - 120) / Math.max(1, order.length - 1);
    order.forEach((id, i) => pos.set(id, { x: 60 + i * step, y: i % 2 === 0 ? height * 0.35 : height * 0.68 }));
    nodes.filter((n) => !pos.has(n.id)).forEach((n, i) => pos.set(n.id, { x: 60 + i * 80, y: height - 30 }));
  } else {
    forceLayout(nodes, rels, height).forEach((p, id) => pos.set(id, p));
  }

  const hl = highlight ?? new Set<string>();
  const anyHl = hl.size > 0;

  return (
    <div className="graph-container">
      <svg viewBox={`0 0 ${WIDTH} ${height}`} width="100%" style={{ display: "block" }}>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#90a4ae" />
          </marker>
        </defs>
        {rels.map((r) => {
          const a = pos.get(r.source);
          const b = pos.get(r.target);
          if (!a || !b) return null;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.hypot(dx, dy) || 1;
          const pad = 24;
          const x1 = a.x + (dx / len) * pad;
          const y1 = a.y + (dy / len) * pad;
          const x2 = b.x - (dx / len) * pad;
          const y2 = b.y - (dy / len) * pad;
          const on = hl.has(r.id);
          const color = REL_COLORS[r.type] ?? "#90a4ae";
          return (
            <g
              key={r.id}
              className="graph-rel"
              onClick={() => onSelect?.(r.id)}
              style={{ cursor: onSelect ? "pointer" : "default", opacity: anyHl && !on ? 0.35 : 1 }}
            >
              <title>{`${r.type}${r.detail ? " · " + r.detail : ""}\nelementId ${r.id}`}</title>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={14} />
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={on ? "#ffa901" : color}
                strokeWidth={on ? 5 : 2}
                markerEnd="url(#arrow)"
              />
              <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 5} textAnchor="middle" className="graph-rel-label" fill={on ? "#b26a00" : color}>
                {r.type}
                {r.detail ? ` · ${r.detail.length > 22 ? r.detail.slice(0, 22) + "…" : r.detail}` : ""}
              </text>
            </g>
          );
        })}
        {nodes.map((n) => {
          const p = pos.get(n.id)!;
          const on = hl.has(n.id);
          const color = COLORS[n.kind] ?? "#455a64";
          return (
            <g
              key={n.id}
              onClick={() => onSelect?.(n.id)}
              style={{ cursor: onSelect ? "pointer" : "default", opacity: anyHl && !on ? 0.45 : 1 }}
            >
              <title>{`${n.kind}: ${n.label}\nelementId ${n.id}`}</title>
              {on && <circle cx={p.x} cy={p.y} r={27} fill="none" stroke="#ffa901" strokeWidth={5} />}
              <circle cx={p.x} cy={p.y} r={20} fill={color} />
              <text x={p.x} y={p.y + 4} textAnchor="middle" fill="white" fontSize={10} fontWeight={700}>
                {n.kind === "Movie" ? "🎬" : n.label.split(" ").map((w) => w[0]).join("").slice(0, 3)}
              </text>
              <text x={p.x} y={p.y + 36} textAnchor="middle" className="graph-node-label">
                {n.label.length > 22 ? n.label.slice(0, 21) + "…" : n.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Small deterministic force layout: repulsion, springs on relationships, kept in the box. */
function forceLayout(nodes: GraphNode[], rels: GraphRel[], height: number): Map<string, { x: number; y: number }> {
  const n = nodes.length;
  const idx = new Map(nodes.map((nd, i) => [nd.id, i]));
  const sorted = [...nodes].sort((a, b) => (a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === "Movie" ? -1 : 1));
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  sorted.forEach((nd, k) => {
    const i = idx.get(nd.id)!;
    const a = (2 * Math.PI * k) / n;
    const r = nd.kind === "Movie" ? 60 : 200;
    xs[i] = WIDTH / 2 + r * Math.cos(a) * 1.8;
    ys[i] = height / 2 + r * Math.sin(a) * 0.6;
  });
  const edges = rels.map((r) => [idx.get(r.source), idx.get(r.target)]).filter((e): e is [number, number] => e[0] !== undefined && e[1] !== undefined);
  const ideal = Math.min(170, Math.max(90, Math.sqrt((WIDTH * height) / Math.max(1, n)) * 0.9));
  for (let it = 0; it < 400; it++) {
    const fx = new Float64Array(n);
    const fy = new Float64Array(n);
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        let dx = xs[i] - xs[j];
        let dy = ys[i] - ys[j];
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = 0.1 * (i - j); dy = 0.1; d2 = 0.02; }
        const f = (ideal * ideal) / d2;
        fx[i] += dx * f * 0.05; fy[i] += dy * f * 0.05;
        fx[j] -= dx * f * 0.05; fy[j] -= dy * f * 0.05;
      }
    for (const [a, b] of edges) {
      const dx = xs[b] - xs[a];
      const dy = ys[b] - ys[a];
      const d = Math.hypot(dx, dy) || 1;
      const f = (d - ideal) * 0.05;
      fx[a] += (dx / d) * f; fy[a] += (dy / d) * f;
      fx[b] -= (dx / d) * f; fy[b] -= (dy / d) * f;
    }
    const cool = 1 - it / 400;
    for (let i = 0; i < n; i++) {
      fx[i] += (WIDTH / 2 - xs[i]) * 0.005;
      fy[i] += (height / 2 - ys[i]) * 0.01;
      const m = Math.hypot(fx[i], fy[i]);
      const cap = 30 * cool + 1;
      const k = m > cap ? cap / m : 1;
      xs[i] = Math.max(50, Math.min(WIDTH - 50, xs[i] + fx[i] * k));
      ys[i] = Math.max(30, Math.min(height - 45, ys[i] + fy[i] * k));
    }
  }
  return new Map(nodes.map((nd, i) => [nd.id, { x: xs[i], y: ys[i] }]));
}
