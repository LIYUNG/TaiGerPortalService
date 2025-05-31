const { jest } = require('@jest/globals');

const mockSendEmail = jest.fn();

const mockTransporter = {
  sendMail: jest.fn(),
  verify: jest.fn()
};

module.exports = {
  transporter: mockTransporter,
  sendEmail: mockSendEmail
};
