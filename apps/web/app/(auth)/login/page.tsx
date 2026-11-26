import { LoginForm } from './login-form';

export const metadata = { title: 'Log in' };

const MESSAGES: Record<string, string> = {
  link: 'That login link has expired or was already used. Ask for a new one.',
};

export default async function LoginPage(props: PageProps<'/login'>) {
  const params = await props.searchParams;
  const code = typeof params.error === 'string' ? params.error : '';
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">FGV Control Panel</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Log in with your email. We send you a link, no password needed.
        </p>
      </div>
      <LoginForm initialError={MESSAGES[code] ?? null} />
    </main>
  );
}
