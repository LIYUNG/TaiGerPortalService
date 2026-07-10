import {
  is_TaiGer_Agent,
  is_TaiGer_Editor,
  is_TaiGer_Admin
} from '@taiger-common/core';
import { IPermission, IUser } from '@taiger-common/model';
import { NextFunction, Request, Response } from 'express';
import { ErrorResponse } from '../common/errors';
import logger from '../services/logger';
import { getPermission } from '../utils/queryFunctions';
import { asyncHandler } from './error-handler';

// `getPermission` (utils/queryFunctions.ts) is a thin cache wrapper whose
// return type isn't precisely inferred there; the real shape returned at
// runtime is the permission document, so we assert it here.
// `canModifyTicketList` isn't (yet) part of the shared `IPermission` model,
// but is a real, persisted field the ticket-list filters below rely on.
type CachedPermission = IPermission & { canModifyTicketList?: boolean };

export const permission_canAssignEditor_filter = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user as IUser;
    const cachedPermission = (await getPermission(req, user)) as
      | CachedPermission
      | undefined;

    if (is_TaiGer_Admin(user) || cachedPermission?.canAssignEditors) {
      next();
    } else {
      logger.warn('permissions denied: permission_canAssignEditor_filter');
      throw new ErrorResponse(403, 'Not allowed to access other resource.');
    }
  }
);

export const permission_canAssignAgent_filter = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user as IUser;
    const cachedPermission = (await getPermission(req, user)) as
      | CachedPermission
      | undefined;
    if (is_TaiGer_Admin(user) || cachedPermission?.canAssignAgents) {
      next();
    } else {
      logger.warn('permissions denied: permission_canAssignAgent_filter');
      throw new ErrorResponse(403, 'Not allowed to access other resource.');
    }
  }
);

export const permission_canModifyDocs_filter = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user as IUser;
    if (is_TaiGer_Agent(user) || is_TaiGer_Editor(user)) {
      const cachedPermission = (await getPermission(req, user)) as
        | CachedPermission
        | undefined;
      if (!cachedPermission?.canModifyDocumentation) {
        logger.warn('permissions denied: permission_canModifyDocs_filter');
        throw new ErrorResponse(403, 'Permission denied: Operation forbidden.');
      }
      next();
    } else {
      next();
    }
  }
);

export const permission_canAccessStudentDatabase_filter = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user as IUser;
    if (is_TaiGer_Agent(user) || is_TaiGer_Editor(user)) {
      const cachedPermission = (await getPermission(req, user)) as
        | CachedPermission
        | undefined;
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

export const permission_canAddUser_filter = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user as IUser;
    if (is_TaiGer_Agent(user) || is_TaiGer_Editor(user)) {
      const cachedPermission = (await getPermission(req, user)) as
        | CachedPermission
        | undefined;
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
  }
);

export const permission_TaiGerAIRatelimiter = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user as IUser;
    const permission = (await getPermission(req, user)) as
      | CachedPermission
      | undefined;
    if (!permission?.taigerAiQuota || permission?.taigerAiQuota === 0) {
      logger.warn('permissions denied: permission_TaiGerAIRatelimiter');
      throw new ErrorResponse(403, 'Permission denied: Operation forbidden.');
    }

    next();
  }
);

export const permission_canUseTaiGerAI_filter = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user as IUser;
    const permission = (await getPermission(req, user)) as
      | CachedPermission
      | undefined;
    if (!is_TaiGer_Admin(user) && !permission?.canUseTaiGerAI) {
      logger.warn('permissions denied: permission_canUseTaiGerAI_filter');
      throw new ErrorResponse(403, 'Permission denied: Operation forbidden.');
    }
    next();
  }
);

export const permission_canModifyProgramList_filter = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user as IUser;
    if (is_TaiGer_Agent(user)) {
      const permission = (await getPermission(req, user)) as
        | CachedPermission
        | undefined;
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

export const permission_canModifyTicketList_filter = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user as IUser;
    if (is_TaiGer_Agent(user)) {
      const permission = (await getPermission(req, user)) as
        | CachedPermission
        | undefined;
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

export const permission_canModifyComplaintList_filter = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const user = req.user as IUser;
  if (is_TaiGer_Agent(user)) {
    const permission = (await getPermission(req, user)) as
      | CachedPermission
      | undefined;
    if (!permission?.canModifyTicketList) {
      logger.warn('permissions denied: permission_canModifyTicketList_filter');
      throw new ErrorResponse(403, 'Permission denied: Operation forbidden.');
    }
    next();
  } else {
    next();
  }
};
