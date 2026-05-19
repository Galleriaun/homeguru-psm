import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface DateInputProps {
  label?: string;
  name: string;
  /** ISO YYYY-MM-DD string. Empty string for no value. */
  value: string;
  /** Called with an ISO YYYY-MM-DD string or '' when cleared. Never called with invalid text. */
  onChange: (iso: string) => void;
  required?: boolean;
  /** ISO YYYY-MM-DD — forwarded to the native picker. */
  min?: string;
  /** ISO YYYY-MM-DD — forwarded to the native picker. */
  max?: string;
  hint?: string;
  disabled?: boolean;
  className?: string;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isoToDisplay(iso: string): string {
  const m = ISO_RE.exec(iso);
  if (!m) return '';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * Parse "dd/mm/yyyy" (also accepts . - and 2-digit year) into ISO YYYY-MM-DD.
 * Returns '' for empty input, null for invalid (so the caller can show an error).
 */
function parseDisplay(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const m = trimmed.match(/^(\d{1,2})[./\-\s](\d{1,2})[./\-\s](\d{2,4})$/);
  if (!m) return null;
  const [, d, mo, rawY] = m;
  const y = rawY.length === 2 ? `20${rawY}` : rawY;
  const day = d.padStart(2, '0');
  const month = mo.padStart(2, '0');
  // Round-trip through Date so we reject impossible dates like 31/02 or 30/02.
  const date = new Date(`${y}-${month}-${day}T00:00:00Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== Number(y) ||
    date.getUTCMonth() + 1 !== Number(month) ||
    date.getUTCDate() !== Number(day)
  ) {
    return null;
  }
  return `${y}-${month}-${day}`;
}

/**
 * Turkish-formatted date input. Shows gg/aa/yyyy regardless of browser/OS
 * locale. A calendar icon opens the native date picker for users who'd
 * rather click than type.
 */
export function DateInput({
  label,
  name,
  value,
  onChange,
  required,
  min,
  max,
  hint,
  disabled,
  className,
}: DateInputProps) {
  const [display, setDisplay] = useState(() => isoToDisplay(value));
  const [error, setError] = useState<string | null>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);

  // Re-sync the visible text whenever the parent updates `value` externally.
  useEffect(() => {
    setDisplay(isoToDisplay(value));
    setError(null);
  }, [value]);

  const commit = () => {
    const parsed = parseDisplay(display);
    if (parsed === null) {
      setError('Geçersiz tarih (gg/aa/yyyy)');
      return;
    }
    setError(null);
    if (parsed !== value) onChange(parsed);
  };

  const openNativePicker = () => {
    const el = hiddenRef.current;
    if (!el || disabled) return;
    el.value = value || '';
    // Modern browsers (Chrome 99+, FF 101+, Safari 16+) expose showPicker().
    // Fallback: focus+click for older iOS / desktop builds.
    type WithShowPicker = HTMLInputElement & { showPicker?: () => void };
    const w = el as WithShowPicker;
    if (typeof w.showPicker === 'function') {
      w.showPicker();
    } else {
      el.focus();
      el.click();
    }
  };

  return (
    <div className={className}>
      {label && (
        <label
          htmlFor={name}
          className="block text-sm font-medium text-stone-700 dark:text-stone-300"
        >
          {label}
          {required && <span className="ml-0.5 text-red-500">*</span>}
        </label>
      )}
      <div className="relative mt-1">
        <input
          type="text"
          id={name}
          name={name}
          value={display}
          onChange={(e) => setDisplay(e.target.value)}
          onBlur={commit}
          placeholder="gg/aa/yyyy"
          inputMode="numeric"
          required={required}
          disabled={disabled}
          autoComplete="off"
          className={cn(
            'w-full rounded-md border px-3 py-2 pr-9 text-stone-900 placeholder-stone-400 transition-colors',
            'border-stone-300 bg-white focus:border-emerald-500 focus:outline-none',
            'dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100 dark:placeholder-stone-500',
            error && 'border-red-500 focus:border-red-500 dark:border-red-500',
          )}
        />
        <button
          type="button"
          onClick={openNativePicker}
          disabled={disabled}
          aria-label="Takvimden seç"
          tabIndex={-1}
          className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-stone-500 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-700 disabled:cursor-not-allowed"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </button>
        {/*
          Hidden native date input — only used to surface the OS picker when
          the user clicks the calendar icon. Kept off-screen but in the DOM
          so showPicker() works in browsers that require an attached element.
        */}
        <input
          ref={hiddenRef}
          type="date"
          tabIndex={-1}
          aria-hidden="true"
          min={min}
          max={max}
          onChange={(e) => {
            const iso = e.target.value;
            if (iso) {
              setDisplay(isoToDisplay(iso));
              setError(null);
              if (iso !== value) onChange(iso);
            }
          }}
          className="pointer-events-none absolute right-0 top-0 h-0 w-0 opacity-0"
        />
      </div>
      {hint && !error && (
        <p className="mt-1 text-xs text-stone-600 dark:text-stone-300">{hint}</p>
      )}
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
