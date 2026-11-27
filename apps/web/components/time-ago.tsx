'use client';

import { useEffect, useState } from 'react';
import { timeAgo } from '@fgv/shared';

/**
 * "5 min ago", kept fresh while the page is open. The server and the browser
 * render a few seconds apart, so a small difference in this text is expected
 * (hence suppressHydrationWarning) and corrected right after load.
 */
export function TimeAgo({ iso, className }: { iso: string | null; className?: string }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 30_000);
    const first = setTimeout(() => setTick((value) => value + 1), 0);
    return () => {
      clearInterval(timer);
      clearTimeout(first);
    };
  }, []);
  return (
    <time dateTime={iso ?? undefined} className={className} suppressHydrationWarning>
      {timeAgo(iso)}
    </time>
  );
}
