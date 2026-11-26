'use client';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';

// Errors never show stack traces to users: one line and a "Try again" action.
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <EmptyState
      title="This page could not load"
      text="The database did not answer. Check your connection, then try again."
    >
      <Button onClick={reset} className="mt-2">
        Try again
      </Button>
    </EmptyState>
  );
}
