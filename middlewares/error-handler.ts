import type {
  ErrorRequestHandler,
  NextFunction,
  Request,
  Response
} from 'express';

import { isInPipeline } from '../config';
import { ErrorResponse } from '../common/errors';
import logger from '../services/logger';

// `handler` is typed as a variadic any-callback (NOT RequestHandler): asyncHandler
// is also (mis)used to wrap non-(req,res,next) helpers, so RequestHandler would
// mistype those. This still gives the wrapped callbacks an explicit param type,
// clearing their implicit-any (TS7006) without surfacing the misuse as TS2339.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const asyncHandler =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any


    (handler: (...args: any[]) => any) =>
    (req: Request, res: Response, next: NextFunction) =>
      Promise.resolve(handler(req, res, next)).catch(next);

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
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
    message: isInPipeline() ? 'Unexpected condition' : err.message
  });
};
