const { connectToDatabase } = require('../database');
const { TENANT_ID } = require('../config');
const { asyncHandler } = require('./error-handler');

// The service is single-tenant: there is one application database, so we no
// longer resolve a tenant from a registry (by header / decrypted token /
// domain) on every request. checkTenantDBMiddleware simply stamps the
// configured tenant id — kept because downstream code still reads req.tenantId
// (e.g. JWT issuing in controllers/auth.js) — and tenantMiddleware attaches the
// single shared connection.
const checkTenantDBMiddleware = asyncHandler(async (req, res, next) => {
  req.tenantId = TENANT_ID;
  next();
});

const tenantMiddleware = asyncHandler(async (req, res, next) => {
  req.db = connectToDatabase(req.tenantId);
  req.VCModel = req.db.model('VC');
  next();
});

module.exports = {
  tenantMiddleware,
  checkTenantDBMiddleware,
  connectToDatabase
};
