import * as React from 'react';
import { LayoutGroup, m } from 'motion/react';
import { cn } from '../../lib/utils';
import { KINETIC_SPRING } from './MotionPrimitives';

interface TabsContextValue {
  value: string;
  onValueChange: (value: string) => void;
  variant: 'default' | 'accent';
  pillLayoutId: string;
}

const TabsContext = React.createContext<TabsContextValue | undefined>(undefined);

interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  variant?: 'default' | 'accent';
}

const Tabs = React.forwardRef<HTMLDivElement, TabsProps>(
  ({ value: controlledValue, defaultValue = '', onValueChange, variant = 'default', className, children, ...props }, ref) => {
    const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue);
    const groupId = React.useId();
    const isControlled = controlledValue !== undefined;
    const value = isControlled ? controlledValue : uncontrolledValue;

    const handleValueChange = React.useCallback(
      (newValue: string) => {
        if (!isControlled) {
          setUncontrolledValue(newValue);
        }
        onValueChange?.(newValue);
      },
      [isControlled, onValueChange]
    );

    return (
      <LayoutGroup id={groupId}>
        <TabsContext.Provider
          value={{
            value,
            onValueChange: handleValueChange,
            variant,
            pillLayoutId: `${groupId}-pill`,
          }}
        >
          <div ref={ref} className={cn('w-full', className)} {...props}>
            {children}
          </div>
        </TabsContext.Provider>
      </LayoutGroup>
    );
  }
);
Tabs.displayName = 'Tabs';

const TabsList = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'inline-flex flex-wrap max-w-full min-h-11 items-center justify-center gap-1 rounded-xl bg-[var(--surface-inset)] p-1 text-[var(--text-secondary)] border border-[var(--border-default)]',
      className
    )}
    {...props}
  />
));
TabsList.displayName = 'TabsList';

interface TabsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
}

const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsTriggerProps>(
  ({ className, value, children, ...props }, ref) => {
    const context = React.useContext(TabsContext);
    if (!context) throw new Error('TabsTrigger must be used within Tabs');

    const isSelected = context.value === value;
    const isAccent = context.variant === 'accent';

    return (
      <button
        ref={ref}
        type="button"
        role="tab"
        aria-selected={isSelected}
        onClick={() => context.onValueChange(value)}
        className={cn(
          'relative overflow-hidden inline-flex items-center justify-center whitespace-normal text-center leading-tight min-w-0 rounded-lg border border-transparent px-4 py-2 text-xs font-semibold cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:focus-visible:ring-red-400 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 select-none motion-safe:active:scale-[0.98]',
          isSelected
            ? isAccent
              ? 'text-white'
              : 'text-[var(--text-primary)]'
            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]',
          className
        )}
        {...props}
      >
        {isSelected && (
          <m.span
            layoutId={context.pillLayoutId}
            transition={KINETIC_SPRING}
            aria-hidden="true"
            className={cn(
              'rp-tab-pill pointer-events-none absolute inset-0 rounded-[7px]',
              isAccent
                ? 'bg-red-700 border border-red-500/35'
                : 'bg-[var(--surface-card)] border border-[var(--border-button)]',
            )}
          />
        )}
        <span className="relative z-10 inline-flex items-center justify-center gap-2">
          {children}
        </span>
      </button>
    );
  }
);
TabsTrigger.displayName = 'TabsTrigger';

interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
}

const TabsContent = React.forwardRef<HTMLDivElement, TabsContentProps>(
  ({ className, value, children, ...props }, ref) => {
    const context = React.useContext(TabsContext);
    if (!context) throw new Error('TabsContent must be used within Tabs');

    if (context.value !== value) return null;

    return (
      <div
        ref={ref}
        role="tabpanel"
        className={cn(
          'mt-4 ring-offset-[var(--surface-page)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500',
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);
TabsContent.displayName = 'TabsContent';

export { Tabs, TabsList, TabsTrigger, TabsContent };
