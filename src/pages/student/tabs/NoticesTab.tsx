import { useState } from 'react';
import { EyeIcon, ListChecksIcon, UsersRoundIcon } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { Notice } from '@/lib/types';
import { COUNTRY_ORDER, Flag, countryName } from '@/lib/countries';
import { pct } from '@/lib/format';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { NOTICE_TONE, NoticeIcon, useNoticeText } from '@/components/NoticeText';
import { cn } from '@/lib/utils';
import { useStudent } from '../context';

type Filter = 'all' | 'teacher' | 'game' | 'world';

function matches(n: Notice, f: Filter): boolean {
  if (f === 'all') return true;
  if (f === 'teacher') return n.category === 'teacher';
  if (f === 'game') return ['game', 'event', 'intel', 'audit', 'card'].includes(n.category);
  return n.world_id !== null || n.category === 'world';
}

export function NoticesTab() {
  const { s, notices } = useStudent();
  const { t, lang } = useI18n();
  const text = useNoticeText();
  const [filter, setFilter] = useState<Filter>('all');
  const list = notices.filter((n) => matches(n, filter));

  // pledge log: period × country
  const pledgePeriods = Array.from(new Set(s.pledges.map((p) => p.period_number))).sort((a, b) => a - b);
  const countries = COUNTRY_ORDER.filter((c) => s.roster.some((r) => r.country_code === c));
  const pledgeOf = (period: number, c: string) => s.pledges.find((p) => p.period_number === period && p.country_code === c);
  const revealed = (period: number, c: string) => {
    if (c === s.country.code) {
      const r = s.results.find((x) => x.period_number === period);
      return r ? { pct: Number(r.production_pct), mine: true } : null;
    }
    const j = s.jpr_reveals.find((x) => x.period_number === period && x.country_code === c);
    if (j) return { pct: Number(j.production_pct), mine: false };
    const a = s.audits.find((x) => x.target_period === period && x.target_country === c);
    if (a) return { pct: Number(a.production_pct), mine: false };
    return null;
  };
  const approved = s.jpr_requests.find((r) => r.status === 'approved');

  const filters: Array<[Filter, string]> = [
    ['all', t('notices.filterAll')],
    ['teacher', t('notices.filterTeacher')],
    ['game', t('notices.filterGame')],
    ['world', t('notices.filterWorld')],
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
      <Card className="gap-3">
        <CardHeader>
          <div role="tablist" aria-label="filter" className="flex flex-wrap gap-1.5">
            {filters.map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={filter === id}
                onClick={() => setFilter(id)}
                className={cn(
                  'rounded-full border px-3 py-1 text-sm font-medium transition-colors',
                  filter === id ? 'border-navy-900 bg-navy-900 text-white' : 'bg-white text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <ol className="flex max-h-[34rem] flex-col gap-2 overflow-y-auto pr-1">
            {list.length === 0 && <li className="py-6 text-center text-sm text-muted-foreground">{t('notices.empty')}</li>}
            {list.map((n) => (
              <li key={n.id} className={cn('flex gap-3 rounded-lg border p-3', n.category === 'event' && 'border-red-200 bg-red-50/50', n.category === 'teacher' && 'border-navy-900/20 bg-secondary/50')}>
                <div className={cn('grid size-8 shrink-0 place-items-center rounded-full', NOTICE_TONE[n.category])}>
                  <NoticeIcon category={n.category} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="font-semibold uppercase tracking-wide">
                      {n.category === 'teacher' ? t('notice.announcement') : n.category === 'intel' ? t('notices.intel') : n.group_id ? '🔒' : ''}
                    </span>
                    <span>{new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <p className="text-sm break-words whitespace-pre-wrap">{text(n)}</p>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        <Card className="gap-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecksIcon className="size-4" /> {t('notices.pledgeLog')}
            </CardTitle>
            <CardDescription>{t('notices.pledgeLogHint')}</CardDescription>
          </CardHeader>
          <CardContent className="px-0 sm:px-2">
            {pledgePeriods.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted-foreground">{t('notices.empty')}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('app.country')}</TableHead>
                    {pledgePeriods.map((p) => (
                      <TableHead key={p} className="text-center">
                        P{p}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {countries.map((c) => (
                    <TableRow key={c} className={c === s.country.code ? 'bg-accent/40' : undefined}>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <Flag code={c} /> <span className="max-w-28 truncate">{countryName(c, lang)}</span>
                        </span>
                      </TableCell>
                      {pledgePeriods.map((p) => {
                        const pl = pledgeOf(p, c);
                        const act = revealed(p, c);
                        return (
                          <TableCell key={p} className="text-center">
                            <div className="font-medium">{pl ? pct(pl.pledge_pct, 0) : '—'}</div>
                            {act && (
                              <div
                                className={cn(
                                  'text-[11px]',
                                  pl && act.pct > Number(pl.pledge_pct) + 0.5 ? 'font-semibold text-red-600' : 'text-muted-foreground',
                                )}
                                title={act.mine ? t('notices.actualYou') : t('notices.revealed')}
                              >
                                {act.mine ? '✓' : '👁'} {pct(act.pct, 0)}
                              </div>
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <p className="px-4 pt-2 text-[11px] text-muted-foreground">
              <span className="font-medium">{t('notices.promised')}</span> · ✓ {t('notices.actualYou')} · 👁 {t('notices.revealed')}
            </p>
          </CardContent>
        </Card>

        <Card className="gap-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <EyeIcon className="size-4" /> {t('notices.audits')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {s.audits.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('notices.noAudits')}</p>
            ) : (
              s.audits.map((a) => (
                <div key={a.id} className="flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm">
                  <Flag code={a.target_country} />
                  {t('cards.auditResult', { country: countryName(a.target_country, lang), period: a.target_period, pct: pct(a.production_pct) })}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="gap-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UsersRoundIcon className="size-4" /> {t('notices.jpr')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!approved ? (
              <p className="text-sm text-muted-foreground">{t('notices.empty')}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('app.country')}</TableHead>
                    {(approved.revealed_periods ?? []).map((p) => (
                      <TableHead key={p} className="text-right">
                        P{p}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {countries.map((c) => (
                    <TableRow key={c}>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <Flag code={c} /> {countryName(c, lang)}
                        </span>
                      </TableCell>
                      {(approved.revealed_periods ?? []).map((p) => {
                        const r = s.jpr_reveals.find((x) => x.period_number === p && x.country_code === c);
                        const pl = pledgeOf(p, c);
                        return (
                          <TableCell key={p} className="text-right">
                            {r ? pct(r.production_pct) : '—'}
                            {pl && r && Number(r.production_pct) > Number(pl.pledge_pct) + 0.5 && (
                              <Badge variant="destructive" className="ml-1">
                                &gt; {pct(pl.pledge_pct, 0)}
                              </Badge>
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
