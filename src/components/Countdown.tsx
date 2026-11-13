import { TimerIcon } from 'lucide-react';
import { clock } from '@/lib/format';
import { cn } from '@/lib/utils';

export function Countdown({ seconds, label, dark = false }: { seconds: number | null; label?: string; dark?: boolean }) {
  if (seconds == null) return null;
  const urgent = seconds <= 30;
  const warn = seconds <= 120;
  return (
    <div
      role="timer"
      aria-live="off"
      aria-label={label}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-base font-bold tabular',
        dark ? 'bg-white/10 text-white' : 'bg-secondary text-navy-900',
        warn && 'bg-gold-500 text-navy-950',
        urgent && 'animate-pulse bg-red-600 text-white',
      )}
    >
      <TimerIcon className="size-4" aria-hidden />
      {clock(seconds)}
    </div>
  );
}
