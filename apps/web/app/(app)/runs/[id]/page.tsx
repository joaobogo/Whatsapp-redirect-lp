import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { ItemTable } from '@/components/item-table';
import { LiveLog } from '@/components/live-log';
import { RunHeader } from '@/components/run-header';
import { Card } from '@/components/ui/card';
import { canOperate, requireViewer } from '@/lib/auth';
import { ACTIVE_RUN_STATUSES, getGlobalSettings, getRunPage } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Run' };

export default async function RunPage(props: PageProps<'/runs/[id]'>) {
  const { id } = await props.params;
  const viewer = await requireViewer();
  const db = await createClient();
  const [data, settings] = await Promise.all([getRunPage(db, id), getGlobalSettings(db)]);
  if (!data) notFound();
  const { run, bot, worker, events, items } = data;
  const active = (ACTIVE_RUN_STATUSES as readonly string[]).includes(run.status);

  return (
    <div className="flex flex-col gap-5" data-testid="run-page" data-run-id={run.id}>
      <Link
        href="/"
        className="-mb-3 -ml-2 inline-flex h-11 items-center gap-1 self-start px-2 text-sm text-muted-foreground"
      >
        <ChevronLeft className="size-4" />
        Home
      </Link>

      <RunHeader
        run={run}
        botName={bot.name}
        botSlug={bot.slug}
        workerName={worker?.name ?? null}
        canOperate={canOperate(viewer.role)}
        stopped={settings.killSwitch}
      />

      {run.summary ? (
        <Card className="p-4">
          <h2 className="text-sm font-semibold">Summary</h2>
          <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap">{run.summary}</p>
        </Card>
      ) : null}

      <LiveLog key={run.id} runId={run.id} initialEvents={events} active={active} />

      <section aria-labelledby="run-items" className="flex flex-col gap-3">
        <h2 id="run-items" className="text-base font-semibold">
          Results ({items.length})
        </h2>
        <ItemTable
          items={items}
          emptyTitle={active ? 'No results yet' : 'This run saved no results'}
          emptyText={active ? 'They appear here the moment the bot saves them.' : undefined}
        />
      </section>
    </div>
  );
}
