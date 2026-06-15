import { body, param, validationResult } from 'express-validator';
import { Role } from '@taiger-common/core';

export const fieldsValidation =
  (...rules) =>
  async (req) => {
    await Promise.all(rules.map((rule) => rule.run(req)));

    const errors = validationResult(req);
    if (!errors.isEmpty()) errors.throw();
  };

export const makeOptional = (rule) => rule.optional();

// common rules
export const checkUserFirstname = body('firstname')
  .isString()
  .notEmpty()
  .withMessage('First name cannot be empty');

export const checkUserLastname = body('lastname')
  .isString()
  .notEmpty()
  .withMessage('Last name cannot be empty');

export const checkEmail = body('email', 'Invalid email address')
  .normalizeEmail({ gmail_remove_dots: false })
  .isEmail();

export const checkPassword = body('password')
  .isString()
  .isLength({ min: 8 })
  .withMessage('Password must contain at least 8 characters');

export const checkUserRole = body('role', 'Invalid role').isIn(
  Object.values(Role)
);

export const checkToken = body('token').isString().notEmpty();

// const checkObjectID = param('id', 'Invalid id').custom(ObjectID.isValid);

export const validationCallBack = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  next();
};

// Middleware to validate ObjectId
export const validateCourseId = [
  param('courseId')
    .isMongoId()
    .withMessage('Invalid course ID format. It must be a valid ObjectId.'),
  validationCallBack
];

export const validateStudentId = [
  param('studentId')
    .isMongoId()
    .withMessage('Invalid student ID format. It must be a valid ObjectId.'),
  validationCallBack
];

export const validateProgramId = [
  param('programId')
    .isMongoId()
    .withMessage('Invalid program ID format. It must be a valid ObjectId.'),
  validationCallBack
];

export const validateApplicationId = [
  param('applicationId')
    .isMongoId()
    .withMessage('Invalid application ID format. It must be a valid ObjectId.'),
  validationCallBack
];
