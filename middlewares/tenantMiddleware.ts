import { connectToDatabase } from '../database';
import { TENANT_ID } from '../config';
import { asyncHandler } from './error-handler';

// The service is single-tenant: there is one application database, so we no
// longer resolve a tenant from a registry (by header / decrypted token /
// domain) on every request. checkTenantDBMiddleware simply stamps the
// configured tenant id — kept because downstream code still reads req.tenantId
// (e.g. JWT issuing in controllers/auth.js). The whole request path now runs on
// the single default Mongoose connection via the service/DAO layer, so there is
// no longer a per-request connection attached to the request object.
const checkTenantDBMiddleware = asyncHandler(async (req, res, next) => {
  req.tenantId = TENANT_ID;
  next();
});

// connectToDatabase is still re-exported for the test fixtures and any tooling
// that needs to open the shared connection directly.
module.exports = {
  checkTenantDBMiddleware,
  connectToDatabase
};
