import {
  BellIcon,
  CalendarClockIcon,
  CreditCardIcon,
  GlobeIcon,
  LightbulbIcon,
  MegaphoneIcon,
  SearchCheckIcon,
  ZapIcon,
} from 'lucide-react';
import type { Notice, NoticeCategory } from '@/lib/types';
import { useI18n } from '@/lib/i18n';
import { countryName } from '@/lib/countries';
import { kb, money, pct, price } from '@/lib/format';

export function useNoticeText() {
  const { t, lang } = useI18n();
  const demand = (d: string) => t(d === 'high' ? 'header.demandHigh' : 'header.demandLow');
  const change = (c: number) => `${c > 0 ? '+' : ''}${(Number(c) * 100).toFixed(0)}%`;
  return (n: Notice): string => {
    const p = n.payload ?? {};
    switch (n.kind) {
      case 'announcement':
        return n.body ?? '';
      case 'period_opened':
        return t('notice.period_opened', { period: p.period, demand: demand(p.demand_type) });
      case 'period_results':
        return t('notice.period_results', { period: p.period, price: price(p.price), total: kb(p.total_production) });
      case 'market_intel': {
        const shares: number[] = p.shares ?? [];
        const prices: number[] = p.prices ?? [];
        const table = shares
          .map((s, i) => `${Math.round(s * 100)}% → $${prices[i]}`)
          .reverse()
          .join(' · ');
        return t('notice.market_intel', { period: p.period, demand: demand(p.demand_type), table });
      }
      case 'event_triggered':
        return t('notice.event_triggered', {
          event: t(`instructor.${p.event}`),
          change: change(p.change),
          period: p.effective_period,
        });
      case 'event_active':
        return t('notice.event_active', { event: t(`instructor.${p.event}`), change: change(p.change) });
      case 'meeting_started':
        return t('notice.meeting_started', { minutes: p.minutes }) + (p.title ? ` — ${p.title}` : '');
      case 'jpr_requested':
        return t('notice.jpr_requested', { required: p.required_yes });
      case 'jpr_result':
        if (p.approved) return t('notice.jpr_approved', { yes: p.yes, no: p.no, periods: (p.periods ?? []).join(', ') });
        return t(p.expired ? 'notice.jpr_expired' : 'notice.jpr_rejected', { yes: p.yes, no: p.no });
      case 'audit_result':
        return t('notice.audit_result', {
          country: countryName(p.target_country, lang),
          pct: pct(p.production_pct),
          period: p.period,
          cost: money(p.cost),
        });
      case 'card_purchased':
        return t('notice.card_purchased', {
          card: t(`cards.${p.card}`),
          cost: money(p.cost),
          from: p.activation_period ?? p.period,
        });
      case 'card_activated':
        return t('notice.card_activated', { card: t(`cards.${p.card}`) });
      case 'hedge_payout':
        return t('notice.hedge_payout', { payout: money(p.payout), period: p.period, price: price(p.price) });
      case 'auto_submitted':
        return t('notice.auto_submitted', { period: p.period, q: kb(p.production) });
      case 'timer_changed':
        return t('notice.timer_changed', { period: p.period });
      default: {
        const key = `notice.${n.kind}`;
        const text = t(key, p);
        return text === key ? t('notice.unknown') : text;
      }
    }
  };
}

export function NoticeIcon({ category }: { category: NoticeCategory }) {
  const cls = 'size-4';
  switch (category) {
    case 'teacher':
      return <MegaphoneIcon className={cls} />;
    case 'event':
      return <ZapIcon className={cls} />;
    case 'intel':
      return <LightbulbIcon className={cls} />;
    case 'audit':
      return <SearchCheckIcon className={cls} />;
    case 'card':
      return <CreditCardIcon className={cls} />;
    case 'world':
      return <GlobeIcon className={cls} />;
    case 'game':
      return <CalendarClockIcon className={cls} />;
    default:
      return <BellIcon className={cls} />;
  }
}

export const NOTICE_TONE: Record<NoticeCategory, string> = {
  teacher: 'bg-navy-900 text-gold-300',
  event: 'bg-red-100 text-red-700',
  intel: 'bg-accent text-accent-foreground',
  audit: 'bg-violet-100 text-violet-700',
  card: 'bg-sky-100 text-sky-700',
  world: 'bg-emerald-100 text-emerald-700',
  game: 'bg-secondary text-navy-800',
};
