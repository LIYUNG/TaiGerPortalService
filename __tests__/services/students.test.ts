// StudentService is the business/orchestration layer for students; today its
// methods are thin pass-throughs to StudentDAO. This is a UNIT test: the DAO is
// mocked so no database is touched. Each test asserts the right DAO method is
// called once with the exact args and that the service returns the DAO's result
// unchanged.
//
// NOTE: getStudentsPaginated is covered separately by
// __tests__/services/studentsPaginated.test.js and is intentionally skipped
// here.
jest.mock('../../dao/student.dao');

import StudentDAO from '../../dao/student.dao';
import StudentService from '../../services/students';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('StudentService (mocked DAO) — fetch/get with default-arg delegators', () => {
  it('fetchStudents forwards filter+options and returns DAO result', () => {
    const filter = { role: 'Student' };
    const options = { lean: true };
    const daoResult = [{ _id: 's1' }];
    StudentDAO.fetchStudents.mockReturnValue(daoResult);

    const result = StudentService.fetchStudents(filter, options);

    expect(StudentDAO.fetchStudents).toHaveBeenCalledTimes(1);
    expect(StudentDAO.fetchStudents).toHaveBeenCalledWith(filter, options);
    expect(result).toBe(daoResult);
  });

  it('fetchStudents defaults filter and options to {} when omitted', () => {
    const daoResult = [];
    StudentDAO.fetchStudents.mockReturnValue(daoResult);

    const result = StudentService.fetchStudents();

    expect(StudentDAO.fetchStudents).toHaveBeenCalledWith({}, {});
    expect(result).toBe(daoResult);
  });

  it('fetchSimpleStudents delegates with filter', () => {
    const filter = { archiv: false };
    const daoResult = [{ _id: 's1' }];
    StudentDAO.fetchSimpleStudents.mockReturnValue(daoResult);

    const result = StudentService.fetchSimpleStudents(filter);

    expect(StudentDAO.fetchSimpleStudents).toHaveBeenCalledTimes(1);
    expect(StudentDAO.fetchSimpleStudents).toHaveBeenCalledWith(filter);
    expect(result).toBe(daoResult);
  });

  it('fetchStudentIds delegates with filter', () => {
    const filter = { archiv: false };
    const daoResult = [{ _id: 's1' }];
    StudentDAO.fetchStudentIds.mockReturnValue(daoResult);

    const result = StudentService.fetchStudentIds(filter);

    expect(StudentDAO.fetchStudentIds).toHaveBeenCalledTimes(1);
    expect(StudentDAO.fetchStudentIds).toHaveBeenCalledWith(filter);
    expect(result).toBe(daoResult);
  });

  it('getStudents forwards { filter, options } and returns DAO result', () => {
    const filter = { role: 'Student' };
    const options = { sort: { name: 1 } };
    const daoResult = [{ _id: 's1' }];
    StudentDAO.getStudents.mockReturnValue(daoResult);

    const result = StudentService.getStudents({ filter, options });

    expect(StudentDAO.getStudents).toHaveBeenCalledTimes(1);
    expect(StudentDAO.getStudents).toHaveBeenCalledWith({ filter, options });
    expect(result).toBe(daoResult);
  });

  it('getStudents defaults filter and options to {} when omitted', () => {
    const daoResult = [];
    StudentDAO.getStudents.mockReturnValue(daoResult);

    const result = StudentService.getStudents({});

    expect(StudentDAO.getStudents).toHaveBeenCalledWith({
      filter: {},
      options: {}
    });
    expect(result).toBe(daoResult);
  });
});

describe('StudentService (mocked DAO) — single-id getters', () => {
  const idGetters = [
    'getStudentById',
    'getStudentByIdLean',
    'getStudentDocById',
    'getStudentByIdWithAgents',
    'getStudentByIdWithTeam',
    'getStudentByIdWithDocThreads',
    'getStudentApplicationsForIntervals'
  ];

  idGetters.forEach((method) => {
    it(`${method} delegates to DAO.${method} with id`, () => {
      const id = 's1';
      const daoResult = { _id: 's1', method };
      StudentDAO[method].mockReturnValue(daoResult);

      const result = StudentService[method](id);

      expect(StudentDAO[method]).toHaveBeenCalledTimes(1);
      expect(StudentDAO[method]).toHaveBeenCalledWith(id);
      expect(result).toBe(daoResult);
    });
  });
});

