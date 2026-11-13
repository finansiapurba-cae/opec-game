import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BotIcon, Loader2Icon, PlayIcon, PresentationIcon, RotateCcwIcon } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { CountryCode, WorldCode } from '@/lib/types';
import { COUNTRY_ORDER, Flag, WORLD_CODES, countryName } from '@/lib/countries';
import { savedSoloGame, startSoloGame } from '@/lib/standalone/solo';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** Browser-only build: start or resume a practice game against 20 bots. */
export function SoloCard() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const saved = savedSoloGame();
  const [country, setCountry] = useState<CountryCode>(saved?.country ?? 'SAU');
  const [world, setWorld] = useState<WorldCode>(saved?.world ?? 'A');
  const [minutes, setMinutes] = useState('4');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await startSoloGame({ world, country, minutes: Number(minutes), lang });
      navigate('/play');
    } catch (err) {
      setError(t('solo.failed', { msg: (err as Error).message }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl bg-white p-5 text-foreground shadow-2xl">
      <div className="mb-1 flex items-center gap-2 text-lg font-bold text-navy-900">
        <BotIcon className="size-5 text-gold-600" /> {t('solo.title')}
      </div>
      <p className="mb-4 text-sm text-muted-foreground">{t('solo.intro')}</p>

      <div className="grid gap-3 sm:grid-cols-[1.6fr_1fr_1fr]">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="solo-country">{t('solo.country')}</Label>
          <Select value={country} onValueChange={(v) => setCountry(v as CountryCode)}>
            <SelectTrigger id="solo-country">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COUNTRY_ORDER.map((c) => (
                <SelectItem key={c} value={c}>
                  <span className="flex items-center gap-2">
                    <Flag code={c} /> {countryName(c, lang)}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="solo-world">{t('solo.world')}</Label>
          <Select value={world} onValueChange={(v) => setWorld(v as WorldCode)}>
            <SelectTrigger id="solo-world">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WORLD_CODES.map((w) => (
                <SelectItem key={w} value={w}>
                  {t('app.worldX', { w })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="solo-minutes">{t('solo.minutes')}</Label>
          <Select value={minutes} onValueChange={setMinutes}>
            <SelectTrigger id="solo-minutes">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['2', '4', '6', '10'].map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {saved && (
          <Button variant="gold" size="lg" onClick={() => navigate('/play')} disabled={busy}>
            <PlayIcon /> {t('solo.resume')}
          </Button>
        )}
        <Button variant={saved ? 'outline' : 'gold'} size="lg" onClick={start} disabled={busy}>
          {busy ? <Loader2Icon className="animate-spin" /> : saved ? <RotateCcwIcon /> : <PlayIcon />}
          {busy ? t('solo.starting') : t('solo.start')}
        </Button>
      </div>
      {saved && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t('solo.resumeHint', { country: countryName(saved.country, lang), world: saved.world })} {t('solo.newGameWarning')}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="mt-5 grid gap-1.5 border-t pt-4 text-sm">
        <div className="font-semibold text-navy-900">{t('solo.howTitle')}</div>
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-muted-foreground">
          {['how1', 'how2', 'how3', 'how4'].map((k) => (
            <li key={k}>{t(`solo.${k}`)}</li>
          ))}
        </ol>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <Link to="/instructor" className="inline-flex items-center gap-1.5 font-medium text-navy-700 underline-offset-4 hover:underline">
          <PresentationIcon className="size-4" /> {t('solo.console')}
        </Link>
        <span className="text-xs text-muted-foreground">{t('solo.consoleHint')}</span>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{t('solo.browserNote')}</p>
    </div>
  );
}
