import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BellIcon, ChartLineIcon, FactoryIcon, FlagIcon, Loader2Icon, LogOutIcon, MessagesSquareIcon, WifiOffIcon } from 'lucide-react';
import { toast } from 'sonner';
import { studentClient, POLL_MS } from '@/lib/supabase';
import { rpc } from '@/lib/rpc';
import { useRealtime, type ChangeSubscription } from '@/lib/realtime';
import { useI18n } from '@/lib/i18n';
import { resolveConfig } from '@/lib/engine';
import type { ChatMessage, Notice, StudentState } from '@/lib/types';
import { Flag, countryName } from '@/lib/countries';
import { useCountdown, useServerOffset } from '@/hooks/useClock';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Brand } from '@/components/Brand';
import { Countdown } from '@/components/Countdown';
import { LanguageToggle } from '@/components/LanguageToggle';
import { ConfirmAction } from '@/components/ConfirmAction';
import { useNoticeText } from '@/components/NoticeText';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { StudentContext, type StudentContextValue } from './context';
import { STUDENT_STATE_KEY } from './StudentApp';
import { CountryTab } from './tabs/CountryTab';
import { ProductionTab } from './tabs/ProductionTab';
import { ResultsTab } from './tabs/ResultsTab';
import { TalkTab } from './tabs/TalkTab';
import { NoticesTab } from './tabs/NoticesTab';

const CHAT_KEY = ['student', 'chat'] as const;
const NOTICES_KEY = ['student', 'notices'] as const;
type TabId = 'country' | 'production' | 'results' | 'talk' | 'notices';

