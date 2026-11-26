'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { createClient } from '@/lib/supabase/client';

type Step = 'email' | 'sent';

export function LoginForm({ initialError }: { initialError: string | null }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  async function sendLink(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: failure } = await createClient().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
    });
    setBusy(false);
    if (failure) {
      setError(
        failure.status === 429
          ? 'Too many tries. Wait a minute, then ask for a new link.'
          : 'The link could not be sent. Check the email address and try again.',
      );
      return;
    }
    setStep('sent');
  }

  async function useCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: failure } = await createClient().auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'email',
    });
    setBusy(false);
    if (failure) {
      setError('That code is not right or has expired. Ask for a new link.');
      return;
    }
    router.replace('/');
    router.refresh();
  }

  if (step === 'sent') {
    return (
      <div className="flex flex-col gap-5" data-testid="login-sent">
        <div className="rounded-xl border bg-card p-4">
          <p className="flex items-center gap-2 font-medium">
            <Mail className="size-5 text-primary" />
            Check your email
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            We sent a login link to {email}. Open it on this device. It can take a minute to arrive.
          </p>
        </div>
        <form onSubmit={useCode} className="flex flex-col gap-3">
          <Label htmlFor="code">Or type the code from the email</Label>
          <Input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="6-digit code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={busy || code.trim().length < 6}>
            {busy ? 'Checking...' : 'Log in with code'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setStep('email')}>
            Use a different email
          </Button>
        </form>
      </div>
    );
  }

  return (
    <form onSubmit={sendLink} className="flex flex-col gap-3" data-testid="login-form">
      <Label htmlFor="email">Email</Label>
      <Input
        id="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        required
        placeholder="you@example.com"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={busy || email.trim().length < 5}>
        {busy ? 'Sending...' : 'Send me a login link'}
      </Button>
      <p className="text-xs text-muted-foreground">
        New here? You can log in, and an owner decides what you may change.
      </p>
    </form>
  );
}
