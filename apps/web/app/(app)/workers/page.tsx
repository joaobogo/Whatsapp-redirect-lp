import { EmptyState } from '@/components/empty-state';
import { WorkerCard } from '@/components/worker-card';
import { requireViewer } from '@/lib/auth';
import { getWorkers } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Workers' };

export default async function WorkersPage() {
  const viewer = await requireViewer();
  const workers = await getWorkers(await createClient());
  const online = workers.filter((entry) => entry.online).length;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Workers</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The computers that run the bots. {online} of {workers.length} online.
        </p>
      </div>
      {workers.length === 0 ? (
        <EmptyState
          title="No computer has connected yet"
          text="Install the worker on a computer (see the README). It shows up here by itself within a minute."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {workers.map((entry) => (
            <WorkerCard key={entry.worker.id} {...entry} isOwner={viewer.role === 'owner'} />
          ))}
        </div>
      )}
    </div>
  );
}
