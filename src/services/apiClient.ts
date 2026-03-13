type ApiResponse<T> = {
  ok: boolean;
  message?: string;
  data?: T;
};

type CacheEntry = {
  expiresAt: number;
  data: unknown;
};

type CacheFilter = string | RegExp | ((cacheKey: string) => boolean);

type FetchApiDataOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  credentials?: RequestCredentials;
  ttlMs?: number;
  forceRefresh?: boolean;
  cacheKey?: string;
  timeoutMs?: number;
};

const responseCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

function resolveRequestUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (!url.startsWith('/')) return url;

  const apiBaseUrl = String(import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!apiBaseUrl) return url;

  if (url.startsWith('/api/')) {
    return `${apiBaseUrl}${url.slice(4)}`;
  }

  return `${apiBaseUrl}${url}`;
}

function normalizeMethod(value?: string): string {
  return String(value || 'GET').toUpperCase();
}

function toCacheKey(method: string, url: string, custom?: string): string {
  if (custom) return custom;
  return `${method}:${url}`;
}

function getCached<T>(key: string): T | null {
  const cached = responseCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    responseCache.delete(key);
    return null;
  }
  return cached.data as T;
}

function parseApiPayload<T>(text: string, statusCode: number): ApiResponse<T> {
  if (!text) return { ok: false, message: `Request failed (${statusCode})` };

  try {
    return JSON.parse(text) as ApiResponse<T>;
  } catch {
    const trimmed = text.trim();
    const lower = trimmed.slice(0, 120).toLowerCase();
    if (lower.startsWith('<!doctype') || lower.startsWith('<html')) {
      return { ok: false, message: 'API returned HTML instead of JSON. Check API route configuration.' };
    }
    return { ok: false, message: trimmed || `Request failed (${statusCode})` };
  }
}

async function executeFetch<T>(url: string, options: FetchApiDataOptions): Promise<T> {
  const method = normalizeMethod(options.method);
  const requestUrl = resolveRequestUrl(url);
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : 0;
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;

  const headers: Record<string, string> = { ...(options.headers || {}) };
  const init: RequestInit = {
    method,
    credentials: options.credentials || 'include',
    headers,
    signal: controller.signal
  };

  if (options.body !== undefined) {
    init.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    if (!headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
  }

  try {
    const response = await fetch(requestUrl, init);
    const text = await response.text();
    const payload = parseApiPayload<T>(text, response.status);
    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || `Request failed (${response.status})`);
    }
    return payload.data as T;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function fetchApiData<T>(url: string, options: FetchApiDataOptions = {}): Promise<T> {
  const method = normalizeMethod(options.method);
  const ttlMs = options.ttlMs || 0;
  const useCache = method === 'GET' && ttlMs > 0 && !options.forceRefresh;
  const cacheKey = toCacheKey(method, url, options.cacheKey);

  if (!useCache) {
    return await executeFetch<T>(url, options);
  }

  const cached = getCached<T>(cacheKey);
  if (cached !== null) return cached;

  const pending = inflight.get(cacheKey) as Promise<T> | undefined;
  if (pending) return await pending;

  const request = (async () => {
    const data = await executeFetch<T>(url, options);
    responseCache.set(cacheKey, {
      expiresAt: Date.now() + ttlMs,
      data
    });
    return data;
  })();

  inflight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    inflight.delete(cacheKey);
  }
}

export function invalidateApiCache(filter: CacheFilter): void {
  const matcher =
    typeof filter === 'string'
      ? (key: string) => key.includes(filter)
      : filter instanceof RegExp
        ? (key: string) => filter.test(key)
        : filter;

  for (const key of responseCache.keys()) {
    if (matcher(key)) responseCache.delete(key);
  }
  for (const key of inflight.keys()) {
    if (matcher(key)) inflight.delete(key);
  }
}

export function clearApiCache(): void {
  responseCache.clear();
  inflight.clear();
}
