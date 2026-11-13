import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2Icon, CircleDashedIcon, FlagIcon, HandshakeIcon, Loader2Icon, LockIcon, SendIcon, ZapIcon } from 'lucide-react';
import { toast } from 'sonner';
import { studentClient } from '@/lib/supabase';
import { rpc } from '@/lib/rpc';
import { useErrorText, useI18n } from '@/lib/i18n';
import {
  REFERENCE_CAPACITY,
  computePrice,
  fvFactor,
  hedgePayout,
  maxProduction,
  periodProfit,
  productionCostM,
  revenueM,
} from '@/lib/engine';
import { kb, money, num, pct, price, timeOfDay } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Gauge } from '@/components/Gauge';
import { HintIcon, Term } from '@/components/Term';
import { useStudent } from '../context';
import { STUDENT_STATE_KEY } from '../StudentApp';

export function ProductionTab() {
  const { s, cfg, openPeriod, offset } = useStudent();
  const { t } = useI18n();
  const errorText = useErrorText();
  const qc = useQueryClient();
  const st = s.state;
  const capacity = Number(st.capacity);
  const limit = maxProduction(capacity, Number(st.remaining_reserves));
  const limitPct = capacity > 0 ? (limit / capacity) * 100 : 0;
  const n = openPeriod?.number ?? s.session.current_period;
  const submission = s.submissions.find((x) => x.period_number === n);
  const pledge = s.pledges.find((p) => p.group_id === s.group.id && p.period_number === n);
  const expired = openPeriod?.closes_at ? new Date(openPeriod.closes_at).getTime() <= Date.now() + offset : false;
  const isOpen = Boolean(openPeriod) && !expired;

  const [qty, setQty] = useState<number>(() => Number(submission?.production ?? st.last_production ?? Math.round(limit * 0.8)));
  const [others, setOthers] = useState<number | null>(null);
  const [pledgeVal, setPledgeVal] = useState<string>(pledge ? String(pledge.pledge_pct) : '');
  const [busy, setBusy] = useState<'prod' | 'pledge' | null>(null);

  // when the period changes, start from the saved submission or the previous output
  useEffect(() => {
    setQty(Math.min(limit, Number(submission?.production ?? st.last_production ?? Math.round(limit * 0.8))));
    setOthers(null);
    setPledgeVal(pledge ? String(pledge.pledge_pct) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);

  const qtyClamped = Math.max(0, Math.min(limit, Math.round(Number.isFinite(qty) ? qty : 0)));
  const myPct = capacity > 0 ? (qtyClamped / capacity) * 100 : 0;
  const othersPct = others ?? Math.round(myPct);

  const est = useMemo(() => {
    const othersCapacity = REFERENCE_CAPACITY - Number(st.base_capacity);
    const total = qtyClamped + (othersPct / 100) * othersCapacity;
    const demandType = openPeriod?.demand_type ?? (n % 2 === 1 ? 'low' : 'high');
    const p = computePrice({ totalProduction: total, demandType, demandFactor: Number(openPeriod?.event_multiplier ?? 1) }, cfg);
    const hedgeCard = s.cards.find((c) => c.card_type === 'price_hedge' && c.activation_period != null && c.end_period != null && n >= c.activation_period && n <= c.end_period);
    const hedge = hedgeCard ? hedgePayout(p, Number(hedgeCard.details.volume), Number(hedgeCard.details.strike)) : 0;
    const profit = periodProfit(p, Number(st.marginal_cost), qtyClamped);
    return {
      price: p,
      revenue: revenueM(p, qtyClamped),
      cost: productionCostM(Number(st.marginal_cost), qtyClamped),
      profit,
      hedge,
      fv: (profit + hedge) * fvFactor(Math.max(1, n), s.session.total_periods, cfg),
    };
  }, [qtyClamped, othersPct, st.base_capacity, st.marginal_cost, openPeriod, n, cfg, s.cards, s.session.total_periods]);

  async function submit() {
    setBusy('prod');
    try {
      await rpc(studentClient, 'submit_production', { p_production: qtyClamped, p_period: n });
      toast.success(t('production.productionSaved', { q: kb(qtyClamped) }));
      await qc.invalidateQueries({ queryKey: STUDENT_STATE_KEY });
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function submitPledge() {
    setBusy('pledge');
    try {
      await rpc(studentClient, 'submit_pledge', { p_pct: Number(pledgeVal), p_period: n });
      toast.success(t('production.pledgeSaved'));
      await qc.invalidateQueries({ queryKey: STUDENT_STATE_KEY });
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  if (s.session.status === 'finished') {
    return <Notice text={t('production.finished')} />;
  }
  if (s.session.current_period === 0) {
    return <Notice text={t('production.lobby')} />;
  }

  const event = s.events.find((e) => e.effective_period === n);
  const pledgeStart = cfg.pledge.start_period;
  const pledgeNum = Number(pledgeVal);
  const pledgeValid = pledgeVal !== '' && pledgeNum >= 0 && pledgeNum <= 100;

  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-lg">{t('production.title', { n })}</CardTitle>
            <div className="flex flex-wrap gap-1.5">
              {openPeriod && (
                <Badge variant={openPeriod.demand_type === 'high' ? 'success' : 'warning'}>
                  {t('production.demandThis', { d: t(openPeriod.demand_type === 'high' ? 'header.demandHigh' : 'header.demandLow') })}
                </Badge>
              )}
              {event && (
                <Badge variant="destructive">
                  <ZapIcon /> {t('production.eventActive', { e: t(`instructor.${event.event_type}`) })}
                </Badge>
              )}
            </div>
          </div>
          {!isOpen && (
            <CardDescription className="flex items-center gap-2 text-sm">
              <LockIcon className="size-4" /> {openPeriod ? t('production.locked') : t('production.notOpen')}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid items-center gap-4 sm:grid-cols-[200px_1fr]">
            <div className="flex justify-center">
              <Gauge value={myPct} marker={pledge ? Number(pledge.pledge_pct) : null} label={t('production.share')} />
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="qty">{t('production.quantity')}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="qty"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={limit}
                    step={1}
                    value={Number.isFinite(qty) ? qty : ''}
                    disabled={!isOpen}
                    onChange={(e) => setQty(e.target.value === '' ? 0 : Number(e.target.value))}
                    aria-invalid={qty > limit || qty < 0}
                    className="text-lg font-semibold tabular"
                  />
                  <span className="text-sm text-muted-foreground">kb</span>
                </div>
                {qty > limit && <p className="text-xs text-red-600">{t('errors.exceeds_limit')}</p>}
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-sm">
                  <Label>
                    <Term k="capacity">{t('production.share')}</Term>
                  </Label>
                  <span className="font-semibold tabular">{pct(myPct)}</span>
                </div>
                <Slider
                  value={[Math.min(myPct, limitPct)]}
                  min={0}
                  max={100}
                  step={1}
                  disabled={!isOpen}
                  onValueChange={([v]) => setQty(Math.min(limit, Math.round((Math.min(v, limitPct) / 100) * capacity)))}
                  aria-label={t('production.share')}
                />
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>0%</span>
                  <span>50%</span>
                  <span>100%</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-muted/70 px-3 py-2 text-sm">
                <span className="text-muted-foreground">{t('production.max')}:</span>
                <strong className="tabular">{kb(limit)}</strong>
                <span className="text-muted-foreground">({pct(limitPct)})</span>
                <HintIcon text={t('production.maxHint')} />
                <span className="ml-auto text-xs text-muted-foreground">
                  {t('country.remainingReserves')}: {kb(st.remaining_reserves)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2 text-sm">
              {submission ? (
                <>
                  <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-oil-600" />
                  <div>
                    <div className="font-medium text-oil-600">
                      {t('production.submitted')}: {kb(submission.production)} ({pct(submission.production_pct)})
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t('production.submittedAt', { time: timeOfDay(submission.updated_at), rev: submission.revision })}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <CircleDashedIcon className="mt-0.5 size-4 shrink-0 text-gold-600" />
                  <div>
                    <div className="font-medium">{t('production.notSubmitted')}</div>
                    <div className="text-xs text-muted-foreground">
                      {st.last_production != null
                        ? t('production.willRepeat', { q: kb(Math.min(Number(st.last_production), limit)) })
                        : t('production.willZero', {
                            q: kb(Math.min(limit, Math.round((cfg.production.missing_first_period_pct / 100) * capacity))),
                          })}
                    </div>
                  </div>
                </>
              )}
            </div>
            <Button size="lg" variant="gold" disabled={!isOpen || busy !== null || qty > limit || qty < 0} onClick={submit}>
              {busy === 'prod' ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
              {submission ? t('production.update') : t('production.submit')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        <Card className="gap-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              {t('production.estimateTitle')}
              <Badge variant="muted">{t('app.estimate')}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1">
                  {t('production.othersAt')} <HintIcon text={t('production.othersAtHint')} />
                </span>
                <span className="font-semibold tabular">{othersPct}%</span>
              </div>
              <Slider value={[othersPct]} min={0} max={100} step={1} onValueChange={([v]) => setOthers(v)} rangeClassName="bg-navy-600" aria-label={t('production.othersAt')} />
            </div>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <Est label={t('production.estPrice')} value={price(est.price)} strong />
              <Est label={t('production.estRevenue')} value={money(est.revenue)} />
              <Est label={<Term k="marginalCost">{t('production.estCost')}</Term>} value={money(est.cost)} />
              <Est label={<Term k="profit">{t('production.estProfit')}</Term>} value={money(est.profit)} strong />
              {est.hedge > 0 && <Est label={t('results.hedge')} value={money(est.hedge, { sign: true })} />}
              <Est label={t('production.estFv')} value={money(est.fv)} />
            </dl>
            <p className="text-xs text-muted-foreground">
              {t('production.estDisclaimer', {
                mode: cfg.price.extrapolation === 'linear' ? t('instructor.extrapLinear') : t('instructor.extrapClamp'),
              })}
            </p>
          </CardContent>
        </Card>

        <Card className="gap-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <HandshakeIcon className="size-4" /> <Term k="pledge">{t('production.pledgeTitle')}</Term>
            </CardTitle>
            <CardDescription>{t('production.pledgeHint')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {n < pledgeStart ? (
              <p className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                <LockIcon className="size-4" /> {t('production.pledgeLocked', { n: pledgeStart })}
              </p>
            ) : (
              <>
                {pledge && (
                  <p className="flex items-center gap-2 text-sm">
                    <FlagIcon className="size-4 text-gold-600" />
                    {t('production.pledgeCurrent', { n, p: pct(pledge.pledge_pct) })}
                  </p>
                )}
                <div className="flex items-end gap-2">
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Label htmlFor="pledge">{t('production.pledgeLabel')}</Label>
                    <Input
                      id="pledge"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={100}
                      step={1}
                      value={pledgeVal}
                      disabled={!isOpen}
                      onChange={(e) => setPledgeVal(e.target.value)}
                      aria-invalid={pledgeVal !== '' && !pledgeValid}
                    />
                  </div>
                  <Button variant="outline" disabled={!isOpen || !pledgeValid || busy !== null} onClick={submitPledge}>
                    {busy === 'pledge' && <Loader2Icon className="animate-spin" />}
                    {pledge ? t('production.pledgeUpdate') : t('production.pledgeSubmit')}
                  </Button>
                </div>
                {submission && (
                  <p className="text-xs text-muted-foreground">
                    {t('production.pledgeVsActual', { p: pct(submission.production_pct) })} ({num(submission.production)} kb)
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Est({ label, value, strong }: { label: React.ReactNode; value: string; strong?: boolean }) {
  return (
    <div className="rounded-lg bg-muted/60 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={strong ? 'text-lg font-semibold text-navy-900 tabular' : 'font-medium tabular'}>{value}</dd>
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-6 text-muted-foreground">
        <LockIcon className="size-5" /> {text}
      </CardContent>
    </Card>
  );
}
