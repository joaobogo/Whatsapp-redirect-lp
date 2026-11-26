import Link from 'next/link';
import { CHANNEL_ORDER, formatUsd } from '@fgv/shared';
import { BotCard } from '@/components/bot-card';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/empty-state';
import { canOperate, requireViewer } from '@/lib/auth';
import { getDashboard } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Home' };

export default async function HomePage() {
  const viewer = await requireViewer();
  const data = await getDashboard(await createClient());
  const operate = canOperate(viewer.role);

  const channels = [
    ...CHANNEL_ORDER,
    ...new Set(
      data.bots.map((card) => card.bot.channel).filter((name) => !CHANNEL_ORDER.includes(name)),
    ),
  ];
  const overCap = data.metrics.spendToday >= data.settings.dailySpendCapUsd;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="sr-only">Home</h1>

      {/* today strip */}
      <section aria-label="Today" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Found today" value={data.metrics.foundToday} href="/results" />
        <Metric label="Applied / sent today" value={data.metrics.actedToday} href="/results" />
        <Metric
          label="Waiting for approval"
          value={data.metrics.waitingApproval}
          href="/approvals"
        />
        <Metric
          label="Spend today (USD)"
          value={formatUsd(data.metrics.spendToday)}
          hint={`of ${formatUsd(data.settings.dailySpendCapUsd)} cap`}
          warn={overCap}
          href="/settings"
        />
      </section>

      {data.workersOnline === 0 ? (
        <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          No worker computer is online, so runs will wait in the queue.{' '}
          <Link href="/workers" className="font-medium underline underline-offset-4">
            See workers
          </Link>
        </p>
      ) : null}

      {data.bots.length === 0 ? (
        <EmptyState
          title="No bots yet"
          text="Run supabase/seed.sql in your Supabase project to add the eight bots."
        />
      ) : null}

      {channels.map((channel) => {
        const cards = data.bots.filter((card) => card.bot.channel === channel);
        if (cards.length === 0) return null;
        return (
          <section
            key={channel}
            aria-labelledby={`channel-${channel}`}
            className="flex flex-col gap-3"
          >
            <h2
              id={`channel-${channel}`}
              className="text-sm font-semibold tracking-wide text-muted-foreground"
            >
              {channel}
            </h2>
            <div className="grid gap-3 md:grid-cols-2">
              {cards.map((card) => (
                <BotCard
                  key={card.bot.id}
                  {...card}
                  canOperate={operate}
                  stopped={data.settings.killSwitch}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  warn = false,
  href,
}: {
  label: string;
  value: number | string;
  hint?: string;
  warn?: boolean;
  href: string;
}) {
  return (
    <Link href={href} className="block">
      <Card className="flex h-full flex-col gap-1 p-4" data-testid="metric">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span
          className={`text-2xl leading-none font-semibold tabular-nums ${warn ? 'text-destructive' : ''}`}
        >
          {value}
        </span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </Card>
    </Link>
  );
}
