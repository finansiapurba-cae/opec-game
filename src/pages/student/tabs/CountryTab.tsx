import { CoinsIcon, DollarSignIcon, DropletsIcon, FactoryIcon, LandmarkIcon, PickaxeIcon } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { Flag, countryName } from '@/lib/countries';
import { kb, money, num, pct, price } from '@/lib/format';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatTile } from '@/components/StatTile';
import { HintIcon, Term } from '@/components/Term';
import { cn } from '@/lib/utils';
import { useStudent } from '../context';
import { AuditPanel, JprPanel, StrategyCards } from '../cards';

export function CountryTab() {
  const { s } = useStudent();
  const { t, lang } = useI18n();
  const st = s.state;
  const totalReserves = Number(st.original_reserves) + Number(st.reserves_bonus);
  const extracted = Number(st.cumulative_production);
  const remaining = Number(st.remaining_reserves);
  const extractedPct = totalReserves > 0 ? (extracted / totalReserves) * 100 : 0;

  return (
    <div className="flex flex-col gap-4">
      <Card className="overflow-hidden py-0">
        <div className="flex flex-col gap-4 bg-gradient-to-r from-navy-900 to-navy-700 p-5 text-white sm:flex-row sm:items-center">
          <Flag code={s.country.code} className="h-14 w-[4.66rem] rounded-md ring-2 ring-white/20" />
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-bold tracking-tight">{countryName(s.country.code, lang)}</h2>
            <div className="mt-1 flex flex-wrap gap-2 text-sm">
              <Badge className="bg-gold-500 text-navy-950">{t('app.worldX', { w: s.world.code })}</Badge>
              <Badge variant="navOutline">{t('app.groupN', { n: s.group.group_number })}</Badge>
              <Badge variant="navOutline">
                {s.session.current_period > 0
                  ? `${t('app.periodN', { n: s.session.current_period })} / ${s.session.total_periods}`
                  : t('header.lobby')}
              </Badge>
            </div>
          </div>
          <div className="rounded-xl bg-white/10 px-4 py-3 text-right">
            <div className="flex items-center justify-end gap-1 text-xs text-white/70">
              {t('country.estimatedWealth')}
            </div>
            <div className="text-2xl font-bold text-gold-300 tabular">{money(st.estimated_wealth)}</div>
          </div>
        </div>
        <CardContent className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
          <StatTile icon={<DropletsIcon className="size-4" />} label={<Term k="reserves">{t('country.initialReserves')}</Term>} value={kb(st.original_reserves)} />
          <StatTile
            icon={<DropletsIcon className="size-4" />}
            label={t('country.remainingReserves')}
            value={kb(remaining)}
            sub={Number(st.reserves_bonus) > 0 ? `${t('country.eorBonus')}: +${num(st.reserves_bonus)} kb` : undefined}
          />
          <StatTile
            icon={<FactoryIcon className="size-4" />}
            label={<Term k="capacity">{t('country.capacity')}</Term>}
            value={kb(st.capacity)}
            sub={Number(st.capacity) !== Number(st.base_capacity) ? `${num(st.base_capacity)} → ${num(st.capacity)}` : undefined}
          />
          <StatTile icon={<DollarSignIcon className="size-4" />} label={<Term k="marginalCost">{t('country.marginalCost')}</Term>} value={price(st.marginal_cost)} />
          <StatTile icon={<CoinsIcon className="size-4" />} label={<Term k="profit">{t('country.cumulativeProfit')}</Term>} value={money(st.cumulative_profit)} />
          <StatTile
            icon={<LandmarkIcon className="size-4" />}
            tone="gold"
            label={
              <span className="inline-flex items-center gap-1">
                <Term k="finalWealth">{t('country.estimatedWealth')}</Term>
              </span>
            }
            value={money(st.estimated_wealth)}
            sub={
              <span className="inline-flex items-center gap-1">
                {t('country.estimatedWealthHint')}
              </span>
            }
            className="col-span-2"
          />
        </CardContent>
      </Card>

      <Card className="gap-3">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <PickaxeIcon className="size-4" /> {t('country.reservesBar')}
            <HintIcon text={t('glossary.reservesDef')} />
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div
            className="flex h-7 w-full overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={`${t('country.extracted')} ${pct(extractedPct)}, ${t('country.remaining')} ${pct(100 - extractedPct)}`}
          >
            <div className="h-full bg-navy-700 transition-all" style={{ width: `${extractedPct}%` }} />
            <div className="h-full flex-1 bg-gradient-to-r from-gold-500 to-gold-300" />
          </div>
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <span className="flex items-center gap-2">
              <span className="inline-block size-3 rounded-sm bg-navy-700" />
              {t('country.extracted')}: <strong className="tabular">{kb(extracted)}</strong> ({pct(extractedPct)})
            </span>
            <span className="flex items-center gap-2">
              <span className="inline-block size-3 rounded-sm bg-gold-500" />
              {t('country.remaining')}: <strong className="tabular">{kb(remaining)}</strong> ({pct(100 - extractedPct)})
            </span>
          </div>
        </CardContent>
      </Card>

      <div>
        <h3 className="mb-1 text-base font-semibold text-navy-900">{t('country.cardsTitle')}</h3>
        <p className="mb-3 text-sm text-muted-foreground">
          {t('country.cardsSubtitle')} {t('cards.onlyOneStrategy')}
        </p>
        <StrategyCards />
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <AuditPanel />
          <JprPanel />
        </div>
      </div>

      <Card className="gap-3">
        <CardHeader>
          <CardTitle className="text-base">{t('country.roster', { w: s.world.code })}</CardTitle>
          <CardDescription>
            <Term k="cartel" />
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {s.roster.map((r) => (
              <li
                key={r.group_id}
                className={cn('flex items-center gap-2 rounded-lg border px-3 py-2 text-sm', r.group_id === s.group.id && 'border-gold-500 bg-accent/50')}
              >
                <Flag code={r.country_code} />
                <span className="min-w-0 flex-1 truncate">{countryName(r.country_code, lang)}</span>
                {r.group_id === s.group.id && <Badge variant="gold">{t('app.you')}</Badge>}
                <span
                  title={r.online ? t('country.online') : undefined}
                  className={cn('size-2 rounded-full', r.online ? 'bg-oil-500' : 'bg-muted-foreground/30')}
                />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
