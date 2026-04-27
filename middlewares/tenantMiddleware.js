const mongoose = require('mongoose');
const {
  mongoDb,
  tenantDb,
  connections,
  connectToDatabase
} = require('../database');

const { tenantsSchema } = require('../models/Tenant');
const logger = require('../services/logger');
const { asyncHandler } = require('./error-handler');

const getTenantFromRequest = (req) => {
  const { tenantid } = req.headers; // Get the host from the request headers
  return tenantid;
};

const checkTenantDBMiddleware = asyncHandler(async (req, res, next) => {
  const tenentIdHeader = getTenantFromRequest(req);
  const { tenantId } = req.decryptedToken;
  const dbUri = `${mongoDb(tenantDb)}`;
  if (!connections[tenantDb]) {
    const connection = mongoose.createConnection(dbUri, {});
    connection.model(tenantDb, tenantsSchema);
    connections[tenantDb] = connection;
  }

  // 0.
  const tenentid = tenentIdHeader || tenantId;

  let tenantExisted;
  tenantExisted = await connections[tenantDb]
    .model(tenantDb)
    .findOne({ tenantId: tenentid });
  if (!tenantExisted) {
    const { origin } = req.headers;
    if (origin) {
      const url = new URL(origin);
      const { hostname } = url;
      logger.info(`hostname: ${hostname}`); // prod:
      tenantExisted = await connections[tenantDb]
        .model(tenantDb)
        .findOne({ domainName: hostname });
    }
  }

  if (!tenantExisted) {
    logger.error(
      `tenantMiddleware : Tenant not identified, req.decryptedToken: ${JSON.stringify(
        req.decryptedToken
      )}`
    );
    return res.status(400).send('Tenant not identified');
  }

  req.tenantId = tenantExisted.tenantId;
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
