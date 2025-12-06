export type ParseMode = 'auto' | 'json' | 'text' | 'stream';

export type BackoffStrategy = 'exponential' | 'fixed';

export interface BackoffOptions {
  strategy?: BackoffStrategy;
  baseDelay?: number;
  maxDelay?: number;
  jitter?: 'none' | 'full';
}

export type NormalizedErrorType =
  | 'network'
  | 'timeout'
  | 'abort'
  | 'http'
  | 'parse'
  | 'unknown';

export interface NormalizedError {
  type: NormalizedErrorType;
  message: string;
  status?: number;
  cause?: unknown;
}

export interface RetryOptions {
  attempts?: number;
  retryOn?: (error: NormalizedError, attempt: number) => boolean;
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  parse?: ParseMode;
  retries?: number | RetryOptions;
  backoff?: BackoffOptions;
  timeout?: number;
  signal?: AbortSignal;
  onRetry?: (info: { attempt: number; delay: number; error: NormalizedError }) => void;
  fetch?: typeof fetch;
}

export type FetcherSuccess<T> = {
  ok: true;
  data: T;
  status: number;
  headers: Headers;
};

export type FetcherFailure = {
  ok: false;
  error: NormalizedError;
  status?: number;
  headers?: Headers;
};

export type FetcherResult<T> = FetcherSuccess<T> | FetcherFailure;
