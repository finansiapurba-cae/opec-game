import type { ReactNode } from 'react';
import { InfoIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export type GlossaryKey =
  | 'barrel'
  | 'marginalCost'
  | 'capacity'
  | 'reserves'
  | 'cartel'
  | 'profit'
  | 'finalWealth'
  | 'hedge'
  | 'pledge'
  | 'audit';

/** A label with a glossary tooltip (keyboard- and touch-accessible). */
export function Term({ k, children, className }: { k: GlossaryKey; children?: ReactNode; className?: string }) {
  const { t } = useI18n();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn('inline-flex items-center gap-1 text-left underline decoration-dotted decoration-muted-foreground/60 underline-offset-4', className)}
        >
          {children ?? t(`glossary.${k}`)}
          <InfoIcon className="size-3.5 text-muted-foreground" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <p className="font-semibold text-gold-300">{t(`glossary.${k}`)}</p>
        <p>{t(`glossary.${k}Def`)}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function HintIcon({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={text} className="inline-flex text-muted-foreground hover:text-foreground">
          <InfoIcon className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}
