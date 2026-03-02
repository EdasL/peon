import { createLogger } from "../logger";

const logger = createLogger("retry");

export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  strategy?: "exponential" | "linear";
  jitter?: boolean;
  onRetry?: (attempt: number, error: Error) => void;
}

/**
 * Retry a function with configurable backoff strategy
 *
 * @param fn - The async function to retry
 * @param options - Retry configuration
 * @returns The result of the function
 * @throws The last error if all retries fail
 *
 * @example
 * ```typescript
 * // Exponential backoff (default)
 * const result = await retryWithBackoff(
 *   () => fetch('https://api.example.com'),
 *   { maxRetries: 3, baseDelay: 1000 }
 * );
 *
 * // Linear backoff with jitter
 * const result = await retryWithBackoff(
 *   () => createDeployment(),
 *   {
 *     maxRetries: 3,
 *     strategy: 'linear',
 *     jitter: true,
 *     baseDelay: 2000,
 *     onRetry: (attempt, error) => {
 *       logger.warn(`Attempt ${attempt} failed: ${error.message}`);
 *     }
 *   }
 * );
 * ```
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    strategy = "exponential",
    jitter = false,
    onRetry,
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt < maxRetries) {
        // Calculate delay based on strategy
        const delay =
          strategy === "exponential"
            ? baseDelay * 2 ** attempt
            : baseDelay * (attempt + 1);

        // Add jitter if requested (0-1000ms random)
        const jitterMs = jitter ? Math.random() * 1000 : 0;
        const finalDelay = delay + jitterMs;

        // Notify caller of retry
        if (onRetry) {
          onRetry(attempt + 1, lastError);
        } else {
          logger.warn(
            `Retry attempt ${attempt + 1}/${maxRetries} after ${Math.round(finalDelay)}ms`,
            { error: lastError.message }
          );
        }

        await new Promise((resolve) => setTimeout(resolve, finalDelay));
      }
    }
  }

  throw lastError;
}
