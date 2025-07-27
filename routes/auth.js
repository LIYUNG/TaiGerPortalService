const { Router } = require('express');
const {
  loginRateLimiter,
  activateAccountRateLimiter,
  resendActivationRateLimiter,
  forgotPasswordRateLimiter,
  resetPasswordRateLimiter,
  // registerRateLimiter,
  GeneralGETRequestRateLimiter
} = require('../middlewares/rate_limiter');

const { localAuth, protect } = require('../middlewares/auth');
const {
  // signup,
  login,
  logout,
  verify,
  activateAccount,
  resendActivation,
  forgotPassword,
  resetPassword,
  thirdAuth
} = require('../controllers/auth');

const router = Router();
// TODO: when public to all user, then activate registration.
// router.post('/signup', registerRateLimiter, signup);

router.post('/login', loginRateLimiter, localAuth, login);

router.get('/logout', GeneralGETRequestRateLimiter, logout);

router.get('/verify', GeneralGETRequestRateLimiter, protect, verify); // check current user

router.post('/activation', activateAccountRateLimiter, activateAccount);

router.post(
  '/resend-activation',
  resendActivationRateLimiter,
  resendActivation
);

router.post('/forgot-password', forgotPasswordRateLimiter, forgotPassword);

router.post('/reset-password', resetPasswordRateLimiter, resetPassword);

router.post('/oauth/google/callback', loginRateLimiter, thirdAuth);

module.exports = router;
