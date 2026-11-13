import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function StatTile({
  label,
  value,
  sub,
  icon,
  tone = 'default',
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  tone?: 'default' | 'gold' | 'green' | 'navy';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-1 rounded-xl border bg-card p-4 shadow-xs',
        tone === 'gold' && 'border-gold-500/40 bg-accent/60',
        tone === 'green' && 'border-oil-600/25 bg-green-50/70',
        tone === 'navy' && 'border-navy-900 bg-navy-900 text-white',
        className,
      )}
    >
      <div className={cn('flex items-center gap-2 text-xs font-medium text-muted-foreground', tone === 'navy' && 'text-white/70')}>
        {icon}
        <span className="min-w-0">{label}</span>
      </div>
      <div className={cn('text-xl font-semibold tracking-tight text-navy-900 sm:text-2xl', tone === 'navy' && 'text-white')}>{value}</div>
      {sub && <div className={cn('text-xs text-muted-foreground', tone === 'navy' && 'text-white/60')}>{sub}</div>}
    </div>
  );
}
