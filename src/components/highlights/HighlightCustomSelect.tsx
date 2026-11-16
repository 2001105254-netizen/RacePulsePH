import { Select, type SelectOption } from '../ui/Select';

export type HighlightSelectOption = SelectOption;

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
 * Shared custom combobox/listbox selector used across Highlights Studio,
 * keeping existing prop contracts backed by the app-wide Select primitive.
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
  return (
    <Select
      id={id}
      ariaLabel={ariaLabel || label}
      value={value}
      options={options}
      placeholder={placeholder}
      disabled={disabled}
      searchable={searchable}
      searchPlaceholder={searchPlaceholder}
      surface="card"
      size={compact ? 'sm' : 'md'}
      showSublabelInTrigger={!compact}
      onChange={onChange}
    />
  );
}
