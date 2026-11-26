import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

const OTP_TYPES: readonly EmailOtpType[] = ['email', 'magiclink', 'invite', 'signup', 'recovery'];

/** Only same-site paths: never redirect to another website after login. */
function safeNext(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\'))
    return '/';
  return value;
}

/**
 * Where the email link lands. Handles both link styles Supabase can send:
 *   ?token_hash=...&type=email   (works on any device - recommended template)
 *   ?code=...                    (default template; same browser only)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const next = safeNext(searchParams.get('next'));
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const code = searchParams.get('code');
  const supabase = await createClient();

  let ok = false;
  if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    ok = !error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  }

  const target = request.nextUrl.clone();
  target.search = '';
  if (ok) {
    target.pathname = next;
  } else {
    target.pathname = '/login';
    target.searchParams.set('error', 'link');
  }
  return NextResponse.redirect(target);
}
