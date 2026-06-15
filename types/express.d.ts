// Ambient augmentation of Express's Request with the app-specific properties
// that middleware attaches (auth user, tenant). Kept loose for now (the strict
// user typing can be tightened later against @taiger-common models).
import 'express';

declare global {
  namespace Express {
    interface Request {
      // Populated by the auth middleware (protect).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      user?: any;
      // Populated by the multitenancy middleware.
      tenantId?: string;
    }
  }
}
