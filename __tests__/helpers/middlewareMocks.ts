// Shared Jest factories for the boilerplate middleware mocks that nearly every
// integration test repeats. In the real app each of these middlewares just
// guards/tags the request; at the HTTP boundary these tests exercise, we swap
// them for passthroughs so the router/controller/service path runs unimpeded.
//
// Why a `require()` at the call site instead of a normal import: ts-jest hoists
// `jest.mock(...)` above the imports, and its factory must not close over
// out-of-scope variables. `require` is allowed, and the factory runs lazily
// (when the mocked module is first loaded, after jest is set up), so:
//
//   jest.mock('../../middlewares/auth', () =>
//     require('../helpers/middlewareMocks').authMock()
//   );
//
// Each factory spreads `jest.requireActual(...)` first, then overrides only the
// exports the tests stub — so unlisted exports keep their real behaviour. Pass
// an `overrides` object to add or replace exports for a specific file, e.g.:
//
//   jest.mock('../../middlewares/auth', () => {
//     const mw = require('../helpers/middlewareMocks');
//     return mw.authMock({ localAuth: mw.passthroughFn() });
//   });

import type { Request, Response, NextFunction } from 'express';

type Overrides = Record<string, unknown>;

// A middleware that does nothing but hand off to the next one.
export const passthrough = (req: Request, res: Response, next: NextFunction) =>
  next();

// A fresh jest.fn() wrapping the passthrough, so each mocked export is its own
// spy with independent call history.
export const passthroughFn = () => jest.fn(passthrough);

export const authMock = (overrides: Overrides = {}) => ({
  ...jest.requireActual('../../middlewares/auth'),
  protect: passthroughFn(),
  permit: jest.fn(() => passthrough),
  ...overrides
});

export const tenantMiddlewareMock = (overrides: Overrides = {}) => ({
  ...jest.requireActual('../../middlewares/tenantMiddleware'),
  checkTenantDBMiddleware: jest.fn(
    (req: Request, res: Response, next: NextFunction) => {
      req.tenantId = 'test';
      next();
    }
  ),
  ...overrides
});

export const decryptCookieMiddlewareMock = (overrides: Overrides = {}) => ({
  ...jest.requireActual('../../middlewares/decryptCookieMiddleware'),
  decryptCookieMiddleware: passthroughFn(),
  ...overrides
});

export const limitArchivUserMock = (overrides: Overrides = {}) => ({
  ...jest.requireActual('../../middlewares/limit_archiv_user'),
  filter_archiv_user: passthroughFn(),
  ...overrides
});

export const innerTaigerMultitenantFilterMock = (
  overrides: Overrides = {}
) => ({
  ...jest.requireActual('../../middlewares/InnerTaigerMultitenantFilter'),
  InnerTaigerMultitenantFilter: passthroughFn(),
  ...overrides
});

export const multitenantFilterMock = (overrides: Overrides = {}) => ({
  ...jest.requireActual('../../middlewares/multitenant-filter'),
  multitenant_filter: passthroughFn(),
  ...overrides
});

export const permissionFilterMock = (overrides: Overrides = {}) => ({
  ...jest.requireActual('../../middlewares/permission-filter'),
  permission_canAccessStudentDatabase_filter: passthroughFn(),
  permission_canAssignAgent_filter: passthroughFn(),
  permission_canAssignEditor_filter: passthroughFn(),
  ...overrides
});
