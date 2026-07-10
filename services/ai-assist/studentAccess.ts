import {
  Role,
  is_TaiGer_Admin,
  is_TaiGer_Agent,
  is_TaiGer_Editor
} from '@taiger-common/core';
import type { IPermission } from '@taiger-common/model';

import type { AuthenticatedUser } from '../../types/express';
import { ErrorResponse } from '../../common/errors';
import { ManagerType } from '../../constants';
import { getPermission } from '../../utils/queryFunctions';

const activeStudentFilter = {
  $or: [{ archiv: { $exists: false } }, { archiv: false }]
};

const getManagerStudentFilter = (user: AuthenticatedUser) => {
  const filters = [];

  if (
    [ManagerType.Agent, ManagerType.AgentAndEditor].includes(
      user.manager_type as string
    ) &&
    user.agents?.length
  ) {
    filters.push({ agents: { $in: user.agents } });
  }

  if (
    [ManagerType.Editor, ManagerType.AgentAndEditor].includes(
      user.manager_type as string
    ) &&
    user.editors?.length
  ) {
    filters.push({ editors: { $in: user.editors } });
  }

  if (!filters.length) {
    return { ...activeStudentFilter, _id: { $exists: false } };
  }

  return {
    ...activeStudentFilter,
    $and: [{ $or: filters }]
  };
};

// Only `req.user` is read here; a minimal structural shape keeps both the real
// Express Request and the lightweight unit-test request stubs assignable.
const getAccessibleStudentFilter = async (req: { user?: unknown }) => {
  // The auth middleware guarantees the hydrated user doc on authenticated
  // requests, exposed via AuthenticatedUser.
  const user = req.user as AuthenticatedUser;

  if (is_TaiGer_Admin(user)) {
    return activeStudentFilter;
  }
  // `getPermission` is cache-backed (ten_minutes_cache.get<T>) and its
  // untyped call site resolves the cached value to `{}`; the real shape is
  // the Permission document.
  const permission = (await getPermission(req, user)) as
    | IPermission
    | undefined;
  if (permission?.canAccessAllChat) {
    return activeStudentFilter;
  }

  const roleField = is_TaiGer_Agent(user)
    ? 'agents'
    : is_TaiGer_Editor(user)
    ? 'editors'
    : null;

  if (roleField) {
    return { ...activeStudentFilter, [roleField]: user._id };
  }

  if (user.role === Role.Manager) {
    return getManagerStudentFilter(user);
  }

  throw new ErrorResponse(403, 'Permission denied');
};

export = {
  getAccessibleStudentFilter
};
