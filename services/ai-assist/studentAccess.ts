const {
  Role,
  is_TaiGer_Admin,
  is_TaiGer_Agent,
  is_TaiGer_Editor
} = require('@taiger-common/core');

const { ErrorResponse } = require('../../common/errors');
const { ManagerType } = require('../../constants');
const { getPermission } = require('../../utils/queryFunctions');

const activeStudentFilter = {
  $or: [{ archiv: { $exists: false } }, { archiv: false }]
};

const getManagerStudentFilter = (user) => {
  const filters = [];

  if (
    [ManagerType.Agent, ManagerType.AgentAndEditor].includes(
      user.manager_type
    ) &&
    user.agents?.length
  ) {
    filters.push({ agents: { $in: user.agents } });
  }

  if (
    [ManagerType.Editor, ManagerType.AgentAndEditor].includes(
      user.manager_type
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

const getAccessibleStudentFilter = async (req) => {
  const { user } = req;

  if (is_TaiGer_Admin(user)) {
    return activeStudentFilter;
  }
  const permission = await getPermission(req, user);
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

module.exports = {
  getAccessibleStudentFilter
};
