import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

export interface HighlightSelectOption {
  value: string;
  label: string;
  sublabel?: string;
  badge?: string;
  accentDot?: string;
  disabled?: boolean;
}

interface HighlightCustomSelectProps {
  id?: string;
  label?: string;
  ariaLabel?: string;
  value: string;
  options: HighlightSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  compact?: boolean;
  onChange: (value: string) => void;
}

/**
 * Accessible custom combobox/listbox selector replacing OS-native select popups
 * with themed option rows, event metadata, and count pills.
 */
export default function HighlightCustomSelect({
  id,
  label,
  ariaLabel,
  value,
  options,
  placeholder = 'Select option',
  disabled = false,
  searchable = false,
  searchPlaceholder = 'Filter options...',
  compact = false,
  onChange,
}: HighlightCustomSelectProps) {
  const generatedId = useId();
  const controlId = id || `hl-select-${generatedId}`;
  const listboxId = `${controlId}-listbox`;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const [open, setOpen] = useState(false);
  const [queryText, setQueryText] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);

  const selectedOption = useMemo(
    () => options.find((opt) => opt.value === value) || null,
    [options, value],
  );

  const filteredOptions = useMemo(() => {
    const q = queryText.trim().toLowerCase();
    if (!searchable || !q) return options;
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) ||
        (opt.sublabel || '').toLowerCase().includes(q) ||
        (opt.badge || '').toLowerCase().includes(q),
    );
  }, [options, queryText, searchable]);

  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (ev: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(ev.target as Node)) {
        setOpen(false);
        setQueryText('');
      }
    };
    const onDocKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setOpen(false);
        setQueryText('');
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDocPointerDown);
    document.addEventListener('keydown', onDocKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocPointerDown);
      document.removeEventListener('keydown', onDocKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open && searchable && options.length >= 6) {
      const t = window.setTimeout(() => searchInputRef.current?.focus(), 20);
      return () => window.clearTimeout(t);
    }
  }, [open, searchable, options.length]);

  const handleToggle = () => {
    if (disabled) return;
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        const idx = options.findIndex((o) => o.value === value && !o.disabled);
        setActiveIndex(idx >= 0 ? idx : 0);
      } else {
        setQueryText('');
      }
      return next;
    });
  };

  const commitOption = (opt: HighlightSelectOption) => {
    if (opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
    setQueryText('');
    triggerRef.current?.focus();
  };

  const handleKeyDown = (ev: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp' || ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        setOpen(true);
        const idx = options.findIndex((o) => o.value === value && !o.disabled);
        setActiveIndex(idx >= 0 ? idx : 0);
      }
      return;
    }

    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      if (filteredOptions.length === 0) return;
      setActiveIndex((prev) => (prev + 1) % filteredOptions.length);
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (filteredOptions.length === 0) return;
      setActiveIndex((prev) => (prev - 1 + filteredOptions.length) % filteredOptions.length);
    } else if (ev.key === 'Home') {
      ev.preventDefault();
      setActiveIndex(filteredOptions.length > 0 ? 0 : -1);
    } else if (ev.key === 'End') {
      ev.preventDefault();
      setActiveIndex(filteredOptions.length > 0 ? filteredOptions.length - 1 : -1);
    } else if (ev.key === 'Enter' && activeIndex >= 0) {
      const target = filteredOptions[activeIndex];
      if (target) {
        ev.preventDefault();
        commitOption(target);
      }
    }
  };

  return (
    <div ref={containerRef} className="relative w-full min-w-0">
      <button
        ref={triggerRef}
        id={controlId}
        type="button"
        role="combobox"
        aria-label={ariaLabel || label}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined}
        disabled={disabled}
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        className={`w-full ${
          compact ? 'min-h-10 px-3 py-1.5 text-xs' : 'min-h-11 px-3 py-2 text-sm'
        } rounded-xl border transition-[border-color,background-color,box-shadow] duration-150 flex items-center justify-between gap-2 text-left bg-[var(--surface-card)] text-[var(--text-primary)] ${
          open
            ? 'border-red-600 ring-2 ring-red-600/25 shadow-sm'
            : 'border-[var(--border-default)] hover:border-[var(--border-button)] hover:bg-[var(--surface-hover)]'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        <div className="min-w-0 flex-1 flex items-center gap-2">
          {selectedOption?.accentDot && (
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/25"
              style={{ backgroundColor: selectedOption.accentDot }}
              aria-hidden="true"
            />
          )}
          <div className="min-w-0 flex-1">
            <span className="block font-semibold text-[var(--text-primary)] truncate">
              {selectedOption ? selectedOption.label : placeholder}
            </span>
            {selectedOption?.sublabel && !compact && (
              <span className="block text-[11px] font-mono text-[var(--text-secondary)] truncate">
                {selectedOption.sublabel}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {selectedOption?.badge && (
            <span className="px-2 py-0.5 rounded-md border border-[var(--border-default)] bg-[var(--surface-inset)] text-[11px] font-mono font-semibold text-[var(--text-secondary)]">
              {selectedOption.badge}
            </span>
          )}
          <ChevronDown
            className={`w-4 h-4 text-[var(--text-secondary)] transition-transform duration-150 ${
              open ? 'rotate-180 text-red-600 dark:text-red-400' : ''
            }`}
            aria-hidden="true"
          />
        </div>
      </button>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel || label || 'Options'}
          onKeyDown={handleKeyDown}
          className="absolute left-0 right-0 top-full mt-1.5 z-40 rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] shadow-2xl overflow-hidden"
        >
          {searchable && options.length >= 6 && (
            <div className="p-2 border-b border-[var(--border-default)] bg-[var(--surface-inset)]">
              <div className="relative">
                <Search
                  className="w-3.5 h-3.5 text-[var(--text-secondary)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={queryText}
                  onChange={(e) => {
                    setQueryText(e.target.value);
                    setActiveIndex(0);
                  }}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  className="w-full h-9 pl-8 pr-8 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-red-600"
                />
                {queryText && (
                  <button
                    type="button"
                    aria-label="Clear filter"
                    onClick={() => {
                      setQueryText('');
                      setActiveIndex(0);
                    }}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 inline-flex items-center justify-center rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="max-h-72 overflow-y-auto p-1.5 space-y-1">
            {filteredOptions.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs font-mono text-[var(--text-secondary)]">
                No matching options found.
              </p>
            ) : (
              filteredOptions.map((opt, idx) => {
                const isSelected = opt.value === value;
                const isHighlighted = idx === activeIndex;
                return (
                  <button
                    key={`${opt.value}-${idx}`}
                    id={`${listboxId}-opt-${idx}`}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    disabled={opt.disabled}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => commitOption(opt)}
                    className={`w-full min-h-11 px-3 py-2 rounded-lg border text-left transition-colors duration-100 flex items-center justify-between gap-2.5 ${
                      isSelected
                        ? 'border-red-600/70 bg-red-600/12 text-[var(--text-primary)]'
                        : isHighlighted
                          ? 'border-[var(--border-default)] bg-[var(--surface-hover)] text-[var(--text-primary)]'
                          : 'border-transparent hover:bg-[var(--surface-hover)] text-[var(--text-primary)]'
                    } disabled:opacity-45 disabled:cursor-not-allowed`}
                  >
                    <div className="min-w-0 flex-1 flex items-center gap-2.5">
                      {opt.accentDot && (
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/25"
                          style={{ backgroundColor: opt.accentDot }}
                          aria-hidden="true"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs sm:text-sm font-semibold text-[var(--text-primary)] truncate">
                          {opt.label}
                        </p>
                        {opt.sublabel && (
                          <p className="text-[11px] font-mono text-[var(--text-secondary)] truncate mt-0.5">
                            {opt.sublabel}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {opt.badge && (
                        <span
                          className={`px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold border ${
                            isSelected
                              ? 'border-red-600/40 bg-red-700 text-white'
                              : 'border-[var(--border-default)] bg-[var(--surface-inset)] text-[var(--text-secondary)]'
                          }`}
                        >
                          {opt.badge}
                        </span>
                      )}
                      {isSelected && (
                        <Check className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" aria-hidden="true" />
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
