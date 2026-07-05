export class ErrorResponse extends Error {
  // Optional machine-readable code so clients can branch on the error kind
  // without regex-matching the human-readable message.
  constructor(statusCode, message, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}
