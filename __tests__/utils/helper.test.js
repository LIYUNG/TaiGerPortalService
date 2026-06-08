// Unit tests for utils/helper.js
//
// queryStudent is a pure role-aware filter augmenter; fetchUserFromIdToken wraps
// the Google OAuth client. We mock @taiger-common/core role guards, the google
// oauth client, and ../config. No network.

jest.mock('../../google/oauth', () => ({
  oauthClient: { verifyIdToken: jest.fn() }
}));
jest.mock('../../config', () => ({ GOOGLE_CLIENT_ID: 'client-id-123' }));
jest.mock('@taiger-common/core', () => ({
  is_TaiGer_Agent: jest.fn(),
  is_TaiGer_Editor: jest.fn()
}));

const { is_TaiGer_Agent, is_TaiGer_Editor } = require('@taiger-common/core');
const { oauthClient } = require('../../google/oauth');
const { queryStudent, fetchUserFromIdToken } = require('../../utils/helper');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('queryStudent', () => {
  const user = { _id: { toString: () => 'user-1' } };

  it('adds agents filter for an agent', () => {
    is_TaiGer_Agent.mockReturnValue(true);
    is_TaiGer_Editor.mockReturnValue(false);

    const result = queryStudent({ active: true }, user);
    expect(result).toEqual({ active: true, agents: 'user-1' });
  });

  it('adds editors filter for an editor', () => {
    is_TaiGer_Agent.mockReturnValue(false);
    is_TaiGer_Editor.mockReturnValue(true);

    const result = queryStudent({ active: true }, user);
    expect(result).toEqual({ active: true, editors: 'user-1' });
  });

  it('leaves the query untouched for other roles', () => {
    is_TaiGer_Agent.mockReturnValue(false);
    is_TaiGer_Editor.mockReturnValue(false);

    const result = queryStudent({ active: true }, user);
    expect(result).toEqual({ active: true });
  });

  it('does not mutate the input query object', () => {
    is_TaiGer_Agent.mockReturnValue(true);
    is_TaiGer_Editor.mockReturnValue(false);

    const input = { active: true };
    queryStudent(input, user);
    expect(input).toEqual({ active: true });
  });
});

describe('fetchUserFromIdToken', () => {
  it('verifies the token against GOOGLE_CLIENT_ID and returns the payload', async () => {
    const payload = { email: 'a@b.c', sub: '42' };
    oauthClient.verifyIdToken.mockResolvedValue({
      getPayload: () => payload
    });

    const result = await fetchUserFromIdToken('id-token-xyz');

    expect(oauthClient.verifyIdToken).toHaveBeenCalledWith({
      idToken: 'id-token-xyz',
      audience: 'client-id-123'
    });
    expect(result).toBe(payload);
  });

  it('propagates verification errors', async () => {
    oauthClient.verifyIdToken.mockRejectedValue(new Error('invalid token'));
    await expect(fetchUserFromIdToken('bad')).rejects.toThrow('invalid token');
  });
});
