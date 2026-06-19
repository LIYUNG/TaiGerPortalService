import logger from '../logger';

const transientErrorCodes = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  '57P01',
  '57P02',
  '57P03'
]);

const getErrorCode = (error: unknown): string | undefined => {
  const err = error as { cause?: { code?: string }; code?: string } | null;
  return err?.cause?.code || err?.code;
};

const isTransientPostgresError = (error: unknown) => {
  const code = getErrorCode(error);
  return Boolean(
    code &&
      (transientErrorCodes.has(code) ||
        (typeof code === 'string' && code.startsWith('08')))
  );
};

const withPostgresRetry = async <T>(
  operation: () => Promise<T>,
  context: Record<string, unknown> = {}
): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    if (!isTransientPostgresError(error)) {
      throw error;
    }

    logger.warn('Retrying transient Postgres operation', {
      ...context,
      code: getErrorCode(error),
      message: (error as { message?: string })?.message
    });

    return operation();
  }
};

export = {
  isTransientPostgresError,
  withPostgresRetry
};
