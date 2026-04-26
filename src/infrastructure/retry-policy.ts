export interface RetryPolicyOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
}

export type RetryResult<T> =
  | { status: "ok"; attempts: number; value: T }
  | { status: "degraded"; attempts: number; error: Error };

export class RetryPolicy {
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly sleep: (delayMs: number) => Promise<void>;

  constructor(options: RetryPolicyOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 100;
    this.maxDelayMs = options.maxDelayMs ?? 400;
    this.sleep = options.sleep ?? defaultSleep;
  }

  async execute<T>(operation: () => Promise<T>): Promise<RetryResult<T>> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const value = await operation();
        return { status: "ok", attempts: attempt, value };
      } catch (error) {
        lastError = normalizeError(error);

        if (attempt === this.maxAttempts) {
          return {
            status: "degraded",
            attempts: attempt,
            error: lastError,
          };
        }

        await this.sleep(this.nextDelay(attempt));
      }
    }

    return {
      status: "degraded",
      attempts: this.maxAttempts,
      error: lastError ?? new Error("Retry policy exhausted without an error."),
    };
  }

  private nextDelay(attempt: number): number {
    return Math.min(this.baseDelayMs * 2 ** (attempt - 1), this.maxDelayMs);
  }
}

async function defaultSleep(delayMs: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(typeof error === "string" ? error : "Unknown retry failure.");
}
