export class ErrorResponse extends Error {
  // Optional machine-readable code so clients can branch on the error kind
  // without regex-matching the human-readable message.
  code: string | undefined;
  statusCode: number;
  constructor(statusCode: number, message: string, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}
