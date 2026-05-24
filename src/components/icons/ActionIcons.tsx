import type { SVGProps } from 'react';

/**
 * Small outline icon set used by the calendar action sheets and a few inline
 * status badges. All icons share the same Heroicons-style outline aesthetic —
 * 24×24 viewBox, no fill, `currentColor` stroke at 1.75px with rounded caps
 * — so they pair cleanly with the sheet's circular icon wells.
 *
 * Why a single file instead of one-per-icon (the WhatsAppIcon pattern): these
 * icons are tightly coupled to the action-sheet UI and only used together,
 * so collocating them here keeps the import surface small.
 */

type IconProps = SVGProps<SVGSVGElement>;

const BASE_PROPS = {
  xmlns: 'http://www.w3.org/2000/svg',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

/** ＋ — new reservation, extend by a night. */
export function PlusIcon({ className = 'h-5 w-5', ...rest }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className} {...rest}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** − — shorten by a night. */
export function MinusIcon({ className = 'h-5 w-5', ...rest }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className} {...rest}>
      <path d="M5 12h14" />
    </svg>
  );
}

/** ✕ — cancel action / close affordance. */
export function XMarkIcon({ className = 'h-5 w-5', ...rest }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className} {...rest}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/** ⛔ — block dates. Circle with a diagonal slash. */
export function NoEntryIcon({ className = 'h-5 w-5', ...rest }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className} {...rest}>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" />
    </svg>
  );
}

/** Document with a folded corner and lines — add / edit a per-date note. */
export function NoteIcon({ className = 'h-5 w-5', ...rest }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className} {...rest}>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
      <path d="M8 13h8M8 17h5" />
    </svg>
  );
}

/** ₺ — Turkish Lira glyph, hand-drawn so it scales with the icon set. */
export function CurrencyLiraIcon({ className = 'h-5 w-5', ...rest }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className} {...rest}>
      {/* Vertical stem of the L */}
      <path d="M9 5v14" />
      {/* Two diagonal cross-strokes that distinguish ₺ from L */}
      <path d="M6 10l8-3M6 14l8-3" />
      {/* The base hook curving up to the right, like the printed glyph */}
      <path d="M9 19c5 0 9-2 10-7" />
    </svg>
  );
}

/** Eye — "Detayı aç". */
export function EyeIcon({ className = 'h-5 w-5', ...rest }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className} {...rest}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** Pencil — edit / change details. */
export function PencilIcon({ className = 'h-5 w-5', ...rest }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className} {...rest}>
      <path d="M4 20h4l10-10-4-4L4 16v4z" />
      <path d="M14 6l4 4" />
    </svg>
  );
}

/** ↔ — move / horizontal range — used by Taşı + the "Aralık seç" toggle. */
export function ArrowsLeftRightIcon({ className = 'h-5 w-5', ...rest }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className} {...rest}>
      <path d="M4 12h16" />
      <path d="M8 8l-4 4 4 4" />
      <path d="M16 8l4 4-4 4" />
    </svg>
  );
}

/** Clock face — used by the Günübirlik (day-use) status badges. */
export function ClockIcon({ className = 'h-5 w-5', ...rest }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className} {...rest}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}
