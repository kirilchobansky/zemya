/**
 * What went wrong while loading the map, and at which step — so the notice on screen (and a
 * screenshot of it) is enough to diagnose a failure without opening the console.
 */
export type LoadStep = 'data' | 'chunk' | 'tiles' | 'map' | 'webgl';

export const STEP_LABEL: Record<LoadStep, string> = {
  data: 'map data (JSON)',
  chunk: 'map code',
  tiles: 'map tiles',
  map: 'map setup',
  webgl: 'WebGL'
};

/** The plain-data form handed to the UI. */
export interface LoadFailure {
  step: LoadStep;
  message: string;
  url?: string;
  status?: number;
}

export class LoadError extends Error {
  readonly step: LoadStep;
  readonly url?: string;
  readonly status?: number;
  /** False for causes a retry cannot change (no WebGL at all). */
  readonly retryable: boolean;

  constructor(step: LoadStep, message: string, detail: { url?: string; status?: number; retryable?: boolean; cause?: unknown } = {}) {
    super(message, detail.cause === undefined ? undefined : { cause: detail.cause });
    this.name = 'LoadError';
    this.step = step;
    this.url = detail.url;
    this.status = detail.status;
    this.retryable = detail.retryable ?? true;
  }
}

/** Any thrown value as a LoadError for `step` (an existing LoadError keeps its own step). */
export function toLoadError(step: LoadStep, error: unknown): LoadError {
  if (error instanceof LoadError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new LoadError(step, message, { cause: error });
}

export function toFailure(step: LoadStep, error: unknown): LoadFailure {
  const e = toLoadError(step, error);
  return { step: e.step, message: e.message, url: e.url, status: e.status };
}

/** One console.error per failed attempt: step, URL, status, attempt number. */
export function logLoadFailure(error: LoadError, attempt: number, attempts: number): void {
  const parts = [`step=${error.step}`, `attempt=${attempt}/${attempts}`];
  if (error.url) parts.push(`url=${error.url}`);
  if (error.status !== undefined) parts.push(`status=${error.status}`);
  console.error(`[map-load] ${parts.join(' ')} — ${error.message}`);
}
