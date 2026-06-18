// Covers the REAL (non-test-mode) send paths of services/email/configuration —
// in NODE_ENV=test the senders are no-ops, so force isTest()=false and capture
// the transporter's sendMail.
const mockSendMail = jest.fn().mockResolvedValue({ messageId: 'm1' });

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail }))
}));
jest.mock('../../config', () => ({
  ...jest.requireActual('../../config'),
  isProd: () => false,
  isTest: () => false
}));
jest.mock('../../aws', () => ({
  ses: {},
  limiter: { schedule: (fn) => fn() },
  SendRawEmailCommand: class {}
}));
jest.mock('../../services/emailTemplate', () => ({
  htmlContent: (message) => `<wrap>${message}</wrap>`
}));
jest.mock('../../services/logger', () => ({
  error: jest.fn(),
  info: jest.fn()
}));

import {
  sendEmail,
  sendEmailWithAttachments
} from '../../services/email/configuration';
import { taigerNotReplyGmail } from '../../constants/email';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('email configuration (real send paths)', () => {
  it('sendEmail builds the mail (html-wrapped, bcc no-reply) and sends it', async () => {
    await sendEmail('to@x.com', 'Subject', 'Hello');

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mail = mockSendMail.mock.calls[0][0];
    expect(mail).toMatchObject({
      to: 'to@x.com',
      bcc: taigerNotReplyGmail,
      subject: 'Subject',
      html: '<wrap>Hello</wrap>'
    });
  });

  it('sendEmail returns null and logs when the transporter throws', async () => {
    mockSendMail.mockRejectedValueOnce(new Error('smtp down'));
    const result = await sendEmail('to@x.com', 'S', 'B');
    expect(result).toBeNull();
  });

  it('sendEmailWithAttachments includes cc, bcc (+no-reply) and attachments', async () => {
    const attachments = [{ filename: 'cv.pdf', content: Buffer.from('x') }];
    await sendEmailWithAttachments({
      to: ['a@x.com'],
      cc: ['c@x.com'],
      bcc: ['b@x.com'],
      subject: 'Docs',
      message: 'Body',
      attachments
    });

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mail = mockSendMail.mock.calls[0][0];
    expect(mail).toMatchObject({
      to: ['a@x.com'],
      cc: ['c@x.com'],
      subject: 'Docs',
      html: '<wrap>Body</wrap>',
      attachments
    });
    // The no-reply mailbox is always bcc'd for an audit copy.
    expect(mail.bcc).toEqual([taigerNotReplyGmail, 'b@x.com']);
  });

  it('sendEmailWithAttachments omits cc when none is given', async () => {
    await sendEmailWithAttachments({
      to: ['a@x.com'],
      subject: 'Docs',
      message: 'Body',
      attachments: []
    });

    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.cc).toBeUndefined();
    expect(mail.bcc).toEqual([taigerNotReplyGmail]);
  });
});
