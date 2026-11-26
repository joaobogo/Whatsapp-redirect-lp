import type { MetadataRoute } from 'next';

// Lets John "Add to Home Screen" so the panel opens like an app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'FGV Control Panel',
    short_name: 'FGV Panel',
    description: 'Turn Flow Group Ventures bots on and off, run them, and approve their work.',
    start_url: '/',
    display: 'standalone',
    background_color: '#fafafa',
    theme_color: '#4f46e5',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
