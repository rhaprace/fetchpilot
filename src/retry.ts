import { BackoffOptions, NormalizedError, RetryOptions } from './types.js';

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BACKOFF: Required<BackoffOptions> = {
  strategy: 'exponential',
  baseDelay: 200,
  maxDelay: 5000,
  jitter: 'full',
};

export function normalizeRetries(retries?: number | RetryOptions): Required<RetryOptions> {
  if (typeof retries === 'number') {
    return { attempts: retries, retryOn: defaultRetryPredicate } as const;
  }
  const attempts = retries?.attempts ?? DEFAULT_ATTEMPTS;
  const retryOn = retries?.retryOn ?? defaultRetryPredicate;
  return { attempts, retryOn } as const;
}

export function normalizeBackoff(backoff?: BackoffOptions): Required<BackoffOptions> {
  return {
    strategy: backoff?.strategy ?? DEFAULT_BACKOFF.strategy,
    baseDelay: backoff?.baseDelay ?? DEFAULT_BACKOFF.baseDelay,
    maxDelay: backoff?.maxDelay ?? DEFAULT_BACKOFF.maxDelay,
    jitter: backoff?.jitter ?? DEFAULT_BACKOFF.jitter,
  };
}

export function computeDelay(attempt: number, backoff: Required<BackoffOptions>): number {
  const base = backoff.strategy === 'fixed'
    ? backoff.baseDelay
    : Math.min(backoff.maxDelay, backoff.baseDelay * 2 ** (attempt - 1));
  if (backoff.jitter === 'none') return base;
  const r = Math.random();
  return Math.floor(r * base);
}

export function defaultRetryPredicate(err: NormalizedError): boolean {
  if (err.type === 'network' || err.type === 'timeout') return true;
  if (err.type === 'http' && (err.status === 429 || (err.status ?? 0) >= 500)) return true;
  return false;
}
