import { TENANT_ID } from '../config';
import { asyncHandler } from './error-handler';

const checkTenantDBMiddleware = asyncHandler(async (req, res, next) => {
  req.tenantId = TENANT_ID;
  next();
});

export = {
  checkTenantDBMiddleware
};
