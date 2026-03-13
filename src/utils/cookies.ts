type CookieOptions = {
  days?: number;
  path?: string;
  sameSite?: 'Lax' | 'Strict' | 'None';
  secure?: boolean;
};

function encode(value: string): string {
  return encodeURIComponent(value);
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function setCookie(name: string, value: string, options: CookieOptions = {}): void {
  if (typeof document === 'undefined') return;
  const path = options.path || '/';
  const sameSite = options.sameSite || 'Lax';
  const secure = options.secure ?? (typeof location !== 'undefined' && location.protocol === 'https:');
  const maxAge = Math.max(1, Math.floor((options.days ?? 30) * 24 * 60 * 60));
  const cookie = [`${encode(name)}=${encode(value)}`, `Max-Age=${maxAge}`, `Path=${path}`, `SameSite=${sameSite}`, secure ? 'Secure' : '']
    .filter(Boolean)
    .join('; ');
  document.cookie = cookie;
}

export function getCookie(name: string): string {
  if (typeof document === 'undefined') return '';
  const key = `${encode(name)}=`;
  const entries = document.cookie ? document.cookie.split('; ') : [];
  for (const entry of entries) {
    if (!entry.startsWith(key)) continue;
    return decode(entry.slice(key.length));
  }
  return '';
}

export function deleteCookie(name: string, path = '/'): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${encode(name)}=; Max-Age=0; Path=${path}; SameSite=Lax`;
}
