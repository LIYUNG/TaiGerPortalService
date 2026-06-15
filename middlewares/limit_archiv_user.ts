import { ErrorResponse } from '../common/errors';

export const filter_archiv_user = (req, res, next) => {
  const { user } = req;
  if (user.archiv) {
    return next(new ErrorResponse(403, 'User service period expired!'));
  }
  next();
};
