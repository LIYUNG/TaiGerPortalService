const { ORIGIN } = require('../../config');
const { sendEmail } = require('./configuration');

// For editor lead, manager
const newCustomerCenterTicketEmail = async (recipient, payload) => {
  const subject = `[URGENT] New Customer Complaint ticket from ${payload.requester.firstname} ${payload.requester.lastname}`;
  const requesterName = `${payload.requester.firstname} ${payload.requester.lastname}`;
  const TICKET_LINK = new URL(
    `/customer-center/tickets/${payload.ticket_id}`,
    ORIGIN
  ).href;
  const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>We received a customer complaint by <a href="${TICKET_LINK}">${requesterName}</a> at ${payload.createdAt}:</p>

<p>Title: <b>${payload.ticket_title}</b></p>

<p>Content:</p>
<p><b>${payload.ticket_description}</b></p>

<p><b>Please address the customer complaints ticket as soon as possible. </b></p>

<a href="${TICKET_LINK}" class="mui-button" target="_blank">See Ticket</a>

<p>If you have any question, feel free to contact your agent.</p>


`;

  sendEmail(recipient, subject, message);
};

// For student confirmation
const newCustomerCenterTicketSubmitConfirmationEmail = async (
  recipient,
  payload
) => {
  const subject = `[Info] Thank you for your customer support request (Ticket id: ${payload.ticket_id}`;
  const TICKET_LINK = new URL(
    `/customer-center/tickets/${payload.ticket_id}`,
    ORIGIN
  ).href;
  const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>We received your customer support request at ${payload.createdAt}.</p>

<p>Title: <b>${payload.ticket_title}</b></p>

<p>Content:</p>
<p><b>${payload.ticket_description}</b></p>

<p><b>Please have patience and our manager will reply in the ticket discussion as soon as possible and organize a call if applicable.</b></p>

<a href="${TICKET_LINK}" class="mui-button" target="_blank">See Ticket</a>

`;

  sendEmail(recipient, subject, message);
};

// For student confirmation
const newCustomerCenterTicketMessageEmail = async (recipient, payload) => {
  const subject = `[Customer Center] There is a new message for the request (Ticket id: ${payload.ticket_id})`;
  const TICKET_LINK = new URL(
    `/customer-center/tickets/${payload.ticket_id}`,
    ORIGIN
  ).href;
  const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>There is a new message for the request (Ticket id: ${payload.ticket_id}).</p>

<p>Title: <b>${payload.ticket_title}</b></p>

<a href="${TICKET_LINK}" class="mui-button" target="_blank">See Ticket</a>

`;

  sendEmail(recipient, subject, message);
};

// For student confirmation
const complaintResolvedRequesterReminderEmail = async (recipient, payload) => {
  const subject = `[Resolved] Your customer support request is resolved (Ticket id: ${payload.ticket_id}`;
  const TICKET_LINK = new URL(
    `/customer-center/tickets/${payload.ticket_id}`,
    ORIGIN
  ).href;
  const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>We resolved your customer support request (Ticket id: ${payload.ticket_id}).</p>

<p>We really appreciate your request and hopefully we increase our service quality for you.</p>

<a href="${TICKET_LINK}" class="mui-button" target="_blank">See Ticket</a>

`;

  sendEmail(recipient, subject, message);
};

module.exports = {
  newCustomerCenterTicketEmail,
  newCustomerCenterTicketSubmitConfirmationEmail,
  newCustomerCenterTicketMessageEmail,
  complaintResolvedRequesterReminderEmail
};
