// Unit tests for services/ai-assist/studentAccess.getAccessibleStudentFilter.
// No DB. We mock utils/queryFunctions.getPermission and exercise each role
// branch using the real @taiger-common/core role predicates.

jest.mock('../../../utils/queryFunctions', () => ({
  getPermission: jest.fn()
}));

const { Role } = require('@taiger-common/core');
const { ManagerType } = require('../../../constants');
const { getPermission } = require('../../../utils/queryFunctions');
const {
  getAccessibleStudentFilter
} = require('../../../services/ai-assist/studentAccess');

const ACTIVE = {
  $or: [{ archiv: { $exists: false } }, { archiv: false }]
};

beforeEach(() => {
  jest.clearAllMocks();
  getPermission.mockResolvedValue({});
});

describe('getAccessibleStudentFilter', () => {
  it('returns the active-student filter for Admin without consulting permissions', async () => {
    const filter = await getAccessibleStudentFilter({
      user: { role: Role.Admin, _id: 'admin_1' }
    });
    expect(filter).toEqual(ACTIVE);
    expect(getPermission).not.toHaveBeenCalled();
  });

  it('returns the active-student filter when permission grants canAccessAllChat', async () => {
    getPermission.mockResolvedValue({ canAccessAllChat: true });
    const filter = await getAccessibleStudentFilter({
      user: { role: Role.Agent, _id: 'agent_1' }
    });
    expect(filter).toEqual(ACTIVE);
  });

  it('scopes an Agent to their own agents field', async () => {
    const filter = await getAccessibleStudentFilter({
      user: { role: Role.Agent, _id: 'agent_1' }
    });
    expect(filter).toEqual({ ...ACTIVE, agents: 'agent_1' });
  });

  it('scopes an Editor to their own editors field', async () => {
    const filter = await getAccessibleStudentFilter({
      user: { role: Role.Editor, _id: 'editor_1' }
    });
    expect(filter).toEqual({ ...ACTIVE, editors: 'editor_1' });
  });

  it('throws 403 for a Student role', async () => {
    await expect(
      getAccessibleStudentFilter({
        user: { role: Role.Student, _id: 'student_1' }
      })
    ).rejects.toMatchObject({ statusCode: 403, message: 'Permission denied' });
  });

  describe('Manager role', () => {
    it('builds an agents-only filter for a Manager managing agents', async () => {
      const filter = await getAccessibleStudentFilter({
        user: {
          role: Role.Manager,
          _id: 'mgr_1',
          manager_type: ManagerType.Agent,
          agents: ['a1', 'a2'],
          editors: []
        }
      });
      expect(filter).toEqual({
        ...ACTIVE,
        $and: [{ $or: [{ agents: { $in: ['a1', 'a2'] } }] }]
      });
    });

    it('builds an editors-only filter for a Manager managing editors', async () => {
      const filter = await getAccessibleStudentFilter({
        user: {
          role: Role.Manager,
          _id: 'mgr_1',
          manager_type: ManagerType.Editor,
          agents: [],
          editors: ['e1']
        }
      });
      expect(filter).toEqual({
        ...ACTIVE,
        $and: [{ $or: [{ editors: { $in: ['e1'] } }] }]
      });
    });

    it('combines agents and editors for an AgentAndEditor manager', async () => {
      const filter = await getAccessibleStudentFilter({
        user: {
          role: Role.Manager,
          _id: 'mgr_1',
          manager_type: ManagerType.AgentAndEditor,
          agents: ['a1'],
          editors: ['e1']
        }
      });
      expect(filter).toEqual({
        ...ACTIVE,
        $and: [
          { $or: [{ agents: { $in: ['a1'] } }, { editors: { $in: ['e1'] } }] }
        ]
      });
    });

    it('returns an impossible filter when a Manager has no managed teams', async () => {
      const filter = await getAccessibleStudentFilter({
        user: {
          role: Role.Manager,
          _id: 'mgr_1',
          manager_type: ManagerType.None,
          agents: [],
          editors: []
        }
      });
      expect(filter).toEqual({ ...ACTIVE, _id: { $exists: false } });
    });

    it('ignores empty agents/editors arrays even when manager_type matches', async () => {
      const filter = await getAccessibleStudentFilter({
        user: {
          role: Role.Manager,
          _id: 'mgr_1',
          manager_type: ManagerType.AgentAndEditor,
          agents: [],
          editors: []
        }
      });
      expect(filter).toEqual({ ...ACTIVE, _id: { $exists: false } });
    });
  });
});
