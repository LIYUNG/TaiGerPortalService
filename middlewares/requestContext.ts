import { AsyncLocalStorage } from 'async_hooks';
import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';

// Local augmentation: `requestId` is stamped onto every request by this
// middleware (see below), but isn't part of the shared Express.Request
// augmentation in types/express.d.ts.
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

interface RequestContextStore {
  requestId: string;
}

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
export const als = new AsyncLocalStorage<RequestContextStore>();

// ALB always sends the header as a single string value; fall back to a
// generated id for requests that bypass the ALB (local dev, direct container
// calls).
const extractRequestId = (req: Request): string => {
  const header = req.headers['x-amzn-trace-id'] as string | undefined;
  if (header) {
    const rootPart = header
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('Root='));
    return rootPart ? rootPart.slice('Root='.length) : header;
  }
  return crypto.randomUUID();
};

export const requestContextMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const requestId = extractRequestId(req);
  req.requestId = requestId;
  // Echo it back so the client (and anything in front) can correlate too.
  res.setHeader('X-Request-Id', requestId);
  als.run({ requestId }, () => next());
};

// Returns the current request's id, or undefined outside a request (cron, boot).
export const getRequestId = () => als.getStore()?.requestId;
