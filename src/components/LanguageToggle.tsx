import { LanguagesIcon } from 'lucide-react';
import { useI18n, type Lang } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export function LanguageToggle({ onChange, dark = false }: { onChange?: (l: Lang) => void; dark?: boolean }) {
  const { lang, setLang, t } = useI18n();
  const options: Array<[Lang, string]> = [
    ['en', 'EN'],
    ['zh', '中文'],
  ];
  return (
    <div
      role="radiogroup"
      aria-label={t('app.language')}
      className={cn('inline-flex items-center gap-0.5 rounded-lg p-0.5', dark ? 'bg-white/10' : 'bg-secondary')}
    >
      <LanguagesIcon className={cn('mx-1 size-4', dark ? 'text-white/70' : 'text-muted-foreground')} aria-hidden />
      {options.map(([l, label]) => (
        <button
          key={l}
          role="radio"
          aria-checked={lang === l}
          onClick={() => {
            setLang(l);
            onChange?.(l);
          }}
          className={cn(
            'rounded-md px-2 py-1 text-xs font-semibold transition-colors',
            lang === l
              ? dark
                ? 'bg-gold-500 text-navy-950'
                : 'bg-white text-navy-900 shadow-sm'
              : dark
                ? 'text-white/80 hover:text-white'
                : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
