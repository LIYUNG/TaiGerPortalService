// Integration test for the account routes — HTTP boundary down to the service,
// with the DAO layer MOCKED (no database, in-memory or otherwise):
//   supertest -> real router -> real middleware -> real controllers/account ->
//   real UserService -> MOCKED UserDAO.
//
// These assert the controller/service pass the right arguments to the DAO and
// shape the HTTP response from the DAO's (mocked) return. The actual schema /
// nested academic_background paths / document-status side effects are exercised
// by driving the DAO mock with a fake live document. Fully deterministic — no
// database engine, no seeding.

import request from 'supertest';

jest.mock('../../middlewares/tenantMiddleware', () => {
  const passthrough = async (req, res, next) => {
    req.tenantId = 'test';
    next();
  };
  return {
    ...jest.requireActual('../../middlewares/tenantMiddleware'),
    checkTenantDBMiddleware: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/decryptCookieMiddleware', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/decryptCookieMiddleware'),
    decryptCookieMiddleware: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/InnerTaigerMultitenantFilter', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/InnerTaigerMultitenantFilter'),
    InnerTaigerMultitenantFilter: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/multitenant-filter', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/multitenant-filter'),
    multitenant_filter: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/limit_archiv_user', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/limit_archiv_user'),
    filter_archiv_user: jest.fn().mockImplementation(passthrough)
  };
});

jest.mock('../../middlewares/auth', () => {
  const passthrough = async (req, res, next) => next();
  return {
    ...jest.requireActual('../../middlewares/auth'),
    protect: jest.fn().mockImplementation(passthrough),
    localAuth: jest.fn().mockImplementation(passthrough),
    permit: jest.fn().mockImplementation((...roles) => passthrough)
  };
});

// updateCredentials notifies the user by email after the update; stub the sender
// so no SMTP connection is opened.
jest.mock('../../services/email', () => ({
  ...jest.requireActual('../../services/email'),
  updateCredentialsEmail: jest.fn().mockResolvedValue(undefined)
}));

// The data boundary: mock the DAO the user service delegates to.
jest.mock('../../dao/user.dao');

import UserDAO from '../../dao/user.dao';
import { protect } from '../../middlewares/auth';
import { app } from '../../app';
import { TENANT_ID } from '../fixtures/constants';
import { student, agent } from '../mock/user';

const requestWithSupertest = request(app);
const studentId = student._id.toString();

// Build a fake "live" Mongoose-style student document for the updateUserDoc
// paths. The controller mutates `profile` (a subdoc array exposing
// find/create/push) and calls `.save()`, so the mock must provide those.
function makeProfileArray() {
  const arr = [];
  arr.create = (fields) => ({ ...fields });
  return arr;
}

function makeStudentDoc(overrides = {}) {
  return {
    _id: student._id,
    firstname: student.firstname,
    lastname: student.lastname,
    profile: makeProfileArray(),
    academic_background: {
      university: {},
      language: {}
    },
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  protect.mockImplementation(async (req, res, next) => {
    req.user = student;
    next();
  });
});

describe('POST /api/account/credentials', () => {
  it('updates the user password via the DAO and reports success', async () => {
    UserDAO.updateUser.mockResolvedValue({ _id: student._id });

    const resp = await requestWithSupertest
      .post('/api/account/credentials')
      .set('tenantId', TENANT_ID)
      .send({ credentials: { new_password: 'somepassword' } });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(UserDAO.updateUser).toHaveBeenCalledWith(studentId, {
      password: 'somepassword'
    });
  });

  it('returns 400 when the DAO reports the user does not exist', async () => {
    UserDAO.updateUser.mockResolvedValue(null);

    const resp = await requestWithSupertest
      .post('/api/account/credentials')
      .set('tenantId', TENANT_ID)
      .send({ credentials: { new_password: 'somepassword' } });

    expect(resp.status).toBe(400);
    expect(resp.body.success).toBe(false);
  });
});

