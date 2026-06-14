const morgan = require('morgan');
const logger = require('./logger');

const httpLogger = morgan((tokens, req, res) => {
  const status = tokens.status(req, res);
  const logData = {
    method: tokens.method(req, res),
    url: tokens.url(req, res),
    status,
    contentLength: tokens.res(req, res, 'content-length'),
    headers: req.headers,
    ipAddress: req.ip,
    body: req.body,
    responseTime: tokens['response-time'](req, res)
    // Additional context as needed
  };
  if (status >= 400) {
    logger.error(`${JSON.stringify(logData)}`);
  } else {
    logger.info(`${JSON.stringify(logData)}`);
  }
});

module.exports = httpLogger;
