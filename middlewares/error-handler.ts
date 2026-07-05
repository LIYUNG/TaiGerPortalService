import type {
  ErrorRequestHandler,
  NextFunction,
  Request,
  Response
} from 'express';

import { isInPipeline } from '../config';
import { ErrorResponse } from '../common/errors';
import logger from '../services/logger';

// `asyncHandler` wraps an async function and forwards rejections to `next`.
// It is also (intentionally) used to wrap non-(req, res, next) helpers — e.g.
// email notifiers invoked directly as `fn(recipient, payload)`. The generic
// signature PRESERVES the wrapped function's own parameter list, so those 2-arg
// call sites type-check while Express route handlers `(req, res, next)` remain
// valid RequestHandlers. The runtime closure is unchanged: it forwards its args
// straight through and `.catch(next)` — which is simply `undefined` (a harmless
// no-op) for the non-route helper call sites.
export const asyncHandler = <T extends (...args: any[]) => any>( // eslint-disable-line @typescript-eslint/no-explicit-any
  handler: T
): ((...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>>) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ((req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(handler(req, res, next)).catch(next)) as any;

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof ErrorResponse) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      ...(err.code ? { code: err.code } : {})
    });
  }

  // TODO: body-parser error, mongoose error, validation error
  logger.error(err.message);
  res.status(500).json({
    success: false,
    message: isInPipeline() ? 'Unexpected condition' : err.message
  });
};
