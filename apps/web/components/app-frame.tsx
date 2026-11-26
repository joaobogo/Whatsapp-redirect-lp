'use client';

import { useState } from 'react';
import type { UserRole } from '@fgv/shared';
import { AppShell } from '@/components/app-shell';
import { ChatDrawer } from '@/components/chat-drawer';
import { RealtimeRefresh } from '@/components/realtime-refresh';
import { KillBanner } from '@/components/stop-all-button';

/** Everything that wraps a signed-in page: banner, navigation, live updates, chat. */
export function AppFrame({
  children,
  role,
  canOperate,
  killSwitch,
  approvalsCount,
  chatReady,
}: {
  children: React.ReactNode;
  role: UserRole;
  canOperate: boolean;
  killSwitch: boolean;
  approvalsCount: number;
  chatReady: boolean;
}) {
  const [chatOpen, setChatOpen] = useState(false);
  return (
    <>
      {killSwitch ? <KillBanner canResume={canOperate} /> : null}
      <AppShell role={role} approvalsCount={approvalsCount} onOpenChat={() => setChatOpen(true)}>
        {children}
      </AppShell>
      <ChatDrawer open={chatOpen} onOpenChange={setChatOpen} ready={chatReady} />
      <RealtimeRefresh tables={['runs', 'items', 'workers', 'bots', 'app_settings']} />
    </>
  );
}
