'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Play } from 'lucide-react';
import { toast } from 'sonner';
import type { BotSettings, FieldSpec } from '@fgv/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { SettingsFields } from '@/components/settings-form';
import { useSettingsForm } from '@/components/use-settings-form';

/** Asks the server to queue a run. Returns the run id or a plain-language error. */
export async function queueRun(input: {
  slug: string;
  settings?: BotSettings;
  saveAsDefault?: boolean;
}): Promise<{ ok: true; runId: string } | { ok: false; error: string }> {
  try {
    const response = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const body = (await response.json().catch(() => null)) as {
      runId?: string;
      error?: string;
    } | null;
    if (response.ok && body?.runId) return { ok: true, runId: body.runId };
    return { ok: false, error: body?.error ?? 'The run could not be started. Try again.' };
  } catch {
    return { ok: false, error: 'Could not reach the server. Check your connection and try again.' };
  }
}

/**
 * "Run now": a bottom sheet with the bot's settings prefilled. The user can
 * change values for this run only, or tick "Save as default".
 */
export function RunSheet({
  open,
  onOpenChange,
  slug,
  name,
  fields,
  settings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  name: string;
  fields: FieldSpec[];
  settings: BotSettings;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        placement="bottom"
        title={`Run ${name}`}
        description="Change anything for this run only, then confirm."
      >
        {/* mounted only while open, so the form always starts from the saved settings */}
        {open ? (
          <RunForm
            slug={slug}
            fields={fields}
            settings={settings}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RunForm({
  slug,
  fields,
  settings,
  onCancel,
}: {
  slug: string;
  fields: FieldSpec[];
  settings: BotSettings;
  onCancel: () => void;
}) {
  const router = useRouter();
  const form = useSettingsForm(fields, settings);
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = form.handleSubmit(async (values) => {
    setBusy(true);
    const result = await queueRun({ slug, settings: values, saveAsDefault });
    if (result.ok) {
      router.push(`/runs/${result.runId}`);
      return;
    }
    setBusy(false);
    toast.error(result.error);
  });

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" data-testid="run-form">
      <DialogBody>
        <SettingsFields fields={fields} control={form.control} errors={form.formState.errors} />
        <label className="mt-6 flex min-h-11 cursor-pointer items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-[var(--primary)]"
            checked={saveAsDefault}
            onChange={(event) => setSaveAsDefault(event.target.checked)}
          />
          Save as default
        </label>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy} data-testid="run-confirm">
          <Play />
          {busy ? 'Starting...' : 'Run now'}
        </Button>
      </DialogFooter>
    </form>
  );
}