describe('StudentService (mocked DAO) — populated getters', () => {
  it('getStudentByIdPopulated forwards id + populates and defaults populates to []', () => {
    const daoResult = { _id: 's1' };
    StudentDAO.getStudentByIdPopulated.mockReturnValue(daoResult);

    const withPopulates = StudentService.getStudentByIdPopulated('s1', [
      'agents'
    ]);
    expect(StudentDAO.getStudentByIdPopulated).toHaveBeenCalledWith('s1', [
      'agents'
    ]);
    expect(withPopulates).toBe(daoResult);

    StudentService.getStudentByIdPopulated('s2');
    expect(StudentDAO.getStudentByIdPopulated).toHaveBeenLastCalledWith(
      's2',
      []
    );
    expect(StudentDAO.getStudentByIdPopulated).toHaveBeenCalledTimes(2);
  });

  it('getStudentDocByIdPopulated forwards id + populates and defaults populates to []', () => {
    const daoResult = { _id: 's1' };
    StudentDAO.getStudentDocByIdPopulated.mockReturnValue(daoResult);

    const withPopulates = StudentService.getStudentDocByIdPopulated('s1', [
      'editors'
    ]);
    expect(StudentDAO.getStudentDocByIdPopulated).toHaveBeenCalledWith('s1', [
      'editors'
    ]);
    expect(withPopulates).toBe(daoResult);

    StudentService.getStudentDocByIdPopulated('s2');
    expect(StudentDAO.getStudentDocByIdPopulated).toHaveBeenLastCalledWith(
      's2',
      []
    );
  });

  it('getStudentByIdSelect delegates with id + select', () => {
    const daoResult = { _id: 's1' };
    StudentDAO.getStudentByIdSelect.mockReturnValue(daoResult);

    const result = StudentService.getStudentByIdSelect('s1', 'firstname');

    expect(StudentDAO.getStudentByIdSelect).toHaveBeenCalledTimes(1);
    expect(StudentDAO.getStudentByIdSelect).toHaveBeenCalledWith(
      's1',
      'firstname'
    );
    expect(result).toBe(daoResult);
  });

  it('getStudentByIdSelectPopulated forwards id, select, populate, populateSelect', () => {
    const daoResult = { _id: 's1' };
    StudentDAO.getStudentByIdSelectPopulated.mockReturnValue(daoResult);

    const result = StudentService.getStudentByIdSelectPopulated(
      's1',
      'firstname',
      'agents',
      'lastname'
    );

    expect(StudentDAO.getStudentByIdSelectPopulated).toHaveBeenCalledTimes(1);
    expect(StudentDAO.getStudentByIdSelectPopulated).toHaveBeenCalledWith(
      's1',
      'firstname',
      'agents',
      'lastname'
    );
    expect(result).toBe(daoResult);
  });
});

describe('StudentService (mocked DAO) — updates', () => {
  it('updateStudentByFilter delegates with filter + update', () => {
    const filter = { _id: 's1' };
    const update = { $set: { archiv: true } };
    const daoResult = { modifiedCount: 1 };
    StudentDAO.updateStudentByFilter.mockReturnValue(daoResult);

    const result = StudentService.updateStudentByFilter(filter, update);

    expect(StudentDAO.updateStudentByFilter).toHaveBeenCalledTimes(1);
    expect(StudentDAO.updateStudentByFilter).toHaveBeenCalledWith(
      filter,
      update
    );
    expect(result).toBe(daoResult);
  });

  it('updateStudentByIdRaw delegates with id + update', () => {
    const update = { $set: { firstname: 'Jane' } };
    const daoResult = { _id: 's1' };
    StudentDAO.updateStudentByIdRaw.mockReturnValue(daoResult);

    const result = StudentService.updateStudentByIdRaw('s1', update);

    expect(StudentDAO.updateStudentByIdRaw).toHaveBeenCalledTimes(1);
    expect(StudentDAO.updateStudentByIdRaw).toHaveBeenCalledWith('s1', update);
    expect(result).toBe(daoResult);
  });

  it('updateStudentById delegates with id + update', () => {
    const update = { firstname: 'Jane' };
    const daoResult = { _id: 's1', firstname: 'Jane' };
    StudentDAO.updateStudentById.mockReturnValue(daoResult);

    const result = StudentService.updateStudentById('s1', update);

    expect(StudentDAO.updateStudentById).toHaveBeenCalledTimes(1);
    expect(StudentDAO.updateStudentById).toHaveBeenCalledWith('s1', update);
    expect(result).toBe(daoResult);
  });
});

