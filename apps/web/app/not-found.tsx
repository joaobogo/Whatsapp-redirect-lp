import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';

export default function NotFound() {
  return (
    <main className="mx-auto max-w-md p-6 pt-16">
      <EmptyState title="Page not found" text="That link does not lead anywhere.">
        <Button asChild className="mt-2">
          <Link href="/">Go to Home</Link>
        </Button>
      </EmptyState>
    </main>
  );
}
