// Unit tests for utils/meeting-assistant.service.js
//
// The module wraps two external HTTP integrations (n8n Google-invite workflow +
// the Fireflies GraphQL API) over axios. We mock axios entirely (no network) and
// mock ../config so the required env constants are present. Each test drives one
// branch: config-missing guards, param-validation guards, success payloads, and
// the GraphQL / HTTP error discriminations in instantInviteTA.

jest.mock('axios');
jest.mock('../../config', () => ({
  FIREFLIES_API_URL: 'https://fireflies.test/graphql',
  FIREFLIES_API_TOKEN: 'token-123',
  FIREFLIES_GOOGLE_INVITE_N8N_URL: 'https://n8n.test/invite'
}));

import axiosReal from 'axios';
import {
  scheduleInviteTA,
  instantInviteTA
} from '../../utils/meeting-assistant.service';

const axios = axiosReal as unknown as {
  post: jest.Mock;
  isAxiosError: jest.Mock;
};

beforeEach(() => {
  jest.clearAllMocks();
  axios.isAxiosError = jest.fn(() => false);
});

describe('scheduleInviteTA', () => {
  it('posts the meeting payload and returns response.data', async () => {
    axios.post.mockResolvedValue({ data: { ok: true } });

    const result = await scheduleInviteTA(
      'Summary',
      'https://meet.test/abc',
      '2026-01-01T10:00:00Z',
      '2026-01-01T11:00:00Z'
    );

    expect(result).toEqual({ ok: true });
    expect(axios.post).toHaveBeenCalledWith('https://n8n.test/invite', {
      summary: 'Summary',
      url: 'https://meet.test/abc',
      start: '2026-01-01T10:00:00Z',
      end: '2026-01-01T11:00:00Z'
    });
  });

  it('throws when required parameters are missing', async () => {
    await expect(
      scheduleInviteTA(null as any, 'link', 'from', 'to')
    ).rejects.toThrow('Missing required parameters');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('wraps an axios failure (response.data) into a descriptive error', async () => {
    axios.post.mockRejectedValue({ response: { data: { code: 'BOOM' } } });

    await expect(scheduleInviteTA('S', 'L', 'F', 'T')).rejects.toThrow(
      /Failed to create Google Meeting event:.*BOOM/
    );
  });

  it('wraps an axios failure (error.message) when no response', async () => {
    axios.post.mockRejectedValue(new Error('network down'));

    await expect(scheduleInviteTA('S', 'L', 'F', 'T')).rejects.toThrow(
      /network down/
    );
  });
});

describe('instantInviteTA', () => {
  it('validates required parameters', async () => {
    await expect((instantInviteTA as any)('summary')).rejects.toThrow(
      'Missing required parameters: meetingSummary, meetingLink'
    );
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('returns success on a successful mutation', async () => {
    axios.post.mockResolvedValue({
      data: { data: { addToLiveMeeting: { success: true } } }
    });

    const result = await instantInviteTA('Summary', 'https://meet.test/abc');

    expect(result).toEqual({
      success: true,
      payload: { success: true }
    });
    // assert the GraphQL request was authorized
    expect(axios.post).toHaveBeenCalledWith(
      'https://fireflies.test/graphql',
      expect.objectContaining({
        variables: { meetingLink: 'https://meet.test/abc', title: 'Summary' }
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123'
        })
      })
    );
  });

  it('detects a rate-limit GraphQL error', async () => {
    axios.post.mockResolvedValue({
      data: {
        errors: [
          {
            message: 'Too many requests',
            extensions: {
              code: 'too_many_requests',
              metadata: { retryAfter: 1766168190612 }
            }
          }
        ]
      }
    });

    const result = await instantInviteTA('S', 'L');

    expect(result).toEqual({
      success: false,
      rateLimited: true,
      retryAfter: 1766168190612,
      message: 'Too many requests'
    });
  });

  it('returns a generic GraphQL error for non-rate-limit errors', async () => {
    const errors = [{ message: 'bad', extensions: { code: 'other' } }];
    axios.post.mockResolvedValue({ data: { errors } });

    const result = await instantInviteTA('S', 'L');

    expect(result).toEqual({
      success: false,
      message: 'GraphQL error',
      errors
    });
  });

  it('returns unsuccessful when mutation result is not success', async () => {
    axios.post.mockResolvedValue({
      data: { data: { addToLiveMeeting: { success: false } } }
    });

    const result = await instantInviteTA('S', 'L');

    expect(result).toEqual({
      success: false,
      message: 'Instant invite unsuccessful',
      response: { success: false }
    });
  });

  it('handles a missing data envelope (response.data undefined)', async () => {
    axios.post.mockResolvedValue({});

    const result = await instantInviteTA('S', 'L');

    expect(result).toEqual({
      success: false,
      message: 'Instant invite unsuccessful',
      response: undefined
    });
  });

  it('maps an axios HTTP error to a structured failure', async () => {
    axios.isAxiosError.mockReturnValue(true);
    axios.post.mockRejectedValue({
      response: { status: 500, data: { detail: 'oops' } }
    });

    const result = await instantInviteTA('S', 'L');

    expect(result).toEqual({
      success: false,
      message: 'HTTP request failed',
      status: 500,
      data: { detail: 'oops' }
    });
  });

  it('maps a non-axios error to "Unexpected error"', async () => {
    axios.isAxiosError.mockReturnValue(false);
    axios.post.mockRejectedValue(new Error('weird'));

    const result = await instantInviteTA('S', 'L');

    expect(result).toEqual({
      success: false,
      message: 'Unexpected error',
      error: 'weird'
    });
  });
});

describe('config guards', () => {
  // Re-require the module with config values blanked to hit the
  // "not configured" guards (which sit at the top of each function).
  it('scheduleInviteTA throws when the n8n URL is not configured', async () => {
    jest.resetModules();
    jest.doMock('../../config', () => ({
      FIREFLIES_API_URL: 'x',
      FIREFLIES_API_TOKEN: 'y',
      FIREFLIES_GOOGLE_INVITE_N8N_URL: ''
    }));
    jest.doMock('axios', () => ({ post: jest.fn() }));
    // eslint-disable-next-line global-require
    const svc = require('../../utils/meeting-assistant.service');
    await expect(svc.scheduleInviteTA('S', 'L', 'F', 'T')).rejects.toThrow(
      'FIREFLIES_GOOGLE_INVITE_N8N_URL is not configured'
    );
    jest.dontMock('../../config');
    jest.dontMock('axios');
  });

  it('instantInviteTA throws when the Fireflies API is not configured', async () => {
    jest.resetModules();
    jest.doMock('../../config', () => ({
      FIREFLIES_API_URL: '',
      FIREFLIES_API_TOKEN: '',
      FIREFLIES_GOOGLE_INVITE_N8N_URL: 'z'
    }));
    jest.doMock('axios', () => ({ post: jest.fn() }));
    // eslint-disable-next-line global-require
    const svc = require('../../utils/meeting-assistant.service');
    await expect(svc.instantInviteTA('S', 'L')).rejects.toThrow(
      'FIREFLIES_API_URL or FIREFLIES_API_TOKEN is not configured'
    );
    jest.dontMock('../../config');
    jest.dontMock('axios');
  });
});
