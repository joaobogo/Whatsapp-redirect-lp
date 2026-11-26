import { GlobalSettingsForm, UsersPanel, type UserEntry } from '@/components/settings-panels';
import { Card } from '@/components/ui/card';
import { requireViewer } from '@/lib/auth';
import { getGlobalSettings, getProfiles } from '@/lib/data';
import { createAdminClient, createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Settings' };

/** Emails live in Supabase Auth, not in the profiles table; only an owner gets to see them. */
async function emailsById(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const { data } = await createAdminClient().auth.admin.listUsers({ page: 1, perPage: 200 });
    for (const user of data?.users ?? []) if (user.email) map.set(user.id, user.email);
  } catch {
    // no server key yet: the list still works, it just shows names
  }
  return map;
}

export default async function SettingsPage() {
  const viewer = await requireViewer();
  const db = await createClient();
  const isOwner = viewer.role === 'owner';
  const [settings, profiles, emails] = await Promise.all([
    getGlobalSettings(db),
    getProfiles(db),
    isOwner ? emailsById() : Promise.resolve(new Map<string, string>()),
  ]);

  const users: UserEntry[] = profiles.map((profile) => ({
    id: profile.id,
    name: profile.full_name,
    email: emails.get(profile.id) ?? (profile.id === viewer.id ? viewer.email : null),
    role: profile.role,
    isYou: profile.id === viewer.id,
  }));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Settings</h1>
      {!isOwner ? (
        <p className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
          Only an owner can change these settings.
        </p>
      ) : null}

      <section aria-labelledby="global" className="flex flex-col gap-3">
        <h2 id="global" className="text-base font-semibold">
          Global
        </h2>
        <GlobalSettingsForm settings={settings} isOwner={isOwner} />
        <Card className="flex items-center justify-between gap-3 p-4 text-sm">
          <span>Time zone</span>
          <span className="text-muted-foreground">America/Sao_Paulo</span>
        </Card>
      </section>

      <section aria-labelledby="users" className="flex flex-col gap-3">
        <h2 id="users" className="text-base font-semibold">
          Users
        </h2>
        <UsersPanel users={users} isOwner={isOwner} />
      </section>
    </div>
  );
}
