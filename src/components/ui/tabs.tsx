import * as React from 'react';
import { LayoutGroup, m } from 'motion/react';
import { cn } from '../../lib/utils';

interface TabsContextValue {
  value: string;
  onValueChange: (value: string) => void;
  pillLayoutId: string;
}

const TabsContext = React.createContext<TabsContextValue | undefined>(undefined);

interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}

const Tabs = React.forwardRef<HTMLDivElement, TabsProps>(
  ({ value: controlledValue, defaultValue = '', onValueChange, className, children, ...props }, ref) => {
    const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue);
    const pillLayoutId = React.useId();
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
      <LayoutGroup id={pillLayoutId}>
        <TabsContext.Provider value={{ value, onValueChange: handleValueChange, pillLayoutId }}>
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
      'inline-flex min-h-11 items-center justify-center gap-1 rounded-full bg-[var(--surface-inset)] dark:bg-[#0f0f12] p-1 text-[var(--text-secondary)] border border-[var(--border-default)] shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)]',
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

    return (
      <button
        ref={ref}
        type="button"
        role="tab"
        aria-selected={isSelected}
        onClick={() => context.onValueChange(value)}
        className={cn(
          'relative isolate inline-flex items-center justify-center whitespace-nowrap rounded-full border border-transparent px-4 py-2 text-xs font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 dark:focus-visible:ring-red-400 disabled:pointer-events-none disabled:opacity-50 select-none motion-safe:active:scale-[0.97]',
          isSelected
            ? 'text-red-700 dark:text-red-400 font-semibold'
            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]',
          className
        )}
        {...props}
      >
        {isSelected && (
          <m.span
            layoutId={`tabs-pill-${context.pillLayoutId}`}
            aria-hidden="true"
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-none absolute inset-0 -z-10 rounded-full bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 shadow-sm"
          />
        )}
        {children}
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
