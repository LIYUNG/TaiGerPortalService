import { is_TaiGer_Agent, is_TaiGer_Editor } from '@taiger-common/core';
import { oauthClient } from '../google/oauth';
import { GOOGLE_CLIENT_ID } from '../config';

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

export = { queryStudent, fetchUserFromIdToken };
