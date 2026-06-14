const {
  is_TaiGer_Agent,
  is_TaiGer_Editor,
  is_TaiGer_Admin
} = require('@taiger-common/core');

const { ErrorResponse } = require('../common/errors');
const logger = require('../services/logger');
const { getPermission } = require('../utils/queryFunctions');
const { asyncHandler } = require('./error-handler');

const permission_canAssignEditor_filter = asyncHandler(
  async (req, res, next) => {
    const { user } = req;
    const cachedPermission = await getPermission(req, user);

    if (is_TaiGer_Admin(user) || cachedPermission?.canAssignEditors) {
      next();
    } else {
      logger.warn('permissions denied: permission_canAssignEditor_filter');
      throw new ErrorResponse(403, 'Not allowed to access other resource.');
    }
  }
);

const permission_canAssignAgent_filter = asyncHandler(
  async (req, res, next) => {
    const { user } = req;
    const cachedPermission = await getPermission(req, user);
    if (is_TaiGer_Admin(user) || cachedPermission?.canAssignAgents) {
      next();
    } else {
      logger.warn('permissions denied: permission_canAssignAgent_filter');
      throw new ErrorResponse(403, 'Not allowed to access other resource.');
    }
  }
);

const permission_canModifyDocs_filter = asyncHandler(async (req, res, next) => {
  const { user } = req;
  if (is_TaiGer_Agent(user) || is_TaiGer_Editor(user)) {
    const cachedPermission = await getPermission(req, user);
    if (!cachedPermission?.canModifyDocumentation) {
      logger.warn('permissions denied: permission_canModifyDocs_filter');
      throw new ErrorResponse(403, 'Permission denied: Operation forbidden.');
    }
    next();
  } else {
    next();
  }
});

const permission_canAccessStudentDatabase_filter = asyncHandler(
  async (req, res, next) => {
    const { user } = req;
    if (is_TaiGer_Agent(user) || is_TaiGer_Editor(user)) {
      const cachedPermission = await getPermission(req, user);
      if (!cachedPermission?.canAccessStudentDatabase) {
        logger.warn(
          'permissions denied: permission_canAccessStudentDatabase_filter'
        );
        throw new ErrorResponse(403, 'Permission denied: Operation forbidden.');
      }
      next();
    } else {
      next();
    }
  }
);

const permission_canAddUser_filter = asyncHandler(async (req, res, next) => {
  const { user } = req;
  if (is_TaiGer_Agent(user) || is_TaiGer_Editor(user)) {
    const cachedPermission = await getPermission(req, user);
    if (!cachedPermission?.canAddUser) {
      logger.warn('permissions denied: permission_canAddUser_filter');
      throw new ErrorResponse(403, 'Permission denied: Operation forbidden.');
    }
    next();
  } else if (is_TaiGer_Admin(user)) {
    next();
  } else {
    throw new ErrorResponse(403, 'Permission denied: Operation forbidden.');
  }
});

const permission_TaiGerAIRatelimiter = asyncHandler(async (req, res, next) => {
  const { user } = req;
  const permission = await getPermission(req, user);
  if (!permission?.taigerAiQuota || permission.taigerAiQuota === 0) {
    logger.warn('permissions denied: permission_TaiGerAIRatelimiter');
    throw new ErrorResponse(403, 'Permission denied: Operation forbidden.');
  }

  next();
});

const permission_canUseTaiGerAI_filter = asyncHandler(
  async (req, res, next) => {
    const { user } = req;
    const permission = await getPermission(req, user);
    if (!is_TaiGer_Admin(user) && !permission?.canUseTaiGerAI) {
      logger.warn('permissions denied: permission_canUseTaiGerAI_filter');
      throw new ErrorResponse(403, 'Permission denied: Operation forbidden.');
    }
    next();
  }
);

const permission_canModifyProgramList_filter = asyncHandler(
  async (req, res, next) => {
    const { user } = req;
    if (is_TaiGer_Agent(user)) {
      const permission = await getPermission(req, user);
      if (!permission?.canModifyProgramList) {
        logger.warn(
          'permissions denied: permission_canModifyProgramList_filter'
        );
        throw new ErrorResponse(403, 'Permission denied: Operation forbidden.');
      }
      next();
    } else {
      next();
    }
  }
);

const permission_canModifyTicketList_filter = asyncHandler(
  async (req, res, next) => {
    const { user } = req;
    if (is_TaiGer_Agent(user)) {
      const permission = await getPermission(req, user);
      if (!permission?.canModifyTicketList) {
        logger.warn(
          'permissions denied: permission_canModifyTicketList_filter'
        );
        throw new ErrorResponse(403, 'Permission denied: Operation forbidden.');
      }
      next();
    } else {
      next();
    }
  }
);

const permission_canModifyComplaintList_filter = async (req, res, next) => {
  const { user } = req;
  if (is_TaiGer_Agent(user)) {
    const permission = await getPermission(req, user);
    if (!permission?.canModifyTicketList) {
      logger.warn('permissions denied: permission_canModifyTicketList_filter');
      throw new ErrorResponse(403, 'Permission denied: Operation forbidden.');
    }
    next();
  } else {
    next();
  }
};

module.exports = {
  permission_canAssignEditor_filter,
  permission_canAssignAgent_filter,
  permission_canModifyDocs_filter,
  permission_canAccessStudentDatabase_filter,
  permission_canAddUser_filter,
  permission_TaiGerAIRatelimiter,
  permission_canUseTaiGerAI_filter,
  permission_canModifyProgramList_filter,
  permission_canModifyTicketList_filter,
  permission_canModifyComplaintList_filter
};
