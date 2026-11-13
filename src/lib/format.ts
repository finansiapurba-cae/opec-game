/** Number formatting. Money values from the database are in USD millions ($M). */
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const num = (x: number | null | undefined) => (x == null || Number.isNaN(x) ? '—' : nf0.format(Number(x)));

/** $M → "$672.0M" or "$6.59B" */
export function money(m: number | null | undefined, opts: { sign?: boolean } = {}): string {
  if (m == null || Number.isNaN(Number(m))) return '—';
  const v = Number(m);
  const sign = v < 0 ? '−' : opts.sign && v > 0 ? '+' : '';
  const a = Math.abs(v);
  if (a >= 1000) return `${sign}$${nf2.format(a / 1000)}B`;
  return `${sign}$${nf1.format(a)}M`;
}

/** USD per barrel */
export const price = (p: number | null | undefined) => (p == null ? '—' : `$${nf2.format(Number(p))}`);

/** thousand barrels */
export const kb = (q: number | null | undefined) => (q == null ? '—' : `${nf0.format(Number(q))} kb`);

export const pct = (x: number | null | undefined, digits = 1) =>
  x == null || Number.isNaN(Number(x)) ? '—' : `${Number(x).toFixed(digits).replace(/\.0+$/, '')}%`;

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m >= 60) return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export function timeOfDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
