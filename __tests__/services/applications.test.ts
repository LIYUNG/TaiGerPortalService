// ApplicationService methods are thin pass-throughs to ApplicationDAO. This is a
// UNIT test: the DAO is mocked so no database (in-memory or otherwise) is
// touched. Each test asserts the service delegates to the right DAO method with
// the exact args and returns the DAO's (mocked) value. The two methods with
// service-side argument defaulting (getActiveStudentsApplicationsPaginated,
// getActiveStudentsApplicationsDeadlineDistribution, getApplicationProgramsUpdateStatus,
// getApplicationStatusStats, getApplications) also have a test for the defaults.
jest.mock('../../dao/application.dao');

import ApplicationDAO from '../../dao/application.dao';
import ApplicationService from '../../services/applications';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ApplicationService.createApplication (mocked DAO)', () => {
  it('delegates to DAO.createApplication with studentId+programId and returns its result', () => {
    const daoResult = { _id: 'a1' };
    ApplicationDAO.createApplication.mockReturnValue(daoResult);

    const result = ApplicationService.createApplication('s1', 'p1');

    expect(ApplicationDAO.createApplication).toHaveBeenCalledTimes(1);
    expect(ApplicationDAO.createApplication).toHaveBeenCalledWith('s1', 'p1');
    expect(result).toBe(daoResult);
  });
});

describe('ApplicationService.getActiveStudentsApplicationsPaginated (mocked DAO)', () => {
  it('delegates to DAO with studentIds+query and returns its result', () => {
    const studentIds = ['s1', 's2'];
    const query = { page: '1' };
    const daoResult = { applications: [], total: 0 };
    ApplicationDAO.getActiveStudentsApplicationsPaginated.mockReturnValue(
      daoResult
    );

    const result = ApplicationService.getActiveStudentsApplicationsPaginated({
      studentIds,
      query
    });

    expect(
      ApplicationDAO.getActiveStudentsApplicationsPaginated
    ).toHaveBeenCalledTimes(1);
    expect(
      ApplicationDAO.getActiveStudentsApplicationsPaginated
    ).toHaveBeenCalledWith({ studentIds, query });
    expect(result).toBe(daoResult);
  });

  it('defaults studentIds and query to empty when omitted', () => {
    const daoResult = { applications: [], total: 0 };
    ApplicationDAO.getActiveStudentsApplicationsPaginated.mockReturnValue(
      daoResult
    );

    const result = ApplicationService.getActiveStudentsApplicationsPaginated(
      {}
    );

    expect(
      ApplicationDAO.getActiveStudentsApplicationsPaginated
    ).toHaveBeenCalledWith({ studentIds: [], query: {} });
    expect(result).toBe(daoResult);
  });
});

describe('ApplicationService.getActiveStudentsApplicationsDeadlineDistribution (mocked DAO)', () => {
  it('delegates to DAO with studentIds and returns its result', () => {
    const studentIds = ['s1'];
    const daoResult = [{ _id: '2026-01', count: 3 }];
    ApplicationDAO.getActiveStudentsApplicationsDeadlineDistribution.mockReturnValue(
      daoResult
    );

    const result =
      ApplicationService.getActiveStudentsApplicationsDeadlineDistribution({
        studentIds
      });

    expect(
      ApplicationDAO.getActiveStudentsApplicationsDeadlineDistribution
    ).toHaveBeenCalledTimes(1);
    expect(
      ApplicationDAO.getActiveStudentsApplicationsDeadlineDistribution
    ).toHaveBeenCalledWith({ studentIds });
    expect(result).toBe(daoResult);
  });

  it('defaults studentIds to empty array when omitted', () => {
    const daoResult = [];
    ApplicationDAO.getActiveStudentsApplicationsDeadlineDistribution.mockReturnValue(
      daoResult
    );

    ApplicationService.getActiveStudentsApplicationsDeadlineDistribution({});

    expect(
      ApplicationDAO.getActiveStudentsApplicationsDeadlineDistribution
    ).toHaveBeenCalledWith({ studentIds: [] });
  });
});

