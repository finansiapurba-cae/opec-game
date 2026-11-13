import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ArrowLeftIcon, DownloadIcon, Loader2Icon, PrinterIcon, ScaleIcon, TrophyIcon } from 'lucide-react';
import { instructorClient, studentClient } from '@/lib/supabase';
import { rpc } from '@/lib/rpc';
import { useI18n } from '@/lib/i18n';
import type { CountryCode, FinalResultsPayload, WorldCode } from '@/lib/types';
import { COUNTRY_COLORS, COUNTRY_ORDER, Flag, WORLD_CODES, WORLD_COLORS, countryName } from '@/lib/countries';
import { downloadText, toCsv } from '@/lib/csv';
import { kb, money, num, pct, price } from '@/lib/format';
import { Brand } from '@/components/Brand';
import { LanguageToggle } from '@/components/LanguageToggle';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChartCard, SeriesChart } from '@/components/charts';
import { cn } from '@/lib/utils';

function useResultsClient(): SupabaseClient | null {
  const [client, setClient] = useState<SupabaseClient | null>(null);
  useEffect(() => {
    instructorClient.auth.getSession().then(({ data }) => setClient(data.session ? instructorClient : studentClient));
  }, []);
  return client;
}

export default function FinalResults() {
  const { sessionId = '' } = useParams();
  const { t, lang } = useI18n();
  const client = useResultsClient();
  const [prodWorld, setProdWorld] = useState<WorldCode>('A');
  const q = useQuery({
    queryKey: ['final', sessionId, client === instructorClient ? 'i' : 's'],
    queryFn: () => rpc<FinalResultsPayload>(client!, 'get_final_results', { p_session: sessionId }),
    enabled: Boolean(client),
    refetchInterval: 15000,
  });
  const d = q.data;

  const model = useMemo(() => {
    if (!d) return null;
    const worldCode = new Map(d.worlds.map((w) => [w.id, w.code]));
    const groupOf = (world: WorldCode, c: CountryCode) =>
      d.groups.find((g) => worldCode.get(g.world_id) === world && g.country_code === c);
    const finalOf = (gid?: string) => d.final_results.find((f) => f.group_id === gid);
    const periods = Array.from({ length: d.session?.total_periods ?? 10 }, (_, i) => i + 1);
    const wr = (world: WorldCode, n: number) => d.world_results.find((r) => worldCode.get(r.world_id) === world && r.period_number === n);
    return { worldCode, groupOf, finalOf, periods, wr };
  }, [d]);

  if (!client || q.isLoading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Loader2Icon className="size-8 animate-spin text-navy-700" />
      </div>
    );
  }

  const finished = d?.session?.status === 'finished';
  const isInstructor = client === instructorClient;

  const header = (
    <header className="no-print bg-navy-900">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3">
        <Link to="/">
          <Brand />
        </Link>
        <div className="flex items-center gap-2">
          <Button asChild variant="navGhost" size="sm">
            <Link to={isInstructor ? `/instructor/s/${sessionId}` : '/play'}>
              <ArrowLeftIcon /> {t('app.back')}
            </Link>
          </Button>
          <LanguageToggle dark />
        </div>
      </div>
    </header>
  );

  if (!d || !model || (!finished && !isInstructor) || d.final_results.length === 0) {
    return (
      <div className="min-h-dvh">
        {header}
        <main className="mx-auto max-w-3xl px-4 py-10">
          <Card>
            <CardContent className="flex items-center gap-3 py-8 text-muted-foreground">
              <TrophyIcon className="size-6" /> {t('final.notFinished')}
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  const { groupOf, finalOf, periods, wr } = model;
  const wealthRows = COUNTRY_ORDER.map((c) => {
    const row: Record<string, string | number | null> = { country: countryName(c, lang) };
    for (const w of WORLD_CODES) row[w] = finalOf(groupOf(w, c)?.id)?.final_wealth ?? null;
    return row;
  });
  const reserveRows = COUNTRY_ORDER.map((c) => {
    const row: Record<string, string | number | null> = { country: countryName(c, lang) };
    for (const w of WORLD_CODES) row[w] = finalOf(groupOf(w, c)?.id)?.remaining_reserves ?? null;
    return row;
  });
  const priceRows = periods.map((n) => {
    const row: Record<string, number | null> = { period: n };
    for (const w of WORLD_CODES) {
      const r = wr(w, n);
      row[`p_${w}`] = r ? Number(r.price) : null;
      row[`s_${w}`] = r ? Number(r.production_share) * 100 : null;
    }
    return row;
  });
  const prodRows = periods.map((n) => {
    const row: Record<string, number | null> = { period: n };
    for (const c of COUNTRY_ORDER) {
      const g = groupOf(prodWorld, c);
      const r = d.results.find((x) => x.group_id === g?.id && x.period_number === n);
      row[c] = r ? Number(r.production_pct) : null;
    }
    return row;
  });

  const worldStats = WORLD_CODES.map((w) => {
    const prices = periods.map((n) => wr(w, n)).filter(Boolean).map((r) => Number(r!.price));
    const shares = periods.map((n) => wr(w, n)).filter(Boolean).map((r) => Number(r!.production_share) * 100);
    const groups = d.groups.filter((g) => model.worldCode.get(g.world_id) === w);
    const total = groups.reduce((acc, g) => acc + Number(finalOf(g.id)?.final_wealth ?? 0), 0);
    const gaps: number[] = [];
    for (const p of d.pledges.filter((x) => model.worldCode.get(x.world_id) === w)) {
      const r = d.results.find((x) => x.group_id === p.group_id && x.period_number === p.period_number);
      if (r) gaps.push(Number(r.production_pct) - Number(p.pledge_pct));
    }
    const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    return { w, avgPrice: avg(prices), avgShare: avg(shares), total, gap: avg(gaps) };
  });
  const bestWorld = worldStats.reduce((a, b) => (b.total > a.total ? b : a));

  const strategy = d.cards.filter((c) => c.card_type !== 'audit');

  function downloadReport() {
    const rows = d!.groups.map((g) => {
      const f = finalOf(g.id);
      const c = d!.cards.find((x) => x.group_id === g.id && x.card_type !== 'audit');
      return {
        world: model!.worldCode.get(g.world_id),
        group: g.group_number,
        country: g.country_code,
        compounded_profits_musd: f?.total_fv,
        remaining_reserves_kb: f?.remaining_reserves,
        remaining_oil_value_musd: f?.terminal_value,
        card_costs_musd: f?.card_costs_nominal,
        final_wealth_musd: f?.final_wealth,
        rank_in_country: f?.rank_in_country,
        rank_in_world: f?.rank_in_world,
        strategy_card: c?.card_type ?? '',
        ...Object.fromEntries(
          periods.map((n) => [`p${n}_production_pct`, d!.results.find((x) => x.group_id === g.id && x.period_number === n)?.production_pct ?? '']),
        ),
      };
    });
    downloadText(`opec_final_report_${(d!.session?.name ?? 'session').replace(/[^\w-]+/g, '_')}.csv`, toCsv(rows));
  }

  return (
    <div className="min-h-dvh pb-12">
      {header}
      <main className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-widest text-gold-600 uppercase">{d.session?.name}</p>
            <h1 className="flex items-center gap-2 text-3xl font-bold text-navy-900">
              <TrophyIcon className="size-7 text-gold-500" /> {t('final.title')}
            </h1>
            {!finished && <Badge variant="warning">{t('country.estimatedWealth')}</Badge>}
          </div>
          <div className="no-print flex gap-2">
            <Button variant="outline" onClick={downloadReport}>
              <DownloadIcon /> {t('final.downloadCsv')}
            </Button>
            <Button variant="outline" onClick={() => window.print()}>
              <PrinterIcon /> {t('final.print')}
            </Button>
          </div>
        </div>

        <Card className="gap-2">
          <CardHeader>
            <CardTitle>{t('final.matrix')}</CardTitle>
            <CardDescription>{t('app.unitsNote')}</CardDescription>
          </CardHeader>
          <CardContent className="px-0 sm:px-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('app.country')}</TableHead>
                  {WORLD_CODES.map((w) => (
                    <TableHead key={w} className="text-right">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block size-2.5 rounded-full" style={{ background: WORLD_COLORS[w] }} />
                        {t('app.worldX', { w })}
                      </span>
                    </TableHead>
                  ))}
                  <TableHead>{t('final.winner')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {COUNTRY_ORDER.map((c) => {
                  const cells = WORLD_CODES.map((w) => finalOf(groupOf(w, c)?.id));
                  const winner = cells.findIndex((f) => f?.rank_in_country === 1);
                  return (
                    <TableRow key={c}>
                      <TableCell>
                        <span className="flex items-center gap-2 font-medium">
                          <Flag code={c} /> {countryName(c, lang)}
                        </span>
                      </TableCell>
                      {cells.map((f, i) => (
                        <TableCell key={i} className={cn('text-right', f?.rank_in_country === 1 && 'bg-accent font-bold text-navy-900')}>
                          {money(f?.final_wealth)}
                          <span className="ml-1 text-xs text-muted-foreground">#{f?.rank_in_country}</span>
                        </TableCell>
                      ))}
                      <TableCell>{winner >= 0 && <Badge variant="gold">🏆 {t('app.worldX', { w: WORLD_CODES[winner] })}</Badge>}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <ChartCard title={t('final.chartWealth')} description="USD">
          <WealthBars rows={wealthRows} />
        </ChartCard>

        <div className="grid gap-4 md:grid-cols-2">
          <ChartCard title={t('final.chartPrice')}>
            <SeriesChart
              data={priceRows}
              xKey="period"
              xFormatter={(v) => `P${v}`}
              series={WORLD_CODES.map((w) => ({ key: `p_${w}`, name: t('app.worldX', { w }), color: WORLD_COLORS[w] }))}
              yFormatter={(v) => `$${v}`}
              valueFormatter={(v) => price(v)}
            />
          </ChartCard>
          <ChartCard title={t('final.chartShare')}>
            <SeriesChart
              data={priceRows}
              xKey="period"
              xFormatter={(v) => `P${v}`}
              series={WORLD_CODES.map((w) => ({ key: `s_${w}`, name: t('app.worldX', { w }), color: WORLD_COLORS[w] }))}
              yFormatter={(v) => `${v.toFixed(0)}%`}
              valueFormatter={(v) => pct(v)}
            />
          </ChartCard>
        </div>

        <ChartCard
          title={t('final.chartProduction', { w: prodWorld })}
          description={`% ${t('results.share')}`}
          action={
            <div className="no-print flex gap-1">
              {WORLD_CODES.map((w) => (
                <Button key={w} size="sm" variant={w === prodWorld ? 'default' : 'outline'} onClick={() => setProdWorld(w)}>
                  {w}
                </Button>
              ))}
            </div>
          }
        >
          <SeriesChart
            data={prodRows}
            xKey="period"
            xFormatter={(v) => `P${v}`}
            series={COUNTRY_ORDER.map((c) => ({ key: c, name: countryName(c, lang), color: COUNTRY_COLORS[c] }))}
            yFormatter={(v) => `${v}%`}
            valueFormatter={(v) => pct(v)}
            yDomain={[0, 'auto']}
            height={280}
          />
        </ChartCard>

        <ChartCard title={t('final.chartReserves')} description="kb">
          <WealthBars rows={reserveRows} format={(v) => kb(v)} axis={(v) => num(v)} />
        </ChartCard>

        <Card className="gap-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ScaleIcon className="size-4" /> {t('final.coop')}
            </CardTitle>
            <CardDescription>{t('final.coopIntro')}</CardDescription>
          </CardHeader>
          <CardContent className="px-0 sm:px-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('app.world')}</TableHead>
                  <TableHead className="text-right">{t('final.avgShare')}</TableHead>
                  <TableHead className="text-right">{t('final.avgPrice')}</TableHead>
                  <TableHead className="text-right">{t('final.pledgeGap')}</TableHead>
                  <TableHead className="text-right">{t('final.totalWealth')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {worldStats.map((s) => (
                  <TableRow key={s.w} className={s.w === bestWorld.w ? 'bg-accent/60' : undefined}>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 font-medium">
                        <span className="inline-block size-2.5 rounded-full" style={{ background: WORLD_COLORS[s.w] }} />
                        {t('app.worldX', { w: s.w })} {s.w === bestWorld.w && '🏆'}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">{pct(s.avgShare)}</TableCell>
                    <TableCell className="text-right">{price(s.avgPrice)}</TableCell>
                    <TableCell className={cn('text-right', (s.gap ?? 0) > 1 && 'text-red-600')}>
                      {s.gap == null ? '—' : `${s.gap > 0 ? '+' : ''}${s.gap.toFixed(1)} pp`}
                    </TableCell>
                    <TableCell className="text-right font-semibold">{money(s.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="gap-2">
          <CardHeader>
            <CardTitle>{t('final.strategyCards')}</CardTitle>
          </CardHeader>
          <CardContent className="px-0 sm:px-2">
            {strategy.length === 0 ? (
              <p className="px-4 text-sm text-muted-foreground">{t('final.cardsNone')}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('app.country')}</TableHead>
                    <TableHead>{t('instructor.card')}</TableHead>
                    <TableHead className="text-right">{t('app.period')}</TableHead>
                    <TableHead className="text-right">{t('cards.cost')}</TableHead>
                    <TableHead>{t('cards.activation')}</TableHead>
                    <TableHead className="text-right">{t('final.wealth')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {strategy.map((c) => {
                    const g = d.groups.find((x) => x.id === c.group_id);
                    const hedgeTotal = d.results
                      .filter((r) => r.group_id === c.group_id)
                      .reduce((acc, r) => acc + Number(r.hedge_payout), 0);
                    const effect =
                      c.card_type === 'price_hedge'
                        ? `${t('results.hedge')}: ${money(hedgeTotal)}`
                        : c.card_type === 'eor'
                          ? `+${kb(c.details.bonus)}`
                          : `→ ${kb(c.details.new_capacity)}`;
                    return (
                      <TableRow key={c.id}>
                        <TableCell>
                          <span className="flex items-center gap-2">
                            <Badge variant="outline">{g && model.worldCode.get(g.world_id)}</Badge>
                            <Flag code={g?.country_code} /> {countryName(g?.country_code, lang)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="gold">{t(`cards.${c.card_type}`)}</Badge>
                        </TableCell>
                        <TableCell className="text-right">{c.purchased_period}</TableCell>
                        <TableCell className="text-right">{money(c.cost)}</TableCell>
                        <TableCell className="text-xs">
                          P{c.activation_period}
                          {c.end_period ? `–${c.end_period}` : ''} · {effect}
                        </TableCell>
                        <TableCell className="text-right">{money(finalOf(c.group_id)?.final_wealth)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="gap-2">
          <CardHeader>
            <CardTitle>{t('results.breakdown')}</CardTitle>
          </CardHeader>
          <CardContent className="px-0 sm:px-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('app.world')}</TableHead>
                  <TableHead>{t('app.country')}</TableHead>
                  <TableHead className="text-right">{t('final.totalFv')}</TableHead>
                  <TableHead className="text-right">{t('final.terminal')}</TableHead>
                  <TableHead className="text-right">{t('final.cards')}</TableHead>
                  <TableHead className="text-right">{t('final.wealth')}</TableHead>
                  <TableHead className="text-right">{t('final.rank')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {WORLD_CODES.flatMap((w) =>
                  COUNTRY_ORDER.map((c) => {
                    const f = finalOf(groupOf(w, c)?.id);
                    return (
                      <TableRow key={`${w}${c}`}>
                        <TableCell>{w}</TableCell>
                        <TableCell>
                          <span className="flex items-center gap-2">
                            <Flag code={c} /> {countryName(c, lang)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">{money(f?.total_fv)}</TableCell>
                        <TableCell className="text-right">{money(f?.terminal_value)}</TableCell>
                        <TableCell className="text-right">{Number(f?.card_costs_nominal) ? money(f?.card_costs_nominal) : '—'}</TableCell>
                        <TableCell className="text-right font-semibold">{money(f?.final_wealth)}</TableCell>
                        <TableCell className="text-right">{f?.rank_in_world}</TableCell>
                      </TableRow>
                    );
                  }),
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function WealthBars({
  rows,
  format = (v: number) => money(v),
  axis = (v: number) => money(v),
}: {
  rows: Record<string, string | number | null>[];
  format?: (v: number) => string;
  axis?: (v: number) => string;
}) {
  const { t } = useI18n();
  return (
    <SeriesChart
      data={rows}
      xKey="country"
      series={WORLD_CODES.map((w) => ({ key: w, name: t('app.worldX', { w }), color: WORLD_COLORS[w], type: 'bar' as const }))}
      yFormatter={axis}
      valueFormatter={(v) => format(v)}
      height={280}
      yDomain={[0, 'auto']}
    />
  );
}
