import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { default as axios } from 'axios';

import {
  JWT_SECRET,
  JWT_EXPIRE,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URL
} from '../config';
import { ErrorResponse } from '../common/errors';
import logger from '../services/logger';
import {
  fieldsValidation,
  checkUserFirstname,
  checkUserLastname,
  checkEmail,
  checkPassword,
  checkToken
} from '../common/validation';
import { asyncHandler } from '../middlewares/error-handler';
import {
  sendConfirmationEmail as sendConfirmationEmailRaw,
  sendForgotPasswordEmail as sendForgotPasswordEmailRaw,
  sendPasswordResetEmail as sendPasswordResetEmailRaw,
  sendAccountActivationConfirmationEmail as sendAccountActivationConfirmationEmailRaw
} from '../services/email';
import UserService from '../services/users';
import TokenService from '../services/tokens';
import { fetchUserFromIdToken } from '../utils/helper';
import type { Request, Response } from 'express';
import type { SignOptions } from 'jsonwebtoken';

// Only the user's id is read here; accept any persisted user shape (DB docs,
// req.user, IUser) without over-constraining to a single model interface.
const generateAuthToken = (
  user: { _id?: unknown } | null | undefined,
  tenantId: string,
  expiresIn: string | number = JWT_EXPIRE
) => {
  const payload = { id: user?._id, tenantId };
  return jwt.sign(payload, JWT_SECRET as jwt.Secret, {
    expiresIn: expiresIn as SignOptions['expiresIn']
  });
};

const generateRandomToken = () => crypto.randomBytes(32).toString('hex');

const hashToken = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex');

// The send*Email helpers are asyncHandler-wrapped (typed as 3-arg Express
// handlers) but are invoked here as plain (recipient[, payload]) notifiers.
// These aliases restore their real call shape — TS-only, no runtime change.
// See FLAGS re: asyncHandler misuse in services/email.
type EmailRecipient = {
  firstname?: string | null;
  lastname?: string | null;
  address?: string | null;
};
const sendConfirmationEmail = sendConfirmationEmailRaw as unknown as (
  recipient: EmailRecipient,
  token: string
) => Promise<unknown>;
const sendForgotPasswordEmail = sendForgotPasswordEmailRaw as unknown as (
  recipient: EmailRecipient,
  token: string
) => Promise<unknown>;
const sendPasswordResetEmail = sendPasswordResetEmailRaw as unknown as (
  recipient: EmailRecipient
) => Promise<unknown>;
const sendAccountActivationConfirmationEmail =
  sendAccountActivationConfirmationEmailRaw as unknown as (
    recipient: EmailRecipient,
    msg: Record<string, unknown>
  ) => Promise<unknown>;

const signup = asyncHandler(async (req, res) => {
  await fieldsValidation(
    checkUserFirstname,
    checkUserLastname,
    checkEmail,
    checkPassword
  )(req);

  const { firstname, lastname, email, password } = req.body;

  const existUser = await UserService.getUserByEmail(email);
  if (existUser) {
    logger.error('signup: An account with this email address already exists');
    throw new ErrorResponse(
      400,
      'An account with this email address already exists'
    );
  }
  // TODO: check if email address exists in the world!

  const user = await UserService.createGuest({
    firstname,
    lastname,
    email,
    password
  });

  const activationToken = generateRandomToken();
  await TokenService.createToken({
    userId: user._id.toString(),
    value: hashToken(activationToken)
  });

  await sendConfirmationEmail(
    { firstname, lastname, address: email },
    activationToken
  );

  res
    // .cookie("x-auth", authToken, { httpOnly: true, sameSite: 'none', secure: true })
    .status(201)
    .json({ success: true });
});

const login = (req: Request, res: Response) => {
  // req.user is attached by the auth middleware; kept loose (see types/express.d.ts).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user = req.user as any;
  const token = generateAuthToken(user, req.tenantId as string, JWT_EXPIRE);
  res
    .cookie('x-auth', token, { httpOnly: true, sameSite: 'none', secure: true })
    .status(200)
    .json({ success: true, data: user });
};

const logout = (_req: Request, res: Response) => {
  res
    .clearCookie('x-auth', { httpOnly: true, sameSite: 'none', secure: true })
    .status(200)
    .json({ success: true });
};

