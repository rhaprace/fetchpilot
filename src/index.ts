type ParseMode = 'auto' | 'json' | 'text' | 'stream';
type BackoffStrategy = 'exponential' | 'fixed';
type NormalizedErrorType = 'network' | 'timeout' | 'abort' | 'http' | 'parse' | 'unknown';

export type NormalizedError = {
  type: NormalizedErrorType;
  message: string;
  status?: number;
  cause?: unknown;
};

export type FetcherResult<T> =
  | { ok: true; data: T; status: number; headers: Headers }
  | { ok: false; error: NormalizedError; status?: number; headers?: Headers };

export type RequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  parse?: ParseMode;
  retries?: number | { attempts?: number; retryOn?: (error: NormalizedError, attempt: number) => boolean };
  backoff?: { strategy?: BackoffStrategy; baseDelay?: number; maxDelay?: number; jitter?: 'none' | 'full' };
  timeout?: number;
  signal?: AbortSignal;
  onRetry?: (info: { attempt: number; delay: number; error: NormalizedError }) => void;
  fetch?: typeof fetch;
  validate?: (data: unknown) => { ok: true } | { ok: false; message?: string };
  cacheTTL?: number;
  dedupe?: boolean;
};

function buildUrl(input: RequestInfo | URL, query?: RequestOptions['query']): string | URL {
  if (!query || Object.keys(query).length === 0) return input as string | URL;
  const url = typeof input === 'string' ? new URL(input, typeof window !== 'undefined' ? window.location.origin : undefined) : new URL(input.toString());
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    url.searchParams.set(key, String(value));
  }
  return url;
}

function normalizeError(e: unknown, status?: number): NormalizedError {
  if (typeof e === 'object' && e && 'name' in e && (e as any).name === 'AbortError') {
    const base: NormalizedError = { type: 'abort', message: 'Request aborted', cause: e };
    return status != null ? { ...base, status } : base;
  }
  if (typeof e === 'object' && e && 'message' in e) {
    const msg = String((e as any).message ?? 'Unknown error');
    const base: NormalizedError = { type: 'network', message: msg, cause: e };
    return status != null ? { ...base, status } : base;
  }
  const base: NormalizedError = { type: 'unknown', message: 'Unknown error', cause: e };
  return status != null ? { ...base, status } : base;
}

async function parseBody<T>(res: Response, mode: RequestOptions['parse']): Promise<T> {
  const contentType = res.headers.get('content-type') || '';
  const isJson = /application\/json/i.test(contentType);
  const chosen = mode === 'auto' ? (isJson ? 'json' : 'text') : mode;
  if (chosen === 'json') return (await res.json()) as T;
  if (chosen === 'text') return (await res.text()) as unknown as T;
  return res.body as unknown as T;
}

export async function fetchpilot<T>(input: RequestInfo | URL, options: RequestOptions = {}): Promise<FetcherResult<T>> {
  const fetchImpl = options.fetch ?? fetch;
  const method = options.method ?? (options.body ? 'POST' : 'GET');
  const headers = new Headers(options.headers ?? {});
  const parse = options.parse ?? 'auto';
  const retries = normalizeRetries(options.retries);
  const backoff = normalizeBackoff(options.backoff);

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    const ct = headers.get('content-type');
    const isJson = !ct || ct.includes('application/json');
    if (!ct && typeof options.body === 'object') headers.set('content-type', 'application/json');
    body = isJson && typeof options.body === 'object' ? JSON.stringify(options.body) : (options.body as BodyInit);
  }

  const url = buildUrl(input, options.query);

  const controller = new AbortController();
  const signal = options.signal ? mergeSignals(options.signal, controller.signal) : controller.signal;
  let timer: any;
  if (options.timeout && options.timeout > 0) {
    timer = setTimeout(() => controller.abort(), options.timeout);
  }

  const cacheKey = buildCacheKey(method, url, headers);
  if (options.cacheTTL && /^(GET)$/i.test(method)) {
    const cached = cacheGet(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return cached.value as FetcherResult<T>;
    }
  }

  let attempt = 1;
  while (attempt <= (retries.attempts ?? 1)) {
    try {
      const exec = async () => fetchImpl(url, { method, headers, body: body ?? null, signal });
      const res = options.dedupe ? await dedupeRun(cacheKey, exec) : await exec();
      const status = res.status;
      if (!res.ok) {
        const err: NormalizedError = { type: 'http', message: res.statusText || 'HTTP error', status };
        const canRetryMethod = /^(GET|HEAD|OPTIONS)$/i.test(method);
        const shouldRetry = canRetryMethod && attempt < (retries.attempts ?? 1) && retries.retryOn(err, attempt);
        if (shouldRetry) {
          const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
          const backoffDelay = computeDelay(attempt, backoff);
          const delay = retryAfter ?? backoffDelay;
          options.onRetry?.({ attempt, delay, error: err });
          await sleep(delay);
          attempt++;
          continue;
        }
        clearTimeoutSafe(timer);
        return { ok: false, error: err, status, headers: res.headers };
      }
      const parsed = await parseBody<unknown>(res, parse);
      if (options.validate) {
        const v = options.validate(parsed);
        if (!v.ok) {
          clearTimeoutSafe(timer);
          return { ok: false, error: { type: 'parse', message: v.message ?? 'Validation failed' }, status, headers: res.headers };
        }
      }
      const data = parsed as T;
      clearTimeoutSafe(timer);
      const result: FetcherResult<T> = { ok: true, data, status, headers: res.headers };
      if (options.cacheTTL && /^(GET)$/i.test(method)) {
        cacheSet(cacheKey, result, Date.now() + options.cacheTTL);
      }
      return result;
    } catch (e) {
      const err = normalizeError(e);
      const canRetryMethod = /^(GET|HEAD|OPTIONS)$/i.test(method);
      const shouldRetry = canRetryMethod && attempt < (retries.attempts ?? 1) && retries.retryOn(err, attempt);
      if (shouldRetry) {
        const delay = computeDelay(attempt, backoff);
        options.onRetry?.({ attempt, delay, error: err });
        await sleep(delay);
        attempt++;
        continue;
      }
      clearTimeoutSafe(timer);
      if (typeof e === 'object' && e && 'status' in (e as any) && typeof (e as any).status === 'number') {
        const status = (e as any).status as number;
        return { ok: false, error: { type: 'http', message: 'HTTP error', status }, status };
      }
      return { ok: false, error: err };
    }
  }
  clearTimeoutSafe(timer);
  return { ok: false, error: { type: 'unknown', message: 'Exhausted retries' } };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clearTimeoutSafe(timer: any): void {
  if (typeof timer !== 'undefined') {
    clearTimeout(timer);
  }
}

function mergeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  a.addEventListener('abort', onAbort);
  b.addEventListener('abort', onAbort);
  return controller.signal;
}

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BACKOFF = { strategy: 'exponential' as const, baseDelay: 200, maxDelay: 5000, jitter: 'full' as const };

function normalizeRetries(retries?: number | { attempts?: number; retryOn?: (error: NormalizedError, attempt: number) => boolean }) {
  if (typeof retries === 'number') {
    return { attempts: Math.max(1, retries), retryOn: defaultRetryPredicate } as const;
  }
  const attempts = retries?.attempts ?? DEFAULT_ATTEMPTS;
  return { attempts: Math.max(1, attempts), retryOn: retries?.retryOn ?? defaultRetryPredicate } as const;
}

function normalizeBackoff(backoff?: { strategy?: BackoffStrategy; baseDelay?: number; maxDelay?: number; jitter?: 'none' | 'full' }) {
  return {
    strategy: backoff?.strategy ?? DEFAULT_BACKOFF.strategy,
    baseDelay: backoff?.baseDelay ?? DEFAULT_BACKOFF.baseDelay,
    maxDelay: backoff?.maxDelay ?? DEFAULT_BACKOFF.maxDelay,
    jitter: backoff?.jitter ?? DEFAULT_BACKOFF.jitter,
  } as const;
}

function computeDelay(attempt: number, backoff: ReturnType<typeof normalizeBackoff>): number {
  const base = backoff.strategy === 'fixed' ? backoff.baseDelay : Math.min(backoff.maxDelay, backoff.baseDelay * 2 ** (attempt - 1));
  if (backoff.jitter === 'none') return base;
  return Math.floor(Math.random() * base);
}

function defaultRetryPredicate(err: NormalizedError): boolean {
  if (err.type === 'network' || err.type === 'timeout') return true;
  if (err.type === 'http' && (err.status === 429 || (err.status ?? 0) >= 500)) return true;
  return false;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (!Number.isNaN(seconds)) {
    return Math.max(0, Math.floor(seconds * 1000));
  }
  const date = new Date(value).getTime();
  if (!Number.isNaN(date)) {
    const now = Date.now();
    const ms = Math.max(0, date - now);
    return ms;
  }
  return undefined;
}
type CacheEntry = { value: FetcherResult<unknown>; expires: number };
const CACHE = new Map<string, CacheEntry>();
const IN_FLIGHT = new Map<string, Promise<Response>>();

function buildCacheKey(method: string, url: string | URL, headers: Headers): string {
  const u = typeof url === 'string' ? url : url.toString();
  return `${method}:${u}`;
}

function cacheGet(key: string): CacheEntry | undefined {
  return CACHE.get(key);
}

function cacheSet(key: string, value: FetcherResult<unknown>, expires: number): void {
  CACHE.set(key, { value, expires });
}

async function dedupeRun(key: string, run: () => Promise<Response>): Promise<Response> {
  const existing = IN_FLIGHT.get(key);
  if (existing) return existing;
  const p = run();
  IN_FLIGHT.set(key, p);
  return p.finally(() => IN_FLIGHT.delete(key));
}
