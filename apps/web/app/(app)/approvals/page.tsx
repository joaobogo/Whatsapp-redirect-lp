import { ApprovalList } from '@/components/approval-list';
import { canOperate, requireViewer } from '@/lib/auth';
import { getApprovals } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Approvals' };

export default async function ApprovalsPage() {
  const viewer = await requireViewer();
  const data = await getApprovals(await createClient());
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Approvals</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Nothing is sent or submitted until you approve it here.
          {data.includesReadyJobs
            ? ' Jobs you approve are applied to on the next Job applier run.'
            : ''}
        </p>
      </div>
      <ApprovalList
        items={data.items}
        bots={data.bots.map((bot) => ({ id: bot.id, name: bot.name, channel: bot.channel }))}
        canOperate={canOperate(viewer.role)}
      />
    </div>
  );
}
