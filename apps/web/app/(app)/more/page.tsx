import Link from 'next/link';
import { ChevronRight, LogOut, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { signOutAction } from '@/lib/actions';
import { requireViewer } from '@/lib/auth';

export const metadata = { title: 'More' };

const ROLE_TEXT = {
  owner: 'Owner - can change everything',
  operator: 'Operator - can run bots and approve',
  viewer: 'Viewer - can look, not change',
} as const;

export default async function MorePage() {
  const viewer = await requireViewer();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">More</h1>
      <Card className="p-4">
        <p className="font-medium break-words">{viewer.name ?? viewer.email ?? 'You'}</p>
        {viewer.email ? (
          <p className="text-sm break-words text-muted-foreground">{viewer.email}</p>
        ) : null}
        <p className="mt-2 text-sm text-muted-foreground">{ROLE_TEXT[viewer.role]}</p>
      </Card>
      <Card className="divide-y">
        <Link href="/settings" className="flex min-h-14 items-center gap-3 px-4 hover:bg-muted">
          <Settings className="size-5 text-muted-foreground" />
          <span className="flex-1 font-medium">Settings</span>
          <ChevronRight className="size-5 text-muted-foreground" />
        </Link>
      </Card>
      <form action={signOutAction}>
        <Button type="submit" variant="outline" className="w-full">
          <LogOut />
          Log out
        </Button>
      </form>
    </div>
  );
}
