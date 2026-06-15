const { Role } = require('@taiger-common/core');

const { getPermission } = require('../../utils/queryFunctions');
const {
  permission_canModifyDocs_filter,
  permission_canAccessStudentDatabase_filter,
  permission_canAddUser_filter,
  permission_canModifyComplaintList_filter
} = require('../../middlewares/permission-filter');
const { ErrorResponse } = require('../../common/errors');
const logger = require('../../services/logger');

jest.mock('../../utils/queryFunctions');

describe('permission-filter additional branches', () => {
  let req, res, next;

  beforeEach(() => {
    res = {};
    next = jest.fn();
    jest.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('permission_canModifyDocs_filter - non agent/editor branch', () => {
    it('calls next() without permission lookup for Admin', async () => {
      req = { user: { role: Role.Admin } };
      await permission_canModifyDocs_filter(req, res, next);
      expect(getPermission).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith();
    });

    it('calls next() without permission lookup for Student', async () => {
      req = { user: { role: Role.Student } };
      await permission_canModifyDocs_filter(req, res, next);
      expect(next).toHaveBeenCalledWith();
    });

    it('calls next() for Editor with permission', async () => {
      req = { user: { role: Role.Editor } };
      getPermission.mockResolvedValue({ canModifyDocumentation: true });
      await permission_canModifyDocs_filter(req, res, next);
      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('permission_canAccessStudentDatabase_filter - non agent/editor branch', () => {
    it('calls next() without permission lookup for Admin', async () => {
      req = { user: { role: Role.Admin } };
      await permission_canAccessStudentDatabase_filter(req, res, next);
      expect(getPermission).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith();
    });

    it('calls next() for Editor with permission', async () => {
      req = { user: { role: Role.Editor } };
      getPermission.mockResolvedValue({ canAccessStudentDatabase: true });
      await permission_canAccessStudentDatabase_filter(req, res, next);
      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('permission_canAddUser_filter', () => {
    it('calls next() for Agent with canAddUser permission', async () => {
      req = { user: { role: Role.Agent } };
      getPermission.mockResolvedValue({ canAddUser: true });
      await permission_canAddUser_filter(req, res, next);
      expect(next).toHaveBeenCalledWith();
    });

    it('passes 403 to next for Editor lacking canAddUser', async () => {
      req = { user: { role: Role.Editor } };
      getPermission.mockResolvedValue({ canAddUser: false });
      await permission_canAddUser_filter(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(ErrorResponse));
      expect(next.mock.calls[0][0].statusCode).toBe(403);
      expect(logger.warn).toHaveBeenCalledWith(
        'permissions denied: permission_canAddUser_filter'
      );
    });

    it('calls next() for Admin', async () => {
      req = { user: { role: Role.Admin } };
      await permission_canAddUser_filter(req, res, next);
      expect(next).toHaveBeenCalledWith();
    });

    it('passes 403 to next for other roles (Student)', async () => {
      req = { user: { role: Role.Student } };
      await permission_canAddUser_filter(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(ErrorResponse));
      expect(next.mock.calls[0][0].statusCode).toBe(403);
    });
  });

  describe('permission_canModifyComplaintList_filter', () => {
    it('calls next() for non-Agent role', async () => {
      req = { user: { role: Role.Admin } };
      await permission_canModifyComplaintList_filter(req, res, next);
      expect(next).toHaveBeenCalledWith();
    });

    it('calls next() for Agent with permission', async () => {
      req = { user: { role: Role.Agent } };
      getPermission.mockResolvedValue({ canModifyTicketList: true });
      await permission_canModifyComplaintList_filter(req, res, next);
      expect(next).toHaveBeenCalledWith();
    });

    it('throws 403 for Agent lacking permission', async () => {
      req = { user: { role: Role.Agent } };
      getPermission.mockResolvedValue({ canModifyTicketList: false });
      await expect(
        permission_canModifyComplaintList_filter(req, res, next)
      ).rejects.toBeInstanceOf(ErrorResponse);
      expect(logger.warn).toHaveBeenCalled();
    });
  });
});
