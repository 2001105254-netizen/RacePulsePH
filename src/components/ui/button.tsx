import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

/**
 * Stylish minimalist athletic action button: crisp 1px borders, sentence-case typography,
 * WCAG 1.4.11 non-text border contrast, and instant < 150ms interaction feedback.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-normal text-center leading-tight rounded-xl text-xs font-semibold cursor-pointer transition-[background-color,border-color,color,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 select-none motion-safe:active:scale-[0.98]',
  {
    variants: {
      variant: {
        default:
          'bg-red-700 hover:bg-red-600 text-white border border-red-800 dark:border-red-500/40',
        destructive:
          'bg-red-800 hover:bg-red-900 text-white border border-red-950 dark:border-red-600/40',
        outline:
          'border border-[var(--border-button)] bg-[var(--surface-card)] text-[var(--text-primary)] hover:border-red-600 hover:text-red-700 dark:hover:text-red-400',
        secondary:
          'bg-[var(--surface-inset)] border border-[var(--border-button)] text-[var(--text-primary)] hover:border-red-600 hover:bg-[var(--surface-hover)]',
        ghost:
          'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] rounded-xl',
        link:
          'text-red-700 dark:text-red-400 underline-offset-4 hover:underline font-normal',
      },
      size: {
        default: 'min-h-11 px-4 py-2',
        sm: 'min-h-11 lg:min-h-9 px-3.5 text-xs rounded-xl',
        lg: 'h-12 px-6 text-sm rounded-xl',
        icon: 'h-11 w-11 p-0 rounded-xl',
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
