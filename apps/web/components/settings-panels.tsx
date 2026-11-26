'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Send } from 'lucide-react';
import { toast } from 'sonner';
import { HARD_LIMITS, USER_ROLES, type BotModel, type UserRole } from '@fgv/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  inviteUserAction,
  resumeAllAction,
  setUserRoleAction,
  stopAllAction,
  updateGlobalSettingsAction,
} from '@/lib/actions';

interface GlobalValues {
  killSwitch: boolean;
  dailySpendCapUsd: number;
  linkedinDailyCap: number;
  defaultModel: BotModel;
}

export function GlobalSettingsForm({
  settings,
  isOwner,
}: {
  settings: GlobalValues;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [spendCap, setSpendCap] = useState(String(settings.dailySpendCapUsd));
  const [linkedinCap, setLinkedinCap] = useState(settings.linkedinDailyCap);
  const [model, setModel] = useState<BotModel>(settings.defaultModel);

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const cap = Number(spendCap);
    if (!Number.isFinite(cap) || cap < 0) {
      toast.error('The spend cap must be a number, for example 30.');
      return;
    }
    startTransition(async () => {
      const result = await updateGlobalSettingsAction({
        dailySpendCapUsd: cap,
        linkedinDailyCap: linkedinCap,
        defaultModel: model,
      });
      if (result.ok) {
        toast.success('Saved');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const toggleKill = (stop: boolean) =>
    startTransition(async () => {
      const result = stop ? await stopAllAction() : await resumeAllAction();
      if (result.ok) {
        toast.success(stop ? 'All bots are stopping.' : 'Bots can run again.');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  return (
    <Card className="flex flex-col gap-5 p-4">
      <label className="flex items-center justify-between gap-3">
        <span className="text-sm">
          <span className="font-medium">Kill switch</span>
          <span className="block text-xs text-muted-foreground">
            On = every bot is stopped and nothing new starts.
          </span>
        </span>
        <Switch
          checked={settings.killSwitch}
          disabled={pending}
          onCheckedChange={toggleKill}
          aria-label="Kill switch"
        />
      </label>

      <form onSubmit={save} className="flex flex-col gap-5 border-t pt-5">
        <div className="flex flex-col gap-2">
          <Label htmlFor="spend-cap">Daily spend cap (USD)</Label>
          <Input
            id="spend-cap"
            inputMode="decimal"
            value={spendCap}
            disabled={!isOwner}
            onChange={(event) => setSpendCap(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            No new run starts once today&apos;s Claude cost reaches this amount.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="linkedin-cap">LinkedIn messages per day (all bots)</Label>
          <Select
            id="linkedin-cap"
            value={linkedinCap}
            disabled={!isOwner}
            onChange={(event) => setLinkedinCap(Number(event.target.value))}
          >
            {Array.from({ length: HARD_LIMITS.linkedinMessagesPerDay + 1 }, (_, value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">
            The limit is {HARD_LIMITS.linkedinMessagesPerDay}. It can be lowered, never raised.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="default-model">Default model for new bots</Label>
          <Select
            id="default-model"
            value={model}
            disabled={!isOwner}
            onChange={(event) => setModel(event.target.value as BotModel)}
          >
            <option value="opus">Best quality</option>
            <option value="fast">Fast and cheap</option>
          </Select>
        </div>
        {isOwner ? (
          <Button type="submit" disabled={pending} className="self-start">
            {pending ? 'Saving...' : 'Save'}
          </Button>
        ) : null}
      </form>
    </Card>
  );
}

export interface UserEntry {
  id: string;
  name: string | null;
  email: string | null;
  role: UserRole;
  isYou: boolean;
}

const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Owner',
  operator: 'Operator',
  viewer: 'Viewer',
};

export function UsersPanel({ users, isOwner }: { users: UserEntry[]; isOwner: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState('');

  const setRole = (id: string, role: string) =>
    startTransition(async () => {
      const result = await setUserRoleAction(id, role);
      if (result.ok) {
        toast.success('Role changed');
        router.refresh();
      } else {
        toast.error(result.error);
        router.refresh();
      }
    });

  const invite = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await inviteUserAction(email);
      if (result.ok) {
        toast.success(`Invite sent to ${email.trim()}`);
        setEmail('');
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <Card className="divide-y">
        {users.map((user) => (
          <div key={user.id} className="flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="font-medium break-words">
                {user.name ?? user.email ?? 'Unnamed'}
                {user.isYou ? <span className="text-muted-foreground"> (you)</span> : null}
              </p>
              {user.email && user.name ? (
                <p className="text-sm break-words text-muted-foreground">{user.email}</p>
              ) : null}
            </div>
            {isOwner ? (
              <Select
                aria-label={`Role of ${user.name ?? user.email ?? 'user'}`}
                className="w-36"
                value={user.role}
                disabled={pending}
                onChange={(event) => setRole(user.id, event.target.value)}
              >
                {USER_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </Select>
            ) : (
              <span className="text-sm text-muted-foreground">{ROLE_LABELS[user.role]}</span>
            )}
          </div>
        ))}
      </Card>

      {isOwner ? (
        <Card className="p-4">
          <form onSubmit={invite} className="flex flex-col gap-3">
            <Label htmlFor="invite-email">Invite by email</Label>
            <div className="flex gap-2">
              <Input
                id="invite-email"
                type="email"
                inputMode="email"
                placeholder="name@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <Button type="submit" disabled={pending || email.trim().length < 5}>
                <Send />
                Invite
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              They get a login link by email and start as a viewer. Change their role here
              afterwards.
            </p>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