describe('PUT /api/account/profile/officehours/:user_id', () => {
  it('updates officehours via the role-aware DAO and reports success', async () => {
    // This route is for Agent/Editor; authenticate as an agent.
    protect.mockImplementation(async (req, res, next) => {
      req.user = agent;
      next();
    });
    UserDAO.updateOfficehours.mockResolvedValue({ _id: agent._id });
    const officehours = { Monday: { active: true, time_slots: [] } };

    const resp = await requestWithSupertest
      .put(`/api/account/profile/officehours/${agent._id.toString()}`)
      .set('tenantId', TENANT_ID)
      .send({ officehours, timezone: 'UTC' });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    // The role must be threaded through so the DAO casts against the Agent
    // discriminator (the base User model would strip these fields).
    expect(UserDAO.updateOfficehours).toHaveBeenCalledWith(
      agent._id.toString(),
      agent.role,
      { officehours, timezone: 'UTC' }
    );
  });
});

describe('POST /api/account/profile/:user_id', () => {
  it('updates personal data via the DAO and echoes the whitelisted fields back', async () => {
    const personaldata = {
      firstname: 'New_FirstName',
      lastname: 'New_LastName'
    };
    UserDAO.updateUser.mockResolvedValue({
      firstname: 'New_FirstName',
      lastname: 'New_LastName',
      birthday: '',
      linkedIn: '',
      lineId: '',
      slackId: ''
    });

    const resp = await requestWithSupertest
      .post(`/api/account/profile/${studentId}`)
      .set('tenantId', TENANT_ID)
      .send({ personaldata });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(UserDAO.updateUser).toHaveBeenCalledWith(studentId, personaldata);
    expect(resp.body.data.firstname).toBe('New_FirstName');
    expect(resp.body.data.lastname).toBe('New_LastName');
  });
});

describe('POST /api/account/survey/language/:studentId', () => {
  const language = {
    english_certificate: 'TOEFL',
    english_score: '95',
    english_test_date: '',
    german_certificate: '',
    german_score: '',
    german_test_date: ''
  };

  it('persists the language block via updateUserDoc and returns it', async () => {
    const doc = makeStudentDoc({
      academic_background: { university: {}, language: { ...language } }
    });
    UserDAO.updateUserDoc.mockResolvedValue(doc);

    const resp = await requestWithSupertest
      .post(`/api/account/survey/language/${studentId}`)
      .set('tenantId', TENANT_ID)
      .send({ language });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(UserDAO.updateUserDoc).toHaveBeenCalledWith(
      studentId,
      expect.objectContaining({
        'academic_background.language': expect.objectContaining({
          english_certificate: 'TOEFL',
          english_score: '95'
        })
      }),
      { upsert: true, new: true }
    );
    expect(doc.save).toHaveBeenCalled();
    expect(resp.body.data.english_certificate).toBe('TOEFL');
    expect(resp.body.data.english_score).toBe('95');
    expect(resp.body.data.german_certificate).toBe('');
  });
});

describe('POST /api/account/survey/university/:studentId', () => {
  const university = {
    attended_university: 'National Chiao Tung University',
    attended_university_program: 'Electronics Engineering',
    isGraduated: 'No'
  };

  it('persists the academic background via updateUserDoc and returns it', async () => {
    const doc = makeStudentDoc({
      academic_background: { university: { ...university }, language: {} }
    });
    UserDAO.updateUserDoc.mockResolvedValue(doc);

    const resp = await requestWithSupertest
      .post(`/api/account/survey/university/${studentId}`)
      .set('tenantId', TENANT_ID)
      .send({ university });

    expect(resp.status).toBe(200);
    expect(resp.body.success).toBe(true);
    expect(UserDAO.updateUserDoc).toHaveBeenCalledWith(
      studentId,
      expect.objectContaining({
        'academic_background.university': expect.objectContaining({
          attended_university: 'National Chiao Tung University',
          attended_university_program: 'Electronics Engineering',
          isGraduated: 'No'
        })
      }),
      { new: true }
    );
    expect(doc.save).toHaveBeenCalled();
    expect(resp.body.data.attended_university).toBe(
      'National Chiao Tung University'
    );
    expect(resp.body.data.attended_university_program).toBe(
      'Electronics Engineering'
    );
    expect(resp.body.data.isGraduated).toBe('No');
  });
});