describe('ApplicationService.getApplicationProgramsUpdateStatus (mocked DAO)', () => {
  it('delegates to DAO with studentIds+decided and returns its result', () => {
    const studentIds = ['s1'];
    const daoResult = [{ _id: 'p1' }];
    ApplicationDAO.getApplicationProgramsUpdateStatus.mockReturnValue(
      daoResult
    );

    const result = ApplicationService.getApplicationProgramsUpdateStatus({
      studentIds,
      decided: 'O'
    });

    expect(
      ApplicationDAO.getApplicationProgramsUpdateStatus
    ).toHaveBeenCalledTimes(1);
    expect(
      ApplicationDAO.getApplicationProgramsUpdateStatus
    ).toHaveBeenCalledWith({ studentIds, decided: 'O' });
    expect(result).toBe(daoResult);
  });

  it('defaults studentIds to empty array and forwards undefined decided', () => {
    const daoResult = [];
    ApplicationDAO.getApplicationProgramsUpdateStatus.mockReturnValue(
      daoResult
    );

    ApplicationService.getApplicationProgramsUpdateStatus({});

    expect(
      ApplicationDAO.getApplicationProgramsUpdateStatus
    ).toHaveBeenCalledWith({ studentIds: [], decided: undefined });
  });
});

describe('ApplicationService.getApplicationStatusStats (mocked DAO)', () => {
  it('delegates to DAO with studentIds and returns its result', () => {
    const studentIds = ['s1'];
    const daoResult = { open: 1 };
    ApplicationDAO.getApplicationStatusStats.mockReturnValue(daoResult);

    const result = ApplicationService.getApplicationStatusStats({ studentIds });

    expect(ApplicationDAO.getApplicationStatusStats).toHaveBeenCalledTimes(1);
    expect(ApplicationDAO.getApplicationStatusStats).toHaveBeenCalledWith({
      studentIds
    });
    expect(result).toBe(daoResult);
  });

  it('defaults studentIds to empty array when omitted', () => {
    ApplicationDAO.getApplicationStatusStats.mockReturnValue({});

    ApplicationService.getApplicationStatusStats({});

    expect(ApplicationDAO.getApplicationStatusStats).toHaveBeenCalledWith({
      studentIds: []
    });
  });
});

describe('ApplicationService.getApplications (mocked DAO)', () => {
  it('delegates to DAO with filter+select+populate and returns its result', () => {
    const filter = { student_id: 's1' };
    const select = ['programId'];
    const daoResult = [{ _id: 'a1' }];
    ApplicationDAO.getApplications.mockReturnValue(daoResult);

    const result = ApplicationService.getApplications(filter, select, false);

    expect(ApplicationDAO.getApplications).toHaveBeenCalledTimes(1);
    expect(ApplicationDAO.getApplications).toHaveBeenCalledWith(
      filter,
      select,
      false
    );
    expect(result).toBe(daoResult);
  });

  it('defaults filter={}, select=[], populate=true when omitted', () => {
    ApplicationDAO.getApplications.mockReturnValue([]);

    ApplicationService.getApplications();

    expect(ApplicationDAO.getApplications).toHaveBeenCalledWith({}, [], true);
  });
});

describe('ApplicationService.getApplicationsWithStudentDetails (mocked DAO)', () => {
  it('delegates to DAO with filter and returns its result', () => {
    const filter = { _id: 'a1' };
    const daoResult = [{ _id: 'a1' }];
    ApplicationDAO.getApplicationsWithStudentDetails.mockReturnValue(daoResult);

    const result = ApplicationService.getApplicationsWithStudentDetails(filter);

    expect(
      ApplicationDAO.getApplicationsWithStudentDetails
    ).toHaveBeenCalledTimes(1);
    expect(
      ApplicationDAO.getApplicationsWithStudentDetails
    ).toHaveBeenCalledWith(filter);
    expect(result).toBe(daoResult);
  });
});

describe('ApplicationService.getApplicationsByStudentId (mocked DAO)', () => {
  it('delegates to DAO with studentId and returns its result', () => {
    const daoResult = [{ _id: 'a1' }];
    ApplicationDAO.getApplicationsByStudentId.mockReturnValue(daoResult);

    const result = ApplicationService.getApplicationsByStudentId('s1');

    expect(ApplicationDAO.getApplicationsByStudentId).toHaveBeenCalledTimes(1);
    expect(ApplicationDAO.getApplicationsByStudentId).toHaveBeenCalledWith(
      's1'
    );
    expect(result).toBe(daoResult);
  });
});

describe('ApplicationService.createApplicationDoc (mocked DAO)', () => {
  it('delegates to DAO with payload and returns its result', () => {
    const payload = { student_id: 's1' };
    const daoResult = { _id: 'a1' };
    ApplicationDAO.createApplicationDoc.mockReturnValue(daoResult);

    const result = ApplicationService.createApplicationDoc(payload);

    expect(ApplicationDAO.createApplicationDoc).toHaveBeenCalledTimes(1);
    expect(ApplicationDAO.createApplicationDoc).toHaveBeenCalledWith(payload);
    expect(result).toBe(daoResult);
  });
});

