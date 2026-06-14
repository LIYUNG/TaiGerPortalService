const jwt = require('jsonwebtoken');
const { asyncHandler } = require('./error-handler');
const logger = require('../services/logger');

const decryptCookieMiddleware = asyncHandler((req, res, next) => {
  const token = req.cookies['x-auth'];
  if (!token) {
    logger.info(
      'new browser request: decryptCookieMiddleware: Token not found'
    );
    req.decryptedToken = {};
    return next();
  }
  const payload = jwt.decode(token);
  req.decryptedToken = payload; // Attach decrypted payload to the request object
  next();
});

module.exports = { decryptCookieMiddleware };
