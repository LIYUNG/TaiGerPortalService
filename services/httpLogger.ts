import morgan from 'morgan';
import { Request, Response } from 'express';
import logger from './logger';

const httpLogger = morgan<Request, Response>((tokens, req, res) => {
  const status = tokens.status(req, res);
  const statusCode = Number(status);
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
  if (statusCode >= 400) {
    logger.error(`${JSON.stringify(logData)}`);
  } else {
    logger.info(`${JSON.stringify(logData)}`);
  }
  return undefined;
});

export = httpLogger;
