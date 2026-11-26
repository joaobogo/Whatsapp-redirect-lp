import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/auth', '/manifest.webmanifest', '/icon', '/apple-icon', '/setup'];

/** Refreshes the Supabase session on every request and sends signed-out users to /login. */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    // Not configured yet: show the setup page instead of a crash.
    if (isPublic || path.startsWith('/api')) return response;
    const target = request.nextUrl.clone();
    target.pathname = '/setup';
    return NextResponse.redirect(target);
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        Object.entries(headers ?? {}).forEach(([name, value]) => response.headers.set(name, value));
      },
    },
  });

  // Do not run code between createServerClient and getClaims(): it refreshes
  // the session, and skipping it logs people out at random.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);

  if (!signedIn && !isPublic) {
    if (path.startsWith('/api')) {
      return NextResponse.json({ error: 'Please log in again.' }, { status: 401 });
    }
    const target = request.nextUrl.clone();
    target.pathname = '/login';
    target.search = '';
    return NextResponse.redirect(target);
  }
  if (signedIn && path === '/login') {
    const target = request.nextUrl.clone();
    target.pathname = '/';
    target.search = '';
    return NextResponse.redirect(target);
  }
  return response;
}
