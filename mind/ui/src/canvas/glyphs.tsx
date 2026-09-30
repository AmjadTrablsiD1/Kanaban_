// Status glyphs and the progress ring. Colours come only from --q-<status>.
import type { StatusId } from "../constants";

export function StatusGlyph({ status, size = 20, onRoot = false }: { status: StatusId; size?: number; onRoot?: boolean }) {
  const c = onRoot ? "var(--rootText)" : `var(--q-${status})`;
  const r = size / 2 - 2;
  const mid = size / 2;
  switch (status) {
    case "idea":
      return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
          <path d={`M${mid} ${mid - r} Q${mid + 1.2} ${mid - 1.2} ${mid + r} ${mid} Q${mid + 1.2} ${mid + 1.2} ${mid} ${mid + r} Q${mid - 1.2} ${mid + 1.2} ${mid - r} ${mid} Q${mid - 1.2} ${mid - 1.2} ${mid} ${mid - r}Z`}
                style={{ fill: c }} opacity={0.95} />
        </svg>
      );
    case "todo":
      return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
          <circle cx={mid} cy={mid} r={r} fill="none" style={{ stroke: c }} strokeWidth={2} />
        </svg>
      );
    case "doing":
      return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
          <circle cx={mid} cy={mid} r={r} fill="none" style={{ stroke: c }} strokeWidth={2} />
          <path d={`M${mid} ${mid - r + 3} A${r - 3} ${r - 3} 0 0 1 ${mid} ${mid + r - 3} Z`} style={{ fill: c }} />
        </svg>
      );
    case "done":
      return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
          <circle cx={mid} cy={mid} r={r + 1} style={{ fill: c }} />
          <path d={`M${mid - r * 0.45} ${mid + 0.2} l${r * 0.32} ${r * 0.32} l${r * 0.62} ${-r * 0.7}`}
                fill="none" style={{ stroke: onRoot ? "var(--rootA)" : "var(--surface)" }} strokeWidth={2.2}
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
  }
}

/** A ring that fills with the share of tasks done; the number is the percentage. */
export function ProgressRing({ done, total, size = 30, onRoot = false, label = true }:
  { done: number; total: number; size?: number; onRoot?: boolean; label?: boolean }) {
  const stroke = size >= 40 ? 4 : 3;
  const r = (size - stroke) / 2;
  const len = 2 * Math.PI * r;
  const ratio = total ? done / total : 0;
  const pct = Math.round(ratio * 100);
  const track = onRoot ? "color-mix(in srgb, var(--rootText) 28%, transparent)" : "var(--border)";
  const fill = onRoot ? "var(--rootText)" : "var(--q-done)";
  return (
    <svg className="mn-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`}
         role="img" aria-label={`${done} of ${total} tasks done`}>
      <title>{`${done} of ${total} tasks done`}</title>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: track }} strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
              strokeLinecap="round" strokeDasharray={`${len * ratio} ${len}`}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              style={{ stroke: fill, transition: "stroke-dasharray 300ms var(--ease)" }} />
      {label && (
        <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle"
              fontSize={size >= 40 ? 11 : 8.5} style={{ fill: onRoot ? "var(--rootText)" : "var(--text)" }}>
          {pct}
        </text>
      )}
    </svg>
  );
}
