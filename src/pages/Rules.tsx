import { Link } from 'react-router-dom';
import { ArrowLeftIcon, BookOpenIcon, FlaskConicalIcon } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { DEFAULT_CONFIG, uniformSharePrice } from '@/lib/engine';
import { Brand } from '@/components/Brand';
import { LanguageToggle } from '@/components/LanguageToggle';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CHART, SeriesChart } from '@/components/charts';
import { Term, type GlossaryKey } from '@/components/Term';

const GLOSSARY: GlossaryKey[] = ['barrel', 'marginalCost', 'capacity', 'reserves', 'cartel', 'profit', 'finalWealth', 'hedge', 'pledge', 'audit'];

export default function Rules() {
  const { t } = useI18n();
  const cfg = DEFAULT_CONFIG;
  const curve = Array.from({ length: 15 }, (_, i) => 40 + i * 5).map((s) => ({
    share: s,
    low: uniformSharePrice(s, 'low', cfg),
    high: uniformSharePrice(s, 'high', cfg),
  }));

  return (
    <div className="min-h-dvh">
      <header className="bg-navy-900">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/">
            <Brand />
          </Link>
          <LanguageToggle dark />
        </div>
      </header>
      <main className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/">
              <ArrowLeftIcon /> {t('app.back')}
            </Link>
          </Button>
          <h1 className="text-2xl font-bold text-navy-900">{t('rules.title')}</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpenIcon className="size-4" /> {t('rules.official')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
              {['r1', 'r2', 'r3', 'r4', 'r5', 'r6'].map((k) => (
                <li key={k}>{t(`rules.${k}`)}</li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('rules.priceTable')}</CardTitle>
            </CardHeader>
            <CardContent className="px-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('rules.share')}</TableHead>
                    <TableHead className="text-right">{t('rules.low')}</TableHead>
                    <TableHead className="text-right">{t('rules.high')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...cfg.price.shares].reverse().map((s, i) => {
                    const idx = cfg.price.shares.length - 1 - i;
                    return (
                      <TableRow key={s}>
                        <TableCell>{Math.round(s * 100)}%</TableCell>
                        <TableCell className="text-right">${cfg.price.low[idx]}</TableCell>
                        <TableCell className="text-right">${cfg.price.high[idx]}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card className="gap-2">
            <CardHeader>
              <CardTitle className="text-base">{t('rules.curve')}</CardTitle>
              <CardDescription className="text-xs">{t('rules.curveHint')}</CardDescription>
            </CardHeader>
            <CardContent className="px-2">
              <SeriesChart
                data={curve}
                xKey="share"
                xFormatter={(v) => `${v}%`}
                series={[
                  { key: 'low', name: t('rules.low'), color: CHART.series1, dot: false },
                  { key: 'high', name: t('rules.high'), color: CHART.series2, dot: false },
                ]}
                yFormatter={(v) => `$${v}`}
                valueFormatter={(v) => `$${v.toFixed(2)}`}
                height={240}
              />
            </CardContent>
          </Card>
        </div>

        <Card className="border-gold-500/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FlaskConicalIcon className="size-4 text-gold-600" /> {t('rules.assumptions')}
            </CardTitle>
            <CardDescription>{t('rules.disclaimer')}</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
              {['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'].map((k) => (
                <li key={k}>{t(`rules.${k}`)}</li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Glossary · 名詞解釋</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 sm:grid-cols-2">
              {GLOSSARY.map((k) => (
                <div key={k} className="rounded-lg border p-3">
                  <dt className="font-semibold text-navy-900">
                    <Term k={k} />
                  </dt>
                  <dd className="mt-1 text-sm text-muted-foreground">{t(`glossary.${k}Def`)}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
