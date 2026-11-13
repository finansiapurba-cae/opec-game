import { useEffect, useRef, useState } from 'react';
import { SendIcon } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { WorldCode } from '@/lib/types';
import { Flag, countryName } from '@/lib/countries';
import { money, pct } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { useInstructor } from '../context';

export function TalkCardsPanel() {
  const { st, chat, act, groupById, worldById, offset } = useInstructor();
  const { t, lang } = useI18n();
  const [world, setWorld] = useState<WorldCode>('A');
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const w = st.worlds.find((x) => x.code === world)!;
  const messages = chat.filter((m) => m.world_id === w.id);
  const now = Date.now() + offset;
  const activeMeeting = st.meetings.find(
    (m) => (m.world_id === null || m.world_id === w.id) && !m.ended_at && new Date(m.ends_at).getTime() > now,
  );

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length, world]);

  const label = (groupId: string) => {
    const g = groupById.get(groupId);
    return g ? (
      <span className="flex items-center gap-1.5">
        <Flag code={g.country_code} className="h-3 w-4" />
        {worldById.get(g.world_id)?.code} · {countryName(g.country_code, lang)}
      </span>
    ) : (
      '—'
    );
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="gap-3 lg:row-span-2">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{t('instructor.chatMonitor')}</CardTitle>
          <div className="flex gap-1">
            {st.worlds.map((x) => (
              <Button key={x.id} size="sm" variant={x.code === world ? 'default' : 'outline'} onClick={() => setWorld(x.code)}>
                {x.code}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div ref={listRef} className="flex h-[28rem] flex-col gap-2 overflow-y-auto rounded-lg border bg-muted/30 p-3">
            {messages.length === 0 && <p className="m-auto text-sm text-muted-foreground">{t('talk.empty')}</p>}
            {messages.map((m) => (
              <div key={m.id} className={cn('flex flex-col gap-0.5', !m.group_id && 'items-end')}>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  {m.group_id ? label(m.group_id) : <Badge className="h-4 text-[10px]">{t('talk.instructor')}</Badge>}
                  {m.meeting_id && <Badge variant="gold" className="h-4 text-[10px]">{t('talk.meeting')}</Badge>}
                  <span>{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className={cn('max-w-[90%] rounded-xl px-3 py-1.5 text-sm whitespace-pre-wrap', m.group_id ? 'bg-white shadow-xs' : 'bg-gold-300/60')}>
                  {m.body}
                </div>
              </div>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!text.trim()) return;
              await act('instructor_chat', { p_world: w.id, p_body: text, p_meeting: activeMeeting?.id ?? null });
              setText('');
            }}
          >
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('instructor.postToWorld', { w: world })} maxLength={1000} />
            <Button type="submit" disabled={!text.trim()}>
              <SendIcon />
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="gap-2">
        <CardHeader>
          <CardTitle>{t('instructor.cardsTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="px-0 sm:px-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('app.country')}</TableHead>
                <TableHead>{t('instructor.card')}</TableHead>
                <TableHead className="text-right">{t('app.period')}</TableHead>
                <TableHead className="text-right">{t('cards.cost')}</TableHead>
                <TableHead>{t('cards.activation')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {st.cards.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    {t('notices.empty')}
                  </TableCell>
                </TableRow>
              )}
              {st.cards.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{label(c.group_id)}</TableCell>
                  <TableCell>
                    <Badge variant={c.card_type === 'audit' ? 'outline' : 'gold'}>{t(`cards.${c.card_type}`)}</Badge>
                  </TableCell>
                  <TableCell className="text-right">{c.purchased_period}</TableCell>
                  <TableCell className="text-right">{money(c.cost)}</TableCell>
                  <TableCell className="text-xs">
                    {c.card_type === 'audit'
                      ? `→ ${countryName(c.details.target_country, lang)} P${c.details.target_period}`
                      : `P${c.activation_period}${c.end_period ? `–${c.end_period}` : ''}${c.applied_at ? ' ✓' : ''}`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="gap-2">
        <CardHeader>
          <CardTitle>
            {t('instructor.auditsTitle')} · {t('instructor.jprTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 px-0 sm:px-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('cards.audit')}</TableHead>
                <TableHead>{t('cards.auditTarget')}</TableHead>
                <TableHead className="text-right">{t('app.period')}</TableHead>
                <TableHead className="text-right">{t('results.share')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {st.audits.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>{label(a.auditor_group_id)}</TableCell>
                  <TableCell>{label(a.target_group_id)}</TableCell>
                  <TableCell className="text-right">{a.target_period}</TableCell>
                  <TableCell className="text-right">{pct(a.production_pct)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex flex-col gap-2 px-4">
            {st.jpr_requests.length === 0 && <p className="text-sm text-muted-foreground">{t('instructor.jprTitle')}: —</p>}
            {st.jpr_requests.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                <Badge variant="outline">{worldById.get(r.world_id)?.code}</Badge>
                <Badge variant={r.status === 'approved' ? 'success' : r.status === 'voting' ? 'gold' : 'muted'}>{r.status}</Badge>
                <span className="text-muted-foreground">
                  👍 {r.yes_count} · 👎 {r.no_count} / {r.required_yes}
                </span>
                {r.revealed_periods && r.revealed_periods.length > 0 && <span className="text-xs">P{r.revealed_periods.join(', P')}</span>}
                <span className="ml-auto text-xs text-muted-foreground">P{r.opened_period}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
