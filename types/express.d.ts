// Ambient augmentation of Express's Request with the app-specific properties
// that middleware attaches (auth user, tenant).
import type { Request } from 'express';
import type {
  IUser,
  IAgent,
  IEditor,
  IUserAttribute
} from '@taiger-common/model';
import type { HydratedDocument, Types } from 'mongoose';

// The authenticated principal attached to `req.user` by the auth middleware
// (middlewares/auth.ts `protect`/`localAuth`). At runtime this is a hydrated
// Mongoose User document — often a role discriminator (Student/Agent/Manager/…)
// — so it carries `_id`, `.save()`, and the discriminator-only fields below that
// the base `IUser` interface does not declare. Typed as always-present because
// every handler that reads `req.user` runs behind `protect`.
export type AuthenticatedUser = HydratedDocument<IUser> & {
  // Student discriminator: assigned agents/editors (populated docs or raw refs).
  agents?: (IAgent | Types.ObjectId | string)[];
  editors?: (IEditor | Types.ObjectId | string)[];
  // Manager discriminator.
  manager_type?: string;
  // Student discriminator profile attributes.
  attributes?: IUserAttribute[];
};

declare global {
  namespace Express {
    interface Request {
      // Populated by the auth middleware (protect). Non-optional: every handler
      // that reads it runs behind `protect`.
      user: AuthenticatedUser;
      // Populated by the multitenancy middleware.
      tenantId?: string;
    }
  }
}

// A request as seen inside an authenticated route handler (see `asyncRoute` in
// middlewares/error-handler.ts): `user` is present and correctly typed, so
// handlers reading a real `Request` don't fall back to passport's empty
// `Express.User`. Used as the handler param type by `asyncRoute`.
export interface AuthedRequest extends Request {
  user: AuthenticatedUser;
}