describe('ApplicationService.findByStudentIdPopulatedBasic (mocked DAO)', () => {
  it('delegates to DAO with studentId and returns its result', () => {
    const daoResult = [{ _id: 'a1' }];
    ApplicationDAO.findByStudentIdPopulatedBasic.mockReturnValue(daoResult);

    const result = ApplicationService.findByStudentIdPopulatedBasic('s1');

    expect(ApplicationDAO.findByStudentIdPopulatedBasic).toHaveBeenCalledTimes(
      1
    );
    expect(ApplicationDAO.findByStudentIdPopulatedBasic).toHaveBeenCalledWith(
      's1'
    );
    expect(result).toBe(daoResult);
  });
});

describe('ApplicationService.findByStudentIdPopulatedFull (mocked DAO)', () => {
  it('delegates to DAO with studentId and returns its result', () => {
    const daoResult = [{ _id: 'a1' }];
    ApplicationDAO.findByStudentIdPopulatedFull.mockReturnValue(daoResult);

    const result = ApplicationService.findByStudentIdPopulatedFull('s1');

    expect(ApplicationDAO.findByStudentIdPopulatedFull).toHaveBeenCalledTimes(
      1
    );
    expect(ApplicationDAO.findByStudentIdPopulatedFull).toHaveBeenCalledWith(
      's1'
    );
    expect(result).toBe(daoResult);
  });
});

describe('ApplicationService.unlockApplication (mocked DAO)', () => {
  it('delegates to DAO with applicationId and returns its result', () => {
    const daoResult = { _id: 'a1', closed: '-' };
    ApplicationDAO.unlockApplication.mockReturnValue(daoResult);

    const result = ApplicationService.unlockApplication('a1');

    expect(ApplicationDAO.unlockApplication).toHaveBeenCalledTimes(1);
    expect(ApplicationDAO.unlockApplication).toHaveBeenCalledWith('a1');
    expect(result).toBe(daoResult);
  });
});

describe('ApplicationService.getApplicationDocByIdWithProgram (mocked DAO)', () => {
  it('delegates to DAO with applicationId and returns its result', () => {
    const daoResult = { _id: 'a1' };
    ApplicationDAO.getApplicationDocByIdWithProgram.mockReturnValue(daoResult);

    const result = ApplicationService.getApplicationDocByIdWithProgram('a1');

    expect(
      ApplicationDAO.getApplicationDocByIdWithProgram
    ).toHaveBeenCalledTimes(1);
    expect(
      ApplicationDAO.getApplicationDocByIdWithProgram
    ).toHaveBeenCalledWith('a1');
    expect(result).toBe(daoResult);
  });
});

describe('ApplicationService.getApplicationByIdWithStudentProgram (mocked DAO)', () => {
  it('delegates to DAO with applicationId and returns its result', () => {
    const daoResult = { _id: 'a1' };
    ApplicationDAO.getApplicationByIdWithStudentProgram.mockReturnValue(
      daoResult
    );

    const result =
      ApplicationService.getApplicationByIdWithStudentProgram('a1');

    expect(
      ApplicationDAO.getApplicationByIdWithStudentProgram
    ).toHaveBeenCalledTimes(1);
    expect(
      ApplicationDAO.getApplicationByIdWithStudentProgram
    ).toHaveBeenCalledWith('a1');
    expect(result).toBe(daoResult);
  });
});

describe('ApplicationService.aggregateApplications (mocked DAO)', () => {
  it('delegates to DAO with pipeline and returns its result', () => {
    const pipeline = [{ $match: {} }];
    const daoResult = [{ _id: 'a1' }];
    ApplicationDAO.aggregateApplications.mockReturnValue(daoResult);

    const result = ApplicationService.aggregateApplications(pipeline);

    expect(ApplicationDAO.aggregateApplications).toHaveBeenCalledTimes(1);
    expect(ApplicationDAO.aggregateApplications).toHaveBeenCalledWith(pipeline);
    expect(result).toBe(daoResult);
  });
});

describe('ApplicationService.findApplicationsSelectPopulate (mocked DAO)', () => {
  it('delegates to DAO with filter+select+populate and returns its result', () => {
    const filter = { student_id: 's1' };
    const select = 'programId';
    const populate = true;
    const daoResult = [{ _id: 'a1' }];
    ApplicationDAO.findApplicationsSelectPopulate.mockReturnValue(daoResult);

    const result = ApplicationService.findApplicationsSelectPopulate(
      filter,
      select,
      populate
    );

    expect(ApplicationDAO.findApplicationsSelectPopulate).toHaveBeenCalledTimes(
      1
    );
    expect(ApplicationDAO.findApplicationsSelectPopulate).toHaveBeenCalledWith(
      filter,
      select,
      populate
    );
    expect(result).toBe(daoResult);
  });
});

