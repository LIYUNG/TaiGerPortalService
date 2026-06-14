const passport = require('passport');
const { ErrorResponse } = require('../common/errors');

const localAuth = (req, res, next) => {
  passport.authenticate('local', { session: false }, (err, user) => {
    if (err) return next(err);

    if (user === 'inactivated') {
      return next(new ErrorResponse(403, 'Inactivated account'));
    }

    if (!user) {
      return next(new ErrorResponse(401, 'The current password is wrong.'));
    }
    req.user = user;
    return next();
  })(req, res, next);
};

const protect = (req, res, next) => {
  passport.authenticate('jwt', { session: false }, (err, user) => {
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
  })(req, res, next);
};

const permit =
  (...roles) =>
  (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return next(new ErrorResponse(403, 'Permission denied'));
    }

    next();
  };

const prohibit =
  (...roles) =>
  (req, res, next) => {
    if (roles.includes(req.user.role))
      return next(new ErrorResponse(403, 'Permission denied2'));

    next();
  };

module.exports = {
  localAuth,
  protect,
  permit,
  prohibit
};
