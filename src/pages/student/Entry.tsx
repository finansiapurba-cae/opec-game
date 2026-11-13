import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftIcon, KeyRoundIcon, Loader2Icon, UsersIcon } from 'lucide-react';
import { toast } from 'sonner';
import { studentClient } from '@/lib/supabase';
import { rpc } from '@/lib/rpc';
import { useErrorText, useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Brand } from '@/components/Brand';
import { LanguageToggle } from '@/components/LanguageToggle';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type ClaimResult = { status: 'ok' | 'invalid' | 'in_use' | 'too_many_attempts'; last_seen_at?: string };

export function Entry({ onJoined }: { onJoined: () => void }) {
  const { t, lang } = useI18n();
  const errorText = useErrorText();
  const [groupNumber, setGroupNumber] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inUse, setInUse] = useState(false);

  async function claim(takeover: boolean) {
    setBusy(true);
    setError(null);
    try {
      const { data } = await studentClient.auth.getSession();
      if (!data.session) {
        const { error: authError } = await studentClient.auth.signInAnonymously();
        if (authError) throw authError;
      }
      const res = await rpc<ClaimResult>(studentClient, 'claim_group', {
        p_group_number: Number(groupNumber),
        p_access_code: code.trim().toUpperCase(),
        p_takeover: takeover,
        p_language: lang,
      });
      if (res.status === 'ok') {
        setInUse(false);
        onJoined();
      } else if (res.status === 'in_use') {
        setInUse(true);
      } else if (res.status === 'too_many_attempts') {
        setError(t('entry.tooMany'));
      } else {
        setError(t('entry.invalid'));
      }
    } catch (err) {
      const msg = errorText(err);
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  const valid = Number(groupNumber) >= 1 && code.trim().length >= 4;

  return (
    <div className="min-h-dvh bg-trading-grid">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <Link to="/" aria-label={t('app.back')}>
          <Brand />
        </Link>
        <LanguageToggle dark />
      </header>
      <main className="mx-auto flex max-w-md flex-col gap-4 px-4 pt-6 pb-16">
        <Card className="border-0 shadow-2xl">
          <CardHeader>
            <CardTitle className="text-xl">{t('entry.title')}</CardTitle>
            <CardDescription>{t('app.course')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (valid && !busy) void claim(false);
              }}
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="group">
                  <UsersIcon className="size-4 text-muted-foreground" />
                  {t('entry.groupNumber')}
                </Label>
                <Input
                  id="group"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  min={1}
                  max={99}
                  value={groupNumber}
                  onChange={(e) => setGroupNumber(e.target.value.replace(/\D/g, '').slice(0, 2))}
                  placeholder="1–21"
                  autoComplete="off"
                  className="text-lg"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="code">
                  <KeyRoundIcon className="size-4 text-muted-foreground" />
                  {t('entry.accessCode')}
                </Label>
                <Input
                  id="code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
                  placeholder="ABC123"
                  autoComplete="off"
                  autoCapitalize="characters"
                  className="font-mono text-lg tracking-[0.3em]"
                />
                <p className="text-xs text-muted-foreground">{t('entry.accessCodeHint')}</p>
              </div>
              <div className="flex flex-col gap-2">
                <Label>{t('entry.language')}</Label>
                <LanguageToggle />
              </div>
              {error && (
                <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </p>
              )}
              <Button type="submit" variant="gold" size="lg" disabled={!valid || busy}>
                {busy && <Loader2Icon className="animate-spin" />}
                {busy ? t('entry.joining') : t('entry.join')}
              </Button>
            </form>
          </CardContent>
        </Card>
        <Button asChild variant="navGhost" className="self-start">
          <Link to="/">
            <ArrowLeftIcon /> {t('app.back')}
          </Link>
        </Button>
      </main>

      <AlertDialog open={inUse} onOpenChange={setInUse}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('entry.inUseTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('entry.inUseBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('app.cancel')}</AlertDialogCancel>
            <Button variant="gold" disabled={busy} onClick={() => void claim(true)}>
              {t('entry.takeOver')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
