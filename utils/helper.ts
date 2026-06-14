const { is_TaiGer_Agent, is_TaiGer_Editor } = require('@taiger-common/core');
const { oauthClient } = require('../google/oauth');
const { GOOGLE_CLIENT_ID } = require('../config');

const queryStudent = (q, user) => {
  const query = { ...q };
  if (is_TaiGer_Agent(user)) {
    query.agents = user._id.toString();
  } else if (is_TaiGer_Editor(user)) {
    query.editors = user._id.toString();
  }
  return query;
};

const fetchUserFromIdToken = async (idToken) => {
  const ticket = await oauthClient.verifyIdToken({
    idToken,
    audience: GOOGLE_CLIENT_ID
  });
  const payload = ticket.getPayload();
  return payload;
};

module.exports = { queryStudent, fetchUserFromIdToken };