describe('ApplicationService.findByStudentIdLean (mocked DAO)', () => {
  it('delegates to DAO with studentId and returns its result', () => {
    const daoResult = [{ _id: 'a1' }];
    ApplicationDAO.findByStudentIdLean.mockReturnValue(daoResult);

    const result = ApplicationService.findByStudentIdLean('s1');

    expect(ApplicationDAO.findByStudentIdLean).toHaveBeenCalledTimes(1);
    expect(ApplicationDAO.findByStudentIdLean).toHaveBeenCalledWith('s1');
    expect(result).toBe(daoResult);
  });
});

describe('ApplicationService.findByStudentIdWithProgram (mocked DAO)', () => {
  it('delegates to DAO with studentId and returns its result', () => {
    const daoResult = [{ _id: 'a1' }];
    ApplicationDAO.findByStudentIdWithProgram.mockReturnValue(daoResult);

    const result = ApplicationService.findByStudentIdWithProgram('s1');

    expect(ApplicationDAO.findByStudentIdWithProgram).toHaveBeenCalledTimes(1);
    expect(ApplicationDAO.findByStudentIdWithProgram).toHaveBeenCalledWith(
      's1'
    );
    expect(result).toBe(daoResult);
  });
});

describe('ApplicationService.findConflictApplications (mocked DAO)', () => {
  it('delegates to DAO with filter and returns its result', () => {
    const filter = { decided: 'O' };
    const daoResult = [{ _id: 'a1' }];
    ApplicationDAO.findConflictApplications.mockReturnValue(daoResult);

    const result = ApplicationService.findConflictApplications(filter);

    expect(ApplicationDAO.findConflictApplications).toHaveBeenCalledTimes(1);
    expect(ApplicationDAO.findConflictApplications).toHaveBeenCalledWith(
      filter
    );
    expect(result).toBe(daoResult);
  });
});

describe('ApplicationService.pullDocModificationThread (mocked DAO)', () => {
  it('delegates to DAO with applicationId+threadId and returns its result', () => {
    const daoResult = { _id: 'a1' };
    ApplicationDAO.pullDocModificationThread.mockReturnValue(daoResult);

    const result = ApplicationService.pullDocModificationThread('a1', 't1');

    expect(ApplicationDAO.pullDocModificationThread).toHaveBeenCalledTimes(1);
    expect(ApplicationDAO.pullDocModificationThread).toHaveBeenCalledWith(
      'a1',
      't1'
    );
    expect(result).toBe(daoResult);
  });
});

describe('ApplicationService.getDecidedApplicationsByProgramPopulated (mocked DAO)', () => {
  it('delegates to DAO with programId and returns its result', () => {
    const daoResult = [{ _id: 'a1' }];
    ApplicationDAO.getDecidedApplicationsByProgramPopulated.mockReturnValue(
      daoResult
    );

    const result =
      ApplicationService.getDecidedApplicationsByProgramPopulated('p1');

    expect(
      ApplicationDAO.getDecidedApplicationsByProgramPopulated
    ).toHaveBeenCalledTimes(1);
    expect(
      ApplicationDAO.getDecidedApplicationsByProgramPopulated
    ).toHaveBeenCalledWith('p1');
    expect(result).toBe(daoResult);
  });
});

describe('ApplicationService.getApplicationsWithCredentialsByStudentId (mocked DAO)', () => {
  it('delegates to DAO with studentId and returns its result', () => {
    const daoResult = [{ _id: 'a1' }];
    ApplicationDAO.getApplicationsWithCredentialsByStudentId.mockReturnValue(
      daoResult
    );

    const result =
      ApplicationService.getApplicationsWithCredentialsByStudentId('s1');

    expect(
      ApplicationDAO.getApplicationsWithCredentialsByStudentId
    ).toHaveBeenCalledTimes(1);
    expect(
      ApplicationDAO.getApplicationsWithCredentialsByStudentId
    ).toHaveBeenCalledWith('s1');
    expect(result).toBe(daoResult);
  });
});

describe('ApplicationService.getApplicationsByProgramId (mocked DAO)', () => {
  it('delegates to DAO with programId and returns its result', () => {
    const daoResult = [{ _id: 'a1' }];
    ApplicationDAO.getApplicationsByProgramId.mockReturnValue(daoResult);

    const result = ApplicationService.getApplicationsByProgramId('p1');

    expect(ApplicationDAO.getApplicationsByProgramId).toHaveBeenCalledTimes(1);
    expect(ApplicationDAO.getApplicationsByProgramId).toHaveBeenCalledWith(
      'p1'
    );
    expect(result).toBe(daoResult);
  });
});

