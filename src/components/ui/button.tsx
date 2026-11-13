import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

/**
 * Tactile Stopwatch Button (Sports Hardware Aesthetic)
 * Inspired by physical split/lap pushers on athletic GPS and timing watches.
 * Features a top edge-bevel highlight, sub-surface hardware rim, and responsive mechanical click.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-xs font-semibold uppercase tracking-wider transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)] disabled:pointer-events-none disabled:opacity-50 select-none motion-safe:active:scale-[0.97]',
  {
    variants: {
      variant: {
        default:
          'bg-red-700 hover:bg-red-600 text-white border border-[#3d0b09] dark:border-red-500/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),inset_0_-1px_0_rgba(0,0,0,0.35)]',
        destructive:
          'bg-red-800 hover:bg-red-900 text-white border border-[#2b0806] dark:border-red-600/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.2),inset_0_-1px_0_rgba(0,0,0,0.4)]',
        outline:
          'border border-[var(--border-button)] bg-[var(--surface-card)] dark:bg-[#141416] text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),inset_0_-1px_0_rgba(0,0,0,0.25)] hover:border-red-600 hover:text-red-600 dark:hover:text-red-400',
        secondary:
          'bg-[var(--surface-inset)] dark:bg-[#161619] border border-[var(--border-button)] text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),inset_0_-1px_0_rgba(0,0,0,0.25)] hover:border-red-600 hover:text-[var(--text-primary)]',
        ghost:
          'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] rounded-full',
        link:
          'text-red-700 dark:text-red-400 underline-offset-4 hover:underline normal-case tracking-normal font-normal',
      },
      size: {
        default: 'min-h-11 px-5 py-2',
        sm: 'min-h-11 sm:min-h-9 px-4 text-xs rounded-full',
        lg: 'h-12 px-7 text-sm tracking-wide rounded-full',
        icon: 'h-11 w-11 p-0 rounded-full',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
