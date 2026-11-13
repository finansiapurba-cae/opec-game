import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftIcon, ChartLineIcon, Loader2Icon, MessagesSquareIcon, SlidersHorizontalIcon, TrophyIcon, UsersIcon, WifiOffIcon } from 'lucide-react';
import { toast } from 'sonner';
import { instructorClient, POLL_MS } from '@/lib/supabase';
import { rpc } from '@/lib/rpc';
import { useRealtime, type ChangeSubscription } from '@/lib/realtime';
import { useErrorText, useI18n } from '@/lib/i18n';
import { resolveConfig } from '@/lib/engine';
import type { ChatMessage, InstructorState } from '@/lib/types';
import { useCountdown, useServerOffset } from '@/hooks/useClock';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Countdown } from '@/components/Countdown';
import { InstructorContext, type InstructorContextValue } from './context';
import { ControlPanel } from './panels/ControlPanel';
import { GroupsPanel } from './panels/GroupsPanel';
import { MarketsPanel } from './panels/MarketsPanel';
import { TalkCardsPanel } from './panels/TalkCardsPanel';
import { ResultsPanel } from './panels/ResultsPanel';

const TABLES = [
  'game_sessions',
  'groups',
  'country_states',
  'periods',
  'production_submissions',
  'world_period_results',
  'country_period_results',
  'final_results',
  'public_pledges',
  'opec_meetings',
  'card_purchases',
  'audit_records',
  'jpr_requests',
  'jpr_reveals',
  'game_events',
  'notices',
];