export function Dashboard({ data: s, dataUpdatedAt, refetch }: { data: StudentState; dataUpdatedAt: number; refetch: () => void }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const noticeText = useNoticeText();
  const [tab, setTab] = useState<TabId>(() => (s.session.status === 'running' ? 'production' : 'country'));
  const [takenOver, setTakenOver] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // ---------------------------------------------------------------- realtime
  const subs = useMemo<ChangeSubscription[]>(() => {
    const sid = `session_id=eq.${s.session.id}`;
    const wid = `world_id=eq.${s.world.id}`;
    const gid = `group_id=eq.${s.group.id}`;
    return [
      { table: 'game_sessions', filter: `id=eq.${s.session.id}`, key: 'state' },
      { table: 'periods', filter: sid, key: 'state' },
      { table: 'country_states', filter: gid, key: 'state' },
      { table: 'production_submissions', filter: gid, key: 'state' },
      { table: 'country_period_results', filter: gid, key: 'state' },
      { table: 'world_period_results', filter: wid, key: 'state' },
      { table: 'public_pledges', filter: wid, key: 'state' },
      { table: 'card_purchases', filter: gid, key: 'state' },
      { table: 'audit_records', filter: `auditor_group_id=eq.${s.group.id}`, key: 'state' },
      { table: 'jpr_requests', filter: wid, key: 'state' },
      { table: 'jpr_reveals', filter: wid, key: 'state' },
      { table: 'game_events', filter: sid, key: 'state' },
      { table: 'opec_meetings', filter: sid, key: 'state' },
      { table: 'final_results', filter: sid, key: 'state' },
      { table: 'groups', filter: wid, key: 'state' },
      { table: 'chat_messages', filter: wid, key: 'chat' },
      { table: 'notices', filter: sid, key: 'notices' },
    ];
  }, [s.session.id, s.world.id, s.group.id]);

  const connected = useRealtime(studentClient, `student-${s.group.id}`, subs, (keys) => {
    if (keys.has('state')) void qc.invalidateQueries({ queryKey: STUDENT_STATE_KEY });
    if (keys.has('chat')) void qc.invalidateQueries({ queryKey: CHAT_KEY });
    if (keys.has('notices')) void qc.invalidateQueries({ queryKey: NOTICES_KEY });
  });
  const pollMs = connected ? 30000 : POLL_MS;

  // fallback polling for the main state as well (realtime can drop on mobile)
  useEffect(() => {
    const id = setInterval(refetch, pollMs);
    return () => clearInterval(id);
  }, [pollMs, refetch]);

  const chat = useQuery({
    queryKey: CHAT_KEY,
    queryFn: () => rpc<ChatMessage[]>(studentClient, 'get_chat', { p_limit: 300 }),
    refetchInterval: pollMs,
  });
  const notices = useQuery({
    queryKey: NOTICES_KEY,
    queryFn: () => rpc<Notice[]>(studentClient, 'get_notices', { p_limit: 300 }),
    refetchInterval: pollMs,
  });

  // ---------------------------------------------------------------- toasts for new notices
  const seen = useRef<Set<string> | null>(null);
  const [unread, setUnread] = useState({ notices: 0, talk: 0 });
  useEffect(() => {
    const list = notices.data;
    if (!list) return;
    if (seen.current === null) {
      seen.current = new Set(list.map((n) => n.id));
      return;
    }
    const fresh = list.filter((n) => !seen.current!.has(n.id));
    fresh.forEach((n) => seen.current!.add(n.id));
    if (fresh.length === 0) return;
    for (const n of fresh.slice(0, 3).reverse()) {
      const text = noticeText(n);
      if (n.category === 'event') toast.warning(text, { duration: 10000 });
      else if (n.category === 'teacher') toast.info(text, { duration: 10000 });
      else toast(text);
    }
    if (tab !== 'notices') setUnread((u) => ({ ...u, notices: u.notices + fresh.length }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notices.data]);

  const chatSeen = useRef<number | null>(null);
  useEffect(() => {
    const n = chat.data?.length ?? 0;
    if (chatSeen.current === null) {
      chatSeen.current = n;
      return;
    }
    if (n > chatSeen.current && tab !== 'talk') setUnread((u) => ({ ...u, talk: u.talk + (n - chatSeen.current!) }));
    chatSeen.current = n;
  }, [chat.data, tab]);

  useEffect(() => {
    if (tab === 'notices' || tab === 'talk') setUnread((u) => ({ ...u, [tab]: 0 }));
  }, [tab]);

  // ---------------------------------------------------------------- heartbeat / takeover detection
  useEffect(() => {
    let stop = false;
    const beat = async () => {
      try {
        const r = await rpc<{ controller: boolean }>(studentClient, 'heartbeat');
        if (!stop && !r.controller) setTakenOver(true);
      } catch {
        /* offline: try again later */
      }
    };
    void beat();
    const id = setInterval(beat, 20000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  // ---------------------------------------------------------------- clock & auto-close
  const offset = useServerOffset(s.server_time, dataUpdatedAt);
  const currentPeriod = s.periods.find((p) => p.number === s.session.current_period) ?? null;
  const openPeriod = currentPeriod?.status === 'open' ? currentPeriod : null;
  const secondsLeft = useCountdown(openPeriod?.closes_at, offset);
  const ticked = useRef<string | null>(null);
  useEffect(() => {
    if (!openPeriod || secondsLeft == null || secondsLeft > 0) return;
    if (ticked.current === openPeriod.id) return;
    ticked.current = openPeriod.id;
    const timer = setTimeout(() => {
      rpc(studentClient, 'tick', { p_session: s.session.id })
        .catch(() => {})
        .finally(() => {
          refetch();
          // allow another attempt if the period is still open a bit later
          setTimeout(() => (ticked.current = null), 4000);
        });
    }, 600 + Math.random() * 1200);
    return () => clearTimeout(timer);
  }, [openPeriod, secondsLeft, s.session.id, refetch]);

  const lastClosed = Math.max(0, ...s.periods.filter((p) => p.status === 'closed').map((p) => p.number));
  const talkPeriod = openPeriod ? openPeriod.number : s.session.current_period + 1;

  const ctx: StudentContextValue = {
    s,
    cfg: resolveConfig(s.session.config),
    offset,
    currentPeriod,
    openPeriod,
    talkPeriod,
    lastClosed,
    chat: chat.data ?? [],
    notices: notices.data ?? [],
    refresh: () => {
      refetch();
      void chat.refetch();
      void notices.refetch();
    },
    connected,
  };

  async function switchUser() {
    setLeaving(true);
    try {
      await rpc(studentClient, 'release_my_group').catch(() => {});
      await studentClient.auth.signOut();
    } finally {
      qc.removeQueries({ queryKey: ['student'] });
      setLeaving(false);
    }
  }

  const statusLabel =
    s.session.status === 'finished'
      ? t('header.finished')
      : s.session.status === 'lobby' || s.session.current_period === 0
        ? t('header.lobby')
        : openPeriod
          ? t('header.periodOpen')
          : t('header.betweenPeriods');

  const tabs: Array<{ id: TabId; icon: typeof FlagIcon; badge?: number }> = [
    { id: 'country', icon: FlagIcon },
    { id: 'production', icon: FactoryIcon },
    { id: 'results', icon: ChartLineIcon },
    { id: 'talk', icon: MessagesSquareIcon, badge: unread.talk },
    { id: 'notices', icon: BellIcon, badge: unread.notices },
  ];

  return (
    <StudentContext.Provider value={ctx}>
      <div className="min-h-dvh pb-10">
        <header className="sticky top-0 z-30 bg-navy-900 text-white shadow-md">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
            <div className="hidden sm:block">
              <Brand compact />
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <Flag code={s.country.code} className="h-6 w-8" />
              <div className="min-w-0 leading-tight">
                <div className="truncate text-sm font-semibold">{countryName(s.country.code, lang)}</div>
                <div className="text-[11px] text-white/60">
                  {t('app.worldX', { w: s.world.code })} · {t('app.groupN', { n: s.group.group_number })}
                </div>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <div className="hidden text-right leading-tight md:block">
                <div className="text-sm font-semibold">
                  {s.session.current_period > 0
                    ? `${t('app.periodN', { n: s.session.current_period })} / ${s.session.total_periods}`
                    : t('header.lobby')}
                </div>
                <div className="text-[11px] text-white/60">
                  {statusLabel}
                  {currentPeriod && ` · ${t(currentPeriod.demand_type === 'high' ? 'header.demandHigh' : 'header.demandLow')}`}
                </div>
              </div>
              {openPeriod && (secondsLeft != null ? <Countdown seconds={secondsLeft} dark label={t('header.timeLeft')} /> : (
                <Badge variant="navOutline">{t('header.noTimer')}</Badge>
              ))}
              {!connected && (
                <span title={t('app.offline')} className="text-gold-300">
                  <WifiOffIcon className="size-4" />
                </span>
              )}
              <LanguageToggle dark onChange={(l) => void rpc(studentClient, 'set_language', { p_language: l }).catch(() => {})} />
              <ConfirmAction
                trigger={
                  <Button variant="navGhost" size="sm" disabled={leaving} aria-label={t('header.switchUser')}>
                    {leaving ? <Loader2Icon className="animate-spin" /> : <LogOutIcon />}
                    <span className="hidden lg:inline">{t('header.switchUser')}</span>
                  </Button>
                }
                title={t('header.switchTitle')}
                description={t('header.switchBody', { n: s.group.group_number })}
                onConfirm={switchUser}
                destructive
              />
            </div>
          </div>
          {/* period strip for small screens */}
          <div className="flex items-center justify-between gap-2 border-t border-white/10 px-4 py-1.5 text-xs text-white/75 md:hidden">
            <span>
              {s.session.current_period > 0 ? `${t('app.periodN', { n: s.session.current_period })} / ${s.session.total_periods}` : ''}{' '}
              · {statusLabel}
            </span>
            {currentPeriod && <span>{t(currentPeriod.demand_type === 'high' ? 'header.demandHigh' : 'header.demandLow')}</span>}
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-3 pt-4 sm:px-4">
          {s.session.current_period === 0 && s.session.status !== 'finished' && (
            <div className="mb-4 flex items-center gap-3 rounded-xl border border-gold-500/40 bg-accent px-4 py-3 text-sm text-accent-foreground">
              <Loader2Icon className="size-4 animate-spin" />
              {t('briefing.waiting')}
            </div>
          )}
          <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)}>
            <TabsList className="grid h-auto w-full grid-cols-5 gap-1 bg-white p-1 shadow-sm">
              {tabs.map(({ id, icon: Icon, badge }) => (
                <TabsTrigger key={id} value={id} className="relative flex-col gap-0.5 px-1 py-1.5 text-[11px] sm:flex-row sm:gap-1.5 sm:text-sm">
                  <Icon />
                  <span className="truncate">{t(`tabs.${id}`)}</span>
                  {badge ? (
                    <span className="absolute top-0.5 right-1 grid min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white sm:static">
                      {badge > 99 ? '99+' : badge}
                    </span>
                  ) : null}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="country">
              <CountryTab />
            </TabsContent>
            <TabsContent value="production">
              <ProductionTab />
            </TabsContent>
            <TabsContent value="results">
              <ResultsTab />
            </TabsContent>
            <TabsContent value="talk">
              <TalkTab />
            </TabsContent>
            <TabsContent value="notices">
              <NoticesTab />
            </TabsContent>
          </Tabs>
        </main>
      </div>

      <AlertDialog open={takenOver}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('header.takenOverTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('header.takenOverBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              onClick={async () => {
                await studentClient.auth.signOut();
                qc.removeQueries({ queryKey: ['student'] });
                setTakenOver(false);
              }}
            >
              {t('header.signInAgain')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </StudentContext.Provider>
  );
}
