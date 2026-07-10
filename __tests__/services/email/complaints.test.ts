// Mock the send boundary so no real SMTP/SES is used.
jest.mock('../../../services/email/configuration', () => ({
  sendEmail: jest.fn(),
  transporter: { sendMail: jest.fn() }
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- export = interop, see services/email/configuration.ts
import EmailConfiguration = require('../../../services/email/configuration');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- export = interop, see services/email/complaints.ts
import ComplaintsEmail = require('../../../services/email/complaints');

const { sendEmail } = EmailConfiguration;
const {
  newCustomerCenterTicketEmail,
  newCustomerCenterTicketSubmitConfirmationEmail,
  newCustomerCenterTicketMessageEmail,
  complaintResolvedRequesterReminderEmail
} = ComplaintsEmail;

const recipient = {
  firstname: 'Recip',
  lastname: 'Ient'
};

const payload = {
  ticket_id: 'TICKET-123',
  ticket_title: 'My complaint',
  ticket_description: 'Something went wrong',
  createdAt: '2025-01-01T10:00:00.000Z',
  requester: {
    firstname: 'Reqi',
    lastname: 'Ster'
  }
};

beforeEach(() => {
  jest.clearAllMocks();
});

// Returns the (recipient, subject, message) tuple from the single sendEmail call.
const lastCall = () => {
  expect(sendEmail).toHaveBeenCalledTimes(1);
  return (sendEmail as jest.Mock).mock.calls[0];
};

describe('email/complaints templates', () => {
  test('newCustomerCenterTicketEmail builds an URGENT subject and links to the ticket', async () => {
    await newCustomerCenterTicketEmail(recipient, payload);

    const [to, subject, message] = lastCall();
    expect(to).toBe(recipient);
    expect(subject).toContain('[URGENT]');
    expect(subject).toContain('Reqi Ster');
    expect(message).toContain('Hi Recip Ient');
    expect(message).toContain(payload.ticket_title);
    expect(message).toContain(payload.ticket_description);
    expect(message).toContain('Reqi Ster');
    // The ticket link is built from ORIGIN + the ticket path.
    expect(message).toContain(`/customer-center/tickets/${payload.ticket_id}`);
  });

  test('newCustomerCenterTicketSubmitConfirmationEmail builds an Info confirmation', async () => {
    await newCustomerCenterTicketSubmitConfirmationEmail(recipient, payload);

    const [to, subject, message] = lastCall();
    expect(to).toBe(recipient);
    expect(subject).toContain('[Info]');
    expect(subject).toContain(payload.ticket_id);
    expect(message).toContain('Hi Recip Ient');
    expect(message).toContain('We received your customer support request');
    expect(message).toContain(payload.ticket_title);
    expect(message).toContain(payload.ticket_description);
    expect(message).toContain(`/customer-center/tickets/${payload.ticket_id}`);
  });

  test('newCustomerCenterTicketMessageEmail notifies about a new message', async () => {
    await newCustomerCenterTicketMessageEmail(recipient, payload);

    const [to, subject, message] = lastCall();
    expect(to).toBe(recipient);
    expect(subject).toContain('[Customer Center]');
    expect(subject).toContain(payload.ticket_id);
    expect(message).toContain('Hi Recip Ient');
    expect(message).toContain('There is a new message');
    expect(message).toContain(payload.ticket_title);
    expect(message).toContain(`/customer-center/tickets/${payload.ticket_id}`);
  });

  test('complaintResolvedRequesterReminderEmail builds a Resolved notice', async () => {
    await complaintResolvedRequesterReminderEmail(recipient, payload);

    const [to, subject, message] = lastCall();
    expect(to).toBe(recipient);
    expect(subject).toContain('[Resolved]');
    expect(subject).toContain(payload.ticket_id);
    expect(message).toContain('Hi Recip Ient');
    expect(message).toContain('We resolved your customer support request');
    expect(message).toContain(`/customer-center/tickets/${payload.ticket_id}`);
  });
});
