// UNIT test for the CV-profile handlers in controllers/account (getCvProfile /
// updateCvProfile). UserService + heavy imports mocked; nothing real runs.

jest.mock('../../services/users');
jest.mock('../../services/students');
jest.mock('../../services/email', () => ({ updateCredentialsEmail: jest.fn() }));

import { getCvProfile, updateCvProfile } from '../../controllers/account';
import UserService from '../../services/users';

const asMock = (fn: unknown) => fn as jest.Mock;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockRes = (): any => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = {};
  res.status = jest.fn(() => res);
  res.send = jest.fn(() => res);
  return res;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockReq = (o: Record<string, unknown> = {}): any => ({
  params: {},
  query: {},
  body: {},
  headers: {},
  ...o
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getCvProfile', () => {
  it('returns the CV profile blocks (defaulting missing ones)', async () => {
    asMock(UserService.getUserById).mockResolvedValue({
      personal_information: { nationality: 'Taiwan' },
      professional_experience: [{ company: 'Acme' }]
    });
    const res = mockRes();
    await getCvProfile(mockReq({ params: { studentId: 's1' } }), res);
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: {
        personal_information: { nationality: 'Taiwan' },
        professional_experience: [{ company: 'Acme' }],
        awards: [],
        skills: {},
        interests: {}
      }
    });
  });

  it('404s when the student is missing', async () => {
    asMock(UserService.getUserById).mockResolvedValue(null);
    await expect(
      getCvProfile(mockReq({ params: { studentId: 'x' } }), mockRes())
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('updateCvProfile', () => {
  it('persists only the whitelisted keys and returns the updated profile', async () => {
    asMock(UserService.updateUserDoc).mockResolvedValue({
      awards: [{ title: 'Deans' }]
    });
    const res = mockRes();
    await updateCvProfile(
      mockReq({
        params: { studentId: 's1' },
        body: {
          awards: [{ title: 'Deans' }],
          hacker: 'ignored',
          role: 'Admin'
        }
      }),
      res
    );
    const [, update] = asMock(UserService.updateUserDoc).mock.calls[0];
    expect(update).toEqual({ awards: [{ title: 'Deans' }] });
    expect(update).not.toHaveProperty('hacker');
    expect(update).not.toHaveProperty('role');
    expect(res.send).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
  });

  it('404s when the student is missing', async () => {
    asMock(UserService.updateUserDoc).mockResolvedValue(null);
    await expect(
      updateCvProfile(mockReq({ params: { studentId: 'x' }, body: {} }), mockRes())
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
