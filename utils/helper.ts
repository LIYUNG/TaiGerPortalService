import { is_TaiGer_Agent, is_TaiGer_Editor } from '@taiger-common/core';
import type { IUser } from '@taiger-common/model';
import type { Types } from 'mongoose';
// `google/oauth.ts` uses `export =`; import via `require` interop since a
// named `import { oauthClient }` against an `export =` module is rejected
// under this project's module settings (TS2497).
// eslint-disable-next-line @typescript-eslint/no-require-imports -- export = interop, see comment above
import googleOauth = require('../google/oauth');
import { GOOGLE_CLIENT_ID } from '../config';

const { oauthClient } = googleOauth;

export const queryStudent = (
  q: Record<string, unknown>,
  user: IUser & { _id: Types.ObjectId | string }
) => {
  const query: Record<string, unknown> = { ...q };
  if (is_TaiGer_Agent(user)) {
    query.agents = user._id.toString();
  } else if (is_TaiGer_Editor(user)) {
    query.editors = user._id.toString();
  }
  return query;
};

export const fetchUserFromIdToken = async (idToken: string) => {
  const ticket = await oauthClient.verifyIdToken({
    idToken,
    audience: GOOGLE_CLIENT_ID
  });
  const payload = ticket.getPayload();
  return payload;
};
