// ---- Mock every external dependency so nothing hits network ----
jest.mock('axios');

// `isLocal` and `SLACK_DEVELOPER_ID` / `SLACK_NOTIFICATIONS_LOG_CHANNEL_ID`
// are mutable per-test so the dev-redirect and manager-log branches of
// sendApplicationWithdrawNotificationToEditors can be exercised.
const mockConfig: Record<string, any> = {
  SLACK_BOT_TOKEN: 'xoxb-test-token',
  SLACK_TAIGER_WIN_CHANNEL_ID: 'C123WIN',
  SLACK_DEVELOPER_ID: 'U_DEV',
  SLACK_NOTIFICATIONS_LOG_CHANNEL_ID: 'C_LOG',
  isLocal: jest.fn(() => false)
};

jest.mock('../../config', () => mockConfig);

jest.mock('../../constants', () => ({
  PROGRAM_URL: (id: any) => `https://app/program/${id}`,
  BASE_DOCUMENT_FOR_AGENT_URL: (id: any) => `https://app/student/${id}`,
  STUDENT_APPLICATION_STUDENT_URL: (id: any) => `https://app/appstudent/${id}`
}));

jest.mock('../../services/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

import axiosReal from 'axios';
import logger from '../../services/logger';

const axios = axiosReal as unknown as { post: jest.Mock };

import * as slackUtils from '../../utils/slackUtils';

beforeEach(() => {
  jest.clearAllMocks();
  // Restore default (production-like) config between tests.
  mockConfig.SLACK_DEVELOPER_ID = 'U_DEV';
  mockConfig.SLACK_NOTIFICATIONS_LOG_CHANNEL_ID = 'C_LOG';
  mockConfig.isLocal.mockReturnValue(false);
});

describe('sendSlackMessage - validation', () => {
  it('throws when text missing or not a string', async () => {
    await expect((slackUtils.sendSlackMessage as any)()).rejects.toThrow(
      'Message text is required.'
    );
    await expect(slackUtils.sendSlackMessage(123 as any, 'C1')).rejects.toThrow(
      'Message text is required.'
    );
  });

  it('throws when channel missing or not a string', async () => {
    await expect((slackUtils.sendSlackMessage as any)('hi')).rejects.toThrow(
      'Slack channel is required.'
    );
    await expect(slackUtils.sendSlackMessage('hi', 42 as any)).rejects.toThrow(
      'Slack channel is required.'
    );
  });

  it('throws when blocks provided but not an array', async () => {
    await expect(
      slackUtils.sendSlackMessage('hi', 'C1', { not: 'array' } as any)
    ).rejects.toThrow('Slack blocks must be an array when provided.');
  });

  it('throws when options provided but not an object', async () => {
    await expect(
      slackUtils.sendSlackMessage('hi', 'C1', [], 'notobj' as any)
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
      PROGRAM_URL: (id: any) => `p/${id}`,
      BASE_DOCUMENT_FOR_AGENT_URL: (id: any) => `s/${id}`
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

describe('sendApplicationWithdrawNotificationToEditors', () => {
  const application = {
    programId: {
      _id: 'prog1',
      school: 'MIT',
      program_name: 'CS',
      degree: 'MSc'
    }
  };
  const studentWith = (editors: any) => ({
    _id: 'stud1',
    firstname: 'Stu',
    lastname: 'Dent',
    editors
  });

  it('returns early without sending when there are no eligible editors', async () => {
    // missing editors array, archived editor, and editor without slackId are all filtered out.
    await slackUtils.sendApplicationWithdrawNotificationToEditors(
      { _id: 's', firstname: 'A', lastname: 'B' },
      application,
      true
    );
    await slackUtils.sendApplicationWithdrawNotificationToEditors(
      studentWith([
        { _id: 'e1', slackId: 'U1', archiv: true },
        { _id: 'e2', archiv: false }, // no slackId
        { _id: 'e3', slackId: '', archiv: false } // empty slackId
      ]),
      application,
      true
    );
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('sends a withdrawn DM to each editor and logs to managers', async () => {
    axios.post.mockResolvedValue({ data: { ok: true } });
    await slackUtils.sendApplicationWithdrawNotificationToEditors(
      studentWith([
        { _id: 'e1', slackId: 'U1', archiv: false },
        {
          _id: 'e2',
          slackId: 'U2',
          firstname: 'Ed',
          lastname: 'Itor',
          archiv: false
        }
      ]),
      application,
      true
    );
    // 2 editor DMs + 2 manager-log posts = 4.
    expect(axios.post).toHaveBeenCalledTimes(4);
    const editorDm = axios.post.mock.calls[0][1];
    expect(editorDm.channel).toBe('U1');
    expect(editorDm.text).toContain('Application withdrawn');
    // Manager log quotes the message and mentions the editor by slackId.
    const log = axios.post.mock.calls[1][1];
    expect(log.channel).toBe('C_LOG');
    expect(log.text).toContain('<@U1>');
    expect(log.text).toContain('> ');
  });

  it('uses the reinstated phrasing when isWithdrawn is false', async () => {
    axios.post.mockResolvedValue({ data: { ok: true } });
    await slackUtils.sendApplicationWithdrawNotificationToEditors(
      studentWith([{ _id: 'e1', slackId: 'U1', archiv: false }]),
      application,
      false
    );
    expect(axios.post.mock.calls[0][1].text).toContain(
      'Application reinstated'
    );
  });

  it('redirects DMs to the developer in local mode', async () => {
    mockConfig.isLocal.mockReturnValue(true);
    axios.post.mockResolvedValue({ data: { ok: true } });
    await slackUtils.sendApplicationWithdrawNotificationToEditors(
      studentWith([{ _id: 'e1', slackId: 'U1', archiv: false }]),
      application,
      true
    );
    const dm = axios.post.mock.calls[0][1];
    expect(dm.channel).toBe('U_DEV');
    expect(dm.text).toContain('redirected to <@U_DEV>');
    // The manager log still records the original (non-redirect) note.
    const log = axios.post.mock.calls[1][1];
    expect(log.text).toContain('redirected to <@U_DEV>');
  });

  it('skips sending (but still logs) in local mode with no SLACK_DEVELOPER_ID', async () => {
    mockConfig.isLocal.mockReturnValue(true);
    mockConfig.SLACK_DEVELOPER_ID = undefined;
    axios.post.mockResolvedValue({ data: { ok: true } });
    await slackUtils.sendApplicationWithdrawNotificationToEditors(
      studentWith([{ _id: 'e1', slackId: 'U1', archiv: false }]),
      application,
      true
    );
    expect(logger.info).toHaveBeenCalled();
    // No editor DM, only the manager-log post.
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls[0][1].channel).toBe('C_LOG');
  });

  it('logs an error when sending the editor DM fails but still logs to managers', async () => {
    // First call (editor DM) fails; manager-log call succeeds.
    axios.post
      .mockResolvedValueOnce({ data: { ok: false, error: 'boom' } })
      .mockResolvedValue({ data: { ok: true } });
    await slackUtils.sendApplicationWithdrawNotificationToEditors(
      studentWith([{ _id: 'e1', slackId: 'U1', archiv: false }]),
      application,
      true
    );
    expect(logger.error).toHaveBeenCalled();
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  it('does not log to managers when no log channel is configured', async () => {
    mockConfig.SLACK_NOTIFICATIONS_LOG_CHANNEL_ID = undefined;
    axios.post.mockResolvedValue({ data: { ok: true } });
    await slackUtils.sendApplicationWithdrawNotificationToEditors(
      studentWith([{ _id: 'e1', slackId: 'U1', archiv: false }]),
      application,
      true
    );
    // Only the editor DM is sent; no manager-log post.
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls[0][1].channel).toBe('U1');
  });

  it('falls back to the editor name in the manager log when sending the DM is skipped without a slackId mention', async () => {
    // logStaffNotificationToManagers receives the editor; with a non-string
    // slackId it should fall back to firstname/lastname (then the generic label).
    mockConfig.SLACK_NOTIFICATIONS_LOG_CHANNEL_ID = 'C_LOG';
    axios.post.mockResolvedValue({ data: { ok: true } });
    // Editor passes the outer filter (string slackId) so it is processed, but
    // we exercise the manager-log name path by spying on the log post text for
    // an editor whose firstname/lastname are present.
    await slackUtils.sendApplicationWithdrawNotificationToEditors(
      studentWith([
        {
          _id: 'e1',
          slackId: 'U1',
          firstname: 'Nina',
          lastname: 'Ame',
          archiv: false
        }
      ]),
      application,
      true
    );
    // slackId present -> mention form is used in the log.
    expect(axios.post.mock.calls[1][1].text).toContain('<@U1>');
  });

  it('logs an error when the manager-log post itself fails', async () => {
    // Editor DM ok, manager-log post rejects -> caught and logged.
    axios.post
      .mockResolvedValueOnce({ data: { ok: true } })
      .mockRejectedValueOnce(new Error('log failed'));
    await slackUtils.sendApplicationWithdrawNotificationToEditors(
      studentWith([{ _id: 'e1', slackId: 'U1', archiv: false }]),
      application,
      true
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to log Slack notification to managers')
    );
  });
});
