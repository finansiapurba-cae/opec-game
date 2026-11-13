import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2Icon } from 'lucide-react';
import { studentClient } from '@/lib/supabase';
import { rpc } from '@/lib/rpc';
import type { StudentState } from '@/lib/types';
import { Entry } from './Entry';
import { Briefing } from './Briefing';
import { Dashboard } from './Dashboard';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';

export const STUDENT_STATE_KEY = ['student', 'state'] as const;

export default function StudentApp() {
  const { t, setLang } = useI18n();
  const qc = useQueryClient();
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    studentClient.auth.getSession().then(({ data }) => mounted && setHasSession(Boolean(data.session)));
    // Only sign-outs change the gate here: a fresh anonymous sign-in happens inside
    // <Entry/>, which reports back via onJoined once the group claim succeeded
    // (otherwise the state query would race the claim).
    const { data: sub } = studentClient.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) setHasSession(false);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const state = useQuery({
    queryKey: STUDENT_STATE_KEY,
    queryFn: () => rpc<StudentState>(studentClient, 'get_student_state'),
    enabled: hasSession === true,
    retry: 1,
  });

  // adopt the group's saved language once
  const groupLang = state.data?.status === 'ok' ? state.data.group.language : undefined;
  useEffect(() => {
    if (groupLang) setLang(groupLang);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupLang]);

  if (hasSession === null || (hasSession && state.isLoading)) {
    return (
      <div className="grid min-h-dvh place-items-center bg-trading-grid text-white">
        <Loader2Icon className="size-8 animate-spin text-gold-400" />
      </div>
    );
  }

  if (hasSession && state.isError) {
    return (
      <div className="grid min-h-dvh place-items-center bg-trading-grid p-4">
        <div className="max-w-sm rounded-xl bg-white p-6 text-center shadow-xl">
          <p className="mb-4 text-sm text-muted-foreground">{String((state.error as Error)?.message ?? '')}</p>
          <div className="flex justify-center gap-2">
            <Button onClick={() => state.refetch()}>{t('app.retry')}</Button>
            <Button
              variant="outline"
              onClick={async () => {
                await studentClient.auth.signOut();
                qc.removeQueries({ queryKey: STUDENT_STATE_KEY });
              }}
            >
              {t('header.signInAgain')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const data = state.data;
  if (!hasSession || !data || data.status !== 'ok') {
    return (
      <Entry
        onJoined={async () => {
          await qc.resetQueries({ queryKey: STUDENT_STATE_KEY });
          setHasSession(true);
        }}
      />
    );
  }

  if (!data.group.ready) {
    return <Briefing data={data} onReady={() => qc.invalidateQueries({ queryKey: STUDENT_STATE_KEY })} />;
  }

  return <Dashboard data={data} dataUpdatedAt={state.dataUpdatedAt} refetch={() => state.refetch()} />;
}
