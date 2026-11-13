/**
 * The authoritative price engine is SQL (opec_price). The TypeScript copy is used
 * for client-side previews; this test keeps the two in lock-step.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computePrice, fvFactor, resolveConfig, terminalValue, type DemandType } from '@/lib/engine';
import { TestDb, databaseAvailable } from './helpers';

const available = await databaseAvailable();

describe.skipIf(!available)('SQL ↔ TypeScript engine parity', () => {
  const db = new TestDb();
  beforeAll(async () => db.setup());
  afterAll(async () => db.teardown());

  const variants: Record<string, Record<string, unknown>> = {
    default: {},
    clamp: { price: { extrapolation: 'clamp' } },
    priceShift: { price: { demand_shift: 'price' } },
    customTable: { price: { low: [120, 100, 90, 80, 60], floor: 10 } },
  };

  for (const [name, overrides] of Object.entries(variants)) {
    it(`prices match on a grid (${name})`, async () => {
      const cfg = resolveConfig(overrides);
      const cases: Array<[number, DemandType, number]> = [];
      for (let q = 0; q <= 44000; q += 1370) {
        for (const type of ['low', 'high'] as DemandType[]) {
          for (const df of [0.95 * 0.985, 0.985, 1, 1.0071, 1.015, 1.05 * 1.015]) cases.push([q, type, df]);
        }
      }
      const rows = await db.sql<{ p: string }>(
        `select public.opec_price(c.q, 33700, c.t, c.df, public.opec_config($2::jsonb)) as p
           from jsonb_to_recordset($1::jsonb) as c(q numeric, t text, df numeric, i int) order by c.i`,
        [JSON.stringify(cases.map(([q, t, df], i) => ({ q, t, df, i }))), JSON.stringify(overrides)],
      );
      cases.forEach(([q, t, df], i) => {
        const ts = computePrice({ totalProduction: q, demandType: t, demandFactor: df }, cfg);
        expect(Math.abs(ts - Number(rows[i].p)), `q=${q} ${t} df=${df}`).toBeLessThanOrEqual(0.01);
      });
    });
  }

  it('compounding and terminal value match', async () => {
    const cfg = resolveConfig({});
    const rows = await db.sql(
      `select t, public.opec_fv_factor(t, 10, public.opec_default_config())::float8 as f,
              public.opec_terminal_value(9, 50000, public.opec_default_config())::float8 as tv
         from generate_series(1, 10) t order by t`,
    );
    for (const r of rows) expect(r.f).toBeCloseTo(fvFactor(r.t, 10, cfg), 12);
    expect(rows[0].tv).toBeCloseTo(terminalValue(9, 50000, cfg), 12);
  });

  it('default configs are identical', async () => {
    const [{ c }] = await db.sql(`select public.opec_default_config() as c`);
    expect(resolveConfig(c)).toEqual(resolveConfig({}));
    expect(c).toEqual(JSON.parse(JSON.stringify(resolveConfig({}))));
  });
});
