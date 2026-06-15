const { Role } = require('@taiger-common/core');

const { getPermission } = require('../../utils/queryFunctions');
const {
  permission_canAssignEditor_filter,
  permission_canAssignAgent_filter,
  permission_canModifyDocs_filter,
  permission_canAccessStudentDatabase_filter,
  permission_TaiGerAIRatelimiter,
  permission_canUseTaiGerAI_filter,
  permission_canModifyProgramList_filter,
  permission_canModifyTicketList_filter
} = require('../../middlewares/permission-filter'); // Update with the correct path
const { ErrorResponse } = require('../../common/errors');
const logger = require('../../services/logger');

jest.mock('../../utils/queryFunctions'); // Mock the getPermission module
jest.mock('../../common/errors'); // Mock the ErrorResponse module

describe('permission_canAssignEditor_filter Middleware', () => {
  let req, res, next, user, cachedPermission;

  beforeEach(() => {
    user = { role: Role.Agent }; // Default role
    cachedPermission = { canAssignEditors: false }; // Default permission

    req = { user };
    res = {};
    next = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should call next if user is an Admin', async () => {
    req.user.role = Role.Admin;
    await permission_canAssignEditor_filter(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('should call next if user has canAssignEditors permission', async () => {
    cachedPermission.canAssignEditors = true;
    getPermission.mockResolvedValue(cachedPermission);
    await permission_canAssignEditor_filter(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('should call next with an error if user lacks permission', async () => {
    getPermission.mockResolvedValue(cachedPermission);
    await permission_canAssignEditor_filter(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(ErrorResponse));
  });

  it('should log a warning if user lacks permission', async () => {
    const loggerSpy = jest.spyOn(logger, 'warn').mockImplementation();
    getPermission.mockResolvedValue(cachedPermission);
    await permission_canAssignEditor_filter(req, res, next);
    expect(loggerSpy).toHaveBeenCalledWith(
      'permissions denied: permission_canAssignEditor_filter'
    );
    loggerSpy.mockRestore();
  });
});

describe('permission_canAssignAgent_filter Middleware', () => {
  let req, res, next, user, cachedPermission;

  beforeEach(() => {
    user = { role: Role.Agent }; // Default role
    cachedPermission = { canAssignAgents: false }; // Default permission

    req = { user };
    res = {};
    next = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should call next if user is an Admin', async () => {
    req.user.role = Role.Admin;
    await permission_canAssignAgent_filter(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('should call next if user has canAssignAgents permission', async () => {
    cachedPermission.canAssignAgents = true;
    getPermission.mockResolvedValue(cachedPermission);
    await permission_canAssignAgent_filter(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('should call next with an error if user lacks permission', async () => {
    getPermission.mockResolvedValue(cachedPermission);
    await permission_canAssignAgent_filter(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(ErrorResponse));
  });

  it('should log a warning if user lacks permission', async () => {
    const loggerSpy = jest.spyOn(logger, 'warn').mockImplementation();
    getPermission.mockResolvedValue(cachedPermission);
    await permission_canAssignAgent_filter(req, res, next);
    expect(loggerSpy).toHaveBeenCalledWith(
      'permissions denied: permission_canAssignAgent_filter'
    );
    loggerSpy.mockRestore();
  });
});

describe('permission_canModifyDocs_filter Middleware', () => {
  let req, res, next, user, cachedPermission;

  beforeEach(() => {
    user = { role: Role.Agent }; // Default role
    cachedPermission = { canModifyDocumentation: false }; // Default permission

    req = { user };
    res = {};
    next = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should call next if user is an Admin', async () => {
    req.user.role = Role.Admin;
    await permission_canModifyDocs_filter(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('should call next if user has canModifyDocumentation permission', async () => {
    cachedPermission.canModifyDocumentation = true;
    getPermission.mockResolvedValue(cachedPermission);
    await permission_canModifyDocs_filter(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('should call next with an error if user lacks permission', async () => {
    getPermission.mockResolvedValue(cachedPermission);
    await permission_canModifyDocs_filter(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(ErrorResponse));
  });

  it('should log a warning if user lacks permission', async () => {
    const loggerSpy = jest.spyOn(logger, 'warn').mockImplementation();
    getPermission.mockResolvedValue(cachedPermission);
    await permission_canModifyDocs_filter(req, res, next);
    expect(loggerSpy).toHaveBeenCalledWith(
      'permissions denied: permission_canModifyDocs_filter'
    );
    loggerSpy.mockRestore();
  });
});

describe('permission_canAccessStudentDatabase_filter Middleware', () => {
  let req, res, next, user, cachedPermission;

  beforeEach(() => {
    user = { role: Role.Agent }; // Default role
    cachedPermission = { canAccessStudentDatabase: false }; // Default permission

    req = { user };
    res = {};
    next = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should call next if user is an Admin', async () => {
    req.user.role = Role.Admin;
    await permission_canAccessStudentDatabase_filter(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('should call next if user has canAccessStudentDatabase permission', async () => {
    cachedPermission.canAccessStudentDatabase = true;
    getPermission.mockResolvedValue(cachedPermission);
    await permission_canAccessStudentDatabase_filter(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('should call next with an error if user lacks permission', async () => {
    getPermission.mockResolvedValue(cachedPermission);
    await permission_canAccessStudentDatabase_filter(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(ErrorResponse));
  });

  it('should log a warning if user lacks permission', async () => {
    const loggerSpy = jest.spyOn(logger, 'warn').mockImplementation();
    getPermission.mockResolvedValue(cachedPermission);
    await permission_canAccessStudentDatabase_filter(req, res, next);
    expect(loggerSpy).toHaveBeenCalledWith(
      'permissions denied: permission_canAccessStudentDatabase_filter'
    );
    loggerSpy.mockRestore();
  });
});

describe('permission_TaiGerAIRatelimiter Middleware', () => {
  let req, res, next, user, cachedPermission;

  beforeEach(() => {
    user = { role: Role.Agent }; // Default role
    cachedPermission = { taigerAiQuota: 2 }; // Default permission

    req = { user };
    res = {};
    next = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should call next if user has enough taigerAiQuota', async () => {
    getPermission.mockResolvedValue(cachedPermission);
    await permission_TaiGerAIRatelimiter(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('should call next with an error if user lacks taigerAiQuota', async () => {
    cachedPermission.taigerAiQuota = 0;
    getPermission.mockResolvedValue(cachedPermission);
    await permission_TaiGerAIRatelimiter(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(ErrorResponse));
  });

  it('should log a warning if user lacks permission', async () => {
    const loggerSpy = jest.spyOn(logger, 'warn').mockImplementation();
    delete cachedPermission.taigerAiQuota;
    getPermission.mockResolvedValue(cachedPermission);
    await permission_TaiGerAIRatelimiter(req, res, next);
    expect(loggerSpy).toHaveBeenCalledWith(
      'permissions denied: permission_TaiGerAIRatelimiter'
    );
    loggerSpy.mockRestore();
  });
});

describe('permission_canUseTaiGerAI_filter Middleware', () => {
  let req, res, next, user, cachedPermission;

  beforeEach(() => {
    user = { role: Role.Agent }; // Default role
    cachedPermission = { canUseTaiGerAI: false }; // Default permission

    req = { user };
    res = {};
    next = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should call next if user has enough canUseTaiGerAI', async () => {
    cachedPermission.canUseTaiGerAI = true;
    getPermission.mockResolvedValue(cachedPermission);
    await permission_canUseTaiGerAI_filter(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('should call next with an error if user lacks canUseTaiGerAI permission', async () => {
    getPermission.mockResolvedValue(cachedPermission);
    await permission_canUseTaiGerAI_filter(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(ErrorResponse));
  });

  it('should log a warning if user lacks permission', async () => {
    const loggerSpy = jest.spyOn(logger, 'warn').mockImplementation();
    getPermission.mockResolvedValue(cachedPermission);
    await permission_canUseTaiGerAI_filter(req, res, next);
    expect(loggerSpy).toHaveBeenCalledWith(
      'permissions denied: permission_canUseTaiGerAI_filter'
    );
    loggerSpy.mockRestore();
  });
});

describe('permission_canModifyProgramList_filter Middleware', () => {
  let req, res, next, user, cachedPermission;

  beforeEach(() => {
    user = { role: Role.Agent }; // Default role
    cachedPermission = { canModifyProgramList: false }; // Default permission

    req = { user };
    res = {};
    next = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should call next if user is not Agent', async () => {
    user.role = Role.Student;
    getPermission.mockResolvedValue(cachedPermission);
    await permission_canModifyProgramList_filter(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('should call next if user has enough canModifyProgramList', async () => {
    cachedPermission.canModifyProgramList = true;
    getPermission.mockResolvedValue(cachedPermission);
    await permission_canModifyProgramList_filter(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('should call next with an error if user lacks canModifyProgramList permission', async () => {
    getPermission.mockResolvedValue(cachedPermission);
    await permission_canModifyProgramList_filter(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(ErrorResponse));
  });

  it('should log a warning if user lacks permission', async () => {
    const loggerSpy = jest.spyOn(logger, 'warn').mockImplementation();
    getPermission.mockResolvedValue(cachedPermission);
    await permission_canModifyProgramList_filter(req, res, next);
    expect(loggerSpy).toHaveBeenCalledWith(
      'permissions denied: permission_canModifyProgramList_filter'
    );
    loggerSpy.mockRestore();
  });
});

describe('permission_canModifyTicketList_filter Middleware', () => {
  let req, res, next, user, cachedPermission;

  beforeEach(() => {
    user = { role: Role.Agent }; // Default role
    cachedPermission = { canModifyTicketList: false }; // Default permission

    req = { user };
    res = {};
    next = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should call next if user is not Agent', async () => {
    user.role = Role.Student;
    getPermission.mockResolvedValue(cachedPermission);
    await permission_canModifyTicketList_filter(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('should call next if user has enough canModifyTicketList', async () => {
    cachedPermission.canModifyTicketList = true;
    getPermission.mockResolvedValue(cachedPermission);
    await permission_canModifyTicketList_filter(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('should call next with an error if user lacks canModifyTicketList permission', async () => {
    getPermission.mockResolvedValue(cachedPermission);
    await permission_canModifyTicketList_filter(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(ErrorResponse));
  });

  it('should log a warning if user lacks permission', async () => {
    const loggerSpy = jest.spyOn(logger, 'warn').mockImplementation();
    getPermission.mockResolvedValue(cachedPermission);
    await permission_canModifyTicketList_filter(req, res, next);
    expect(loggerSpy).toHaveBeenCalledWith(
      'permissions denied: permission_canModifyTicketList_filter'
    );
    loggerSpy.mockRestore();
  });
});
