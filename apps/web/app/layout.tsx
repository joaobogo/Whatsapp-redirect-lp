import type { Metadata, Viewport } from 'next';
import { Toaster } from 'sonner';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'FGV Control Panel', template: '%s - FGV Control Panel' },
  description: 'Turn Flow Group Ventures bots on and off, run them, and approve their work.',
  applicationName: 'FGV Control Panel',
  appleWebApp: { capable: true, title: 'FGV Panel', statusBarStyle: 'default' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafafa' },
    { media: '(prefers-color-scheme: dark)', color: '#1c1c1c' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
