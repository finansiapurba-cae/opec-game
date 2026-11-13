import { Link } from 'react-router-dom';
import { BookOpenIcon, GraduationCapIcon, PresentationIcon } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { COUNTRY_ORDER, Flag, countryName } from '@/lib/countries';
import { Brand } from '@/components/Brand';
import { LanguageToggle } from '@/components/LanguageToggle';
import { Button } from '@/components/ui/button';
import { STANDALONE } from '@/lib/supabase';
import { SoloCard } from './SoloCard';

export default function Landing() {
  const { t, lang } = useI18n();
  const steps = ['step1', 'step2', 'step3', 'step4', 'step5', 'step6'];
  return (
    <div className="min-h-dvh bg-background">
      <section className="bg-trading-grid text-white">
        <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <Brand />
          <div className="flex items-center gap-2">
            <Button asChild variant="navGhost" size="sm">
              <Link to="/rules">
                <BookOpenIcon /> <span className="hidden sm:inline">{t('app.rules')}</span>
              </Link>
            </Button>
            <LanguageToggle dark />
          </div>
        </header>
        <div className="mx-auto grid max-w-6xl gap-10 px-4 pt-8 pb-16 md:grid-cols-[1.2fr_1fr] md:items-center md:pt-14">
          <div>
            <p className="mb-3 text-xs font-semibold tracking-[0.2em] text-gold-400 uppercase">{t('app.course')}</p>
            <h1 className="text-4xl leading-tight font-bold tracking-tight sm:text-5xl">
              {t('app.title')} <span className="text-gold-400">—</span>
              <br />
              <span className="text-white/90">{t('app.subtitle')}</span>
            </h1>
            <p className="mt-4 text-lg text-gold-300">{t('landing.hero')}</p>
            <p className="mt-3 max-w-xl text-white/75">{t('landing.intro')}</p>
            <div className={STANDALONE ? 'hidden' : 'mt-8 grid gap-3 sm:grid-cols-2'}>
              <Link
                to="/play"
                className="group flex items-start gap-3 rounded-xl bg-gold-500 p-4 text-navy-950 shadow-lg transition-transform hover:-translate-y-0.5"
              >
                <GraduationCapIcon className="mt-0.5 size-6 shrink-0" />
                <span>
                  <span className="block font-semibold">{t('landing.student')}</span>
                  <span className="text-sm opacity-80">{t('landing.studentHint')}</span>
                </span>
              </Link>
              <Link
                to="/instructor"
                className="group flex items-start gap-3 rounded-xl border border-white/20 bg-white/5 p-4 transition-transform hover:-translate-y-0.5 hover:bg-white/10"
              >
                <PresentationIcon className="mt-0.5 size-6 shrink-0 text-gold-400" />
                <span>
                  <span className="block font-semibold">{t('landing.instructor')}</span>
                  <span className="text-sm text-white/70">{t('landing.instructorHint')}</span>
                </span>
              </Link>
            </div>
          </div>
          {STANDALONE ? (
            <SoloCard />
          ) : (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
            <div className="mb-3 flex items-center justify-between text-xs text-white/60">
              <span>{t('app.worldX', { w: 'A · B · C' })}</span>
              <span>kb · USD</span>
            </div>
            <ul className="flex flex-col gap-1.5">
              {COUNTRY_ORDER.map((c, i) => (
                <li key={c} className="flex items-center gap-3 rounded-lg bg-white/5 px-3 py-2 text-sm">
                  <Flag code={c} className="h-5 w-7" />
                  <span className="flex-1">{countryName(c, lang)}</span>
                  <span className="font-mono text-xs text-white/60 tabular">
                    {[12000, 4600, 3700, 3300, 3000, 4400, 2700][i].toLocaleString()} kb · ${[9, 10, 16, 13, 5, 20, 7][i]}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          )}
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-4 py-12">
        <h2 className="mb-6 text-2xl font-bold text-navy-900">{t('landing.howItWorks')}</h2>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((k, i) => (
            <li key={k} className="flex gap-3 rounded-xl border bg-card p-4 shadow-xs">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-navy-900 text-sm font-bold text-gold-400">{i + 1}</span>
              <p className="text-sm text-foreground/85">{t(`landing.${k}`)}</p>
            </li>
          ))}
        </ol>
        <p className="mt-6 text-xs text-muted-foreground">{t('app.unitsNote')}</p>
      </section>
    </div>
  );
}
