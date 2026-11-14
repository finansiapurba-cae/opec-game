import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckIcon, ClipboardCopyIcon } from 'lucide-react';
import { toast } from 'sonner';
import { studentClient } from '@/lib/supabase';
import { rpc } from '@/lib/rpc';
import { useI18n } from '@/lib/i18n';
import type { FinalResultsPayload } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useStudent } from './context';
import { buildSummary } from './summary';

/** Copies a text summary of the group's game (to paste into a chat for feedback). */
export function CopySummaryButton() {
  const { s } = useStudent();
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [fallback, setFallback] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const finished = s.session.status === 'finished';
  // after the game the summary also compares the twins in the other worlds
  const final = useQuery({
    queryKey: ['student', 'final-summary', s.session.id],
    queryFn: () => rpc<FinalResultsPayload>(studentClient, 'get_final_results', { p_session: s.session.id }),
    enabled: finished,
  });

  function copy() {
    const text = buildSummary(s, final.data);
    const done = () => {
      setCopied(true);
      toast.success(t('summary.copied'));
      setTimeout(() => setCopied(false), 2500);
    };
    try {
      // must run inside the click itself (some browsers refuse it later)
      navigator.clipboard.writeText(text).then(done, () => setFallback(text));
    } catch {
      setFallback(text);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={copy} disabled={finished && final.isLoading}>
        {copied ? <CheckIcon className="text-oil-600" /> : <ClipboardCopyIcon />}
        {t('summary.copy')}
      </Button>
      <Dialog open={fallback !== null} onOpenChange={(o) => !o && setFallback(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('summary.fallbackTitle')}</DialogTitle>
            <DialogDescription>{t('summary.fallbackBody')}</DialogDescription>
          </DialogHeader>
          <textarea
            id="game-summary"
            ref={areaRef}
            readOnly
            value={fallback ?? ''}
            onFocus={(e) => e.currentTarget.select()}
            className="h-80 w-full rounded-md border bg-muted/40 p-3 font-mono text-xs"
          />
          <Button
            onClick={() => {
              areaRef.current?.focus();
              areaRef.current?.select();
            }}
          >
            {t('summary.selectAll')}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
