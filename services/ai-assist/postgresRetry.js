const logger = require('../logger');

const transientErrorCodes = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  '57P01',
  '57P02',
  '57P03'
]);

const getErrorCode = (error) => error?.cause?.code || error?.code;

const isTransientPostgresError = (error) => {
  const code = getErrorCode(error);
  return Boolean(
    code &&
      (transientErrorCodes.has(code) ||
        (typeof code === 'string' && code.startsWith('08')))
  );
};

const withPostgresRetry = async (operation, context = {}) => {
  try {
    return await operation();
  } catch (error) {
    if (!isTransientPostgresError(error)) {
      throw error;
    }

    logger.warn('Retrying transient Postgres operation', {
      ...context,
      code: getErrorCode(error),
      message: error.message
    });

    return operation();
  }
};

module.exports = {
  isTransientPostgresError,
  withPostgresRetry
};
