import { IUser } from '@taiger-common/model';
import { NextFunction, Request, Response } from 'express';
import passport from 'passport';
import { ErrorResponse } from '../common/errors';

// The local strategy's verify callback (middlewares/passport.ts) calls
// `done(null, 'inactivated')` as a sentinel for a not-yet-activated account,
// in addition to the usual `IUser` / `false` outcomes.
type LocalAuthUser = IUser | false | 'inactivated' | null | undefined;
type JwtAuthUser = IUser | false | null | undefined;

export const localAuth = (req: Request, res: Response, next: NextFunction) => {
  passport.authenticate(
    'local',
    { session: false },
    (err: Error | null, user: LocalAuthUser) => {
      if (err) return next(err);

      if (user === 'inactivated') {
        return next(new ErrorResponse(403, 'Inactivated account'));
      }

      if (!user) {
        return next(new ErrorResponse(401, 'The current password is wrong.'));
      }
      req.user = user;
      return next();
    }
  )(req, res, next);
};

export const protect = (req: Request, res: Response, next: NextFunction) => {
  passport.authenticate(
    'jwt',
    { session: false },
    (err: Error | null, user: JwtAuthUser) => {
      if (err) return next(err);

      if (!user) {
        return next(
          new ErrorResponse(
            401,
            'Session expired. Please refresh and log in again.'
          )
        );
      }
      req.user = user;
      return next();
    }
  )(req, res, next);
};

export const permit =
  (...roles: string[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    const { role } = req.user as IUser;
    if (!roles.includes(role as string)) {
      return next(new ErrorResponse(403, 'Permission denied'));
    }

    next();
  };

export const prohibit =
  (...roles: string[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    const { role } = req.user as IUser;
    if (roles.includes(role as string))
      return next(new ErrorResponse(403, 'Permission denied2'));

    next();
  };
