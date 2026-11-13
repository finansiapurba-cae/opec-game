import { Link } from 'react-router-dom';
import { DownloadIcon, TrophyIcon } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { COUNTRY_ORDER, Flag, WORLD_CODES, countryName } from '@/lib/countries';
import { downloadText, toCsv } from '@/lib/csv';
import { money } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { useInstructor } from '../context';
import { STANDALONE } from '@/lib/supabase';

export function ResultsPanel() {
  const { st, worldById, groupById, cfg } = useInstructor();
  const { t, lang } = useI18n();
  const slug = st.session.name.replace(/[^\w-]+/g, '_');
  const wealth = (code: string, w: string) => {
    const g = st.groups.find((x) => x.country_code === code && worldById.get(x.world_id)?.code === w);
    const f = st.final_results.find((x) => x.group_id === g?.id);
    const s = st.states.find((x) => x.group_id === g?.id);
    return f ? Number(f.final_wealth) : s ? Number(s.estimated_wealth) : null;
  };

  function exportPeriods() {
    const rows = st.results.map((r) => {
      const g = groupById.get(r.group_id)!;
      const wr = st.world_results.find((x) => x.world_id === r.world_id && x.period_number === r.period_number);
      const pl = st.pledges.find((x) => x.group_id === r.group_id && x.period_number === r.period_number);
      return {
        session: st.session.name,
        world: worldById.get(r.world_id)?.code,
        group: g.group_number,
        country: r.country_code,
        period: r.period_number,
        demand: wr?.demand_type,
        demand_factor: wr?.demand_factor,
        world_total_kb: wr?.total_production,
        price_usd_bbl: r.price,
        production_kb: r.production,
        capacity_kb: r.capacity,
        production_pct: r.production_pct,
        pledge_pct: pl?.pledge_pct ?? '',
        auto_submitted: r.auto_submitted,
        revenue_musd: r.revenue,
        cost_musd: r.production_cost,
        profit_musd: r.profit,
        hedge_musd: r.hedge_payout,
        card_cost_musd: r.card_cost,
        fv_factor: r.fv_factor,
        fv_musd: r.fv_amount,
        cumulative_fv_musd: r.cumulative_fv,
        remaining_reserves_kb: r.remaining_reserves,
        estimated_wealth_musd: r.estimated_wealth,
      };
    });
    downloadText(`${slug}_period_results.csv`, toCsv(rows));
  }

  function exportFinal() {
    const rows = st.groups.map((g) => {
      const f = st.final_results.find((x) => x.group_id === g.id);
      const s = st.states.find((x) => x.group_id === g.id);
      const card = st.cards.find((c) => c.group_id === g.id && c.card_type !== 'audit');
      return {
        session: st.session.name,
        world: worldById.get(g.world_id)?.code,
        group: g.group_number,
        country: g.country_code,
        compounded_profits_musd: f?.total_fv ?? s?.cumulative_fv,
        remaining_reserves_kb: f?.remaining_reserves ?? s?.remaining_reserves,
        remaining_oil_value_musd: f?.terminal_value ?? '',
        card_costs_musd: f?.card_costs_nominal ?? s?.card_costs,
        final_wealth_musd: f?.final_wealth ?? s?.estimated_wealth,
        rank_in_country: f?.rank_in_country ?? '',
        rank_in_world: f?.rank_in_world ?? '',
        strategy_card: card?.card_type ?? '',
        card_cost_mode: cfg.accounting.card_cost_mode,
      };
    });
    downloadText(`${slug}_final_results.csv`, toCsv(rows));
  }

  function exportPledgesCards() {
    const rows = [
      ...st.pledges.map((p) => ({
        type: 'pledge',
        world: worldById.get(p.world_id)?.code,
        group: groupById.get(p.group_id)?.group_number,
        country: p.country_code,
        period: p.period_number,
        value: p.pledge_pct,
        detail: `revision ${p.revision}`,
      })),
      ...st.cards.map((c) => ({
        type: c.card_type,
        world: worldById.get(c.world_id)?.code,
        group: groupById.get(c.group_id)?.group_number,
        country: groupById.get(c.group_id)?.country_code,
        period: c.purchased_period,
        value: c.cost,
        detail: JSON.stringify({ activation: c.activation_period, end: c.end_period, ...c.details }),
      })),
    ];
    downloadText(`${slug}_pledges_cards.csv`, toCsv(rows));
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className={STANDALONE ? 'hidden' : undefined}>
        <CardHeader>
          <CardTitle>{t('instructor.exportCsv')}</CardTitle>
          <CardDescription>{t('app.unitsNote')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportPeriods} disabled={st.results.length === 0}>
            <DownloadIcon /> {t('instructor.exportPeriods')}
          </Button>
          <Button variant="outline" onClick={exportFinal}>
            <DownloadIcon /> {t('instructor.exportFinal')}
          </Button>
          <Button variant="outline" onClick={exportPledgesCards}>
            <DownloadIcon /> {t('instructor.exportPledges')}
          </Button>
          <Button asChild variant="gold" className="ml-auto">
            <Link to={`/results/${st.session.id}`}>
              <TrophyIcon /> {t('instructor.openFinal')}
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card className="gap-2">
        <CardHeader>
          <CardTitle>{st.session.status === 'finished' ? t('final.matrix') : `${t('final.matrix')} (${t('country.estimatedWealth')})`}</CardTitle>
        </CardHeader>
        <CardContent className="px-0 sm:px-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('app.country')}</TableHead>
                {WORLD_CODES.map((w) => (
                  <TableHead key={w} className="text-right">
                    {t('app.worldX', { w })}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {COUNTRY_ORDER.map((c) => {
                const vals = WORLD_CODES.map((w) => wealth(c, w));
                const best = Math.max(...vals.map((v) => v ?? -Infinity));
                return (
                  <TableRow key={c}>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <Flag code={c} /> {countryName(c, lang)}
                      </span>
                    </TableCell>
                    {vals.map((v, i) => (
                      <TableCell key={i} className={cn('text-right', v === best && v != null && 'bg-accent font-bold text-navy-900')}>
                        {v === best && v != null && '🏆 '}
                        {money(v)}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="gap-2">
        <CardHeader>
          <CardTitle>{t('instructor.configTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="max-h-80 overflow-auto rounded-lg bg-navy-950 p-3 text-xs text-white/85">{JSON.stringify(st.session.config, null, 2)}</pre>
        </CardContent>
      </Card>
    </div>
  );
}
