import type {
  ErrorRequestHandler,
  NextFunction,
  RequestHandler,
  Response
} from 'express';

import { isInPipeline } from '../config';
import { ErrorResponse } from '../common/errors';
import logger from '../services/logger';
import type { AuthedRequest } from '../types/express';

// Standard error envelope every endpoint may emit (see `errorHandler` below and
// the ad-hoc `res.status(4xx).send({ success: false, message })` guards in
// controllers). Allowed alongside an endpoint's typed success body so the typed
// route wrapper does not reject error responses.
export interface ApiErrorBody {
  success: false;
  message?: string;
  code?: string;
}

// Typed wrapper for Express *route* handlers (as opposed to `asyncHandler`,
// which intentionally stays generic to also wrap non-(req,res,next) helpers).
// `asyncRoute<ResBody>(handler)` gives the handler an `AuthedRequest` (so
// `req.user`/`req.query`/`req.params` are typed, with `user` present) and a
// `Response<ResBody | ApiErrorBody>`, so `res.json`/`res.send` are checked
// against the endpoint's api response type from `@taiger-common/model` (with the
// shared error envelope permitted). Rejections are forwarded to `next`, same as
// `asyncHandler`.
export const asyncRoute =
  <ResBody = unknown>(
    handler: (
      req: AuthedRequest,
      res: Response<ResBody | ApiErrorBody>,
      next: NextFunction
    ) => Promise<unknown> | unknown
  ): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(handler(req as AuthedRequest, res as Response, next)).catch(
      next
    );

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
