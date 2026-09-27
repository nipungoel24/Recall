'use client';

import { useEffect } from 'react';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { routes } from '@/lib/routes';

/**
 * Global error boundary (client side). Catches unexpected runtime failures so
 * users never see a raw Next.js error screen. Entity-level "not found" states
 * are handled by their own pages; this is only for genuine crashes.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    console.error('Unhandled application error:', error);
  }, [error]);

  return (
    <div className="flex h-full items-center justify-center bg-background">
      <div className="max-w-md rounded-xl border border-border bg-surface p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-warning/10">
          <AlertTriangle className="h-6 w-6 text-warning" aria-hidden="true" />
        </div>
        <h1 className="text-lg font-semibold text-foreground">Something went wrong</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          An unexpected error occurred. Your data is safe — you can retry or return Home.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button variant="outline" onClick={() => router.push(routes.home())}>
            <Home className="h-4 w-4" />
            Go to Home
          </Button>
          <Button variant="default" onClick={reset}>
            <RefreshCw className="h-4 w-4" />
            Try again
          </Button>
        </div>
      </div>
    </div>
  );
}
