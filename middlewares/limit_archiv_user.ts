import { NextFunction, Request, Response } from 'express';
import type { IUser } from '@taiger-common/model';

import { ErrorResponse } from '../common/errors';

// Populated by the `protect` auth middleware before this filter runs, so it is
// always present at this point despite `Request.user` being declared optional.
type AuthUser = IUser;

export const filter_archiv_user = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const user = req.user as AuthUser;
  if (user.archiv) {
    return next(new ErrorResponse(403, 'User service period expired!'));
  }
  next();
};
