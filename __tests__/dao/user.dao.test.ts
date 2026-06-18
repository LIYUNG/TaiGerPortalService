// UserDAO unit tests — the DAO is a thin query-building layer over the Mongoose
// models, so we mock the models entirely (NO database, in-memory or otherwise).
// These assert that each DAO method builds the expected query/options and
// forwards the model's result. Real query/aggregation behaviour is covered by
// the integration suite (__tests__/integration), which runs against in-memory
// MongoDB on happy/unhappy paths only.
jest.mock('../../models', () => {
  const model = () => ({
    findById: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    find: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findByIdAndDelete: jest.fn(),
    countDocuments: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
    aggregate: jest.fn()
  });
  return {
    User: model(),
    Agent: model(),
    Editor: model(),
    Student: model(),
    Guest: model(),
    Documentthread: model(),
    Application: model(),
    Course: model(),
    Communication: model(),
    Complaint: model(),
    Event: model(),
    Interview: model(),
    surveyInput: model(),
    Ticket: model()
  };
});

import { Role } from '@taiger-common/core';
import {
  User,
  Agent,
  Editor,
  Student,
  Guest,
  Documentthread,
  Application,
  Course,
  Communication,
  Complaint,
  Event,
  Interview,
  surveyInput,
  Ticket
} from '../../models';
import UserDAO from '../../dao/user.dao';

