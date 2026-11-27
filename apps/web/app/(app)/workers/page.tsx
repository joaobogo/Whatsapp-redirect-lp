import { EmptyState } from '@/components/empty-state';
import { WorkerCard } from '@/components/worker-card';
import { requireViewer } from '@/lib/auth';
import { getProfiles, getWorkers, type WorkerCardData } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Workers' };

export default async function WorkersPage() {
  const viewer = await requireViewer();
  const db = await createClient();
  const isAppOwner = viewer.role === 'owner';
  const [workers, profiles] = await Promise.all([
    getWorkers(db),
    isAppOwner ? getProfiles(db) : Promise.resolve([]),
  ]);
  const online = workers.filter((entry) => entry.online).length;
  const people = profiles.map((person) => ({
    id: person.id,
    name: person.full_name ?? 'Unnamed',
  }));

  // your own computers first, then everyone else's
  const mine = workers.filter((entry) => entry.worker.owner_id === viewer.id);
  const others = workers.filter((entry) => entry.worker.owner_id !== viewer.id);

  const grid = (list: WorkerCardData[]) => (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {list.map((entry) => (
        <WorkerCard
          key={entry.worker.id}
          {...entry}
          canManage={isAppOwner || entry.worker.owner_id === viewer.id}
          people={isAppOwner ? people : null}
        />
      ))}
    </div>
  );

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
      ) : null}
      {mine.length > 0 ? (
        <section aria-labelledby="my-computers" className="flex flex-col gap-3">
          <h2 id="my-computers" className="text-sm font-semibold text-muted-foreground">
            Your computers
          </h2>
          {grid(mine)}
        </section>
      ) : null}
      {others.length > 0 ? (
        <section aria-labelledby="other-computers" className="flex flex-col gap-3">
          {mine.length > 0 ? (
            <h2 id="other-computers" className="text-sm font-semibold text-muted-foreground">
              Other computers
            </h2>
          ) : (
            <h2 id="other-computers" className="sr-only">
              Computers
            </h2>
          )}
          {grid(others)}
        </section>
      ) : null}
    </div>
  );
}
