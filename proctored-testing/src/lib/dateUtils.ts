/**
 * Centralized Date & Time formatting utility for Proctored Testing.
 * 
 * Rules:
 * 1. All dates displayed must follow either:
 *    - DD/MM/YYYY (e.g. 27/10/2026)
 *    - DD (st/nd/rd/th) MONTH YEAR (e.g. 27th October 2026 or 27th Oct 2026)
 * 2. All rendered date & time text must be white (#ffffff), clearly visible, and legible.
 */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

/**
 * Returns ordinal suffix for a day number: 1st, 2nd, 3rd, 4th, 21st, 22nd, 23rd, 31st...
 */
export function getOrdinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return `${day}th`;
  switch (day % 10) {
    case 1: return `${day}st`;
    case 2: return `${day}nd`;
    case 3: return `${day}rd`;
    default: return `${day}th`;
  }
}

/**
 * Safely parse any date-like input into a Date object.
 */
export function parseDate(input: string | number | Date | null | undefined): Date | null {
  if (!input) return null;
  if (input instanceof Date) {
    return isNaN(input.getTime()) ? null : input;
  }
  if (typeof input === 'number') {
    const d = new Date(input);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return null;

    // Check if numeric timestamp string
    if (/^\d{10,13}$/.test(trimmed)) {
      const num = parseInt(trimmed, 10);
      const d = new Date(num);
      if (!isNaN(d.getTime())) return d;
    }

    // Try standard parse
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d;

    // Try DD/MM/YYYY parsing if string is in that format
    const ddmmyyyy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (ddmmyyyy) {
      const day = parseInt(ddmmyyyy[1], 10);
      const month = parseInt(ddmmyyyy[2], 10) - 1;
      const year = parseInt(ddmmyyyy[3], 10);
      const parsed = new Date(year, month, day);
      if (!isNaN(parsed.getTime())) return parsed;
    }
  }
  return null;
}

/**
 * Format date as DD/MM/YYYY (e.g. "27/10/2026")
 */
export function formatDateNumeric(input: string | number | Date | null | undefined): string {
  const d = parseDate(input);
  if (!d) return typeof input === 'string' ? input : '—';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Format date as DD (st/nd/rd/th) MONTH YEAR (e.g. "27th October 2026" or "27th Oct 2026")
 */
export function formatDateOrdinal(
  input: string | number | Date | null | undefined,
  shortMonth = false
): string {
  const d = parseDate(input);
  if (!d) return typeof input === 'string' ? input : '—';
  const dayOrdinal = getOrdinalSuffix(d.getDate());
  const month = shortMonth ? MONTH_SHORT[d.getMonth()] : MONTH_NAMES[d.getMonth()];
  const year = d.getFullYear();
  return `${dayOrdinal} ${month} ${year}`;
}

/**
 * Standard date formatter. Defaults to DD/MM/YYYY (numeric) or DDth Month Year (ordinal).
 */
export function formatDate(
  input: string | number | Date | null | undefined,
  style: 'numeric' | 'ordinal' = 'numeric',
  shortMonth = false
): string {
  return style === 'ordinal'
    ? formatDateOrdinal(input, shortMonth)
    : formatDateNumeric(input);
}

/**
 * Format time as 12-hour hh:mm AM/PM (or hh:mm:ss AM/PM)
 */
export function formatTime(
  input: string | number | Date | null | undefined,
  includeSeconds = false
): string {
  const d = parseDate(input);
  if (!d) return typeof input === 'string' ? input : '';
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const hStr = String(hours).padStart(2, '0');

  if (includeSeconds) {
    const s = String(d.getSeconds()).padStart(2, '0');
    return `${hStr}:${minutes}:${s} ${ampm}`;
  }
  return `${hStr}:${minutes} ${ampm}`;
}

/**
 * Format both date and time:
 * - 'numeric': "27/10/2026, 07:59 PM"
 * - 'ordinal': "27th October 2026, 07:59 PM" (or "27th Oct 2026, 07:59 PM")
 */
export function formatDateTime(
  input: string | number | Date | null | undefined,
  style: 'numeric' | 'ordinal' = 'numeric',
  includeSeconds = false,
  shortMonth = false
): string {
  const d = parseDate(input);
  if (!d) return typeof input === 'string' ? input : '—';
  const dateStr = formatDate(d, style, shortMonth);
  const timeStr = formatTime(d, includeSeconds);
  return `${dateStr}, ${timeStr}`;
}

/**
 * Smart formatter for relative times in activity streams / chats:
 * Shows relative time with full DD/MM/YYYY or DDth Month Year date for older items.
 */
export function formatSmartTimestamp(
  input: string | number | Date | null | undefined,
  style: 'numeric' | 'ordinal' = 'numeric'
): { relative: string; full: string } {
  const d = parseDate(input);
  if (!d) return { relative: '', full: typeof input === 'string' ? input : '' };

  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
  let relative = '';
  if (diffSec < 60) relative = 'just now';
  else if (diffSec < 3600) relative = `${Math.floor(diffSec / 60)}m ago`;
  else if (diffSec < 86400) relative = `${Math.floor(diffSec / 3600)}h ago`;
  else relative = formatDate(d, style);

  const full = formatDateTime(d, style);
  return { relative, full };
}

/**
 * Standard inline styling for all dates and times to enforce white & high visibility.
 */
export const DATE_TIME_STYLE: React.CSSProperties = {
  color: '#ffffff',
  fontWeight: 500,
  letterSpacing: '0.02em',
  display: 'inline-block',
};
