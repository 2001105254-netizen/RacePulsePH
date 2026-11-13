import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

// Contrast: every text/background pair below measured >= 4.5:1 (see contrast-check.py).
const badgeVariants = cva(
  'inline-flex flex-wrap max-w-full items-center gap-2 rounded-full border px-2 py-1 text-xs font-semibold',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-red-700 text-white',
        secondary:
          'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-secondary)]',
        outline:
          'border-[var(--border-default)] text-[var(--text-primary)] bg-transparent',
        destructive: 'border-red-700 text-red-700 dark:border-red-400 dark:text-red-400',
        success:
          'border-emerald-700 bg-emerald-50 text-emerald-800 dark:border-emerald-400 dark:bg-emerald-950 dark:text-emerald-300',
        live: 'border-red-700 bg-red-50 text-red-800 dark:border-red-400 dark:bg-red-950 dark:text-red-300',
        athletic:
          'border-red-700 text-red-700 dark:border-red-400 dark:text-red-400',
        muted:
          'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-secondary)] font-normal',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
