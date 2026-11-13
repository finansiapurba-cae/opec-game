import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Loader2Icon, TriangleAlertIcon } from 'lucide-react';
import { isConfigured, STANDALONE } from '@/lib/supabase';
import { ensureSoloHost } from '@/lib/standalone/solo';
import { useI18n } from '@/lib/i18n';
import Landing from '@/pages/Landing';
import Rules from '@/pages/Rules';

const StudentApp = lazy(() => import('@/pages/student/StudentApp'));
const InstructorApp = lazy(() => import('@/pages/instructor/InstructorApp'));
const FinalResults = lazy(() => import('@/pages/results/FinalResults'));

function Loading() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <Loader2Icon className="size-8 animate-spin text-navy-700" />
    </div>
  );
}

function NotConfigured() {
  const { t } = useI18n();
  return (
    <div className="grid min-h-dvh place-items-center bg-trading-grid p-4">
      <div className="max-w-md rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-2 flex items-center gap-2 text-lg font-semibold text-navy-900">
          <TriangleAlertIcon className="size-5 text-gold-600" /> {t('app.notConfiguredTitle')}
        </div>
        <p className="text-sm text-muted-foreground">{t('app.notConfiguredBody')}</p>
      </div>
    </div>
  );
}

export default function App() {
  // browser-only build: resume the automatic instructor of a solo game after a reload
  useEffect(() => {
    if (STANDALONE) ensureSoloHost();
  }, []);
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/rules" element={<Rules />} />
        <Route path="/play" element={isConfigured ? <StudentApp /> : <NotConfigured />} />
        <Route path="/instructor/*" element={isConfigured ? <InstructorApp /> : <NotConfigured />} />
        <Route path="/results/:sessionId" element={isConfigured ? <FinalResults /> : <NotConfigured />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
