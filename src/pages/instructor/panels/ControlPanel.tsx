import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BotIcon,
  ExternalLinkIcon,
  FlagTriangleRightIcon,
  GavelIcon,
  Loader2Icon,
  MegaphoneIcon,
  PlayIcon,
  RotateCcwIcon,
  SquareIcon,
  TimerIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  TrophyIcon,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { Flag, countryName } from '@/lib/countries';
import { clock } from '@/lib/format';
import { useNow } from '@/hooks/useClock';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmAction } from '@/components/ConfirmAction';
import { NOTICE_TONE, NoticeIcon, useNoticeText } from '@/components/NoticeText';
import { cn } from '@/lib/utils';
import { useInstructor } from '../context';
import { STANDALONE } from '@/lib/supabase';

export function ControlPanel() {
  const { st, openPeriod, act, busy, offset, talkPeriod, cfg } = useInstructor();
  const { t, lang } = useI18n();
  const noticeText = useNoticeText();
  const now = useNow(1000) + offset;
  const s = st.session;
  const [minutes, setMinutes] = useState(String(s.default_period_seconds / 60));
  const [announce, setAnnounce] = useState('');
  const [announceWorld, setAnnounceWorld] = useState('all');
  const [meetingWorld, setMeetingWorld] = useState('all');
  const [meetingMinutes, setMeetingMinutes] = useState('5');
  const [meetingTitle, setMeetingTitle] = useState('');
  const next = s.current_period + 1;
  const talkLocked = talkPeriod < cfg.talk.start_period;
  const activeMeetings = st.meetings.filter((m) => !m.ended_at && new Date(m.ends_at).getTime() > now);
  const missing = openPeriod ? st.groups.filter((g) => !st.submissions.some((x) => x.group_id === g.id && x.period_number === openPeriod.number)) : [];
  const worldName = (id: string | null) => (id ? t('app.worldX', { w: st.worlds.find((w) => w.id === id)?.code ?? '?' }) : t('instructor.allWorlds'));
  const hasBots = st.groups.some((g) => g.is_bot);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* ------------------------------------------------ game flow */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlagTriangleRightIcon className="size-4" /> {t('instructor.tabs.control')}
          </CardTitle>
          <CardDescription>{t('instructor.autoClose')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {s.status === 'lobby' && (
            <div className="flex flex-col gap-2 rounded-xl border border-gold-500/40 bg-accent/50 p-4">
              <p className="text-sm text-accent-foreground">{t('instructor.startGameHint')}</p>
              <p className="text-xs text-muted-foreground">
                {t('briefing.ready')}: {st.groups.filter((g) => g.ready).length} / {st.groups.length} ·{' '}
                {t('instructor.status_online')}: {st.groups.filter((g) => g.online).length}
              </p>
              <Button variant="gold" size="lg" className="self-start" disabled={busy !== null} onClick={() => act('start_game', { p_session: s.id })}>
                <PlayIcon /> {t('instructor.startGame')}
              </Button>
            </div>
          )}

          {s.status === 'running' && !openPeriod && next <= s.total_periods && (
            <div className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-end">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dur">{t('instructor.duration')}</Label>
                <Input id="dur" type="number" min={0} step={0.5} className="w-32" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
              </div>
              <Button
                variant="gold"
                size="lg"
                disabled={busy !== null}
                onClick={() => act('open_period', { p_session: s.id, p_duration_seconds: Math.round(Number(minutes) * 60) })}
              >
                {busy === 'open_period' ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
                {t('instructor.openPeriod', { n: next })}
              </Button>
              <Badge variant={next % 2 === 1 ? 'warning' : 'success'} className="self-center">
                {t(next % 2 === 1 ? 'header.demandLow' : 'header.demandHigh')}
              </Badge>
            </div>
          )}

          {openPeriod && (
            <div className="flex flex-col gap-3 rounded-xl border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <TimerIcon className="size-4 text-muted-foreground" />
                {[1, 2, 5].map((m) => (
                  <Button
                    key={m}
                    variant="outline"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => {
                      const left = openPeriod.closes_at ? Math.max(0, (new Date(openPeriod.closes_at).getTime() - now) / 1000) : 0;
                      void act('set_period_deadline', { p_session: s.id, p_seconds_from_now: Math.round(left + m * 60) });
                    }}
                  >
                    {t('instructor.extend', { m })}
                  </Button>
                ))}
                <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => act('set_period_deadline', { p_session: s.id, p_seconds_from_now: 0 })}>
                  {t('instructor.removeTimer')}
                </Button>
                <div className="ml-auto">
                  <ConfirmAction
                    trigger={
                      <Button variant="destructive" disabled={busy !== null}>
                        {busy === 'close_period' ? <Loader2Icon className="animate-spin" /> : <SquareIcon />}
                        {t('instructor.closeNow')}
                      </Button>
                    }
                    title={t('instructor.closeNow')}
                    description={t('instructor.closeConfirm', { n: openPeriod.number })}
                    onConfirm={() => act('close_period', { p_session: s.id })}
                  />
                </div>
              </div>
              {missing.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {missing.map((g) => (
                    <Badge key={g.id} variant="outline" className="gap-1.5">
                      <Flag code={g.country_code} className="h-3 w-4" />#{g.group_number}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}

          {s.status === 'finished' && (
            <Button asChild variant="gold" size="lg" className="self-start">
              <Link to={`/results/${s.id}`}>
                <TrophyIcon /> {t('instructor.openFinal')}
              </Link>
            </Button>
          )}

          <div className="flex flex-wrap gap-2 border-t pt-4">
            {s.status === 'running' && (
              <ConfirmAction
                trigger={
                  <Button variant="outline" disabled={busy !== null}>
                    <TrophyIcon /> {t('instructor.endGame')}
                  </Button>
                }
                title={t('instructor.endGame')}
                description={t('instructor.endConfirm')}
                destructive
                onConfirm={() => act('end_game', { p_session: s.id })}
              />
            )}
            <ConfirmAction
              trigger={
                <Button variant="ghost" disabled={busy !== null} className="text-red-700">
                  <RotateCcwIcon /> {t('instructor.reset')}
                </Button>
              }
              title={t('instructor.reset')}
              description={t('instructor.resetConfirm')}
              destructive
              onConfirm={() => act('reset_session', { p_session: s.id })}
            />
          </div>
        </CardContent>
      </Card>

      {/* ------------------------------------------------ events */}
      <Card>
        <CardHeader>
          <CardTitle>{t('instructor.events')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {(['recession', 'boom'] as const).map((e) => {
            const used = st.events.find((x) => x.event_type === e);
            const Icon = e === 'recession' ? TrendingDownIcon : TrendingUpIcon;
            return (
              <div key={e} className={cn('flex flex-col gap-2 rounded-xl border p-3', e === 'recession' ? 'border-red-200' : 'border-emerald-200')}>
                <div className="flex items-center gap-2 font-semibold">
                  <Icon className={cn('size-4', e === 'recession' ? 'text-red-600' : 'text-oil-600')} /> {t(`instructor.${e}`)}
                </div>
                <p className="text-xs text-muted-foreground">{t(`instructor.${e}Desc`)}</p>
                {used ? (
                  <Badge variant="muted">{t('instructor.used', { n: used.effective_period })}</Badge>
                ) : (
                  <ConfirmAction
                    trigger={
                      <Button size="sm" variant={e === 'recession' ? 'destructive' : 'success'} disabled={busy !== null || s.status === 'finished' || next > s.total_periods}>
                        {t('instructor.trigger')}
                      </Button>
                    }
                    title={t(`instructor.${e}`)}
                    description={t('instructor.eventConfirm', { event: t(`instructor.${e}`), n: next })}
                    onConfirm={() => act('trigger_event', { p_session: s.id, p_event: e })}
                  />
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* ------------------------------------------------ communication */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GavelIcon className="size-4" /> {t('instructor.meeting')} & {t('instructor.chat')}
          </CardTitle>
          {talkLocked && <CardDescription>{t('talk.lockedBody')}</CardDescription>}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <span>
              <span className="block text-sm font-medium">{t('instructor.chat')}</span>
              <span className="text-xs text-muted-foreground">{t('instructor.chatHint')}</span>
            </span>
            <Switch
              checked={s.chat_enabled}
              disabled={busy !== null || (talkLocked && !s.chat_enabled) || s.status !== 'running'}
              onCheckedChange={(v) => act('set_chat_enabled', { p_session: s.id, p_enabled: v })}
            />
          </label>
          <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_100px_1.4fr_auto] sm:items-end">
            <div className="flex flex-col gap-1.5">
              <Label>{t('instructor.meetingWorld')}</Label>
              <Select value={meetingWorld} onValueChange={setMeetingWorld}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('instructor.allWorlds')}</SelectItem>
                  {st.worlds.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {t('app.worldX', { w: w.code })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t('instructor.meetingMinutes')}</Label>
              <Input type="number" min={1} max={120} value={meetingMinutes} onChange={(e) => setMeetingMinutes(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t('instructor.meetingTitle')}</Label>
              <Input value={meetingTitle} onChange={(e) => setMeetingTitle(e.target.value)} maxLength={120} />
            </div>
            <Button
              disabled={busy !== null || talkLocked || s.status !== 'running'}
              onClick={async () => {
                await act('start_meeting', {
                  p_session: s.id,
                  p_world: meetingWorld === 'all' ? null : meetingWorld,
                  p_minutes: Number(meetingMinutes),
                  p_title: meetingTitle,
                });
                setMeetingTitle('');
              }}
            >
              <GavelIcon /> {t('instructor.startMeeting')}
            </Button>
          </div>
          {activeMeetings.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-lg border border-gold-500 bg-accent/50 px-3 py-2 text-sm">
              <GavelIcon className="size-4 text-gold-600" />
              <span className="font-medium">{worldName(m.world_id)}</span>
              {m.title && <span className="truncate text-muted-foreground">{m.title}</span>}
              <span className="ml-auto font-mono tabular">{clock((new Date(m.ends_at).getTime() - now) / 1000)}</span>
              <Button size="sm" variant="outline" onClick={() => act('end_meeting', { p_meeting: m.id })}>
                {t('instructor.endMeeting')}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ------------------------------------------------ announcements */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MegaphoneIcon className="size-4" /> {t('instructor.announce')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Textarea value={announce} onChange={(e) => setAnnounce(e.target.value)} placeholder={t('instructor.announcePlaceholder')} rows={3} maxLength={2000} />
          <div className="flex gap-2">
            <Select value={announceWorld} onValueChange={setAnnounceWorld}>
              <SelectTrigger aria-label={t('instructor.announceTo')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('instructor.allWorlds')}</SelectItem>
                {st.worlds.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {t('app.worldX', { w: w.code })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              disabled={!announce.trim() || busy !== null}
              onClick={async () => {
                await act('post_announcement', { p_session: s.id, p_body: announce, p_world: announceWorld === 'all' ? null : announceWorld }, t('instructor.send'));
                setAnnounce('');
              }}
            >
              {t('instructor.send')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ------------------------------------------------ demo tools */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BotIcon className="size-4" /> {t('instructor.demoTools')}
          </CardTitle>
          <CardDescription>{t('instructor.playAsHint')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={!openPeriod || !hasBots || busy !== null} onClick={() => act('demo_fill_submissions', { p_session: s.id })}>
              <BotIcon /> {t('instructor.fillBots')}
            </Button>
            <Button asChild variant="outline" className={STANDALONE ? 'hidden' : undefined}>
              <a href="/play" target="_blank" rel="noreferrer">
                <ExternalLinkIcon /> {t('instructor.playAs')}
              </a>
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
            {st.groups.slice(0, 21).map((g) => (
              <div key={g.id} className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
                <span className="font-semibold">#{g.group_number}</span>
                <Flag code={g.country_code} className="h-3 w-4" />
                <span className="truncate text-muted-foreground">
                  {st.worlds.find((w) => w.id === g.world_id)?.code} · {countryName(g.country_code, lang)}
                </span>
                <code className="ml-auto font-mono font-semibold">{g.access_code}</code>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ------------------------------------------------ notices */}
      <Card>
        <CardHeader>
          <CardTitle>{t('instructor.notices')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {st.notices.slice(0, 40).map((n) => (
              <li key={n.id} className="flex gap-2 text-xs">
                <span className={cn('grid size-6 shrink-0 place-items-center rounded-full', NOTICE_TONE[n.category])}>
                  <NoticeIcon category={n.category} />
                </span>
                <span className="min-w-0">
                  <span className="text-muted-foreground">
                    {new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {n.world_id && ` · ${worldName(n.world_id)}`}
                  </span>
                  <span className="block break-words">{noticeText(n)}</span>
                </span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
