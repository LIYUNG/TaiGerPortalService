const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const { JWT_SECRET, JWT_EXPIRE } = require('../config');
const { ErrorResponse } = require('../common/errors');
const logger = require('../services/logger');

const {
  fieldsValidation,
  checkUserFirstname,
  checkUserLastname,
  checkEmail,
  checkPassword,
  checkToken
} = require('../common/validation');
const { asyncHandler } = require('../middlewares/error-handler');
const {
  sendConfirmationEmail,
  sendForgotPasswordEmail,
  sendPasswordResetEmail,
  sendAccountActivationConfirmationEmail
} = require('../services/email');

const generateAuthToken = (user) => {
  const payload = { id: user._id };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRE });
};

const generateRandomToken = () => crypto.randomBytes(32).toString('hex');

const hashToken = (token) =>
  crypto.createHash('sha256').update(token).digest('hex');

const signup = asyncHandler(async (req, res) => {
  await fieldsValidation(
    checkUserFirstname,
    checkUserLastname,
    checkEmail,
    checkPassword
  )(req);

  const { firstname, lastname, email, password } = req.body;

  const existUser = await req.db.model('User').findOne({ email });
  if (existUser) {
    logger.error('signup: An account with this email address already exists');
    throw new ErrorResponse(
      400,
      'An account with this email address already exists'
    );
  }
  // TODO: check if email address exists in the world!

  const user = await req.db
    .model('Guest')
    .create({ firstname, lastname, email, password });

  const activationToken = generateRandomToken();
  await req.db
    .model('Token')
    .create({ userId: user._id, value: hashToken(activationToken) });

  await sendConfirmationEmail(
    { firstname, lastname, address: email },
    activationToken
  );

  // const authToken = generateAuthToken(user);
  res
    // .cookie("x-auth", authToken, { httpOnly: true, sameSite: 'none', secure: true })
    .status(201)
    // .json({ success: true, data: user });
    .json({ success: true });
});

const login = (req, res) => {
  const { user } = req;
  const token = generateAuthToken(user);
  res
    .cookie('x-auth', token, { httpOnly: true, sameSite: 'none', secure: true })
    .status(200)
    .json({ success: true, data: user });
};

const logout = (req, res) => {
  res
    .clearCookie('x-auth', { httpOnly: true, sameSite: 'none', secure: true })
    .status(200)
    .json({ success: true });
};

const verify = (req, res) => {
  const { user } = req;
  const token = generateAuthToken(user);
  user.attributes = [];
  res
    .cookie('x-auth', token, { httpOnly: true, sameSite: 'none', secure: true })
    .status(200)
    .json({ success: true, data: user });
};

// (O) Email confirmation notification
const activateAccount = asyncHandler(async (req, res) => {
  await fieldsValidation(checkEmail, checkToken)(req);

  const { email, token: activationToken } = req.body;

  const token = await req.db
    .model('Token')
    .findOne({ value: hashToken(activationToken) });
  if (!token) {
    logger.error('activateAccount: Invalid or expired token');
    throw new ErrorResponse(400, 'Invalid or expired token');
  }

  const user = await req.db.model('User').findOne({ _id: token.userId, email });
  if (!user) {
    logger.error('activateAccount: Invalid email or token');
    throw new ErrorResponse(400, 'Invalid email or token');
  }

  if (user.isAccountActivated) {
    logger.error('activateAccount: User account already activated');
    throw new ErrorResponse(400, 'User account already activated');
  }

  const user_updated = await req.db
    .model('User')
    .findOneAndUpdate(
      { _id: token.userId },
      { $set: { isAccountActivated: true, lastLoginAt: Date() } },
      { new: true }
    );

  await token.deleteOne();

  const authToken = generateAuthToken(user);
  res
    .cookie('x-auth', authToken, {
      httpOnly: true,
      sameSite: 'none',
      secure: true
    })
    .status(200)
    .json({ success: true });

  await sendAccountActivationConfirmationEmail(
    {
      firstname: user_updated.firstname,
      lastname: user_updated.lastname,
      address: user_updated.email
    },
    {}
  );
});

// send activation link to user
// (O) email notification self
const resendActivation = asyncHandler(async (req, res) => {
  await fieldsValidation(checkEmail)(req);

  const { email } = req.body;

  const user = await req.db.model('User').findOne({ email });
  if (!user) {
    logger.error('resendActivation: Email not found');
    throw new ErrorResponse(400, 'Email not found');
  }

  if (user.isAccountActivated) {
    logger.error('resendActivation: User account already activated');
    throw new ErrorResponse(400, 'User account already activated');
  }

  const activationToken = generateRandomToken();
  await req.db.model('Token').create({
    userId: user._id,
    value: hashToken(activationToken)
  });

  await sendConfirmationEmail(
    { firstname: user.firstname, lastname: user.lastname, address: email },
    activationToken
  );

  res.status(200).json({ success: true });
});

// (O) email notification works
const forgotPassword = asyncHandler(async (req, res) => {
  await fieldsValidation(checkEmail)(req);

  const { email } = req.body;

  const user = await req.db.model('User').findOne({ email });
  if (!user) {
    logger.error('forgotPassword: Email not found');
    throw new ErrorResponse(400, 'Email not found');
  }

  const resetToken = generateRandomToken();
  await req.db
    .model('Token')
    .create({ userId: user._id, value: hashToken(resetToken) });

  await sendForgotPasswordEmail(
    { firstname: user.firstname, lastname: user.lastname, address: email },
    resetToken
  );

  res.status(200).json({ success: true });
});

// (O) email notification works
const resetPassword = asyncHandler(async (req, res) => {
  await fieldsValidation(checkEmail, checkPassword, checkToken)(req);

  const { email, password, token: resetToken } = req.body;

  const token = await req.db
    .model('Token')
    .findOne({ value: hashToken(resetToken) });
  if (!token) {
    logger.error('resetPassword: Invalid or expired token');
    throw new ErrorResponse(400, 'Invalid or expired token');
  }

  const user = await req.db.model('User').findOne({ _id: token.userId, email });
  if (!user) {
    logger.error('resetPassword: Invalid email or token');
    throw new ErrorResponse(403, 'Invalid email or token');
  }

  user.password = password;
  await user.save();

  await sendPasswordResetEmail({
    firstname: user.firstname,
    lastname: user.lastname,
    address: email
  });
  await token.deleteOne();

  res.status(200).json({ success: true });
});

module.exports = {
  signup,
  login,
  logout,
  verify,
  activateAccount,
  resendActivation,
  forgotPassword,
  resetPassword
};
