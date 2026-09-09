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
    <div className="flex h-screen items-center justify-center bg-gray-50">
      <div className="max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50">
          <AlertTriangle className="h-6 w-6 text-amber-600" />
        </div>
        <h1 className="text-lg font-semibold text-gray-900">Something went wrong</h1>
        <p className="mt-1 text-sm text-gray-500">
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