export function SessionDashboard() {
  const { sessionId = '' } = useParams();
  const { t } = useI18n();
  const errorText = useErrorText();
  const qc = useQueryClient();
  const [tab, setTab] = useState('control');
  const [busy, setBusy] = useState<string | null>(null);
  const stateKey = useMemo(() => ['instructor', 'state', sessionId], [sessionId]);
  const chatKey = useMemo(() => ['instructor', 'chat', sessionId], [sessionId]);

  const subs = useMemo<ChangeSubscription[]>(
    () => [
      ...TABLES.map((table) => ({
        table,
        filter: table === 'game_sessions' ? `id=eq.${sessionId}` : `session_id=eq.${sessionId}`,
        key: 'state',
      })),
      { table: 'chat_messages', filter: `session_id=eq.${sessionId}`, key: 'chat' },
    ],
    [sessionId],
  );
  const connected = useRealtime(instructorClient, sessionId ? `instructor-${sessionId}` : null, subs, (keys) => {
    if (keys.has('state')) void qc.invalidateQueries({ queryKey: stateKey });
    if (keys.has('chat')) void qc.invalidateQueries({ queryKey: chatKey });
  });

  const state = useQuery({
    queryKey: stateKey,
    queryFn: () => rpc<InstructorState>(instructorClient, 'get_instructor_state', { p_session: sessionId }),
    refetchInterval: connected ? 15000 : POLL_MS,
  });
  const chat = useQuery({
    queryKey: chatKey,
    queryFn: () => rpc<ChatMessage[]>(instructorClient, 'get_instructor_chat', { p_session: sessionId, p_limit: 1000 }),
    refetchInterval: connected ? 30000 : POLL_MS,
  });

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: stateKey });
    void qc.invalidateQueries({ queryKey: chatKey });
  }, [qc, stateKey, chatKey]);

  const act = useCallback(
    async <T,>(fn: string, args: Record<string, unknown> = {}, success?: string): Promise<T | undefined> => {
      setBusy(fn);
      try {
        const r = await rpc<T>(instructorClient, fn, args);
        if (success) toast.success(success);
        refresh();
        return r;
      } catch (err) {
        toast.error(errorText(err));
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [refresh, errorText],
  );

  const st = state.data;
  const offset = useServerOffset(st?.server_time, state.dataUpdatedAt);
  const currentPeriod = st?.periods.find((p) => p.number === st.session.current_period) ?? null;
  const openPeriod = currentPeriod?.status === 'open' ? currentPeriod : null;
  const secondsLeft = useCountdown(openPeriod?.closes_at, offset);

  // close the period automatically when the timer runs out (idempotent on the server)
  const ticked = useRef<string | null>(null);
  useEffect(() => {
    if (!openPeriod || secondsLeft == null || secondsLeft > 0 || ticked.current === openPeriod.id) return;
    ticked.current = openPeriod.id;
    rpc(instructorClient, 'tick', { p_session: sessionId })
      .catch(() => {})
      .finally(() => {
        refresh();
        setTimeout(() => (ticked.current = null), 4000);
      });
  }, [openPeriod, secondsLeft, sessionId, refresh]);

  if (state.isLoading || !st) {
    return (
      <div className="grid place-items-center py-20">
        {state.isError ? (
          <p className="text-sm text-red-600">{errorText(state.error)}</p>
        ) : (
          <Loader2Icon className="size-8 animate-spin text-navy-700" />
        )}
      </div>
    );
  }

  const submitted = openPeriod ? st.submissions.filter((x) => x.period_number === openPeriod.number).length : 0;
  const ctx: InstructorContextValue = {
    st,
    cfg: resolveConfig(st.session.config),
    offset,
    chat: chat.data ?? [],
    currentPeriod,
    openPeriod,
    talkPeriod: openPeriod ? openPeriod.number : st.session.current_period + 1,
    worldById: new Map(st.worlds.map((w) => [w.id, w])),
    groupById: new Map(st.groups.map((g) => [g.id, g])),
    act,
    busy,
    refresh,
  };

  return (
    <InstructorContext.Provider value={ctx}>
      <div className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <Button asChild variant="ghost" size="icon" aria-label={t('app.back')}>
            <Link to="/instructor">
              <ArrowLeftIcon />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold text-navy-900">{st.session.name}</h1>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant={st.session.status === 'running' ? 'success' : st.session.status === 'finished' ? 'muted' : 'gold'}>
                {t(`instructor.status.${st.session.status}`)}
              </Badge>
              {st.session.is_demo && <Badge variant="outline">Demo</Badge>}
              <span>
                {t('app.periodN', { n: st.session.current_period })} / {st.session.total_periods}
                {currentPeriod && ` · ${t(currentPeriod.demand_type === 'high' ? 'header.demandHigh' : 'header.demandLow')}`}
                {currentPeriod && ` · ${currentPeriod.status === 'open' ? t('header.periodOpen') : t('header.periodClosed')}`}
              </span>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {openPeriod && (
              <Badge variant={submitted === st.groups.length ? 'success' : 'outline'} className="text-sm">
                {t('instructor.submissions', { n: submitted, total: st.groups.length })}
              </Badge>
            )}
            {openPeriod && (secondsLeft != null ? <Countdown seconds={secondsLeft} /> : <Badge variant="muted">{t('header.noTimer')}</Badge>)}
            {!connected && (
              <span title={t('app.offline')} className="text-gold-600">
                <WifiOffIcon className="size-4" />
              </span>
            )}
          </div>
        </div>
      </div>
      <main className="mx-auto max-w-7xl px-4 pt-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid h-auto w-full grid-cols-5 bg-white p-1 shadow-sm">
            {(
              [
                ['control', SlidersHorizontalIcon],
                ['groups', UsersIcon],
                ['markets', ChartLineIcon],
                ['talk', MessagesSquareIcon],
                ['results', TrophyIcon],
              ] as const
            ).map(([id, Icon]) => (
              <TabsTrigger key={id} value={id} className="flex-col gap-0.5 py-1.5 text-[11px] sm:flex-row sm:text-sm">
                <Icon />
                <span className="truncate">{t(`instructor.tabs.${id}`)}</span>
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="control">
            <ControlPanel />
          </TabsContent>
          <TabsContent value="groups">
            <GroupsPanel />
          </TabsContent>
          <TabsContent value="markets">
            <MarketsPanel />
          </TabsContent>
          <TabsContent value="talk">
            <TalkCardsPanel />
          </TabsContent>
          <TabsContent value="results">
            <ResultsPanel />
          </TabsContent>
        </Tabs>
      </main>
    </InstructorContext.Provider>
  );
}
