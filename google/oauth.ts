import { OAuth2Client } from 'google-auth-library';

import { GOOGLE_CLIENT_ID } from '../config';

const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID);

export = { oauthClient };
