import { useEffect, useMemo, useState } from 'react';
import { BotIcon, KeyRoundIcon, PrinterIcon, ShuffleIcon, UnplugIcon } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { BotStrategy, CountryCode, WorldCode } from '@/lib/types';
import { COUNTRY_ORDER, Flag, WORLD_CODES, countryName } from '@/lib/countries';
import { kb, money, pct, timeOfDay } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmAction } from '@/components/ConfirmAction';
import { cn } from '@/lib/utils';
import { useInstructor } from '../context';
import { STANDALONE } from '@/lib/supabase';

type Slot = `${WorldCode}:${CountryCode}`;

export function GroupsPanel() {
  const { st, act, busy, openPeriod, worldById } = useInstructor();
  const { t, lang } = useI18n();
  const s = st.session;
  const lobby = s.status === 'lobby';
  const period = openPeriod?.number ?? s.current_period;

  const original = useMemo(
    () => Object.fromEntries(st.groups.map((g) => [g.group_number, `${worldById.get(g.world_id)?.code}:${g.country_code}` as Slot])),
    [st.groups, worldById],
  );
  const [draft, setDraft] = useState<Record<number, Slot>>(original);
  useEffect(() => setDraft(original), [original]);
  const dirty = Object.keys(original).some((k) => original[Number(k)] !== draft[Number(k)]);

  function assign(groupNumber: number, slot: Slot) {
    setDraft((d) => {
      const holder = Object.entries(d).find(([, v]) => v === slot)?.[0];
      const next = { ...d };
      if (holder) next[Number(holder)] = d[groupNumber];
      next[groupNumber] = slot;
      return next;
    });
  }

  function printCodes() {
    const esc = (v: unknown) =>
      String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
    const rows = st.groups
      .map((g) => {
        const w = worldById.get(g.world_id)?.code;
        return `<div class="c"><div class="n">Group ${g.group_number} · 第 ${g.group_number} 組</div><div class="w">World ${w} · ${countryName(g.country_code, 'en')} / ${countryName(g.country_code, 'zh')}</div><div class="k">${esc(g.access_code)}</div><div class="u">${location.origin}/play</div></div>`;
      })
      .join('');
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>${esc(s.name)} — access codes</title><style>body{font-family:system-ui,sans-serif;margin:16px}h1{font-size:16px}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.c{border:1px dashed #888;border-radius:8px;padding:10px;break-inside:avoid}.n{font-weight:700}.w{font-size:12px;color:#444}.k{font:700 26px monospace;letter-spacing:4px;margin:6px 0}.u{font-size:10px;color:#666}</style></head><body><h1>${esc(s.name)}</h1><div class="g">${rows}</div><script>setTimeout(()=>print(),300)</script></body></html>`,
    );
    w.document.close();
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="gap-3">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>{t('instructor.groupsTable')}</CardTitle>
            <CardDescription>
              {period > 0 && `${t('app.periodN', { n: period })} · `}
              {lobby ? t('instructor.assignmentsHint') : null}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={printCodes} className={STANDALONE ? 'hidden' : undefined}>
              <PrinterIcon /> {t('instructor.printCodes')}
            </Button>
            {lobby && (
              <>
                <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => act('randomize_assignments', { p_session: s.id })}>
                  <ShuffleIcon /> {t('instructor.randomizeNow')}
                </Button>
                <Button
                  size="sm"
                  variant="gold"
                  disabled={!dirty || busy !== null}
                  onClick={() =>
                    act(
                      'set_assignments',
                      {
                        p_session: s.id,
                        p_assignments: Object.entries(draft).map(([n, slot]) => {
                          const [world, country] = slot.split(':');
                          return { group_number: Number(n), world, country };
                        }),
                      },
                      t('instructor.saveAssignments'),
                    )
                  }
                >
                  {t('instructor.saveAssignments')}
                </Button>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent className="px-0 sm:px-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>{lobby ? t('instructor.assignments') : `${t('app.world')} / ${t('app.country')}`}</TableHead>
                <TableHead>{t('instructor.code')}</TableHead>
                <TableHead>{t('instructor.device')}</TableHead>
                <TableHead>{t('instructor.ready')}</TableHead>
                <TableHead>{t('instructor.submission')}</TableHead>
                <TableHead className="text-right">{t('instructor.production')}</TableHead>
                <TableHead className="text-right">{t('instructor.pledge')}</TableHead>
                <TableHead>{t('instructor.card')}</TableHead>
                <TableHead className="text-right">{t('instructor.wealth')}</TableHead>
                <TableHead>{t('instructor.bot')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {st.groups.map((g) => {
                const sub = st.submissions.find((x) => x.group_id === g.id && x.period_number === period);
                const pledge = st.pledges.find((x) => x.group_id === g.id && x.period_number === period);
                const state = st.states.find((x) => x.group_id === g.id);
                const card = st.cards.find((c) => c.group_id === g.id && c.card_type !== 'audit');
                const audit = st.cards.find((c) => c.group_id === g.id && c.card_type === 'audit');
                const w = worldById.get(g.world_id)?.code;
                return (
                  <TableRow key={g.id}>
                    <TableCell className="font-semibold">{g.group_number}</TableCell>
                    <TableCell>
                      {lobby ? (
                        <Select value={draft[g.group_number]} onValueChange={(v) => assign(g.group_number, v as Slot)}>
                          <SelectTrigger className={cn('h-8 w-52', draft[g.group_number] !== original[g.group_number] && 'border-gold-500')}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {WORLD_CODES.flatMap((wc) =>
                              COUNTRY_ORDER.map((c) => (
                                <SelectItem key={`${wc}:${c}`} value={`${wc}:${c}`}>
                                  <span className="flex items-center gap-2">
                                    <Flag code={c} className="h-3 w-4" /> {wc} · {countryName(c, lang)}
                                  </span>
                                </SelectItem>
                              )),
                            )}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="flex items-center gap-2">
                          <Badge variant="outline">{w}</Badge>
                          <Flag code={g.country_code} /> {countryName(g.country_code, lang)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <code className="font-mono text-xs font-semibold">{g.access_code}</code>
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5 text-xs">
                        <span
                          className={cn('size-2 rounded-full', g.online ? 'bg-oil-500' : g.controlled ? 'bg-gold-500' : 'bg-muted-foreground/30')}
                        />
                        {g.online ? t('instructor.status_online') : g.controlled ? t('instructor.status_offline') : t('instructor.status_unclaimed')}
                      </span>
                    </TableCell>
                    <TableCell>{g.ready ? <Badge variant="success">✓</Badge> : '—'}</TableCell>
                    <TableCell>
                      {sub ? (
                        <span className="flex flex-col text-xs">
                          <Badge variant={sub.source === 'student' ? 'success' : sub.source === 'bot' ? 'outline' : 'warning'}>
                            {t(sub.source === 'student' ? 'instructor.sub_student' : sub.source === 'bot' ? 'instructor.sub_bot' : 'instructor.sub_auto')}
                            {sub.revision > 1 && ` ×${sub.revision}`}
                          </Badge>
                          <span className="text-muted-foreground">{timeOfDay(sub.updated_at)}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{t('instructor.sub_none')}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {sub ? (
                        <>
                          {kb(sub.production)}
                          <span className="block text-xs text-muted-foreground">{pct(sub.production_pct)}</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-right">{pledge ? pct(pledge.pledge_pct) : '—'}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {card && <Badge variant="gold">{t(`cards.${card.card_type}`)}</Badge>}
                        {audit && <Badge variant="outline">{t('cards.audit')}</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium">{money(state?.estimated_wealth)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Switch
                          checked={g.is_bot}
                          aria-label={t('instructor.bot')}
                          disabled={busy !== null}
                          onCheckedChange={(v) => act('set_group_bot', { p_group: g.id, p_is_bot: v, p_strategy: g.bot_strategy ?? 'random' })}
                        />
                        {g.is_bot && (
                          <Select value={g.bot_strategy ?? 'random'} onValueChange={(v) => act('set_group_bot', { p_group: g.id, p_is_bot: true, p_strategy: v as BotStrategy })}>
                            <SelectTrigger className="h-7 w-36 text-xs">
                              <BotIcon className="size-3" />
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(['cooperative', 'moderate', 'competitive', 'random'] as BotStrategy[]).map((b) => (
                                <SelectItem key={b} value={b}>
                                  {b}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          title={t('instructor.release')}
                          disabled={!g.controlled || busy !== null}
                          onClick={() => act('release_group', { p_group: g.id })}
                        >
                          <UnplugIcon />
                        </Button>
                        <ConfirmAction
                          trigger={
                            <Button variant="ghost" size="icon" className="size-7" title={t('instructor.newCode')} disabled={busy !== null}>
                              <KeyRoundIcon />
                            </Button>
                          }
                          title={t('instructor.newCode')}
                          description={`${t('app.groupN', { n: g.group_number })} — ${g.access_code} → ?`}
                          onConfirm={() => act('regenerate_access_code', { p_group: g.id })}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
