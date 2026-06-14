const { isProd } = require('../config');
const { ErrorResponse } = require('../common/errors');
const logger = require('../services/logger');

const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

const errorHandler = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof ErrorResponse) {
    return res
      .status(err.statusCode)
      .json({ success: false, message: err.message });
  }

  // TODO: body-parser error, mongoose error, validation error
  logger.error(err.message);
  res.status(500).json({
    success: false,
    message: isProd() ? 'Unexpected condition' : err.message
  });
};

module.exports = { asyncHandler, errorHandler };
