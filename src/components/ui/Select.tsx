import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface SelectOption {
  value: string;
  label: string;
  sublabel?: string;
  badge?: string;
  accentDot?: string;
  disabled?: boolean;
}

export interface SelectProps {
  id?: string;
  name?: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  'aria-label'?: string;
  ariaLabelledBy?: string;
  'aria-labelledby'?: string;
  ariaInvalid?: boolean;
  'aria-invalid'?: boolean;
  ariaRequired?: boolean;
  'aria-required'?: boolean;
  title?: string;
  surface?: 'inset' | 'card' | 'header';
  size?: 'sm' | 'md' | 'lg';
  align?: 'left' | 'center';
  searchable?: boolean;
  searchPlaceholder?: string;
  leadingIcon?: React.ReactNode;
  minMenuWidth?: number;
  className?: string;
  triggerClassName?: string;
  menuClassName?: string;
  showSublabelInTrigger?: boolean;
}

function findEnabledIndex(options: SelectOption[], startIndex: number, direction: 1 | -1): number {
  if (options.length === 0) return -1;
  for (let step = 0; step < options.length; step += 1) {
    const idx = (startIndex + step * direction + options.length) % options.length;
    if (!options[idx]?.disabled) return idx;
  }
  return -1;
}

export function Select({
  id,
  name,
  value,
  options,
  onChange,
  placeholder = 'Select option',
  disabled = false,
  ariaLabel,
  'aria-label': ariaLabelAttr,
  ariaLabelledBy,
  'aria-labelledby': ariaLabelledByAttr,
  ariaInvalid,
  'aria-invalid': ariaInvalidAttr,
  ariaRequired,
  'aria-required': ariaRequiredAttr,
  title,
  surface = 'inset',
  size = 'md',
  align = 'left',
  searchable = false,
  searchPlaceholder = 'Filter options...',
  leadingIcon,
  minMenuWidth,
  className,
  triggerClassName,
  menuClassName,
  showSublabelInTrigger = false,
}: SelectProps) {
  const generatedId = useId();
  const controlId = id || `rp-select-${generatedId}`;
  const listboxId = `${controlId}-listbox`;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const ignoreNextClickRef = useRef(false);
  const typeAheadBufferRef = useRef('');
  const typeAheadTimerRef = useRef<number | null>(null);

  const [open, setOpen] = useState(false);
  const [queryText, setQueryText] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const [placement, setPlacement] = useState<'top' | 'bottom'>('bottom');
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const [listMaxHeight, setListMaxHeight] = useState(288);
  const lastPositionKeyRef = useRef('');

  const supportsPopover = useMemo(
    () => typeof HTMLElement !== 'undefined' && Object.hasOwn(HTMLElement.prototype, 'popover'),
    [],
  );

  const resolvedAriaLabel = ariaLabel ?? ariaLabelAttr;
  const resolvedAriaLabelledBy = ariaLabelledBy ?? ariaLabelledByAttr;
  const resolvedAriaInvalid = ariaInvalid ?? ariaInvalidAttr;
  const resolvedAriaRequired = ariaRequired ?? ariaRequiredAttr;

  const selectedOption = useMemo(
    () => options.find((opt) => opt.value === value) || null,
    [options, value],
  );

  const showSearch = searchable && options.length >= 6;

  const filteredOptions = useMemo(() => {
    const q = queryText.trim().toLowerCase();
    if (!showSearch || !q) return options;
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) ||
        (opt.sublabel || '').toLowerCase().includes(q) ||
        (opt.badge || '').toLowerCase().includes(q),
    );
  }, [options, queryText, showSearch]);

  const closeMenu = useCallback(
    (restoreFocus = false) => {
      const popEl = popoverRef.current as (HTMLDivElement & { hidePopover?: () => void }) | null;
      if (supportsPopover && popEl && typeof popEl.hidePopover === 'function') {
        try {
          if (popEl.matches(':popover-open')) {
            popEl.hidePopover();
          }
        } catch {
          // Ignore when already closed or disconnected.
        }
      }
      setOpen(false);
      setQueryText('');
      lastPositionKeyRef.current = '';
      if (restoreFocus) {
        triggerRef.current?.focus();
      }
    },
    [supportsPopover],
  );

  const openMenu = useCallback(() => {
    if (disabled || triggerRef.current?.matches(':disabled')) return;
    const dialogAncestor = triggerRef.current?.closest('dialog');
    setPortalContainer((dialogAncestor as HTMLElement | null) ?? document.body);
    const selectedIdx = options.findIndex((o) => o.value === value && !o.disabled);
    const initialIdx = selectedIdx >= 0 ? selectedIdx : findEnabledIndex(options, 0, 1);
    setActiveIndex(initialIdx);
    setOpen(true);
  }, [disabled, options, value]);

  const commitOption = useCallback(
    (opt: SelectOption) => {
      if (opt.disabled) return;
      onChange(opt.value);
      closeMenu(true);
    },
    [closeMenu, onChange],
  );

  const updateMenuPosition = useCallback(() => {
    const triggerEl = triggerRef.current;
    const popEl = popoverRef.current;
    if (!triggerEl || !popEl) return;

    const rect = triggerEl.getBoundingClientRect();
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;

    if (rect.bottom < 0 || rect.top > vh) {
      closeMenu(false);
      return;
    }

    const effectiveMinWidth = Math.min(vw - 16, Math.max(rect.width, minMenuWidth ?? 0));
    const effectiveMaxWidth = Math.min(vw - 16, Math.max(rect.width, 440));
    const spaceBelow = Math.max(0, vh - rect.bottom - 12);
    const spaceAbove = Math.max(0, rect.top - 12);
    const nextPlacement: 'top' | 'bottom' =
      spaceBelow < 220 && spaceAbove > spaceBelow ? 'top' : 'bottom';
    const availableVertical = nextPlacement === 'bottom' ? spaceBelow : spaceAbove;
    const nextListMax = Math.max(120, Math.min(288, availableVertical - (showSearch ? 64 : 16)));

    // Measure actual width within computed min/max bounds before clamping left offset.
    const measuredWidth = Math.min(
      Math.max(popEl.offsetWidth || rect.width, effectiveMinWidth),
      effectiveMaxWidth,
    );
    const preferredLeft =
      align === 'center' && measuredWidth > rect.width
        ? rect.left + rect.width / 2 - measuredWidth / 2
        : rect.left;
    const clampedLeft = Math.max(8, Math.min(preferredLeft, vw - measuredWidth - 8));
    const clampedTop = nextPlacement === 'bottom' ? Math.max(8, rect.bottom + 6) : null;
    const clampedBottom = nextPlacement === 'top' ? Math.max(8, vh - rect.top + 6) : null;

    const positionKey = `${nextPlacement}:${effectiveMinWidth}:${effectiveMaxWidth}:${clampedLeft}:${clampedTop ?? ''}:${clampedBottom ?? ''}:${nextListMax}`;
    if (positionKey === lastPositionKeyRef.current) return;
    lastPositionKeyRef.current = positionKey;

    setPlacement(nextPlacement);
    setListMaxHeight(nextListMax);
    setMenuStyle({
      minWidth: `${effectiveMinWidth}px`,
      maxWidth: `${effectiveMaxWidth}px`,
      left: `${clampedLeft}px`,
      ...(clampedTop !== null
        ? { top: `${clampedTop}px`, bottom: 'auto' }
        : { top: 'auto', bottom: `${clampedBottom}px` }),
    });
  }, [align, closeMenu, minMenuWidth, showSearch]);

  useLayoutEffect(() => {
    if (!open) return;
    const popEl = popoverRef.current as (HTMLDivElement & { showPopover?: () => void }) | null;
    if (!popEl) return;

    if (supportsPopover && typeof popEl.showPopover === 'function') {
      try {
        if (!popEl.matches(':popover-open')) {
          popEl.showPopover();
        }
      } catch {
        // Fallback when element is temporarily detached.
      }
    }

    updateMenuPosition();
    const rafId = window.requestAnimationFrame(updateMenuPosition);
    return () => window.cancelAnimationFrame(rafId);
  }, [open, portalContainer, supportsPopover, updateMenuPosition]);

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
  }, [filteredOptions.length, open, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    const popEl = popoverRef.current;

    const handleNativeToggle = (ev: Event) => {
      const toggleEv = ev as ToggleEvent;
      if (toggleEv.newState === 'closed') {
        lastPositionKeyRef.current = '';
        setOpen(false);
        setQueryText('');
      }
    };

    const handleOutsidePointerDown = (ev: PointerEvent) => {
      const target = ev.target as Node | null;
      if (!target) return;
      if (containerRef.current?.contains(target) || popoverRef.current?.contains(target)) {
        return;
      }
      closeMenu(false);
    };

    const handleWindowKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        closeMenu(true);
      } else if (ev.key === 'Tab') {
        closeMenu(false);
      }
    };

    const handleScrollOrResize = (ev?: Event) => {
      if (ev?.type === 'scroll' && ev.target instanceof Node && popoverRef.current?.contains(ev.target)) {
        return;
      }
      updateMenuPosition();
    };

    popEl?.addEventListener('toggle', handleNativeToggle);
    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    window.addEventListener('keydown', handleWindowKeyDown, true);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize, { passive: true });

    return () => {
      popEl?.removeEventListener('toggle', handleNativeToggle);
      document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
      window.removeEventListener('keydown', handleWindowKeyDown, true);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [closeMenu, open, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    if (showSearch) {
      const t = window.setTimeout(() => searchInputRef.current?.focus({ preventScroll: true }), 16);
      return () => window.clearTimeout(t);
    }
    if (activeIndex >= 0) {
      optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, open, showSearch]);

  useEffect(() => {
    return () => {
      if (typeAheadTimerRef.current !== null) {
        window.clearTimeout(typeAheadTimerRef.current);
      }
    };
  }, []);

  const handleTriggerPointerDown = () => {
    if (open) {
      ignoreNextClickRef.current = true;
    }
  };

  const handleTriggerClick = () => {
    if (ignoreNextClickRef.current) {
      ignoreNextClickRef.current = false;
      return;
    }
    if (open) {
      closeMenu(false);
    } else {
      openMenu();
    }
  };

  const runTypeAhead = (key: string) => {
    if (typeAheadTimerRef.current !== null) {
      window.clearTimeout(typeAheadTimerRef.current);
    }
    typeAheadBufferRef.current += key.toLowerCase();
    typeAheadTimerRef.current = window.setTimeout(() => {
      typeAheadBufferRef.current = '';
    }, 550);

    const prefix = typeAheadBufferRef.current;
    const list = filteredOptions;
    if (list.length === 0) return;

    const start = activeIndex >= 0 ? activeIndex : 0;
    for (let offset = 1; offset <= list.length; offset += 1) {
      const idx = (start + offset) % list.length;
      const opt = list[idx];
      if (!opt.disabled && opt.label.toLowerCase().startsWith(prefix)) {
        setActiveIndex(idx);
        return;
      }
    }
  };

  const handleKeyDown = (ev: React.KeyboardEvent, fromSearchInput = false) => {
    if (disabled || triggerRef.current?.matches(':disabled')) return;

    if (!open) {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp' || ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        openMenu();
      }
      return;
    }

    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      if (filteredOptions.length === 0) return;
      const start = activeIndex < 0 ? 0 : activeIndex + 1;
      setActiveIndex(findEnabledIndex(filteredOptions, start, 1));
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (filteredOptions.length === 0) return;
      const start = activeIndex < 0 ? filteredOptions.length - 1 : activeIndex - 1;
      setActiveIndex(findEnabledIndex(filteredOptions, start, -1));
    } else if (ev.key === 'Home' && !fromSearchInput) {
      ev.preventDefault();
      setActiveIndex(findEnabledIndex(filteredOptions, 0, 1));
    } else if (ev.key === 'End' && !fromSearchInput) {
      ev.preventDefault();
      setActiveIndex(findEnabledIndex(filteredOptions, Math.max(0, filteredOptions.length - 1), -1));
    } else if (ev.key === 'Enter') {
      if (activeIndex >= 0 && filteredOptions[activeIndex]) {
        ev.preventDefault();
        commitOption(filteredOptions[activeIndex]);
      }
    } else if (ev.key === ' ' && !fromSearchInput) {
      ev.preventDefault();
      if (activeIndex >= 0 && filteredOptions[activeIndex]) {
        commitOption(filteredOptions[activeIndex]);
      }
    } else if (
      !fromSearchInput &&
      ev.key.length === 1 &&
      !ev.ctrlKey &&
      !ev.metaKey &&
      !ev.altKey
    ) {
      runTypeAhead(ev.key);
    }
  };

  const sizeClasses = {
    sm: 'min-h-11 lg:min-h-9 px-3 py-1.5 text-xs font-semibold rounded-lg',
    md: 'min-h-11 px-3 py-2 text-sm font-semibold rounded-xl',
    lg: 'min-h-[52px] px-4 py-3 text-base font-normal rounded-xl',
  }[size];

  const surfaceTriggerClasses = {
    inset:
      'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-primary)] hover:border-[var(--border-button)] hover:bg-[var(--surface-hover)]',
    card:
      'border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-primary)] hover:border-[var(--border-button)] hover:bg-[var(--surface-hover)]',
    header:
      'border-white/20 bg-[#1c1d21] text-white hover:border-red-400/70 hover:bg-[#24262b]',
  }[surface];

  const isHeaderSurface = surface === 'header';
  const openRingClasses = isHeaderSurface
    ? 'border-red-400 ring-2 ring-red-400/35'
    : 'border-red-600 dark:border-red-400 ring-2 ring-red-600/25 dark:ring-red-400/25';

  const menuSurfaceClasses = isHeaderSurface
    ? 'border border-white/20 bg-[#141416] text-white shadow-[0_20px_48px_-12px_rgba(0,0,0,0.75)]'
    : 'border border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-primary)] shadow-[0_16px_40px_-12px_rgba(0,0,0,0.22)] dark:shadow-[0_20px_48px_-12px_rgba(0,0,0,0.68)]';

  const menuContent = open && portalContainer ? (
    <div
      ref={popoverRef}
      {...(supportsPopover ? { popover: 'auto' as const } : {})}
      data-placement={placement}
      onClick={(ev) => ev.stopPropagation()}
      style={menuStyle}
      className={cn(
        'rp-select-popover rounded-2xl overflow-hidden',
        !supportsPopover && 'fixed z-[9999]',
        menuSurfaceClasses,
        menuClassName,
      )}
    >
      {showSearch && (
        <div
          className={cn(
            'p-2 border-b',
            isHeaderSurface
              ? 'border-white/15 bg-[#1c1d21]'
              : 'border-[var(--border-default)] bg-[var(--surface-inset)]',
          )}
        >
          <div className="relative">
            <Search
              className={cn(
                'w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none',
                isHeaderSurface ? 'text-zinc-300' : 'text-[var(--text-secondary)]',
              )}
              aria-hidden="true"
            />
            <input
              ref={searchInputRef}
              type="text"
              value={queryText}
              onChange={(ev) => {
                setQueryText(ev.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={(ev) => handleKeyDown(ev, true)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className={cn(
                'w-full min-h-9 pl-8 pr-8 rounded-lg border text-xs focus:outline-none focus-visible:ring-2',
                isHeaderSurface
                  ? 'border-white/20 bg-[#141416] text-white placeholder:text-zinc-400 focus-visible:ring-red-400'
                  : 'border-[var(--border-default)] bg-[var(--surface-card)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus-visible:ring-red-600 dark:focus-visible:ring-red-400',
              )}
            />
            {queryText && (
              <button
                type="button"
                aria-label="Clear filter"
                onClick={() => {
                  setQueryText('');
                  setActiveIndex(0);
                  searchInputRef.current?.focus();
                }}
                className={cn(
                  'absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 inline-flex items-center justify-center rounded',
                  isHeaderSurface
                    ? 'text-zinc-300 hover:text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                )}
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      )}

      <div
        id={listboxId}
        role="listbox"
        aria-label={resolvedAriaLabel || (!resolvedAriaLabelledBy ? placeholder : undefined)}
        aria-labelledby={resolvedAriaLabelledBy || (resolvedAriaLabel ? undefined : controlId)}
        onKeyDown={(ev) => handleKeyDown(ev, false)}
        style={{ maxHeight: `${listMaxHeight}px` }}
        className={cn(
          'overflow-y-auto overscroll-contain p-1.5 space-y-1',
          isHeaderSurface && 'rp-select-list-dark',
        )}
      >
        {filteredOptions.length === 0 ? (
          <p
            className={cn(
              'px-3 py-4 text-center text-xs font-mono',
              isHeaderSurface ? 'text-zinc-300' : 'text-[var(--text-secondary)]',
            )}
          >
            {options.length === 0 ? 'No options available.' : 'No matching options found.'}
          </p>
        ) : (
          filteredOptions.map((opt, idx) => {
            const isSelected = opt.value === value;
            const isHighlighted = idx === activeIndex;
            return (
              <button
                key={`${opt.value}-${idx}`}
                ref={(el) => {
                  optionRefs.current[idx] = el;
                }}
                id={`${listboxId}-opt-${idx}`}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={opt.disabled}
                onMouseEnter={() => {
                  if (!opt.disabled) setActiveIndex(idx);
                }}
                onClick={() => commitOption(opt)}
                className={cn(
                  'w-full min-h-11 px-3 py-2 rounded-xl border text-left transition-colors duration-100 flex items-center justify-between gap-2.5 disabled:opacity-45 disabled:cursor-not-allowed',
                  align === 'center' && 'justify-center text-center',
                  isSelected
                    ? isHeaderSurface
                      ? 'border-red-400/70 bg-red-500/20 text-white'
                      : 'border-red-600/60 dark:border-red-400/60 bg-red-50 dark:bg-red-950/45 text-[var(--text-primary)]'
                    : isHighlighted
                      ? isHeaderSurface
                        ? 'border-white/20 bg-[#27272c] text-white'
                        : 'border-[var(--border-default)] bg-[var(--surface-hover)] text-[var(--text-primary)]'
                      : isHeaderSurface
                        ? 'border-transparent text-zinc-100 hover:bg-[#27272c]'
                        : 'border-transparent text-[var(--text-primary)] hover:bg-[var(--surface-hover)]',
                )}
              >
                <div
                  className={cn(
                    'min-w-0 flex-1 flex items-center gap-2.5',
                    align === 'center' && 'justify-center',
                  )}
                >
                  {opt.accentDot && (
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/25"
                      style={{ backgroundColor: opt.accentDot }}
                      aria-hidden="true"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block text-xs sm:text-sm leading-snug break-words',
                        isSelected ? 'font-semibold' : 'font-normal',
                      )}
                    >
                      {opt.label}
                    </span>
                    {opt.sublabel && (
                      <span
                        className={cn(
                          'block text-xs font-mono truncate mt-0.5',
                          isHeaderSurface ? 'text-zinc-300' : 'text-[var(--text-secondary)]',
                        )}
                      >
                        {opt.sublabel}
                      </span>
                    )}
                  </div>
                </div>

                {(opt.badge || isSelected) && (
                  <div className="flex items-center gap-2 shrink-0">
                    {opt.badge && (
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded-md text-xs font-mono font-semibold border',
                          isSelected
                            ? 'border-red-600/40 bg-red-700 text-white'
                            : isHeaderSurface
                              ? 'border-white/20 bg-[#1c1d21] text-zinc-200'
                              : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-secondary)]',
                        )}
                      >
                        {opt.badge}
                      </span>
                    )}
                    {isSelected && (
                      <Check
                        className={cn(
                          'w-4 h-4 shrink-0',
                          isHeaderSurface ? 'text-red-400' : 'text-red-700 dark:text-red-400',
                        )}
                        aria-hidden="true"
                      />
                    )}
                  </div>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  ) : null;

  return (
    <div ref={containerRef} className={cn('relative w-full min-w-0', className)}>
      <button
        ref={triggerRef}
        id={controlId}
        name={name}
        type="button"
        role="combobox"
        title={title}
        aria-label={resolvedAriaLabel}
        aria-labelledby={resolvedAriaLabelledBy}
        aria-invalid={resolvedAriaInvalid}
        aria-required={resolvedAriaRequired}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined}
        disabled={disabled}
        onPointerDown={handleTriggerPointerDown}
        onClick={handleTriggerClick}
        onKeyDown={(ev) => handleKeyDown(ev, false)}
        className={cn(
          'w-full border transition-[border-color,background-color,box-shadow] duration-150 flex items-center justify-between gap-2 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none',
          align === 'center' ? 'text-center' : 'text-left',
          sizeClasses,
          surfaceTriggerClasses,
          open
            ? openRingClasses
            : isHeaderSurface
              ? 'focus-visible:ring-2 focus-visible:ring-red-400'
              : 'focus-visible:ring-2 focus-visible:ring-red-700 dark:focus-visible:ring-red-400',
          triggerClassName,
        )}
      >
        <div
          className={cn(
            'min-w-0 flex-1 flex items-center gap-2',
            align === 'center' && 'justify-center',
          )}
        >
          {leadingIcon && (
            <span
              className={cn(
                'shrink-0',
                isHeaderSurface ? 'text-zinc-300' : 'text-[var(--text-secondary)]',
              )}
              aria-hidden="true"
            >
              {leadingIcon}
            </span>
          )}
          {selectedOption?.accentDot && (
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/25"
              style={{ backgroundColor: selectedOption.accentDot }}
              aria-hidden="true"
            />
          )}
          <div className="min-w-0 flex-1">
            <span
              className={cn(
                'block truncate',
                !selectedOption &&
                  (isHeaderSurface ? 'text-zinc-300 font-normal' : 'text-[var(--text-secondary)] font-normal'),
              )}
            >
              {selectedOption ? selectedOption.label : placeholder}
            </span>
            {showSublabelInTrigger && selectedOption?.sublabel && (
              <span
                className={cn(
                  'block text-xs font-mono truncate',
                  isHeaderSurface ? 'text-zinc-300' : 'text-[var(--text-secondary)]',
                )}
              >
                {selectedOption.sublabel}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {selectedOption?.badge && (
            <span
              className={cn(
                'px-2 py-0.5 rounded-md border text-xs font-mono font-semibold',
                isHeaderSurface
                  ? 'border-white/20 bg-[#141416] text-zinc-200'
                  : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-secondary)]',
              )}
            >
              {selectedOption.badge}
            </span>
          )}
          <ChevronDown
            className={cn(
              'w-4 h-4 shrink-0 transition-transform duration-150',
              open
                ? isHeaderSurface
                  ? 'rotate-180 text-red-400'
                  : 'rotate-180 text-red-700 dark:text-red-400'
                : isHeaderSurface
                  ? 'text-zinc-300'
                  : 'text-[var(--text-secondary)]',
            )}
            aria-hidden="true"
          />
        </div>
      </button>

      {menuContent && portalContainer ? createPortal(menuContent, portalContainer) : null}
    </div>
  );
}

export default Select;
