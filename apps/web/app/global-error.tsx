'use client';

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
        <h1 style={{ fontSize: 18 }}>Something went wrong</h1>
        <p>The app could not load. Try again in a moment.</p>
        <button onClick={reset} style={{ minHeight: 44, padding: '0 16px' }}>
          Try again
        </button>
      </body>
    </html>
  );
}
