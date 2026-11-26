import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import {
  allowedApprovalModes,
  capabilitiesFor,
  fieldsFromJsonSchema,
  formatDuration,
  formatUsd,
  timeAgo,
} from '@fgv/shared';
import { BotSettingsForm } from '@/components/bot-settings-form';
import { EmptyState } from '@/components/empty-state';
import { RunStatusPill } from '@/components/status-pill';
import { Card } from '@/components/ui/card';
import { canOperate, requireViewer } from '@/lib/auth';
import { getBotBySlug, getGlobalSettings, getRunHistory } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';

export async function generateMetadata(props: PageProps<'/bots/[slug]'>) {
  const { slug } = await props.params;
  const bot = await getBotBySlug(await createClient(), slug);
  return { title: bot?.name ?? 'Bot' };
}

export default async function BotPage(props: PageProps<'/bots/[slug]'>) {
  const { slug } = await props.params;
  const viewer = await requireViewer();
  const db = await createClient();
  const bot = await getBotBySlug(db, slug);
  if (!bot) notFound();

  const [history, workers, settings] = await Promise.all([
    getRunHistory(db, bot.id, 20),
    db.from('workers').select('id, name, has_browser').order('name'),
    getGlobalSettings(db),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/"
          className="-ml-2 inline-flex h-11 items-center gap-1 px-2 text-sm text-muted-foreground"
        >
          <ChevronLeft className="size-4" />
          Home
        </Link>
        <h1 className="text-xl font-semibold">{bot.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{bot.description}</p>
      </div>

      <BotSettingsForm
        bot={bot}
        fields={fieldsFromJsonSchema(bot.settings_schema)}
        allowedModes={[...allowedApprovalModes(bot.slug)]}
        contacts={capabilitiesFor(bot.slug).contactStatus !== null}
        workers={(workers.data ?? []).filter(
          (worker) => !bot.requires_browser || worker.has_browser,
        )}
        canOperate={canOperate(viewer.role)}
        isOwner={viewer.role === 'owner'}
        stopped={settings.killSwitch}
      />

      <section aria-labelledby="history" className="flex flex-col gap-3">
        <h2 id="history" className="text-base font-semibold">
          Run history
        </h2>
        {history.length === 0 ? (
          <EmptyState title="No runs yet" text="Press Run now to start the first one." />
        ) : (
          <Card className="divide-y">
            {history.map(({ run, itemCount }) => (
              <Link
                key={run.id}
                href={`/runs/${run.id}`}
                className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-muted"
              >
                <RunStatusPill status={run.status} />
                <span className="text-sm">{timeAgo(run.queued_at)}</span>
                <span className="ml-auto flex gap-3 text-sm text-muted-foreground tabular-nums">
                  <span>{formatDuration(run.started_at, run.finished_at)}</span>
                  <span>
                    {itemCount} {itemCount === 1 ? 'item' : 'items'}
                  </span>
                  <span>{formatUsd(run.cost_usd)}</span>
                </span>
              </Link>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}
