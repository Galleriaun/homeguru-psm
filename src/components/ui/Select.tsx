import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { cn } from '@/lib/utils';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  label?: string;
  name?: string;
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  required?: boolean;
  error?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Custom Select dropdown.
 * Replaces the native <select> so we control the appearance in all browsers.
 * Fully keyboard-accessible: arrow keys, Home/End, Enter/Space, Escape, Tab.
 */
export const Select = forwardRef<HTMLButtonElement, SelectProps>(
  (
    {
      label,
      name,
      id,
      value,
      onChange,
      options,
      required,
      error,
      placeholder = 'Seçiniz…',
      disabled,
      className,
    },
    ref,
  ) => {
    const selectId = id ?? name;
    const [open, setOpen] = useState(false);
    const [highlighted, setHighlighted] = useState<number>(() => {
      const idx = options.findIndex((o) => o.value === value);
      return idx >= 0 ? idx : 0;
    });

    const containerRef = useRef<HTMLDivElement>(null);
    const optionRefs = useRef<(HTMLLIElement | null)[]>([]);

    // Click outside → close
    useEffect(() => {
      if (!open) return;
      const handle = (e: MouseEvent) => {
        if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
      };
      document.addEventListener('mousedown', handle);
      return () => document.removeEventListener('mousedown', handle);
    }, [open]);

    // When opening, sync highlight to current selection
    useEffect(() => {
      if (open) {
        const idx = options.findIndex((o) => o.value === value);
        setHighlighted(idx >= 0 ? idx : 0);
      }
    }, [open, value, options]);

    // Keep the highlighted option visible if list scrolls
    useEffect(() => {
      if (open) optionRefs.current[highlighted]?.scrollIntoView({ block: 'nearest' });
    }, [open, highlighted]);

    const selectOption = useCallback(
      (index: number) => {
        const opt = options[index];
        if (opt) {
          onChange(opt.value);
          setOpen(false);
        }
      },
      [options, onChange],
    );

    const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          if (!open) setOpen(true);
          else setHighlighted((i) => Math.min(i + 1, options.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (!open) setOpen(true);
          else setHighlighted((i) => Math.max(i - 1, 0));
          break;
        case 'Home':
          if (open) {
            e.preventDefault();
            setHighlighted(0);
          }
          break;
        case 'End':
          if (open) {
            e.preventDefault();
            setHighlighted(options.length - 1);
          }
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (open) selectOption(highlighted);
          else setOpen(true);
          break;
        case 'Escape':
          if (open) {
            e.preventDefault();
            setOpen(false);
          }
          break;
        case 'Tab':
          if (open) setOpen(false);
          break;
      }
    };

    const selected = options.find((o) => o.value === value);

    return (
      <div ref={containerRef} className="relative">
        {label && (
          <label
            htmlFor={selectId}
            className="block text-sm font-medium text-stone-700 dark:text-stone-300"
          >
            {label}
            {required && <span className="ml-0.5 text-red-500">*</span>}
          </label>
        )}
        <button
          ref={ref}
          type="button"
          id={selectId}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-required={required}
          aria-invalid={!!error}
          disabled={disabled}
          onClick={() => !disabled && setOpen((o) => !o)}
          onKeyDown={handleKeyDown}
          className={cn(
            'mt-1 flex w-full items-center justify-between rounded-md border bg-white px-3 py-2 text-left text-sm transition-colors',
            'border-stone-300 dark:border-stone-700 dark:bg-stone-800',
            'focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/30',
            error && 'border-red-500 dark:border-red-500',
            disabled && 'cursor-not-allowed opacity-60',
            className,
          )}
        >
          <span
            className={
              selected
                ? 'text-stone-900 dark:text-stone-100'
                : 'text-stone-400 dark:text-stone-500'
            }
          >
            {selected?.label ?? placeholder}
          </span>
          <svg
            className={cn(
              'h-4 w-4 text-stone-500 transition-transform dark:text-stone-400',
              open && 'rotate-180',
            )}
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M5 8l5 5 5-5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {open && (
          <ul
            role="listbox"
            tabIndex={-1}
            className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-white py-1 shadow-lg
                       border-stone-200 dark:border-stone-700 dark:bg-stone-900"
          >
            {options.map((opt, i) => {
              const isSelected = opt.value === value;
              const isHighlighted = i === highlighted;
              return (
                <li
                  key={opt.value}
                  ref={(el) => {
                    optionRefs.current[i] = el;
                  }}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setHighlighted(i)}
                  onClick={() => selectOption(i)}
                  className={cn(
                    'cursor-pointer px-3 py-2 text-sm transition-colors',
                    isHighlighted
                      ? 'bg-emerald-600 text-white'
                      : isSelected
                        ? 'bg-emerald-50 font-medium text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200'
                        : 'text-stone-900 dark:text-stone-100',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span>{opt.label}</span>
                    {isSelected && (
                      <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                        <path
                          d="M4 10l4 4 8-8"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    );
  },
);

Select.displayName = 'Select';