// A query chain whose terminal `.lean()` resolves to `value`. Intermediate
// builder calls (select/sort/skip/limit) return the same chain so they compose.
const leanChain = (value) => {
  const chain = {
    select: jest.fn(() => chain),
    sort: jest.fn(() => chain),
    skip: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    populate: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(value)
  };
  return chain;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('UserDAO.parseUsersPaginationQuery (pure)', () => {
  it('applies defaults and clamps the limit', () => {
    const parsed = UserDAO.parseUsersPaginationQuery({});
    expect(parsed.page).toBe(1);
    expect(parsed.limit).toBe(20);
    expect(parsed.skip).toBe(0);

    const clamped = UserDAO.parseUsersPaginationQuery({ limit: '5000' });
    expect(clamped.limit).toBe(100);
  });

  it('computes skip and a desc sort with a firstname tiebreak', () => {
    const parsed = UserDAO.parseUsersPaginationQuery({
      page: '3',
      limit: '10',
      sortBy: 'lastname',
      sortOrder: 'desc'
    });
    expect(parsed.skip).toBe(20);
    expect(parsed.sort).toEqual({ lastname: -1, firstname: 1 });
  });

  it('falls back to lastname sort for a disallowed sortBy', () => {
    const parsed = UserDAO.parseUsersPaginationQuery({ sortBy: 'password' });
    expect(parsed.sort).toHaveProperty('lastname');
  });
});

describe('UserDAO (mocked models)', () => {
  it('getUserById queries by id and returns the lean doc', async () => {
    const doc = { _id: 'u1', firstname: 'A' };
    User.findById.mockReturnValue(leanChain(doc));

    const found = await UserDAO.getUserById('u1');

    expect(User.findById).toHaveBeenCalledWith('u1');
    expect(found).toBe(doc);
  });

  it('getUserByEmail queries by email and returns the lean doc', async () => {
    const doc = { _id: 'u2', email: 'x@y.z' };
    User.findOne.mockReturnValue(leanChain(doc));

    const found = await UserDAO.getUserByEmail('x@y.z');

    expect(User.findOne).toHaveBeenCalledWith({ email: 'x@y.z' });
    expect(found).toBe(doc);
  });

  it('getUsers forwards the filter to find().lean()', async () => {
    const docs = [{ role: 'Admin' }];
    User.find.mockReturnValue(leanChain(docs));

    const result = await UserDAO.getUsers({ role: 'Admin' });

    expect(User.find).toHaveBeenCalledWith({ role: 'Admin' });
    expect(result).toBe(docs);
  });

  it('findUsersByIds queries by _id $in with the projection (lean)', async () => {
    const docs = [{ _id: 'a' }, { _id: 'b' }];
    const chain = leanChain(docs);
    User.find.mockReturnValue(chain);

    const result = await UserDAO.findUsersByIds(['a', 'b'], 'email role');

    expect(User.find).toHaveBeenCalledWith({ _id: { $in: ['a', 'b'] } });
    expect(chain.select).toHaveBeenCalledWith('email role');
    expect(result).toBe(docs);
  });

  it('updateUser uses findByIdAndUpdate with { new: true } and returns the doc', async () => {
    const updated = { _id: 'u1', firstname: 'Renamed' };
    User.findByIdAndUpdate.mockReturnValue(leanChain(updated));

    const result = await UserDAO.updateUser('u1', { firstname: 'Renamed' });

    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
      'u1',
      { firstname: 'Renamed' },
      { new: true }
    );
    expect(result.firstname).toBe('Renamed');
  });

  it('updateOfficehours casts against the Agent discriminator (not base User)', async () => {
    const updated = { _id: 'u1', timezone: 'UTC' };
    Agent.findByIdAndUpdate.mockReturnValue(leanChain(updated));
    const payload = {
      officehours: { Monday: { active: true } },
      timezone: 'UTC'
    };

    const result = await UserDAO.updateOfficehours('u1', Role.Agent, payload);

    expect(Agent.findByIdAndUpdate).toHaveBeenCalledWith('u1', payload, {
      new: true
    });
    // The base User model must NOT be used — that path silently strips the
    // discriminator-only officehours/timezone fields.
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(result).toBe(updated);
  });

  it('updateOfficehours uses the Editor discriminator for editors', async () => {
    Editor.findByIdAndUpdate.mockReturnValue(leanChain({ _id: 'e1' }));
    const payload = { officehours: {}, timezone: 'CET' };

    await UserDAO.updateOfficehours('e1', Role.Editor, payload);

    expect(Editor.findByIdAndUpdate).toHaveBeenCalledWith('e1', payload, {
      new: true
    });
    expect(Agent.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('getUsersPaginated runs the page query + count and returns both', async () => {
    const users = [{ _id: 'a' }, { _id: 'b' }];
    User.find.mockReturnValue(leanChain(users));
    User.countDocuments.mockResolvedValue(7);

    const parsed = UserDAO.parseUsersPaginationQuery({ page: 1, limit: 2 });
    const res = await UserDAO.getUsersPaginated({ filter: {}, ...parsed });

    expect(res.users).toBe(users);
    expect(res.total).toBe(7);
    expect(res.page).toBe(1);
    expect(res.limit).toBe(2);
  });

  it('getUsersPaginated injects an $and search filter when search is set', async () => {
    User.find.mockReturnValue(leanChain([]));
    User.countDocuments.mockResolvedValue(0);

    const parsed = UserDAO.parseUsersPaginationQuery({ search: 'jane' });
    await UserDAO.getUsersPaginated({ filter: {}, ...parsed });

    const usedFilter = User.find.mock.calls[0][0];
    expect(usedFilter).toHaveProperty('$and');
    expect(usedFilter.$and[0].$or.some((c) => c.firstname)).toBe(true);
    expect(User.countDocuments).toHaveBeenCalledWith(usedFilter);
  });

  it('getUsersPaginated appends search onto an existing $and filter', async () => {
    User.find.mockReturnValue(leanChain([]));
    User.countDocuments.mockResolvedValue(0);

    const parsed = UserDAO.parseUsersPaginationQuery({ search: 'jane' });
    const existing = { $and: [{ role: 'Student' }] };
    await UserDAO.getUsersPaginated({ filter: existing, ...parsed });

    const usedFilter = User.find.mock.calls[0][0];
    // The pre-existing $and condition is preserved and the search group appended.
    expect(usedFilter.$and).toHaveLength(2);
    expect(usedFilter.$and[0]).toEqual({ role: 'Student' });
    expect(usedFilter.$and[1]).toHaveProperty('$or');
  });

  it('escapes regex metacharacters in the search term', async () => {
    User.find.mockReturnValue(leanChain([]));
    User.countDocuments.mockResolvedValue(0);

    const parsed = UserDAO.parseUsersPaginationQuery({ search: 'a.b*c' });
    await UserDAO.getUsersPaginated({ filter: {}, ...parsed });

    const usedFilter = User.find.mock.calls[0][0];
    expect(usedFilter.$and[0].$or[0].firstname.$regex).toBe('a\\.b\\*c');
  });

  it('updateUserDoc returns the live (non-lean) doc with default options', async () => {
    const live = { _id: 'u1', save: jest.fn() };
    User.findByIdAndUpdate.mockReturnValue(live);

    const result = await UserDAO.updateUserDoc('u1', { firstname: 'X' });

    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
      'u1',
      { firstname: 'X' },
      { new: true }
    );
    expect(result).toBe(live);
  });

  it('updateUserDoc forwards caller-supplied options', async () => {
    const live = { _id: 'u1' };
    User.findByIdAndUpdate.mockReturnValue(live);

    await UserDAO.updateUserDoc(
      'u1',
      { firstname: 'X' },
      { new: false, overwriteDiscriminatorKey: true }
    );

    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
      'u1',
      { firstname: 'X' },
      { new: false, overwriteDiscriminatorKey: true }
    );
  });

  it('getUserByFilter forwards the filter to findOne().lean()', async () => {
    const doc = { _id: 'u1' };
    User.findOne.mockReturnValue(leanChain(doc));

    const result = await UserDAO.getUserByFilter({ role: 'Agent' });

    expect(User.findOne).toHaveBeenCalledWith({ role: 'Agent' });
    expect(result).toBe(doc);
  });

  it('getUserDocByFilter returns the live findOne document', async () => {
    const live = { _id: 'u1', save: jest.fn() };
    User.findOne.mockReturnValue(live);

    const result = await UserDAO.getUserDocByFilter({ email: 'x@y.z' });

    expect(User.findOne).toHaveBeenCalledWith({ email: 'x@y.z' });
    expect(result).toBe(live);
  });

  it('createGuest creates on the Guest discriminator', async () => {
    const created = { _id: 'g1' };
    Guest.create.mockResolvedValue(created);

    const result = await UserDAO.createGuest({ email: 'g@x.z' });

    expect(Guest.create).toHaveBeenCalledWith({ email: 'g@x.z' });
    expect(result).toBe(created);
  });

  it('getUserByIdSelect applies the projection and returns the lean doc', async () => {
    const doc = { _id: 'u1' };
    const chain = leanChain(doc);
    User.findById.mockReturnValue(chain);

    const result = await UserDAO.getUserByIdSelect('u1', 'firstname email');

    expect(User.findById).toHaveBeenCalledWith('u1');
    expect(chain.select).toHaveBeenCalledWith('firstname email');
    expect(result).toBe(doc);
  });

  it('getUserDocWithPasswordByEmail selects +password (live doc)', async () => {
    const live = { _id: 'u1', verifyPassword: jest.fn() };
    const chain = { select: jest.fn().mockReturnValue(live) };
    User.findOne.mockReturnValue(chain);

    const result = await UserDAO.getUserDocWithPasswordByEmail('x@y.z');

    expect(User.findOne).toHaveBeenCalledWith({ email: 'x@y.z' });
    expect(chain.select).toHaveBeenCalledWith('+password');
    expect(result).toBe(live);
  });

  it('touchLastLoginByEmail updates lastLoginAt without upsert', async () => {
    const res = { email: 'x@y.z' };
    User.findOneAndUpdate.mockResolvedValue(res);

    const result = await UserDAO.touchLastLoginByEmail('x@y.z');

    expect(User.findOneAndUpdate).toHaveBeenCalledWith(
      { email: 'x@y.z' },
      { lastLoginAt: expect.any(Date) },
      { upsert: false }
    );
    expect(result).toBe(res);
  });

  it('touchLastLoginById updates lastLoginAt with upsert', async () => {
    const res = { _id: 'u1' };
    User.findByIdAndUpdate.mockResolvedValue(res);

    const result = await UserDAO.touchLastLoginById('u1');

    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
      'u1',
      { lastLoginAt: expect.any(Date) },
      { upsert: true }
    );
    expect(result).toBe(res);
  });

  it('findAgents queries the Agent discriminator with select', async () => {
    const docs = [{ _id: 'a1' }];
    const chain = { select: jest.fn().mockReturnValue(docs) };
    Agent.find.mockReturnValue(chain);

    const result = await UserDAO.findAgents({ archiv: false }, 'firstname');

    expect(Agent.find).toHaveBeenCalledWith({ archiv: false });
    expect(chain.select).toHaveBeenCalledWith('firstname');
    expect(result).toBe(docs);
  });

  it('findEditors queries the Editor discriminator with select', async () => {
    const docs = [{ _id: 'e1' }];
    const chain = { select: jest.fn().mockReturnValue(docs) };
    Editor.find.mockReturnValue(chain);

    const result = await UserDAO.findEditors({ archiv: false }, 'lastname');

    expect(Editor.find).toHaveBeenCalledWith({ archiv: false });
    expect(chain.select).toHaveBeenCalledWith('lastname');
    expect(result).toBe(docs);
  });

  it('findAgentById queries Agent.findById with select', async () => {
    const doc = { _id: 'a1' };
    const chain = { select: jest.fn().mockReturnValue(doc) };
    Agent.findById.mockReturnValue(chain);

    const result = await UserDAO.findAgentById('a1', 'firstname');

    expect(Agent.findById).toHaveBeenCalledWith('a1');
    expect(chain.select).toHaveBeenCalledWith('firstname');
    expect(result).toBe(doc);
  });

  it('getUserDocById returns the live User document', async () => {
    const live = { _id: 'u1', save: jest.fn() };
    User.findById.mockReturnValue(live);

    const result = await UserDAO.getUserDocById('u1');

    expect(User.findById).toHaveBeenCalledWith('u1');
    expect(result).toBe(live);
  });

  it('getAgentDocById returns the live Agent document', async () => {
    const live = { _id: 'a1', save: jest.fn() };
    Agent.findById.mockReturnValue(live);

    const result = await UserDAO.getAgentDocById('a1');

    expect(Agent.findById).toHaveBeenCalledWith('a1');
    expect(result).toBe(live);
  });

  it('createUser uses the Student discriminator for the Student role', async () => {
    const created = { _id: 's1' };
    Student.create.mockResolvedValue(created);

    const result = await UserDAO.createUser(Role.Student, { firstname: 'S' });

    expect(Student.create).toHaveBeenCalledWith({ firstname: 'S' });
    expect(User.create).not.toHaveBeenCalled();
    expect(result).toBe(created);
  });

  it('createUser uses the base User model for non-Student roles', async () => {
    const created = { _id: 'a1' };
    User.create.mockResolvedValue(created);

    const result = await UserDAO.createUser(Role.Agent, { firstname: 'A' });

    expect(User.create).toHaveBeenCalledWith({ firstname: 'A' });
    expect(Student.create).not.toHaveBeenCalled();
    expect(result).toBe(created);
  });

  it('updateUserWithOptions forwards options and returns the lean doc', async () => {
    const updated = { _id: 'u1' };
    const chain = leanChain(updated);
    User.findByIdAndUpdate.mockReturnValue(chain);

    const opts = { new: true, overwriteDiscriminatorKey: true };
    const result = await UserDAO.updateUserWithOptions(
      'u1',
      { role: 'Agent' },
      opts
    );

    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
      'u1',
      { role: 'Agent' },
      opts
    );
    expect(result).toBe(updated);
  });

  it('updateUserArchiv updates archiv, populates editors and returns lean', async () => {
    const updated = { _id: 'u1', archiv: true };
    const chain = leanChain(updated);
    User.findByIdAndUpdate.mockReturnValue(chain);

    const result = await UserDAO.updateUserArchiv('u1', true);

    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
      'u1',
      { archiv: true },
      { new: true, strict: false }
    );
    expect(chain.populate).toHaveBeenCalledWith('editors');
    expect(result).toBe(updated);
  });

  it('deleteUserById forwards the id to findByIdAndDelete', async () => {
    const deleted = { _id: 'u1' };
    User.findByIdAndDelete.mockResolvedValue(deleted);

    const result = await UserDAO.deleteUserById('u1');

    expect(User.findByIdAndDelete).toHaveBeenCalledWith('u1');
    expect(result).toBe(deleted);
  });

  it('pullStaffFromStudents pulls the user from agents/editors arrays', async () => {
    const res = { modifiedCount: 2 };
    Student.updateMany.mockResolvedValue(res);

    const result = await UserDAO.pullStaffFromStudents('u1');

    expect(Student.updateMany).toHaveBeenCalledWith(
      { $or: [{ agents: 'u1' }, { editors: 'u1' }] },
      { $pull: { agents: 'u1', editors: 'u1' } },
      { multi: true }
    );
    expect(result).toBe(res);
  });

  it('deleteStudentCascade deletes all owned documents then the user', async () => {
    Documentthread.deleteMany.mockResolvedValue({});
    Application.deleteMany.mockResolvedValue({});
    Course.deleteMany.mockResolvedValue({});
    Communication.deleteMany.mockResolvedValue({});
    Complaint.deleteMany.mockResolvedValue({});
    Event.deleteMany.mockResolvedValue({});
    Interview.deleteMany.mockResolvedValue({});
    surveyInput.deleteMany.mockResolvedValue({});
    Ticket.deleteMany.mockResolvedValue({});
    User.findByIdAndDelete.mockResolvedValue({});

    await UserDAO.deleteStudentCascade('s1');

    expect(Documentthread.deleteMany).toHaveBeenCalledWith({
      student_id: 's1'
    });
    expect(Application.deleteMany).toHaveBeenCalledWith({ studentId: 's1' });
    expect(Course.deleteMany).toHaveBeenCalledWith({ student_id: 's1' });
    expect(Communication.deleteMany).toHaveBeenCalledWith({ student_id: 's1' });
    expect(Complaint.deleteMany).toHaveBeenCalledWith({ requester_id: 's1' });
    expect(Event.deleteMany).toHaveBeenCalledWith({ requester_id: 's1' });
    expect(Interview.deleteMany).toHaveBeenCalledWith({ student_id: 's1' });
    expect(surveyInput.deleteMany).toHaveBeenCalledWith({ studentId: 's1' });
    expect(Ticket.deleteMany).toHaveBeenCalledWith({ requester_id: 's1' });
    expect(User.findByIdAndDelete).toHaveBeenCalledWith('s1');
  });

  it('getUserRoleCounts returns the first aggregation row when present', async () => {
    const counts = {
      totalUsers: 10,
      adminCount: 1,
      agentCount: 2,
      editorCount: 3,
      studentCount: 4,
      guestCount: 0,
      externalCount: 0
    };
    User.aggregate.mockResolvedValue([counts]);

    const result = await UserDAO.getUserRoleCounts();

    expect(User.aggregate).toHaveBeenCalledTimes(1);
    expect(result).toBe(counts);
  });

  it('getUserRoleCounts returns all-zero counts when the aggregation is empty', async () => {
    User.aggregate.mockResolvedValue([]);

    const result = await UserDAO.getUserRoleCounts();

    expect(result).toEqual({
      totalUsers: 0,
      adminCount: 0,
      agentCount: 0,
      editorCount: 0,
      studentCount: 0,
      guestCount: 0,
      externalCount: 0
    });
  });

  it('getUsersOverview runs the five Student aggregations and maps them by name', async () => {
    Student.aggregate
      .mockResolvedValueOnce([{ degree: 'Master', count: 3 }])
      .mockResolvedValueOnce([{ semester: 'WS', count: 2 }])
      .mockResolvedValueOnce([{ field: 'CS', count: 5 }])
      .mockResolvedValueOnce([{ language: 'English', count: 4 }])
      .mockResolvedValueOnce([{ university: 'TUM', count: 1 }]);

    const result = await UserDAO.getUsersOverview();

    expect(Student.aggregate).toHaveBeenCalledTimes(5);
    expect(result).toEqual({
      byTargetDegree: [{ degree: 'Master', count: 3 }],
      byApplicationSemester: [{ semester: 'WS', count: 2 }],
      byTargetField: [{ field: 'CS', count: 5 }],
      byProgramLanguage: [{ language: 'English', count: 4 }],
      byUniversityProgram: [{ university: 'TUM', count: 1 }]
    });
  });
});
