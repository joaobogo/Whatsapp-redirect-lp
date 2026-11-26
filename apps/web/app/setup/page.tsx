import { isSupabaseConfigured } from '@/lib/env';
import { redirect } from 'next/navigation';

export const metadata = { title: 'Setup' };
export const dynamic = 'force-dynamic';

/** Shown instead of a crash when the Supabase keys have not been added yet. */
export default function SetupPage() {
  if (isSupabaseConfigured()) redirect('/');
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Almost there</h1>
      <p className="text-sm text-muted-foreground">
        The app is running but it is not connected to a database yet.
      </p>
      <ol className="list-decimal space-y-2 pl-5 text-sm">
        <li>Create a Supabase project (the free tier is fine).</li>
        <li>
          Copy <code>apps/web/.env.example</code> to <code>apps/web/.env.local</code> and paste the
          project URL and keys.
        </li>
        <li>Run the SQL in supabase/migrations and supabase/seed.sql.</li>
        <li>Restart the app.</li>
      </ol>
      <p className="text-sm text-muted-foreground">The README has every click, step by step.</p>
    </main>
  );
}
