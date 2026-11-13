import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftIcon, Loader2Icon, ShieldAlertIcon } from 'lucide-react';
import { toast } from 'sonner';
import { instructorClient } from '@/lib/supabase';
import { rpc } from '@/lib/rpc';
import { useErrorText, useI18n } from '@/lib/i18n';
import { Brand } from '@/components/Brand';
import { LanguageToggle } from '@/components/LanguageToggle';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function Shell({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="min-h-dvh bg-trading-grid">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <Link to="/">
          <Brand />
        </Link>
        <LanguageToggle dark />
      </header>
      <main className="mx-auto flex max-w-md flex-col gap-4 px-4 pt-6 pb-16">
        {children}
        <Button asChild variant="navGhost" className="self-start">
          <Link to="/">
            <ArrowLeftIcon /> {t('app.back')}
          </Link>
        </Button>
      </main>
    </div>
  );
}

export function Login() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'in' | 'up'>('in');

  async function submit() {
    setBusy(true);
    try {
      if (mode === 'in') {
        const { error } = await instructorClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await instructorClient.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) toast.info(t('instructor.checkEmail'));
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <Card className="border-0 shadow-2xl">
        <CardHeader>
          <CardTitle className="text-xl">{t('instructor.title')}</CardTitle>
          <CardDescription>{t('app.course')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">{t('instructor.email')}</Label>
              <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">{t('instructor.password')}</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            <Button type="submit" variant="gold" size="lg" disabled={busy}>
              {busy && <Loader2Icon className="animate-spin" />}
              {mode === 'in' ? t('instructor.signIn') : t('instructor.signUp')}
            </Button>
            <Button type="button" variant="link" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
              {mode === 'in' ? t('instructor.signUp') : t('instructor.signIn')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </Shell>
  );
}

export function NotInstructor({ email, onRedeemed }: { email: string; onRedeemed: () => void }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Shell>
      <Card className="border-0 shadow-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlertIcon className="size-5 text-gold-600" /> {t('instructor.notInstructor')}
          </CardTitle>
          <CardDescription className="font-mono text-xs break-all">{t('instructor.notInstructorHint', { email })}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Label htmlFor="invite">{t('instructor.inviteCode')}</Label>
          <div className="flex gap-2">
            <Input id="invite" value={code} onChange={(e) => setCode(e.target.value)} />
            <Button
              disabled={!code || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await rpc(instructorClient, 'redeem_instructor_invite', { p_code: code });
                  onRedeemed();
                } catch (err) {
                  toast.error(errorText(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t('instructor.redeem')}
            </Button>
          </div>
          <Button variant="outline" onClick={() => instructorClient.auth.signOut()}>
            {t('instructor.signOut')}
          </Button>
        </CardContent>
      </Card>
    </Shell>
  );
}