describe('StudentService (mocked DAO) — filter-based finders with default {}', () => {
  const filterFinders = [
    'findStudents',
    'findStudentsWithTeamNames',
    'countStudents'
  ];

  filterFinders.forEach((method) => {
    it(`${method} forwards filter and defaults it to {}`, () => {
      const filter = { archiv: false };
      const daoResult = { method };
      StudentDAO[method].mockReturnValue(daoResult);

      const withFilter = StudentService[method](filter);
      expect(StudentDAO[method]).toHaveBeenCalledWith(filter);
      expect(withFilter).toBe(daoResult);

      StudentService[method]();
      expect(StudentDAO[method]).toHaveBeenLastCalledWith({});
      expect(StudentDAO[method]).toHaveBeenCalledTimes(2);
    });
  });

  it('findStudentsSelect forwards filter, select, limit and applies defaults', () => {
    const daoResult = [{ _id: 's1' }];
    StudentDAO.findStudentsSelect.mockReturnValue(daoResult);

    const result = StudentService.findStudentsSelect(
      { archiv: false },
      'firstname',
      10
    );
    expect(StudentDAO.findStudentsSelect).toHaveBeenCalledWith(
      { archiv: false },
      'firstname',
      10
    );
    expect(result).toBe(daoResult);

    StudentService.findStudentsSelect();
    expect(StudentDAO.findStudentsSelect).toHaveBeenLastCalledWith(
      {},
      '',
      undefined
    );
  });

  it('searchStudentsByText delegates with filter, select, limit', () => {
    const filter = { $text: { $search: 'john' } };
    const daoResult = [{ _id: 's1' }];
    StudentDAO.searchStudentsByText.mockReturnValue(daoResult);

    const result = StudentService.searchStudentsByText(filter, 'firstname', 5);

    expect(StudentDAO.searchStudentsByText).toHaveBeenCalledTimes(1);
    expect(StudentDAO.searchStudentsByText).toHaveBeenCalledWith(
      filter,
      'firstname',
      5
    );
    expect(result).toBe(daoResult);
  });
});

