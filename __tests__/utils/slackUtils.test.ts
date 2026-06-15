// ---- Mock every external dependency so nothing hits network ----
jest.mock('axios');

jest.mock('../../config', () => ({
  SLACK_BOT_TOKEN: 'xoxb-test-token',
  SLACK_TAIGER_WIN_CHANNEL_ID: 'C123WIN'
}));

jest.mock('../../constants', () => ({
  PROGRAM_URL: (id) => `https://app/program/${id}`,
  BASE_DOCUMENT_FOR_AGENT_URL: (id) => `https://app/student/${id}`
}));

jest.mock('../../services/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

import axios from 'axios';
import logger from '../../services/logger';

import slackUtils from '../../utils/slackUtils';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('sendSlackMessage - validation', () => {
  it('throws when text missing or not a string', async () => {
    await expect(slackUtils.sendSlackMessage()).rejects.toThrow(
      'Message text is required.'
    );
    await expect(slackUtils.sendSlackMessage(123, 'C1')).rejects.toThrow(
      'Message text is required.'
    );
  });

  it('throws when channel missing or not a string', async () => {
    await expect(slackUtils.sendSlackMessage('hi')).rejects.toThrow(
      'Slack channel is required.'
    );
    await expect(slackUtils.sendSlackMessage('hi', 42)).rejects.toThrow(
      'Slack channel is required.'
    );
  });

  it('throws when blocks provided but not an array', async () => {
    await expect(
      slackUtils.sendSlackMessage('hi', 'C1', { not: 'array' })
    ).rejects.toThrow('Slack blocks must be an array when provided.');
  });

  it('throws when options provided but not an object', async () => {
    await expect(
      slackUtils.sendSlackMessage('hi', 'C1', [], 'notobj')
    ).rejects.toThrow('Slack options must be an object when provided.');
  });
});

describe('sendSlackMessage - postToSlack happy path', () => {
  it('posts to slack and returns data on ok=true', async () => {
    axios.post.mockResolvedValue({ data: { ok: true, ts: '1.2' } });
    const result = await slackUtils.sendSlackMessage('hello', 'C1', [
      { type: 'section' }
    ]);
    expect(result).toEqual({ ok: true, ts: '1.2' });
    expect(axios.post).toHaveBeenCalledWith(
      'https://slack.com/api/chat.postMessage',
      expect.objectContaining({ channel: 'C1', text: 'hello' }),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer xoxb-test-token'
        })
      })
    );
  });

  it('works with no blocks/options provided', async () => {
    axios.post.mockResolvedValue({ data: { ok: true } });
    const result = await slackUtils.sendSlackMessage('hi', 'C1');
    expect(result).toEqual({ ok: true });
  });
});

describe('sendSlackMessage - postToSlack errors', () => {
  it('throws Slack API error when response.data.ok is false', async () => {
    axios.post.mockResolvedValue({
      data: { ok: false, error: 'channel_not_found' }
    });
    await expect(slackUtils.sendSlackMessage('hi', 'C1')).rejects.toThrow(
      'Slack API error: channel_not_found'
    );
  });

  it('throws unknown_error when data.ok false without error field', async () => {
    axios.post.mockResolvedValue({ data: { ok: false } });
    await expect(slackUtils.sendSlackMessage('hi', 'C1')).rejects.toThrow(
      'Slack API error: unknown_error'
    );
  });

  it('throws using response.data.error when axios rejects', async () => {
    axios.post.mockRejectedValue({
      response: { data: { error: 'rate_limited' } }
    });
    await expect(slackUtils.sendSlackMessage('hi', 'C1')).rejects.toThrow(
      'Slack API error: rate_limited'
    );
  });

  it('throws using error.message when axios rejects without response data', async () => {
    axios.post.mockRejectedValue(new Error('network down'));
    await expect(slackUtils.sendSlackMessage('hi', 'C1')).rejects.toThrow(
      'Slack API error: network down'
    );
  });

  it('throws Unknown error when axios rejects with empty object', async () => {
    axios.post.mockRejectedValue({});
    await expect(slackUtils.sendSlackMessage('hi', 'C1')).rejects.toThrow(
      'Slack API error: Unknown error'
    );
  });
});

