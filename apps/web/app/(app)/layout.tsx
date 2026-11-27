import { AppFrame } from '@/components/app-frame';
import { canOperate, requireViewer } from '@/lib/auth';
import { countWaitingApproval, getGlobalSettings } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer();
  const db = await createClient();
  const [settings, approvalsCount] = await Promise.all([
    getGlobalSettings(db),
    countWaitingApproval(db),
  ]);

  return (
    <AppFrame
      role={viewer.role}
      canOperate={canOperate(viewer.role)}
      killSwitch={settings.killSwitch}
      approvalsCount={approvalsCount}
    >
      {children}
    </AppFrame>
  );
}