describe('StudentService (mocked DAO) — communication/course/expense aggregations', () => {
  it('getStudentsWithLatestCommunication delegates with no args', () => {
    const daoResult = [{ _id: 's1' }];
    StudentDAO.getStudentsWithLatestCommunication.mockReturnValue(daoResult);

    const result = StudentService.getStudentsWithLatestCommunication();

    expect(StudentDAO.getStudentsWithLatestCommunication).toHaveBeenCalledTimes(
      1
    );
    expect(
      StudentDAO.getStudentsWithLatestCommunication
    ).toHaveBeenCalledWith();
    expect(result).toBe(daoResult);
  });

  it('getUnreadCommunicationStudents delegates with studentIds + userId', () => {
    const studentIds = ['s1', 's2'];
    const userId = 'u1';
    const daoResult = [{ _id: 's1' }];
    StudentDAO.getUnreadCommunicationStudents.mockReturnValue(daoResult);

    const result = StudentService.getUnreadCommunicationStudents(
      studentIds,
      userId
    );

    expect(StudentDAO.getUnreadCommunicationStudents).toHaveBeenCalledTimes(1);
    expect(StudentDAO.getUnreadCommunicationStudents).toHaveBeenCalledWith(
      studentIds,
      userId
    );
    expect(result).toBe(daoResult);
  });

  it('getStudentsWithLatestCommunicationSorted delegates with studentIds', () => {
    const studentIds = ['s1'];
    const daoResult = [{ _id: 's1' }];
    StudentDAO.getStudentsWithLatestCommunicationSorted.mockReturnValue(
      daoResult
    );

    const result =
      StudentService.getStudentsWithLatestCommunicationSorted(studentIds);

    expect(
      StudentDAO.getStudentsWithLatestCommunicationSorted
    ).toHaveBeenCalledTimes(1);
    expect(
      StudentDAO.getStudentsWithLatestCommunicationSorted
    ).toHaveBeenCalledWith(studentIds);
    expect(result).toBe(daoResult);
  });

  it('getStudentsWithCourses delegates with no args', () => {
    const daoResult = [{ _id: 's1' }];
    StudentDAO.getStudentsWithCourses.mockReturnValue(daoResult);

    const result = StudentService.getStudentsWithCourses();

    expect(StudentDAO.getStudentsWithCourses).toHaveBeenCalledTimes(1);
    expect(StudentDAO.getStudentsWithCourses).toHaveBeenCalledWith();
    expect(result).toBe(daoResult);
  });

  it('getStudentsWithCoursesAndAgents delegates with no args', () => {
    const daoResult = [{ _id: 's1' }];
    StudentDAO.getStudentsWithCoursesAndAgents.mockReturnValue(daoResult);

    const result = StudentService.getStudentsWithCoursesAndAgents();

    expect(StudentDAO.getStudentsWithCoursesAndAgents).toHaveBeenCalledTimes(1);
    expect(StudentDAO.getStudentsWithCoursesAndAgents).toHaveBeenCalledWith();
    expect(result).toBe(daoResult);
  });

  it('getStudentsForDocumentThreadIntervals delegates with filter', () => {
    const filter = { archiv: false };
    const daoResult = [{ _id: 's1' }];
    StudentDAO.getStudentsForDocumentThreadIntervals.mockReturnValue(daoResult);

    const result = StudentService.getStudentsForDocumentThreadIntervals(filter);

    expect(
      StudentDAO.getStudentsForDocumentThreadIntervals
    ).toHaveBeenCalledTimes(1);
    expect(
      StudentDAO.getStudentsForDocumentThreadIntervals
    ).toHaveBeenCalledWith(filter);
    expect(result).toBe(daoResult);
  });

  it('getTaigerUsersWithExpenses delegates with no args', () => {
    const daoResult = [{ _id: 'u1' }];
    StudentDAO.getTaigerUsersWithExpenses.mockReturnValue(daoResult);

    const result = StudentService.getTaigerUsersWithExpenses();

    expect(StudentDAO.getTaigerUsersWithExpenses).toHaveBeenCalledTimes(1);
    expect(StudentDAO.getTaigerUsersWithExpenses).toHaveBeenCalledWith();
    expect(result).toBe(daoResult);
  });

  it('getStudentsWithExpenses delegates with no args', () => {
    const daoResult = [{ _id: 's1' }];
    StudentDAO.getStudentsWithExpenses.mockReturnValue(daoResult);

    const result = StudentService.getStudentsWithExpenses();

    expect(StudentDAO.getStudentsWithExpenses).toHaveBeenCalledTimes(1);
    expect(StudentDAO.getStudentsWithExpenses).toHaveBeenCalledWith();
    expect(result).toBe(daoResult);
  });

  it('getStudentsForExpenses delegates with filter', () => {
    const filter = { archiv: false };
    const daoResult = [{ _id: 's1' }];
    StudentDAO.getStudentsForExpenses.mockReturnValue(daoResult);

    const result = StudentService.getStudentsForExpenses(filter);

    expect(StudentDAO.getStudentsForExpenses).toHaveBeenCalledTimes(1);
    expect(StudentDAO.getStudentsForExpenses).toHaveBeenCalledWith(filter);
    expect(result).toBe(daoResult);
  });

  it('getStudentsWithApplications delegates with filter', () => {
    const filter = { archiv: false };
    const daoResult = [{ _id: 's1' }];
    StudentDAO.getStudentsWithApplications.mockReturnValue(daoResult);

    const result = StudentService.getStudentsWithApplications(filter);

    expect(StudentDAO.getStudentsWithApplications).toHaveBeenCalledTimes(1);
    expect(StudentDAO.getStudentsWithApplications).toHaveBeenCalledWith(filter);
    expect(result).toBe(daoResult);
  });
});
