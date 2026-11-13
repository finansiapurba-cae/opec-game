/** Semicircular production gauge (0–100 % of capacity) with an optional pledge marker. */
export function Gauge({ value, marker, label }: { value: number; marker?: number | null; label?: string }) {
  const v = Math.max(0, Math.min(100, value));
  const r = 80;
  const cx = 100;
  const cy = 95;
  const arc = (p: number) => {
    const a = Math.PI * (1 - p / 100);
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)] as const;
  };
  const [ex, ey] = arc(v);
  const large = 0;
  const m = marker != null ? arc(Math.max(0, Math.min(100, marker))) : null;
  return (
    <svg viewBox="0 0 200 110" className="w-full max-w-[240px]" role="img" aria-label={label ?? `${v.toFixed(0)}%`}>
      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} stroke="var(--muted)" strokeWidth="14" fill="none" strokeLinecap="round" />
      {v > 0 && (
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey}`}
          stroke={v > 90 ? '#c0392b' : v > 75 ? 'var(--gold-500)' : 'var(--oil-600)'}
          strokeWidth="14"
          fill="none"
          strokeLinecap="round"
        />
      )}
      {m && (
        <g>
          <circle cx={m[0]} cy={m[1]} r="6" fill="#fff" stroke="var(--navy-900)" strokeWidth="2.5" />
        </g>
      )}
      <text x={cx} y={cy - 18} textAnchor="middle" className="fill-navy-900" style={{ fontSize: 30, fontWeight: 700 }}>
        {v.toFixed(0)}%
      </text>
      {label && (
        <text x={cx} y={cy + 2} textAnchor="middle" style={{ fontSize: 11 }} className="fill-muted-foreground">
          {label}
        </text>
      )}
    </svg>
  );
}
