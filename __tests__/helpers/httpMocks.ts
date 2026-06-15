// Lightweight Express req/res test doubles for controller UNIT tests.
//
// Controllers here are plain (req, res, next) functions (wrapped by
// asyncHandler), so a unit test calls them DIRECTLY — no supertest, no app, no
// middleware, no database. The service layer is mocked; we assert what the
// controller does with req and how it shapes the res. Route wiring + middleware
// are covered by the integration tests (__tests__/integration) and the
// middleware suites (__tests__/middlewares).

const mockRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.send = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.end = jest.fn(() => res);
  res.set = jest.fn(() => res);
  res.cookie = jest.fn(() => res);
  res.clearCookie = jest.fn(() => res);
  res.download = jest.fn(() => res);
  return res;
};

const mockReq = (overrides = {}) => ({
  params: {},
  query: {},
  body: {},
  headers: {},
  ...overrides
});

module.exports = { mockRes, mockReq };
