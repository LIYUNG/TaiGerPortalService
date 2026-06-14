const { AsyncLocalStorage } = require('async_hooks');
const crypto = require('crypto');

/**
 * Per-request context backed by AsyncLocalStorage.
 *
 * The Application Load Balancer attaches an `X-Amzn-Trace-Id` header to every
 * request it forwards to this ECS service, e.g.
 *   X-Amzn-Trace-Id: Root=1-67891233-abcdef012345678912345678;Self=...
 * We use its `Root=` segment as the requestId. The SAME value appears in the
 * ALB access logs (`trace_id` field), so it is the join key between ALB logs and
 * this service's CloudWatch logs.
 *
 * By stashing it in AsyncLocalStorage, every `logger` call made while handling
 * the request is automatically tagged with `requestId` (see services/logger.js),
 * so a single 5XX line found from an alarm can be expanded to the full story of
 * that one request via `filter requestId = "..."`.
 */
const als = new AsyncLocalStorage();

// ALB always sends the header; fall back to a generated id for requests that
// bypass the ALB (local dev, direct container calls).
const extractRequestId = (req) => {
  const header = req.headers['x-amzn-trace-id'];
  if (header) {
    const rootPart = header
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('Root='));
    return rootPart ? rootPart.slice('Root='.length) : header;
  }
  return crypto.randomUUID();
};

const requestContextMiddleware = (req, res, next) => {
  const requestId = extractRequestId(req);
  req.requestId = requestId;
  // Echo it back so the client (and anything in front) can correlate too.
  res.setHeader('X-Request-Id', requestId);
  als.run({ requestId }, () => next());
};

// Returns the current request's id, or undefined outside a request (cron, boot).
const getRequestId = () => als.getStore()?.requestId;

module.exports = { requestContextMiddleware, getRequestId, als };
