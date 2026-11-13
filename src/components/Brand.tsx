import { DropletIcon } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export function Brand({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid size-9 place-items-center rounded-lg bg-gold-500 text-navy-950 shadow-sm">
        <DropletIcon className="size-5" fill="currentColor" />
      </div>
      <div className="leading-tight">
        <div className="text-[15px] font-bold tracking-tight text-white">{t('app.title')}</div>
        {!compact && <div className="text-[11px] text-white/60">{t('app.subtitle')}</div>}
      </div>
    </div>
  );
}
