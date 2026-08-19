import { cn } from '@/lib/utils';

/**
 * Lightweight loading placeholder for layouts whose shape is known. Use for
 * individual sections (not whole pages) so the shell renders immediately.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-gray-200/70', className)}
      {...props}
    />
  );
}

export { Skeleton };
