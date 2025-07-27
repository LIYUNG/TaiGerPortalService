const { OAuth2Client } = require('google-auth-library');

const { GOOGLE_CLIENT_ID } = require('../config');

const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID);

module.exports = { oauthClient };
