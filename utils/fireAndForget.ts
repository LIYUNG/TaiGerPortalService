import logger from '../services/logger';

/**
 * Run a promise as fire-and-forget: never blocks the caller, and logs a failure
 * instead of letting it surface as an unhandled promise rejection. Use for
 * non-critical side effects (notification emails, etc.) that intentionally must
 * not block the HTTP response. Satisfies `no-floating-promises` while making the
 * "don't await, but don't swallow errors" intent explicit.
 */
export const fireAndForget = (
  promise: Promise<unknown>,
  context?: string
): void => {
  promise.catch((error) => {
    logger.error(`fire-and-forget failed${context ? `: ${context}` : ''}`, {
      error
    });
  });
};

export default fireAndForget;
