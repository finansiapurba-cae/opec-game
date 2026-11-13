import { useEffect, useState } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2Icon, LogOutIcon } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { instructorClient } from '@/lib/supabase';
import { rpc } from '@/lib/rpc';
import { useI18n } from '@/lib/i18n';
import { Brand } from '@/components/Brand';
import { LanguageToggle } from '@/components/LanguageToggle';
import { Button } from '@/components/ui/button';
import { Login, NotInstructor } from './Login';
import { SessionList } from './SessionList';
import { SessionDashboard } from './SessionDashboard';

export default function InstructorApp() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    instructorClient.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = instructorClient.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const who = useQuery({
    queryKey: ['instructor', 'whoami', session?.user.id],
    queryFn: () => rpc<{ is_instructor: boolean }>(instructorClient, 'whoami'),
    enabled: Boolean(session),
  });

  if (session === undefined || (session && who.isLoading)) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Loader2Icon className="size-8 animate-spin text-navy-700" />
      </div>
    );
  }
  if (!session) return <Login />;
  if (!who.data?.is_instructor) return <NotInstructor email={session.user.email ?? ''} onRedeemed={() => who.refetch()} />;

  return (
    <div className="min-h-dvh pb-12">
      <header className="sticky top-0 z-30 bg-navy-900 text-white shadow-md">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5">
          <Link to="/instructor">
            <Brand compact />
          </Link>
          <span className="hidden rounded-md bg-white/10 px-2 py-0.5 text-xs text-gold-300 sm:inline">{t('instructor.title')}</span>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-xs text-white/60 md:inline">{session.user.email}</span>
            <LanguageToggle dark />
            <Button
              variant="navGhost"
              size="sm"
              onClick={async () => {
                await instructorClient.auth.signOut();
                qc.removeQueries({ queryKey: ['instructor'] });
              }}
            >
              <LogOutIcon /> <span className="hidden sm:inline">{t('instructor.signOut')}</span>
            </Button>
          </div>
        </div>
      </header>
      <Routes>
        <Route index element={<SessionList />} />
        <Route path="s/:sessionId" element={<SessionDashboard />} />
      </Routes>
    </div>
  );
}
