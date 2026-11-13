import { useState } from 'react';
import { DollarSignIcon, DropletsIcon, FactoryIcon, Loader2Icon, PlayIcon, TargetIcon } from 'lucide-react';
import { toast } from 'sonner';
import { studentClient } from '@/lib/supabase';
import { rpc } from '@/lib/rpc';
import { useErrorText, useI18n } from '@/lib/i18n';
import type { StudentState } from '@/lib/types';
import { Flag, countryName } from '@/lib/countries';
import { num, price } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Brand } from '@/components/Brand';
import { LanguageToggle } from '@/components/LanguageToggle';
import { Term } from '@/components/Term';

export function Briefing({ data, onReady }: { data: StudentState; onReady: () => void }) {
  const { t, lang } = useI18n();
  const errorText = useErrorText();
  const [busy, setBusy] = useState(false);
  const c = data.country;

  async function start() {
    setBusy(true);
    try {
      await rpc(studentClient, 'set_ready', { p_ready: true });
      onReady();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh bg-trading-grid">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <Brand />
        <LanguageToggle dark onChange={(l) => void rpc(studentClient, 'set_language', { p_language: l }).catch(() => {})} />
      </header>
      <main className="mx-auto max-w-2xl px-4 pt-4 pb-16">
        <p className="mb-3 text-sm font-semibold tracking-widest text-gold-400 uppercase">{t('briefing.title')}</p>
        <Card className="overflow-hidden border-0 py-0 shadow-2xl">
          <div className="flex flex-col gap-4 bg-gradient-to-br from-navy-800 to-navy-950 p-6 text-white sm:flex-row sm:items-center">
            <Flag code={c.code} className="h-16 w-[5.33rem] rounded-md ring-2 ring-white/20" />
            <div className="min-w-0">
              <p className="text-sm text-white/70">{t('briefing.youControl')}</p>
              <h1 className="text-3xl font-bold tracking-tight">{countryName(c.code, lang)}</h1>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant="navOutline">{t('app.groupN', { n: data.group.group_number })}</Badge>
                <Badge className="bg-gold-500 text-navy-950">{t('briefing.inWorld', { w: data.world.code })}</Badge>
              </div>
            </div>
          </div>
          <CardContent className="grid gap-3 p-6 sm:grid-cols-3">
            <div className="rounded-lg border p-4">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                <FactoryIcon className="size-4" />
                <Term k="capacity">{t('briefing.capacity')}</Term>
              </div>
              <div className="text-2xl font-bold text-navy-900 tabular">{num(c.capacity)}</div>
              <div className="text-xs text-muted-foreground">{t('briefing.capacityUnit')}</div>
            </div>
            <div className="rounded-lg border p-4">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                <DropletsIcon className="size-4" />
                <Term k="reserves">{t('briefing.reserves')}</Term>
              </div>
              <div className="text-2xl font-bold text-navy-900 tabular">{num(c.reserves)}</div>
              <div className="text-xs text-muted-foreground">kb</div>
            </div>
            <div className="rounded-lg border p-4">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                <DollarSignIcon className="size-4" />
                <Term k="marginalCost">{t('briefing.marginalCost')}</Term>
              </div>
              <div className="text-2xl font-bold text-navy-900 tabular">{price(c.marginal_cost)}</div>
              <div className="text-xs text-muted-foreground">{t('briefing.perBarrel')}</div>
            </div>
            <p className="text-sm text-muted-foreground sm:col-span-3">{t('briefing.reservesNote')}</p>
            <div className="flex items-start gap-3 rounded-lg bg-accent p-4 text-sm text-accent-foreground sm:col-span-3">
              <TargetIcon className="mt-0.5 size-5 shrink-0" />
              <p>
                {t('briefing.goal')}{' '}
                <Term k="finalWealth" className="font-medium" />
              </p>
            </div>
            <Button size="lg" variant="gold" className="sm:col-span-3" disabled={busy} onClick={start}>
              {busy ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
              {t('briefing.startGame')}
            </Button>
            <p className="text-center text-xs text-muted-foreground sm:col-span-3">{t('app.unitsNote')}</p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
