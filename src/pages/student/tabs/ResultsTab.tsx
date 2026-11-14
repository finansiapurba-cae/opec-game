import { Link } from 'react-router-dom';
import { CalculatorIcon, TrophyIcon } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { terminalValue } from '@/lib/engine';
import { kb, money, num, pct, price } from '@/lib/format';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatTile } from '@/components/StatTile';
import { CHART, ChartCard, EmptyChart, SeriesChart } from '@/components/charts';
import { Term } from '@/components/Term';
import { useStudent } from '../context';
import { CopySummaryButton } from '../CopySummaryButton';

export function ResultsTab() {
  const { s, cfg } = useStudent();
  const { t } = useI18n();
  const results = s.results;
  const worldByPeriod = new Map(s.world_results.map((w) => [w.period_number, w]));
  const pledgeByPeriod = new Map(s.pledges.filter((p) => p.group_id === s.group.id).map((p) => [p.period_number, p]));
  const last = results[results.length - 1];
  const lastWorld = last ? worldByPeriod.get(last.period_number) : undefined;
  const finished = s.session.status === 'finished';
  const myFinal = s.final_results.find((f) => f.group_id === s.group.id);

  const summaryBar = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span className="text-xs text-muted-foreground">{t('summary.hint')}</span>
      <CopySummaryButton />
    </div>
  );

  if (!last) {
    return (
      <div className="flex flex-col gap-4">
        {summaryBar}
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">{t('results.noResults')}</CardContent>
        </Card>
      </div>
    );
  }

  const periods = Array.from({ length: s.session.total_periods }, (_, i) => i + 1);
  const chartRows = periods.map((n) => {
    const r = results.find((x) => x.period_number === n);
    const w = worldByPeriod.get(n);
    const pl = pledgeByPeriod.get(n);
    return {
      period: n,
      price: w ? Number(w.price) : null,
      actual: r ? Number(r.production_pct) : null,
      pledged: pl ? Number(pl.pledge_pct) : null,
      profit: r ? Number(r.profit) + Number(r.hedge_payout) : null,
      reserves: r ? Number(r.remaining_reserves) : n === 1 ? null : null,
      wealth: r ? Number(r.estimated_wealth) : null,
    };
  });
  const reservesRows = [{ period: 0, reserves: Number(s.state.original_reserves) }, ...chartRows.filter((r) => r.reserves != null)];
  const px = (n: string | number) => `P${n}`;
  const compounded = cfg.accounting.card_cost_mode === 'compounded';
  const tv = terminalValue(Number(s.state.marginal_cost), Number(s.state.remaining_reserves), cfg);
  const sumFv = Number(s.state.cumulative_fv);
  const cardDeduction = compounded ? 0 : Number(s.state.card_costs);

  return (
    <div className="flex flex-col gap-4">
      {summaryBar}
      {finished && (
        <Card className="border-gold-500/50 bg-accent/60 py-4">
          <CardContent className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <TrophyIcon className="size-8 text-gold-600" />
            <div className="flex-1">
              <div className="text-sm text-accent-foreground">{t('results.finalWealth')}</div>
              <div className="text-2xl font-bold text-navy-900">{money(myFinal?.final_wealth ?? s.state.estimated_wealth)}</div>
            </div>
            <Button asChild variant="gold">
              <Link to={`/results/${s.session.id}`}>{t('results.seeFinal')}</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div>
        <h3 className="mb-2 flex items-center gap-2 text-base font-semibold text-navy-900">
          {t('results.latest', { n: last.period_number })}
          {lastWorld && (
            <Badge variant={lastWorld.demand_type === 'high' ? 'success' : 'warning'}>
              {t(lastWorld.demand_type === 'high' ? 'header.demandHigh' : 'header.demandLow')}
            </Badge>
          )}
        </h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          <StatTile tone="navy" label={t('results.worldPrice')} value={price(last.price)} sub={t('app.worldX', { w: s.world.code })} />
          <StatTile
            label={t('results.yourProduction')}
            value={kb(last.production)}
            sub={
              <>
                {pct(last.production_pct)} {last.auto_submitted && <Badge variant="warning">{t('results.auto')}</Badge>}
              </>
            }
          />
          <StatTile label={t('results.totalProduction')} value={kb(lastWorld?.total_production)} sub={lastWorld ? pct(Number(lastWorld.production_share) * 100) : undefined} />
          <StatTile label={t('results.revenue')} value={money(last.revenue)} />
          <StatTile label={t('results.productionCost')} value={money(last.production_cost)} />
          <StatTile
            tone="green"
            label={<Term k="profit">{t('results.periodProfit')}</Term>}
            value={money(last.profit)}
            sub={Number(last.hedge_payout) > 0 ? `${t('results.hedge')}: ${money(last.hedge_payout, { sign: true })}` : undefined}
          />
          <StatTile label={t('results.cumulativeFv')} value={money(last.cumulative_fv)} />
          <StatTile label={t('results.remainingReserves')} value={kb(last.remaining_reserves)} />
          <StatTile tone="gold" label={<Term k="finalWealth">{t('results.estimatedWealth')}</Term>} value={money(s.state.estimated_wealth)} className="col-span-2" />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ChartCard title={t('results.priceChart', { w: s.world.code })}>
          <SeriesChart
            data={chartRows}
            xKey="period"
            xFormatter={px}
            series={[{ key: 'price', name: t('results.price'), color: CHART.series1 }]}
            yFormatter={(v) => `$${v}`}
            valueFormatter={(v) => price(v)}
          />
        </ChartCard>
        <ChartCard title={t('results.productionChart')}>
          <SeriesChart
            data={chartRows}
            xKey="period"
            xFormatter={px}
            series={[
              { key: 'actual', name: t('results.actual'), color: CHART.series1, type: 'bar' },
              { key: 'pledged', name: t('results.pledged'), color: CHART.series2 },
            ]}
            yDomain={[0, 100]}
            yFormatter={(v) => `${v}%`}
            valueFormatter={(v) => pct(v)}
          />
        </ChartCard>
        <ChartCard title={t('results.profitChart')} description="USD">
          {chartRows.some((r) => r.profit != null) ? (
            <SeriesChart
              data={chartRows}
              xKey="period"
              xFormatter={px}
              series={[{ key: 'profit', name: t('results.profit'), color: CHART.series1, type: 'bar' }]}
              yFormatter={(v) => money(v)}
            />
          ) : (
            <EmptyChart text={t('results.noResults')} />
          )}
        </ChartCard>
        <ChartCard title={t('results.reservesChart')} description="kb">
          <SeriesChart
            data={reservesRows}
            xKey="period"
            xFormatter={px}
            series={[{ key: 'reserves', name: t('results.remaining'), color: CHART.series1, type: 'area' }]}
            yFormatter={(v) => num(v)}
            valueFormatter={(v) => kb(v)}
            yDomain={[0, 'auto']}
          />
        </ChartCard>
        <ChartCard title={t('results.wealthChart')} className="md:col-span-2">
          <SeriesChart
            data={chartRows}
            xKey="period"
            xFormatter={px}
            series={[{ key: 'wealth', name: t('results.wealth'), color: CHART.series1 }]}
            yFormatter={(v) => money(v)}
          />
        </ChartCard>
      </div>

      <Card className="gap-2">
        <CardHeader>
          <CardTitle className="text-base">{t('results.table')}</CardTitle>
        </CardHeader>
        <CardContent className="px-0 sm:px-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('app.period')}</TableHead>
                <TableHead>{t('results.demand')}</TableHead>
                <TableHead className="text-right">{t('results.price')}</TableHead>
                <TableHead className="text-right">{t('results.production')}</TableHead>
                <TableHead className="text-right">{t('results.share')}</TableHead>
                <TableHead className="text-right">{t('results.totalProduction')}</TableHead>
                <TableHead className="text-right">{t('results.revenue')}</TableHead>
                <TableHead className="text-right">{t('results.productionCost')}</TableHead>
                <TableHead className="text-right">{t('results.profit')}</TableHead>
                <TableHead className="text-right">{t('results.hedge')}</TableHead>
                <TableHead className="text-right">{t('results.cardCost')}</TableHead>
                <TableHead className="text-right">{t('results.remaining')}</TableHead>
                <TableHead className="text-right">{t('results.wealth')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((r) => {
                const w = worldByPeriod.get(r.period_number);
                return (
                  <TableRow key={r.period_number}>
                    <TableCell className="font-medium">{r.period_number}</TableCell>
                    <TableCell>{w ? t(w.demand_type === 'high' ? 'header.demandHigh' : 'header.demandLow') : '—'}</TableCell>
                    <TableCell className="text-right">{price(r.price)}</TableCell>
                    <TableCell className="text-right">
                      {num(r.production)}
                      {r.auto_submitted && (
                        <Badge variant="warning" className="ml-1" title={t('results.autoHint')}>
                          {t('results.auto')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{pct(r.production_pct)}</TableCell>
                    <TableCell className="text-right">{num(w?.total_production)}</TableCell>
                    <TableCell className="text-right">{money(r.revenue)}</TableCell>
                    <TableCell className="text-right">{money(r.production_cost)}</TableCell>
                    <TableCell className="text-right font-medium">{money(r.profit)}</TableCell>
                    <TableCell className="text-right">{Number(r.hedge_payout) ? money(r.hedge_payout) : '—'}</TableCell>
                    <TableCell className="text-right">{Number(r.card_cost) ? money(r.card_cost) : '—'}</TableCell>
                    <TableCell className="text-right">{num(r.remaining_reserves)}</TableCell>
                    <TableCell className="text-right font-semibold">{money(r.estimated_wealth)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="gap-3">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalculatorIcon className="size-4" /> {t('results.breakdown')}
          </CardTitle>
          <CardDescription>{t('results.breakdownIntro')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 px-0 sm:px-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('app.period')}</TableHead>
                <TableHead className="text-right">{t('results.profit')}</TableHead>
                <TableHead className="text-right">{t('results.hedge')}</TableHead>
                {compounded && <TableHead className="text-right">{t('results.cardCost')}</TableHead>}
                <TableHead className="text-right">{t('results.factor')}</TableHead>
                <TableHead className="text-right">{t('results.compounded')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((r) => (
                <TableRow key={r.period_number}>
                  <TableCell>{r.period_number}</TableCell>
                  <TableCell className="text-right">{money(r.profit)}</TableCell>
                  <TableCell className="text-right">{Number(r.hedge_payout) ? money(r.hedge_payout) : '—'}</TableCell>
                  {compounded && <TableCell className="text-right">{Number(r.card_cost) ? `−${money(r.card_cost)}` : '—'}</TableCell>}
                  <TableCell className="text-right text-muted-foreground">
                    × 1.05<sup>{s.session.total_periods + 1 - r.period_number}</sup> = {Number(r.fv_factor).toFixed(4)}
                  </TableCell>
                  <TableCell className="text-right font-medium">{money(r.fv_amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <dl className="mx-4 grid gap-1.5 rounded-xl border bg-muted/40 p-4 text-sm sm:mx-2">
            <Line label={t('results.sumFv')} value={money(sumFv)} />
            <Line
              label={
                <>
                  {t('results.terminal')}{' '}
                  <span className="text-xs text-muted-foreground">
                    {t('results.terminalFormula', { tp: cfg.accounting.terminal_price, mc: s.state.marginal_cost, r: num(s.state.remaining_reserves) })}
                  </span>
                </>
              }
              value={`+ ${money(tv)}`}
            />
            {compounded ? (
              <p className="text-xs text-muted-foreground">{t('results.cardsCompounded')}</p>
            ) : (
              <Line label={t('results.cardsDeducted')} value={`− ${money(cardDeduction)}`} />
            )}
            <div className="my-1 h-px bg-border" />
            <Line label={<strong>{finished ? t('results.finalWealth') : t('results.currentWealth')}</strong>} value={<strong>{money(sumFv + tv - cardDeduction)}</strong>} />
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

function Line({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt>{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}
