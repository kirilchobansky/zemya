/**
 * Retrying a load step: three attempts, 400 ms then 1200 ms apart, then give up with the
 * last error. Every failed attempt is logged (load-error.ts). `run` receives the attempt
 * number (1-based) so a fetch can bypass the HTTP cache on a retry.
 */
import { LoadError, logLoadFailure, toLoadError, type LoadStep } from './load-error';

export const RETRY_ATTEMPTS = 3;
export const RETRY_DELAYS_MS: readonly number[] = [400, 1200];

export interface RetryInfo {
  step: LoadStep;
  /** The attempt that just failed (1-based). */
  attempt: number;
  attempts: number;
  error: LoadError;
}

/** What a caller can hand a load step: a way to show "Retrying…" and a way to stop. */
export interface RetryHooks {
  onRetry?: (info: RetryInfo) => void;
  /** True once the caller no longer wants the result (its component unmounted). */
  cancelled?: () => boolean;
}

export interface RetryOptions extends RetryHooks {
  attempts?: number;
  delays?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export async function withRetry<T>(step: LoadStep, run: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? RETRY_ATTEMPTS;
  const delays = options.delays ?? RETRY_DELAYS_MS;
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 1; ; attempt++) {
    try {
      return await run(attempt);
    } catch (cause) {
      const error = toLoadError(step, cause);
      logLoadFailure(error, attempt, attempts);
      if (!error.retryable || attempt >= attempts || options.cancelled?.()) throw error;
      options.onRetry?.({ step: error.step, attempt, attempts, error });
      await sleep(delays[Math.min(attempt - 1, delays.length - 1)] ?? 0);
      if (options.cancelled?.()) throw error;
    }
  }
}

/** fetch() that turns a network failure or a non-2xx answer into a LoadError for `step`.
 *  After the first attempt the cache is revalidated (`no-cache`), so a bad cached copy is
 *  never reused. */
export async function fetchStrict(step: LoadStep, url: string, attempt = 1, cache?: RequestCache): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { cache: cache ?? (attempt > 1 ? 'no-cache' : 'default') });
  } catch (cause) {
    throw new LoadError(step, `${url}: network error (${cause instanceof Error ? cause.message : cause})`, { url, cause });
  }
  if (!response.ok) throw new LoadError(step, `${url}: HTTP ${response.status}`, { url, status: response.status });
  return response;
}

export async function fetchJsonStrict<T>(step: LoadStep, url: string, attempt = 1): Promise<T> {
  const response = await fetchStrict(step, url, attempt);
  try {
    return (await response.json()) as T;
  } catch (cause) {
    throw new LoadError(step, `${url}: the answer was not valid JSON`, { url, status: response.status, cause });
  }
}
