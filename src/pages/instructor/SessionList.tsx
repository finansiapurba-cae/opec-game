import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BotIcon, Loader2Icon, PlusIcon, Trash2Icon, UsersIcon } from 'lucide-react';
import { toast } from 'sonner';
import { instructorClient } from '@/lib/supabase';
import { rpc } from '@/lib/rpc';
import { useErrorText, useI18n } from '@/lib/i18n';
import type { GameSession } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmAction } from '@/components/ConfirmAction';

export function SessionList() {
  const { t } = useI18n();
  const errorText = useErrorText();
  const qc = useQueryClient();
  const sessions = useQuery({
    queryKey: ['instructor', 'sessions'],
    queryFn: () => rpc<GameSession[]>(instructorClient, 'list_sessions'),
  });
  const del = useMutation({
    mutationFn: (id: string) => rpc(instructorClient, 'delete_session', { p_session: id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['instructor', 'sessions'] }),
    onError: (e) => toast.error(errorText(e)),
  });

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-navy-900">{t('instructor.sessions')}</h1>
        <CreateSessionDialog />
      </div>
      {sessions.isLoading && <Loader2Icon className="size-6 animate-spin text-navy-700" />}
      {sessions.data?.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">{t('instructor.noSessions')}</CardContent>
        </Card>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {sessions.data?.map((s) => (
          <Card key={s.id} className="gap-3">
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle className="truncate">{s.name}</CardTitle>
                  <CardDescription className="text-xs">{new Date(s.created_at).toLocaleString()}</CardDescription>
                </div>
                <Badge variant={s.status === 'running' ? 'success' : s.status === 'finished' ? 'muted' : 'gold'}>
                  {t(`instructor.status.${s.status}`)}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3 text-sm">
              <span className="flex items-center gap-1 text-muted-foreground">
                <UsersIcon className="size-4" /> {s.groups_claimed ?? 0}/21
              </span>
              {(s.bots ?? 0) > 0 && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <BotIcon className="size-4" /> {s.bots}
                </span>
              )}
              <span className="text-muted-foreground">
                {t('app.periodN', { n: s.current_period })} / {s.total_periods}
              </span>
              <div className="ml-auto flex gap-2">
                <ConfirmAction
                  trigger={
                    <Button variant="ghost" size="icon" aria-label={t('instructor.delete')}>
                      <Trash2Icon className="text-red-600" />
                    </Button>
                  }
                  title={t('instructor.delete')}
                  description={t('instructor.deleteConfirm', { name: s.name })}
                  destructive
                  onConfirm={() => del.mutate(s.id)}
                />
                <Button asChild>
                  <Link to={`/instructor/s/${s.id}`}>{t('instructor.open')}</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}

function CreateSessionDialog() {
  const { t } = useI18n();
  const errorText = useErrorText();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(() => `OPEC Game ${new Date().toLocaleDateString()}`);
  const [demo, setDemo] = useState(false);
  const [randomize, setRandomize] = useState(true);
  const [minutes, setMinutes] = useState('10');
  const [periods, setPeriods] = useState('10');
  const [extrap, setExtrap] = useState<'linear' | 'clamp'>('linear');
  const [shift, setShift] = useState<'quantity' | 'price'>('quantity');
  const [noise, setNoise] = useState('1.5');
  const [cardMode, setCardMode] = useState<'nominal' | 'compounded'>('nominal');
  const [missing, setMissing] = useState('0');
  const [reveal, setReveal] = useState(true);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const s = await rpc<GameSession>(instructorClient, 'create_session', {
        p_name: name,
        p_is_demo: demo,
        p_randomize: randomize,
        p_period_seconds: Math.round(Number(minutes) * 60),
        p_total_periods: Number(periods),
        p_config: {
          price: { extrapolation: extrap, demand_shift: shift },
          demand: { noise_pct: Number(noise) },
          accounting: { card_cost_mode: cardMode },
          production: { missing_first_period_pct: Number(missing) },
          reveal_all_after_game: reveal,
        },
      });
      await qc.invalidateQueries({ queryKey: ['instructor', 'sessions'] });
      setOpen(false);
      navigate(`/instructor/s/${s.id}`);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="gold">
          <PlusIcon /> {t('instructor.newSession')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('instructor.newSession')}</DialogTitle>
          <DialogDescription>{t('app.course')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sname">{t('instructor.sessionName')}</Label>
            <Input id="sname" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mins">{t('instructor.periodLength')}</Label>
              <Input id="mins" type="number" min={0} step={0.5} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="periods">{t('instructor.totalPeriods')}</Label>
              <Input id="periods" type="number" min={1} max={30} value={periods} onChange={(e) => setPeriods(e.target.value)} />
            </div>
          </div>
          <label className="flex items-start justify-between gap-3 rounded-lg border p-3">
            <span>
              <span className="block text-sm font-medium">{t('instructor.demoMode')}</span>
              <span className="text-xs text-muted-foreground">{t('instructor.demoHint')}</span>
            </span>
            <Switch checked={demo} onCheckedChange={setDemo} />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <span className="text-sm font-medium">{t('instructor.randomize')}</span>
            <Switch checked={randomize} onCheckedChange={setRandomize} />
          </label>

          <fieldset className="flex flex-col gap-3 rounded-lg border border-gold-500/40 bg-accent/30 p-3">
            <legend className="px-1 text-sm font-semibold text-accent-foreground">{t('instructor.assumptions')}</legend>
            <Field label={t('instructor.extrapolation')}>
              <Select value={extrap} onValueChange={(v) => setExtrap(v as 'linear' | 'clamp')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="linear">{t('instructor.extrapLinear')}</SelectItem>
                  <SelectItem value="clamp">{t('instructor.extrapClamp')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('instructor.demandShift')}>
              <Select value={shift} onValueChange={(v) => setShift(v as 'quantity' | 'price')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="quantity">{t('instructor.shiftQuantity')}</SelectItem>
                  <SelectItem value="price">{t('instructor.shiftPrice')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('instructor.cardMode')}>
              <Select value={cardMode} onValueChange={(v) => setCardMode(v as 'nominal' | 'compounded')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nominal">{t('instructor.cardNominal')}</SelectItem>
                  <SelectItem value="compounded">{t('instructor.cardCompounded')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('instructor.noise')}>
                <Input type="number" min={0} max={10} step={0.1} value={noise} onChange={(e) => setNoise(e.target.value)} />
              </Field>
              <Field label={t('instructor.missingFirst')}>
                <Input type="number" min={0} max={100} value={missing} onChange={(e) => setMissing(e.target.value)} />
              </Field>
            </div>
            <label className="flex items-center justify-between gap-3">
              <span className="text-sm">{t('instructor.revealAfter')}</span>
              <Switch checked={reveal} onCheckedChange={setReveal} />
            </label>
          </fieldset>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t('app.cancel')}
          </Button>
          <Button variant="gold" disabled={busy || !name.trim()} onClick={create}>
            {busy && <Loader2Icon className="animate-spin" />}
            {t('instructor.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs leading-snug">{label}</Label>
      {children}
    </div>
  );
}