const verify = (req: Request, res: Response) => {
  // req.user is attached by the auth middleware; kept loose (see types/express.d.ts).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user = req.user as any;
  const token = generateAuthToken(user, req.tenantId as string, JWT_EXPIRE);
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

  const token = await TokenService.findOneToken({
    value: hashToken(activationToken)
  });
  if (!token) {
    logger.error('activateAccount: Invalid or expired token');
    throw new ErrorResponse(400, 'Invalid or expired token');
  }

  const user = await UserService.getUserByFilter({ _id: token.userId, email });
  if (!user) {
    logger.error('activateAccount: Invalid email or token');
    throw new ErrorResponse(400, 'Invalid email or token');
  }

  if (user.isAccountActivated) {
    logger.error('activateAccount: User account already activated');
    throw new ErrorResponse(400, 'User account already activated');
  }

  const user_updated = await UserService.updateUser(token.userId, {
    isAccountActivated: true,
    lastLoginAt: Date()
  });

  await token.deleteOne();
  const authToken = generateAuthToken(user, req.tenantId, JWT_EXPIRE);
  res
    .cookie('x-auth', authToken, {
      httpOnly: true,
      sameSite: 'none',
      secure: true
    })
    .status(200)
    .json({ success: true });

  if (user_updated) {
    await sendAccountActivationConfirmationEmail(
      {
        firstname: user_updated.firstname,
        lastname: user_updated.lastname,
        address: user_updated.email
      },
      {}
    );
  }
});

// send activation link to user
// (O) email notification self
const resendActivation = asyncHandler(async (req, res) => {
  await fieldsValidation(checkEmail)(req);

  const { email } = req.body;

  const user = await UserService.getUserByEmail(email);
  if (!user) {
    logger.error('resendActivation: Email not found');
    throw new ErrorResponse(400, 'Email not found');
  }

  if (user.isAccountActivated) {
    logger.error('resendActivation: User account already activated');
    throw new ErrorResponse(400, 'User account already activated');
  }

  const activationToken = generateRandomToken();
  await TokenService.createToken({
    userId: user._id.toString(),
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

  const user = await UserService.getUserByEmail(email);
  if (!user) {
    logger.error('forgotPassword: Email not found');
    throw new ErrorResponse(400, 'Email not found');
  }

  const resetToken = generateRandomToken();
  await TokenService.createToken({
    userId: user._id.toString(),
    value: hashToken(resetToken)
  });

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

  const token = await TokenService.findOneToken({
    value: hashToken(resetToken)
  });
  if (!token) {
    logger.error('resetPassword: Invalid or expired token');
    throw new ErrorResponse(400, 'Invalid or expired token');
  }

  const user = await UserService.getUserDocByFilter({
    _id: token.userId,
    email
  });
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

const thirdAuth = asyncHandler(async (req, res, _next) => {
  const code = req.body?.code;
  const oauthRequest = {
    url: new URL('https://oauth2.googleapis.com/token'),
    params: {
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: GOOGLE_REDIRECT_URL
    }
  };
  const oauthResponse = await axios.post(oauthRequest.url.toString(), null, {
    params: oauthRequest.params
  });
  const oauthResponseData = oauthResponse.data;
  const payload = await fetchUserFromIdToken(oauthResponseData?.id_token);
  if (!payload) {
    throw new ErrorResponse(400, 'Invalid Google Token');
  }
  const { email, picture } = payload;
  if (!email) {
    throw new ErrorResponse(400, 'Invalid Google Token');
  }
  const user = await UserService.getUserByEmail(email);
  if (!user) {
    throw new ErrorResponse(400, 'User not found');
  }

  const jwtToken = generateAuthToken(user, req.tenantId as string, '30d');

  res
    .cookie('x-auth', jwtToken, {
      httpOnly: true,
      sameSite: 'none',
      secure: true
    })
    .status(200)
    .json({
      success: true,
      data: user
    });

  // if (!user.isAccountActivated) {
  await UserService.updateUser(user._id.toString(), {
    pictureUrl: picture,
    isAccountActivated: true
  });
  // }
});

export = {
  signup,
  login,
  logout,
  verify,
  activateAccount,
  resendActivation,
  forgotPassword,
  resetPassword,
  thirdAuth
};
