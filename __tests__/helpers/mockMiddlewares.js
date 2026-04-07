/**
 * Common middleware mock setup used across all controller test files.
 *
 * Usage: call setupCommonMocks() at the top of your test file (outside describe blocks)
 * BEFORE importing app, since jest.mock calls are hoisted.
 *
 * In practice, jest.mock() calls must be at the top level of the test file due to
 * hoisting. Use this file as a reference/copy-paste template.
 *
 * Standard mock blocks to include in every controller test file:
 */

const passthrough = async (req, res, next) => next();

// ── tenantMiddleware ────────────────────────────────────────────────────────
// jest.mock('../../middlewares/tenantMiddleware', () => {
//   return {
//     ...jest.requireActual('../../middlewares/tenantMiddleware'),
//     checkTenantDBMiddleware: jest.fn().mockImplementation(async (req, res, next) => {
//       req.tenantId = 'test';
//       next();
//     })
//   };
// });

// ── decryptCookieMiddleware ─────────────────────────────────────────────────
// jest.mock('../../middlewares/decryptCookieMiddleware', () => {
//   const passthrough = async (req, res, next) => next();
//   return {
//     ...jest.requireActual('../../middlewares/decryptCookieMiddleware'),
//     decryptCookieMiddleware: jest.fn().mockImplementation(passthrough)
//   };
// });

// ── auth ────────────────────────────────────────────────────────────────────
// jest.mock('../../middlewares/auth', () => {
//   const passthrough = async (req, res, next) => next();
//   return {
//     ...jest.requireActual('../../middlewares/auth'),
//     protect: jest.fn().mockImplementation(passthrough),
//     permit: jest.fn().mockImplementation((...roles) => passthrough)
//   };
// });

// ── InnerTaigerMultitenantFilter ────────────────────────────────────────────
// jest.mock('../../middlewares/InnerTaigerMultitenantFilter', () => {
//   const passthrough = async (req, res, next) => next();
//   return {
//     ...jest.requireActual('../../middlewares/InnerTaigerMultitenantFilter'),
//     InnerTaigerMultitenantFilter: jest.fn().mockImplementation(passthrough)
//   };
// });

// ── permission-filter ───────────────────────────────────────────────────────
// jest.mock('../../middlewares/permission-filter', () => {
//   const passthrough = async (req, res, next) => next();
//   return {
//     ...jest.requireActual('../../middlewares/permission-filter'),
//     permission_canAccessStudentDatabase_filter: jest.fn().mockImplementation(passthrough),
//     permission_canModifyDocs_filter: jest.fn().mockImplementation(passthrough),
//     permission_canAssignAgent_filter: jest.fn().mockImplementation(passthrough),
//     permission_canAssignEditor_filter: jest.fn().mockImplementation(passthrough)
//   };
// });

// ── multitenant-filter ──────────────────────────────────────────────────────
// jest.mock('../../middlewares/multitenant-filter', () => {
//   const passthrough = async (req, res, next) => next();
//   return {
//     ...jest.requireActual('../../middlewares/multitenant-filter'),
//     multitenant_filter: jest.fn().mockImplementation(passthrough),
//     complaintTicketMultitenant_filter: jest.fn().mockImplementation(passthrough)
//   };
// });

// ── Standard lifecycle ──────────────────────────────────────────────────────
// const { connect, clearDatabase } = require('../fixtures/db');
// const { connectToDatabase } = require('../../middlewares/tenantMiddleware');
// const { disconnectFromDatabase } = require('../../database');
// const { protect } = require('../../middlewares/auth');
// const { UserSchema } = require('../../models/User');
// const { TENANT_ID } = require('../fixtures/constants');
// const { users, admin } = require('../mock/user');
//
// let dbUri;
// beforeAll(async () => { dbUri = await connect(); });
// afterAll(async () => { await disconnectFromDatabase(TENANT_ID); await clearDatabase(); });
// beforeEach(async () => {
//   const db = connectToDatabase(TENANT_ID, dbUri);
//   const UserModel = db.model('User', UserSchema);
//   await UserModel.deleteMany();
//   await UserModel.insertMany(users);
//   protect.mockImplementation(async (req, res, next) => { req.user = admin; next(); });
// });

module.exports = { passthrough };