describe('sendSlackMessage - missing token', () => {
  it('throws when SLACK_BOT_TOKEN is not set', async () => {
    jest.resetModules();
    jest.doMock('../../config', () => ({
      SLACK_BOT_TOKEN: undefined,
      SLACK_TAIGER_WIN_CHANNEL_ID: 'C123WIN'
    }));
    jest.doMock('../../constants', () => ({
      PROGRAM_URL: (id) => `p/${id}`,
      BASE_DOCUMENT_FOR_AGENT_URL: (id) => `s/${id}`
    }));
    jest.doMock('../../services/logger', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    }));
    const freshSlack = require('../../utils/slackUtils');
    await expect(freshSlack.sendSlackMessage('hi', 'C1')).rejects.toThrow(
      'Missing Slack bot token. Set SLACK_BOT_TOKEN.'
    );
  });
});

describe('sendSlackMessageToWinChannel', () => {
  const buildStudent = (overrides = {}) => ({
    _id: 'stud1',
    firstname: 'Stu',
    lastname: 'Dent',
    agents: [
      { firstname: 'Ag', lastname: 'Ent', slackId: 'U_AG', archiv: false }
    ],
    editors: [{ firstname: 'Ed', lastname: 'Itor', archiv: false }],
    ...overrides
  });
  const application = {
    programId: {
      _id: 'prog1',
      school: 'MIT',
      program_name: 'CS',
      degree: 'MSc'
    }
  };

  it('sends slack message with slackId mention and name fallback (multiple contributors)', async () => {
    axios.post.mockResolvedValue({ data: { ok: true } });
    await slackUtils.sendSlackMessageToWinChannel(buildStudent(), application);
    expect(axios.post).toHaveBeenCalledTimes(1);
    const body = axios.post.mock.calls[0][1];
    expect(body.channel).toBe('C123WIN');
    expect(body.text).toContain('<@U_AG>'); // slackId mention
    expect(body.text).toContain('Ed Itor'); // name fallback
    expect(body.text).toContain(', and '); // 2+ contributors join
  });

  it('uses single contributor phrasing', async () => {
    axios.post.mockResolvedValue({ data: { ok: true } });
    const student = buildStudent({
      agents: [{ firstname: 'Solo', lastname: 'Agent', archiv: false }],
      editors: []
    });
    await slackUtils.sendSlackMessageToWinChannel(student, application);
    const body = axios.post.mock.calls[0][1];
    expect(body.text).toContain('Solo Agent');
    expect(body.text).not.toContain(', and ');
  });

  it('falls back to "the TaiGer team" when no active contributors', async () => {
    axios.post.mockResolvedValue({ data: { ok: true } });
    const student = buildStudent({
      agents: [{ firstname: 'A', lastname: 'B', archiv: true }],
      editors: []
    });
    await slackUtils.sendSlackMessageToWinChannel(student, application);
    const body = axios.post.mock.calls[0][1];
    expect(body.text).toContain('the TaiGer team');
  });

  it('uses generic contributor label when names are blank', async () => {
    axios.post.mockResolvedValue({ data: { ok: true } });
    const student = buildStudent({
      agents: [{ firstname: '', lastname: '', slackId: '', archiv: false }],
      editors: []
    });
    await slackUtils.sendSlackMessageToWinChannel(student, application);
    const body = axios.post.mock.calls[0][1];
    expect(body.text).toContain('a TaiGer contributor');
  });

  it('handles missing agents/editors arrays', async () => {
    axios.post.mockResolvedValue({ data: { ok: true } });
    const student = {
      _id: 'stud2',
      firstname: 'No',
      lastname: 'Staff'
    };
    await slackUtils.sendSlackMessageToWinChannel(student, application);
    const body = axios.post.mock.calls[0][1];
    expect(body.text).toContain('the TaiGer team');
  });

  it('logs error and does not throw when sending fails', async () => {
    axios.post.mockResolvedValue({ data: { ok: false, error: 'bad' } });
    await expect(
      slackUtils.sendSlackMessageToWinChannel(buildStudent(), application)
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });
});
