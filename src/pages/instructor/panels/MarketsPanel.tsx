import { useI18n } from '@/lib/i18n';
import { COUNTRY_ORDER, Flag, WORLD_COLORS, countryName } from '@/lib/countries';
import { kb, money, num, pct, price } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChartCard, EmptyChart, SeriesChart } from '@/components/charts';
import { useInstructor } from '../context';

export function MarketsPanel() {
  const { st } = useInstructor();
  const { t, lang } = useI18n();
  const periods = Array.from({ length: st.session.total_periods }, (_, i) => i + 1);
  const wr = (worldId: string, n: number) => st.world_results.find((r) => r.world_id === worldId && r.period_number === n);
  const rows = periods.map((n) => {
    const row: Record<string, number | null> = { period: n };
    for (const w of st.worlds) {
      const r = wr(w.id, n);
      row[`price_${w.code}`] = r ? Number(r.price) : null;
      row[`share_${w.code}`] = r ? Number(r.production_share) * 100 : null;
    }
    return row;
  });
  const hasData = st.world_results.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <ChartCard title={t('instructor.priceByWorld')}>
          {hasData ? (
            <SeriesChart
              data={rows}
              xKey="period"
              xFormatter={(v) => `P${v}`}
              series={st.worlds.map((w) => ({ key: `price_${w.code}`, name: t('app.worldX', { w: w.code }), color: WORLD_COLORS[w.code] }))}
              yFormatter={(v) => `$${v}`}
              valueFormatter={(v) => price(v)}
            />
          ) : (
            <EmptyChart text={t('results.noResults')} />
          )}
        </ChartCard>
        <ChartCard title={t('instructor.shareByWorld')}>
          {hasData ? (
            <SeriesChart
              data={rows}
              xKey="period"
              xFormatter={(v) => `P${v}`}
              series={st.worlds.map((w) => ({ key: `share_${w.code}`, name: t('app.worldX', { w: w.code }), color: WORLD_COLORS[w.code] }))}
              yFormatter={(v) => `${v.toFixed(0)}%`}
              valueFormatter={(v) => pct(v)}
            />
          ) : (
            <EmptyChart text={t('results.noResults')} />
          )}
        </ChartCard>
      </div>

      {st.worlds.map((w) => {
        const groups = st.groups
          .filter((g) => g.world_id === w.id)
          .sort((a, b) => COUNTRY_ORDER.indexOf(a.country_code) - COUNTRY_ORDER.indexOf(b.country_code));
        const closed = periods.filter((n) => wr(w.id, n));
        return (
          <Card key={w.id} className="gap-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span className="inline-block size-3 rounded-full" style={{ background: WORLD_COLORS[w.code] }} />
                {t('instructor.worldTable', { w: w.code })}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-0 sm:px-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('app.country')}</TableHead>
                    {closed.map((n) => (
                      <TableHead key={n} className="text-right">
                        P{n}
                      </TableHead>
                    ))}
                    <TableHead className="text-right">{t('results.remaining')}</TableHead>
                    <TableHead className="text-right">{t('results.wealth')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map((g) => {
                    const state = st.states.find((x) => x.group_id === g.id);
                    return (
                      <TableRow key={g.id}>
                        <TableCell>
                          <span className="flex items-center gap-2">
                            <Flag code={g.country_code} /> {countryName(g.country_code, lang)}
                            <span className="text-xs text-muted-foreground">#{g.group_number}</span>
                          </span>
                        </TableCell>
                        {closed.map((n) => {
                          const r = st.results.find((x) => x.group_id === g.id && x.period_number === n);
                          const pl = st.pledges.find((x) => x.group_id === g.id && x.period_number === n);
                          const over = pl && r && Number(r.production_pct) > Number(pl.pledge_pct) + 0.5;
                          return (
                            <TableCell key={n} className="text-right" title={r ? kb(r.production) : undefined}>
                              <span className={over ? 'font-semibold text-red-600' : undefined}>{r ? pct(r.production_pct, 0) : '—'}</span>
                              {pl && <span className="block text-[10px] text-muted-foreground">↳ {pct(pl.pledge_pct, 0)}</span>}
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-right">{num(state?.remaining_reserves)}</TableCell>
                        <TableCell className="text-right font-medium">{money(state?.estimated_wealth)}</TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="bg-muted/40 font-medium">
                    <TableCell>{t('results.worldPrice')}</TableCell>
                    {closed.map((n) => (
                      <TableCell key={n} className="text-right">
                        {price(wr(w.id, n)?.price)}
                      </TableCell>
                    ))}
                    <TableCell />
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
              <p className="px-4 pt-1 text-[11px] text-muted-foreground">% = {t('results.share')} · ↳ = {t('results.pledged')}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
