import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { GavelIcon, Loader2Icon, LockIcon, SendIcon, ShieldIcon } from 'lucide-react';
import { toast } from 'sonner';
import { studentClient } from '@/lib/supabase';
import { rpc } from '@/lib/rpc';
import { useErrorText, useI18n } from '@/lib/i18n';
import type { ChatMessage, Meeting } from '@/lib/types';
import { Flag, countryName } from '@/lib/countries';
import { clock } from '@/lib/format';
import { useNow } from '@/hooks/useClock';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useStudent } from '../context';

export function activeMeeting(meetings: Meeting[], worldId: string, serverNow: number): Meeting | null {
  return (
    meetings.find(
      (m) =>
        (m.world_id === null || m.world_id === worldId) &&
        new Date(m.starts_at).getTime() <= serverNow &&
        new Date(m.ended_at ?? m.ends_at).getTime() > serverNow,
    ) ?? null
  );
}

export function TalkTab() {
  const { s, cfg, talkPeriod, chat, offset } = useStudent();
  const { t } = useI18n();
  const now = useNow(1000) + offset;
  const locked = talkPeriod < cfg.talk.start_period || s.session.status !== 'running';
  const meeting = activeMeeting(s.meetings, s.world.id, now);

  if (locked) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-muted">
            <LockIcon className="size-6 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold text-navy-900">{t('talk.lockedTitle')}</h3>
          <p className="max-w-md text-sm text-muted-foreground">{t('talk.lockedBody')}</p>
        </CardContent>
      </Card>
    );
  }

  const meetingMessages = meeting ? chat.filter((m) => m.meeting_id === meeting.id) : [];
  const worldMessages = chat.filter((m) => !m.meeting_id);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className={cn('gap-3', meeting ? 'border-gold-500 ring-2 ring-gold-500/25' : '')}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <GavelIcon className="size-4" /> {meeting ? t('talk.meetingLive') : t('talk.meeting')}
            {meeting && (
              <Badge variant="gold" className="ml-auto font-mono">
                {t('talk.meetingEnds', { t: clock((new Date(meeting.ended_at ?? meeting.ends_at).getTime() - now) / 1000) })}
              </Badge>
            )}
          </CardTitle>
          {meeting?.title && <CardDescription>{meeting.title}</CardDescription>}
        </CardHeader>
        <CardContent>
          {meeting ? (
            <ChatPanel messages={meetingMessages} meetingId={meeting.id} placeholder={t('talk.meetingPlaceholder')} />
          ) : (
            <p className="rounded-lg bg-muted px-3 py-6 text-center text-sm text-muted-foreground">{t('talk.noMeeting')}</p>
          )}
        </CardContent>
      </Card>

      <Card className="gap-3">
        <CardHeader>
          <CardTitle className="text-base">{t('talk.worldChat', { w: s.world.code })}</CardTitle>
          <CardDescription className="flex items-center gap-1.5 text-xs">
            <ShieldIcon className="size-3.5" /> {t('talk.privacy', { w: s.world.code })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {s.session.chat_enabled ? (
            <ChatPanel messages={worldMessages} placeholder={t('talk.placeholder', { w: s.world.code })} />
          ) : (
            <>
              <ChatPanel messages={worldMessages} readOnly />
              <p className="mt-2 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                <LockIcon className="size-4" /> {t('talk.disabledBody')}
              </p>
            </>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground lg:col-span-2">
        {t('glossary.cartel')}: {t('glossary.cartelDef')}
      </p>
    </div>
  );
}

function ChatPanel({
  messages,
  meetingId,
  placeholder,
  readOnly,
}: {
  messages: ChatMessage[];
  meetingId?: string;
  placeholder?: string;
  readOnly?: boolean;
}) {
  const { s } = useStudent();
  const { t, lang } = useI18n();
  const errorText = useErrorText();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    try {
      await rpc(studentClient, 'send_chat', { p_body: body, p_meeting: meetingId ?? null });
      setText('');
      await qc.invalidateQueries({ queryKey: ['student', 'chat'] });
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div ref={listRef} className="flex h-80 flex-col gap-2 overflow-y-auto rounded-lg border bg-muted/30 p-3" aria-live="polite">
        {messages.length === 0 && <p className="m-auto text-sm text-muted-foreground">{t('talk.empty')}</p>}
        {messages.map((m) => {
          const mine = m.group_id === s.group.id;
          const teacher = m.group_id === null;
          return (
            <div key={m.id} className={cn('flex max-w-[85%] flex-col gap-0.5', mine ? 'self-end items-end' : 'self-start')}>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                {teacher ? (
                  <Badge className="h-4 px-1.5 text-[10px]">{t('talk.instructor')}</Badge>
                ) : (
                  <>
                    <Flag code={m.country_code} className="h-3 w-4" />
                    <span className="font-medium text-foreground/80">{countryName(m.country_code, lang)}</span>
                  </>
                )}
                <span>{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <div
                className={cn(
                  'rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words',
                  mine ? 'rounded-br-sm bg-navy-900 text-white' : teacher ? 'rounded-bl-sm bg-gold-300/60 text-navy-950' : 'rounded-bl-sm bg-white shadow-xs',
                )}
              >
                {m.body}
              </div>
            </div>
          );
        })}
      </div>
      {!readOnly && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} maxLength={1000} aria-label={placeholder} />
          <Button type="submit" disabled={busy || !text.trim()} aria-label={t('talk.send')}>
            {busy ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
            <span className="hidden sm:inline">{t('talk.send')}</span>
          </Button>
        </form>
      )}
    </div>
  );
}
