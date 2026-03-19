type DateTimeInput = Date | string | number | null | undefined;

type DateTimeFormatOptions = Intl.DateTimeFormatOptions & {
  fallback?: string;
};

const PHILIPPINES_TIMEZONE = 'Asia/Manila';
const PHILIPPINES_TIMEZONE_LABEL = 'GMT+8';

function parseDateTimeInput(value: DateTimeInput): Date {
  if (value instanceof Date) return value;
  const text = String(value ?? '').trim();
  if (!text) return new Date('');

  const normalized =
    /(?:Z|[+-]\d{2}:\d{2})$/i.test(text)
      ? text
      : /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/i.test(text)
        ? text.replace(' ', 'T') + 'Z'
        : text;

  return new Date(normalized);
}

export function getTimezoneLabel(_value: DateTimeInput = new Date()): string {
  return PHILIPPINES_TIMEZONE_LABEL;
}

export function formatDateTimeWithTimezone(
  value: DateTimeInput,
  options: DateTimeFormatOptions = {}
): string {
  const parsed = parseDateTimeInput(value);
  if (Number.isNaN(parsed.getTime())) return options.fallback || String(value || '--');

  const { fallback: _fallback, ...formatOptions } = options;
  const formatter = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: PHILIPPINES_TIMEZONE,
    ...formatOptions
  });

  return `${formatter.format(parsed)} ${getTimezoneLabel(parsed)}`;
}

export function formatRelativeDateTime(value: DateTimeInput, fallback = '--'): string {
  const parsed = parseDateTimeInput(value);
  if (Number.isNaN(parsed.getTime())) return fallback;

  const diffMs = Date.now() - parsed.getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes} min${diffMinutes === 1 ? '' : 's'} ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  return formatDateTimeWithTimezone(parsed, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', fallback });
}