describe('ApplicationService.getApplicationById (mocked DAO)', () => {
  it('delegates to DAO with applicationId and returns its result', () => {
    const daoResult = { _id: 'a1' };
    ApplicationDAO.getApplicationById.mockReturnValue(daoResult);

    const result = ApplicationService.getApplicationById('a1');

    expect(ApplicationDAO.getApplicationById).toHaveBeenCalledTimes(1);
    expect(ApplicationDAO.getApplicationById).toHaveBeenCalledWith('a1');
    expect(result).toBe(daoResult);
  });
});

describe('ApplicationService.updateApplication (mocked DAO)', () => {
  it('delegates to DAO with filter+payload and returns its result', () => {
    const filter = { _id: 'a1' };
    const payload = { decided: 'O' };
    const daoResult = { _id: 'a1', decided: 'O' };
    ApplicationDAO.updateApplication.mockReturnValue(daoResult);

    const result = ApplicationService.updateApplication(filter, payload);

    expect(ApplicationDAO.updateApplication).toHaveBeenCalledTimes(1);
    expect(ApplicationDAO.updateApplication).toHaveBeenCalledWith(
      filter,
      payload
    );
    expect(result).toBe(daoResult);
  });
});

describe('ApplicationService.deleteApplication (mocked DAO)', () => {
  it('delegates to DAO with application_id and returns its result', () => {
    const daoResult = { deletedCount: 1 };
    ApplicationDAO.deleteApplication.mockReturnValue(daoResult);

    const result = ApplicationService.deleteApplication('a1');

    expect(ApplicationDAO.deleteApplication).toHaveBeenCalledTimes(1);
    expect(ApplicationDAO.deleteApplication).toHaveBeenCalledWith('a1');
    expect(result).toBe(daoResult);
  });
});

describe('ApplicationService.updateApplicationsBulk (mocked DAO)', () => {
  it('delegates to DAO with updates and returns its result', () => {
    const updates = [{ _id: 'a1' }];
    const daoResult = { modifiedCount: 1 };
    ApplicationDAO.updateApplicationsBulk.mockReturnValue(daoResult);

    const result = ApplicationService.updateApplicationsBulk(updates);

    expect(ApplicationDAO.updateApplicationsBulk).toHaveBeenCalledTimes(1);
    expect(ApplicationDAO.updateApplicationsBulk).toHaveBeenCalledWith(updates);
    expect(result).toBe(daoResult);
  });
});

describe('ApplicationService.getApplicationConflicts (mocked DAO)', () => {
  it('delegates to DAO.getApplicationConflicts and returns its result', () => {
    const daoResult = [{ _id: 'a1' }];
    ApplicationDAO.getApplicationConflicts.mockReturnValue(daoResult);

    const result = ApplicationService.getApplicationConflicts();

    expect(ApplicationDAO.getApplicationConflicts).toHaveBeenCalledTimes(1);
    expect(ApplicationDAO.getApplicationConflicts).toHaveBeenCalledWith();
    expect(result).toBe(daoResult);
  });
});

describe('ApplicationService.getAdmissionsStatusCounts (mocked DAO)', () => {
  it('delegates to DAO.getAdmissionsStatusCounts and returns its result', () => {
    const daoResult = { admitted: 1 };
    ApplicationDAO.getAdmissionsStatusCounts.mockReturnValue(daoResult);

    const result = ApplicationService.getAdmissionsStatusCounts();

    expect(ApplicationDAO.getAdmissionsStatusCounts).toHaveBeenCalledTimes(1);
    expect(ApplicationDAO.getAdmissionsStatusCounts).toHaveBeenCalledWith();
    expect(result).toBe(daoResult);
  });
});

describe('ApplicationService.getProgramApplicationCounts (mocked DAO)', () => {
  it('delegates to DAO.getProgramApplicationCounts and returns its result', () => {
    const daoResult = [{ _id: 'p1', count: 3 }];
    ApplicationDAO.getProgramApplicationCounts.mockReturnValue(daoResult);

    const result = ApplicationService.getProgramApplicationCounts();

    expect(ApplicationDAO.getProgramApplicationCounts).toHaveBeenCalledTimes(1);
    expect(ApplicationDAO.getProgramApplicationCounts).toHaveBeenCalledWith();
    expect(result).toBe(daoResult);
  });
});
