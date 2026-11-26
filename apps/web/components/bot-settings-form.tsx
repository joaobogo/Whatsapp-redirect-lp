'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ChevronDown, Play, Save } from 'lucide-react';
import { toast } from 'sonner';
import {
  APPROVAL_MODE_LABELS,
  SCHEDULE_PRESETS,
  presetById,
  presetForCron,
  type ApprovalMode,
  type BotModel,
  type BotRow,
  type FieldSpec,
} from '@fgv/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label, Select, Textarea } from '@/components/ui/input';
import { RunSheet } from '@/components/run-sheet';
import { SettingsFields } from '@/components/settings-form';
import { useSettingsForm } from '@/components/use-settings-form';
import { updateBotAction, type BotPatch } from '@/lib/actions';
import { cn } from '@/lib/utils';

const CUSTOM = 'custom';

export function BotSettingsForm({
  bot,
  fields,
  allowedModes,
  contacts,
  workers,
  canOperate,
  isOwner,
  stopped,
}: {
  bot: BotRow;
  fields: FieldSpec[];
  allowedModes: ApprovalMode[];
  contacts: boolean;
  workers: { id: string; name: string }[];
  canOperate: boolean;
  isOwner: boolean;
  stopped: boolean;
}) {
  const router = useRouter();
  const form = useSettingsForm(fields, bot.settings);
  const [pending, startTransition] = useTransition();
  const [sheetOpen, setSheetOpen] = useState(false);

  const [schedule, setSchedule] = useState(presetForCron(bot.schedule_cron)?.id ?? CUSTOM);
  const [mode, setMode] = useState<ApprovalMode>(bot.approval_mode);
  const [dailyCap, setDailyCap] = useState(bot.daily_cap);
  const [model, setModel] = useState<BotModel>(bot.model);
  const [worker, setWorker] = useState(bot.preferred_worker ?? '');
  const [maxMinutes, setMaxMinutes] = useState(bot.max_minutes);
  const [prompt, setPrompt] = useState(bot.prompt_template);
  const readOnly = !canOperate;

  const save = form.handleSubmit((values) => {
    const patch: BotPatch = {
      settings: values,
      approval_mode: mode,
      daily_cap: dailyCap,
      model,
      preferred_worker: worker || null,
      max_minutes: maxMinutes,
    };
    if (schedule !== CUSTOM) patch.schedule_cron = presetById(schedule)?.cron ?? null;
    if (isOwner && prompt !== bot.prompt_template) patch.prompt_template = prompt;

    startTransition(async () => {
      const result = await updateBotAction(bot.slug, patch);
      if (result.ok) {
        toast.success('Saved');
        router.refresh();
        return;
      }
      for (const [key, message] of Object.entries(result.fieldErrors ?? {})) {
        form.setError(key, { type: 'server', message });
      }
      toast.error(result.error);
    });
  });

  return (
    <form onSubmit={save} className="flex flex-col gap-4" data-testid="bot-settings">
      {readOnly ? (
        <p className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
          You can look at these settings but not change them. Ask an owner to make you an operator.
        </p>
      ) : null}

      <Section title="What it does">
        <SettingsFields
          fields={fields}
          control={form.control}
          errors={form.formState.errors}
          disabled={readOnly}
        />
      </Section>

      <Section
        title="Schedule"
        hint="Times are America/Sao_Paulo. Switch it on from the Home card."
      >
        <RadioList
          name="schedule"
          value={schedule}
          disabled={readOnly}
          onChange={setSchedule}
          options={[
            ...SCHEDULE_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
            ...(schedule === CUSTOM
              ? [{ value: CUSTOM, label: `Custom (${bot.schedule_cron ?? ''})` }]
              : []),
          ]}
        />
      </Section>

      <Section title="Approval">
        <RadioList
          name="approval"
          value={mode}
          disabled={readOnly}
          onChange={(value) => setMode(value as ApprovalMode)}
          options={allowedModes.map((value) => ({
            value,
            label: APPROVAL_MODE_LABELS[value].label,
            help: APPROVAL_MODE_LABELS[value].help,
          }))}
        />
      </Section>

      <Section title="Limits">
        <div className="flex flex-col gap-5">
          {contacts ? (
            <NumberRow
              id="daily-cap"
              label="Daily cap"
              hint="Most it may send or apply in one day."
              value={dailyCap}
              min={0}
              max={bot.slug === 'linkedin-outreach' ? 20 : 200}
              disabled={readOnly}
              onChange={setDailyCap}
            />
          ) : null}
          <NumberRow
            id="max-minutes"
            label="Longest run (minutes)"
            hint="The run is stopped when it takes longer."
            value={maxMinutes}
            min={5}
            max={240}
            step={5}
            disabled={readOnly}
            onChange={setMaxMinutes}
          />
          <div className="flex flex-col gap-2">
            <Label htmlFor="model">Model</Label>
            <Select
              id="model"
              value={model}
              disabled={readOnly}
              onChange={(event) => setModel(event.target.value as BotModel)}
            >
              <option value="opus">Best quality</option>
              <option value="fast">Fast and cheap</option>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="worker">Run on</Label>
            <Select
              id="worker"
              value={worker}
              disabled={readOnly}
              onChange={(event) => setWorker(event.target.value)}
            >
              <option value="">Any computer</option>
              {workers.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Section>

      {isOwner ? (
        <details className="group rounded-xl border bg-card">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between px-4 text-base font-semibold">
            Advanced
            <ChevronDown className="size-5 transition-transform group-open:rotate-180" />
          </summary>
          <div className="flex flex-col gap-3 border-t p-4">
            <p className="flex gap-2 rounded-lg bg-warning/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
              This is the bot&apos;s instructions. A small change can change everything it does. The
              safety rules are added on top automatically and cannot be edited here.
            </p>
            <Label htmlFor="prompt">Prompt template</Label>
            <Textarea
              id="prompt"
              value={prompt}
              rows={16}
              spellCheck={false}
              className="font-mono text-sm"
              onChange={(event) => setPrompt(event.target.value)}
            />
          </div>
        </details>
      ) : null}

      {/* sticky action bar, above the phone's bottom navigation */}
      <div className="sticky bottom-16 z-10 -mx-4 flex gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur md:bottom-0">
        <Button
          type="submit"
          variant="outline"
          className="flex-1"
          disabled={readOnly || pending}
          data-testid="save-settings"
        >
          <Save />
          {pending ? 'Saving...' : 'Save'}
        </Button>
        <Button
          type="button"
          className="flex-1"
          disabled={readOnly || stopped}
          onClick={() => setSheetOpen(true)}
          data-testid="run-now"
        >
          <Play />
          Run now
        </Button>
      </div>

      <RunSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        slug={bot.slug}
        name={bot.name}
        fields={fields}
        settings={bot.settings}
      />
    </form>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-4 p-4">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </Card>
  );
}

function RadioList({
  name,
  value,
  options,
  onChange,
  disabled,
}: {
  name: string;
  value: string;
  options: { value: string; label: string; help?: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" className="flex flex-col gap-2">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <label
            key={option.value}
            className={cn(
              'flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5',
              active ? 'border-primary bg-accent' : 'border-input',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={active}
              disabled={disabled}
              onChange={() => onChange(option.value)}
              className="mt-0.5 size-5 accent-[var(--primary)]"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{option.label}</span>
              {option.help ? (
                <span className="block text-xs text-muted-foreground">{option.help}</span>
              ) : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}

function NumberRow({
  id,
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const set = (next: number) => onChange(Math.min(max, Math.max(min, next)));
  const button =
    'inline-flex size-11 items-center justify-center rounded-lg border border-input bg-card text-lg hover:bg-muted disabled:opacity-50';
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={button}
          aria-label={`Less ${label}`}
          disabled={disabled || value <= min}
          onClick={() => set(value - step)}
        >
          -
        </button>
        <output
          id={id}
          className="min-w-16 rounded-lg bg-muted px-3 py-2.5 text-center font-semibold tabular-nums"
        >
          {value}
        </output>
        <button
          type="button"
          className={button}
          aria-label={`More ${label}`}
          disabled={disabled || value >= max}
          onClick={() => set(value + step)}
        >
          +
        </button>
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
