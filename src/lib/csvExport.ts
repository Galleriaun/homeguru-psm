/**
 * Minimal CSV export — no external lib, no Excel binary format.
 *
 * Why semicolon + UTF-8 BOM:
 *  • Excel on Turkish-locale Windows defaults to ; as separator. Using ; instead
 *    of , means the user can double-click the file and columns are split correctly.
 *  • The BOM (﻿) tells Excel that the file is UTF-8 so Turkish characters
 *    (ş ç ğ ı ö ü) render correctly. Without it Excel guesses Latin-1.
 *  • Numbers and Google Sheets also handle this format natively.
 */

const SEP = ';';
const ROW_END = '\r\n';
const BOM = '﻿';

/**
 * Escape a single cell value for CSV. Wraps in double quotes when the value
 * contains the separator, a quote, or a newline. Doubles internal quotes.
 */
function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'string' ? value : String(value);
  if (s.includes(SEP) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Convert an array of row objects to a CSV string.
 *
 * @param rows   array of objects (one per row)
 * @param columns ordered list of { key, label } — label becomes the header,
 *                key is the property name read from each row
 */
export function toCsv<T extends Record<string, unknown>>(
  rows: T[],
  columns: { key: keyof T & string; label: string }[],
): string {
  const header = columns.map((c) => escapeCell(c.label)).join(SEP);
  const body = rows
    .map((r) => columns.map((c) => escapeCell(r[c.key])).join(SEP))
    .join(ROW_END);
  return BOM + header + ROW_END + body + (rows.length > 0 ? ROW_END : '');
}

/**
 * Trigger a browser download for a CSV string. Filename is sanitized lightly
 * so users don't generate "Şubat: 2026.csv" with illegal characters on Windows.
 */
export function downloadCsv(filename: string, csv: string): void {
  const safeName = filename
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\.csv$/i, '')
    .trim();
  const finalName = `${safeName || 'export'}.csv`;

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = finalName;
  document.body.appendChild(a);
  a.click();
  a.remove();

  // Free the object URL after the click has been processed.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Convenience: build CSV from rows + columns then trigger download.
 */
export function exportRowsToCsv<T extends Record<string, unknown>>(
  filename: string,
  rows: T[],
  columns: { key: keyof T & string; label: string }[],
): void {
  downloadCsv(filename, toCsv(rows, columns));
}
