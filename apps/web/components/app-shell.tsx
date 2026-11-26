'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  Inbox,
  LayoutList,
  Menu,
  MessageCircle,
  MonitorSmartphone,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import type { UserRole } from '@fgv/shared';
import { Button } from '@/components/ui/button';
import { StopAllButton } from '@/components/stop-all-button';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
  /** where it shows */
  on: 'both' | 'desktop' | 'mobile';
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/')
    return pathname === '/' || pathname.startsWith('/bots') || pathname.startsWith('/runs');
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({
  children,
  role,
  approvalsCount,
  onOpenChat,
}: {
  children: React.ReactNode;
  role: UserRole;
  approvalsCount: number;
  onOpenChat: () => void;
}) {
  const pathname = usePathname();
  const canStop = role === 'owner' || role === 'operator';
  const items: NavItem[] = [
    { href: '/', label: 'Home', icon: Home, on: 'both' },
    { href: '/approvals', label: 'Approvals', icon: Inbox, badge: approvalsCount, on: 'both' },
    { href: '/results', label: 'Results', icon: LayoutList, on: 'both' },
    { href: '/workers', label: 'Workers', icon: MonitorSmartphone, on: 'both' },
    { href: '/settings', label: 'Settings', icon: Settings, on: 'desktop' },
    { href: '/more', label: 'More', icon: Menu, on: 'mobile' },
  ];

  return (
    <div className="min-h-dvh">
      {/* top bar */}
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="flex h-14 items-center gap-2 px-4">
          <Link href="/" className="flex h-11 min-w-0 items-center text-base font-semibold">
            <span className="truncate">FGV Control Panel</span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            {canStop ? <StopAllButton /> : null}
            <Button
              variant="outline"
              size="icon"
              onClick={onOpenChat}
              aria-label="Open chat"
              data-testid="open-chat"
            >
              <MessageCircle />
            </Button>
          </div>
        </div>
      </header>

      {/* side navigation on desktop */}
      <nav
        aria-label="Main"
        className="fixed top-14 bottom-0 left-0 z-20 hidden w-56 flex-col gap-1 border-r bg-background p-3 md:flex"
      >
        {items
          .filter((item) => item.on !== 'mobile')
          .map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium',
                  active
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-muted',
                )}
              >
                <item.icon className="size-5" />
                <span>{item.label}</span>
                {item.badge ? <NavBadge count={item.badge} className="ml-auto" /> : null}
              </Link>
            );
          })}
      </nav>

      <main className="mx-auto w-full max-w-5xl px-4 pt-4 pb-28 md:pb-10 md:pl-60">{children}</main>

      {/* bottom navigation on a phone */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-safe backdrop-blur md:hidden"
      >
        <ul className="grid grid-cols-5">
          {items
            .filter((item) => item.on !== 'desktop')
            .map((item) => {
              const active =
                item.href === '/more'
                  ? isActive(pathname, '/more') || isActive(pathname, '/settings')
                  : isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'relative flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium',
                      active ? 'text-primary' : 'text-muted-foreground',
                    )}
                  >
                    <span className="relative">
                      <item.icon className="size-5" />
                      {item.badge ? (
                        <NavBadge count={item.badge} className="absolute -top-2 left-3" />
                      ) : null}
                    </span>
                    {item.label}
                  </Link>
                </li>
              );
            })}
        </ul>
      </nav>
    </div>
  );
}

function NavBadge({ count, className }: { count: number; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] leading-5 font-semibold text-primary-foreground',
        className,
      )}
      aria-label={`${count} waiting`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
