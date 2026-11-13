import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2Icon,
  ClockIcon,
  EyeIcon,
  GaugeIcon,
  Loader2Icon,
  FuelIcon,
  ScaleIcon,
  ShieldCheckIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  UsersRoundIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { studentClient } from '@/lib/supabase';
import { rpc } from '@/lib/rpc';
import { useErrorText, useI18n } from '@/lib/i18n';
import { cardCost, cardTimeline, eorBonus, hedgeVolume, type StrategyCard } from '@/lib/engine';
import { Flag, countryName } from '@/lib/countries';
import { kb, money, num, pct } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmAction } from '@/components/ConfirmAction';
import { Term } from '@/components/Term';
import { cn } from '@/lib/utils';
import { useStudent } from './context';
import { STUDENT_STATE_KEY } from './StudentApp';

const STRATEGY: Array<{ id: StrategyCard; icon: typeof FuelIcon }> = [
  { id: 'eor', icon: FuelIcon },
  { id: 'capacity_expansion', icon: GaugeIcon },
  { id: 'price_hedge', icon: ShieldCheckIcon },
];

function useRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: STUDENT_STATE_KEY });
}

export function StrategyCards() {
  const { s, cfg, openPeriod } = useStudent();
  const { t } = useI18n();
  const errorText = useErrorText();
  const refresh = useRefresh();
  const [busy, setBusy] = useState<string | null>(null);
  const owned = s.cards.find((c) => c.card_type !== 'audit');
  const period = openPeriod?.number ?? s.session.current_period + 1;
  const current = s.session.current_period;

  async function buy(card: StrategyCard) {
    setBusy(card);
    try {
      await rpc(studentClient, 'buy_strategy_card', { p_card: card });
      toast.success(t('cards.bought', { card: t(`cards.${card}`) }));
      refresh();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-3 md:grid-cols-3">
      {STRATEGY.map(({ id, icon: Icon }) => {
        const cost = cardCost(id, s.state.capacity, cfg);
        const tl = cardTimeline(id, period, s.session.total_periods, cfg);
        const mine = owned?.card_type === id ? owned : null;
        let effect = '';
        if (id === 'eor') effect = t('cards.eorEffect', { bonus: kb(eorBonus(s.state.original_reserves, cfg)) });
        if (id === 'capacity_expansion')
          effect = t('cards.capacityEffect', {
            from: num(s.state.base_capacity),
            to: num(Math.round(s.state.base_capacity * (1 + cfg.cards.capacity_expansion.capacity_increase))),
          });
        if (id === 'price_hedge')
          effect = t('cards.hedgeEffect', { strike: cfg.cards.price_hedge.strike, volume: kb(hedgeVolume(s.state.capacity, cfg)) });

        let status: { text: string; tone: 'success' | 'gold' | 'muted' | 'outline' } | null = null;
        if (mine) {
          const act = mine.activation_period ?? 0;
          if (current < act) status = { text: t('cards.pending', { n: act }), tone: 'gold' };
          else if (mine.end_period != null && current > mine.end_period) status = { text: t('cards.expired'), tone: 'muted' };
          else if (mine.end_period != null)
            status = { text: `${t('cards.active')} · ${t('cards.remainingDuration', { n: mine.end_period - current + 1 })}`, tone: 'success' };
          else status = { text: t('cards.active'), tone: 'success' };
        }

        const disabledReason = mine
          ? null
          : owned
            ? t('cards.otherOwned', { card: t(`cards.${owned.card_type}`) })
            : !openPeriod
              ? t('cards.needOpenPeriod')
              : tl.tooLate
                ? t('cards.tooLate', { n: s.session.total_periods })
                : null;

        return (
          <Card key={id} className={cn('gap-3 py-4', mine && 'border-oil-600/50 ring-2 ring-oil-600/20')}>
            <CardHeader className="px-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="grid size-9 place-items-center rounded-lg bg-navy-900 text-gold-400">
                    <Icon className="size-5" />
                  </div>
                  <div>
                    <CardTitle className="text-sm">
                      {id === 'price_hedge' ? <Term k="hedge">{t(`cards.${id}`)}</Term> : t(`cards.${id}`)}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {t('cards.strategy')} · {t('cards.oncePerGame')}
                    </CardDescription>
                  </div>
                </div>
                {status && <Badge variant={status.tone}>{status.text}</Badge>}
              </div>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3 px-4 text-sm">
              <p className="text-muted-foreground">{effect}</p>
              <dl className="grid grid-cols-3 gap-2 rounded-lg bg-muted/60 p-2 text-xs">
                <div>
                  <dt className="text-muted-foreground">{t('cards.cost')}</dt>
                  <dd className="font-semibold text-navy-900">{money(mine ? mine.cost : cost)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t('cards.activation')}</dt>
                  <dd className="font-semibold text-navy-900">
                    {t('app.periodN', { n: mine?.activation_period ?? tl.activationPeriod })}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t('cards.duration')}</dt>
                  <dd className="font-semibold text-navy-900">
                    {id === 'price_hedge'
                      ? t('cards.durationPeriods', {
                          n: mine && mine.end_period && mine.activation_period ? mine.end_period - mine.activation_period + 1 : tl.activePeriods,
                        })
                      : id === 'eor'
                        ? t('cards.oneTime')
                        : t('cards.permanent')}
                  </dd>
                </div>
              </dl>
              <div className="mt-auto">
                {mine ? (
                  <div className="flex items-center gap-2 text-sm font-medium text-oil-600">
                    <CheckCircle2Icon className="size-4" /> {t('cards.owned')}
                  </div>
                ) : (
                  <>
                    <ConfirmAction
                      trigger={
                        <Button className="w-full" variant="gold" disabled={Boolean(disabledReason) || busy !== null}>
                          {busy === id && <Loader2Icon className="animate-spin" />}
                          {t('cards.buy')} · {money(cost)}
                        </Button>
                      }
                      title={t('cards.confirmTitle', { card: t(`cards.${id}`) })}
                      description={`${t('cards.confirmBody', { cost: money(cost) })} ${t('cards.onlyOneStrategy')}`}
                      onConfirm={() => buy(id)}
                    >
                      <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                        <p className="mb-2">{effect}</p>
                        <p className="text-xs text-muted-foreground">
                          {t('cards.activation')}: {t('app.periodN', { n: tl.activationPeriod })}
                          {tl.endPeriod != null && ` – ${tl.endPeriod}`} · {t('cards.cost')}: {money(cost)}
                        </p>
                      </div>
                    </ConfirmAction>
                    {disabledReason && <p className="mt-1.5 text-xs text-muted-foreground">{disabledReason}</p>}
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export function AuditPanel() {
  const { s, cfg, openPeriod, lastClosed } = useStudent();
  const { t, lang } = useI18n();
  const errorText = useErrorText();
  const refresh = useRefresh();
  const [target, setTarget] = useState<string>('');
  const [period, setPeriod] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const audit = s.audits[0];
  const cost = cardCost('audit', s.state.capacity, cfg);
  const others = s.roster.filter((r) => r.group_id !== s.group.id);
  const closedPeriods = s.periods.filter((p) => p.status === 'closed').map((p) => p.number);
  const targetCountry = others.find((o) => o.group_id === target)?.country_code;

  async function run() {
    setBusy(true);
    try {
      const r = await rpc<{ production_pct: number; target_country: any; target_period: number }>(studentClient, 'use_audit', {
        p_target_group: target,
        p_period: Number(period),
      });
      toast.success(
        t('cards.auditResult', { country: countryName(r.target_country, lang), period: r.target_period, pct: pct(r.production_pct) }),
        { duration: 12000 },
      );
      refresh();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="grid size-9 place-items-center rounded-lg bg-violet-100 text-violet-700">
              <EyeIcon className="size-5" />
            </div>
            <div>
              <CardTitle className="text-sm">
                <Term k="audit">{t('cards.audit')}</Term>
              </CardTitle>
              <CardDescription className="text-xs">
                {t('cards.action')} · {t('cards.oncePerGame')} · {money(cost)}
              </CardDescription>
            </div>
          </div>
          {audit && <Badge variant="muted">{t('cards.used')}</Badge>}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4 text-sm">
        <p className="text-muted-foreground">{t('cards.auditEffect')}</p>
        {audit ? (
          <div className="flex items-center gap-3 rounded-lg border border-violet-200 bg-violet-50 p-3">
            <Flag code={audit.target_country} />
            <span>
              {t('cards.auditResult', {
                country: countryName(audit.target_country, lang),
                period: audit.target_period,
                pct: pct(audit.production_pct),
              })}
            </span>
          </div>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger aria-label={t('cards.auditTarget')}>
                  <SelectValue placeholder={t('cards.auditTarget')} />
                </SelectTrigger>
                <SelectContent>
                  {others.map((o) => (
                    <SelectItem key={o.group_id} value={o.group_id}>
                      <span className="flex items-center gap-2">
                        <Flag code={o.country_code} /> {countryName(o.country_code, lang)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={period} onValueChange={setPeriod} disabled={closedPeriods.length === 0}>
                <SelectTrigger aria-label={t('cards.auditPeriod')}>
                  <SelectValue placeholder={t('cards.auditPeriod')} />
                </SelectTrigger>
                <SelectContent>
                  {closedPeriods.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {t('app.periodN', { n })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <ConfirmAction
              trigger={
                <Button variant="outline" disabled={!openPeriod || !target || !period || busy || lastClosed === 0}>
                  {busy && <Loader2Icon className="animate-spin" />}
                  {t('cards.auditUse')} · {money(cost)}
                </Button>
              }
              title={t('cards.auditUse')}
              description={t('cards.auditConfirm', { country: countryName(targetCountry, lang), period, cost: money(cost) })}
              onConfirm={run}
            />
            {!openPeriod && <p className="text-xs text-muted-foreground">{t('cards.needOpenPeriod')}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function JprPanel() {
  const { s, cfg, lastClosed } = useStudent();
  const { t } = useI18n();
  const errorText = useErrorText();
  const refresh = useRefresh();
  const [busy, setBusy] = useState(false);
  const requests = s.jpr_requests;
  const approved = requests.find((r) => r.status === 'approved');
  const voting = requests.find((r) => r.status === 'voting');
  const rejected = requests.filter((r) => r.status === 'rejected');
  const voted = useMemo(() => new Set(s.jpr_my_votes.map((v) => v.request_id)), [s.jpr_my_votes]);
  const need = cfg.cards.jpr.required_yes;

  async function call(fn: string, args: Record<string, unknown> = {}) {
    setBusy(true);
    try {
      await rpc(studentClient, fn, args);
      refresh();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="grid size-9 place-items-center rounded-lg bg-emerald-100 text-emerald-700">
              <UsersRoundIcon className="size-5" />
            </div>
            <div>
              <CardTitle className="text-sm">{t('cards.jpr')}</CardTitle>
              <CardDescription className="text-xs">
                {t('cards.action')} · {t('cards.oncePerWorld')} · {t('cards.free')}
              </CardDescription>
            </div>
          </div>
          {approved && <Badge variant="success">{t('cards.used')}</Badge>}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4 text-sm">
        <p className="text-muted-foreground">{t('cards.jprEffect', { n: need })}</p>
        {approved ? (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-800">
            <CheckCircle2Icon className="size-4" />
            {t('cards.jprApproved', { periods: (approved.revealed_periods ?? []).join(', ') })}
          </div>
        ) : voting ? (
          <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3">
            <div className="flex items-center gap-2 font-medium">
              <ScaleIcon className="size-4" />
              {t('cards.jprVoting', { yes: voting.yes_count, no: voting.no_count, n: voting.required_yes })}
            </div>
            <div className="flex gap-1" aria-hidden>
              {Array.from({ length: 7 }, (_, i) => (
                <span
                  key={i}
                  className={cn(
                    'h-2 flex-1 rounded-full',
                    i < voting.yes_count ? 'bg-oil-600' : i >= 7 - voting.no_count ? 'bg-red-500' : 'bg-muted',
                  )}
                />
              ))}
            </div>
            {voted.has(voting.id) ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ClockIcon className="size-3.5" /> {t('cards.jprVoted')}
              </p>
            ) : (
              <div className="flex gap-2">
                <Button size="sm" variant="success" disabled={busy} onClick={() => call('vote_jpr', { p_request: voting.id, p_vote: true })}>
                  <ThumbsUpIcon /> {t('cards.jprVoteYes')}
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => call('vote_jpr', { p_request: voting.id, p_vote: false })}>
                  <ThumbsDownIcon /> {t('cards.jprVoteNo')}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <>
            {rejected.length > 0 && <p className="text-xs text-muted-foreground">{t('cards.jprRejected')}</p>}
            <ConfirmAction
              trigger={
                <Button variant="outline" disabled={busy || lastClosed === 0 || s.session.status !== 'running'}>
                  {busy && <Loader2Icon className="animate-spin" />}
                  {t('cards.jprRequest')}
                </Button>
              }
              title={t('cards.jpr')}
              description={t('cards.jprConfirm', { n: need })}
              onConfirm={() => call('request_jpr')}
            />
            {lastClosed === 0 && <p className="text-xs text-muted-foreground">{t('cards.jprNeedsClosed')}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
