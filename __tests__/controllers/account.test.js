// Controller UNIT test for controllers/account.
//
// The account handlers are plain (req, res, next) functions (wrapped by
// asyncHandler), so we call them DIRECTLY with fake req/res/next and a mocked
// UserService + mocked email side-effect. No route, no middleware, no database.
// We assert ONLY the controller's own work: the args it forwards to the
// service, the status + body it writes, and that a service error is forwarded
// to next(). Route + middleware wiring (and the real Mongoose document
// manipulation in updateAcademicBackground / updateLanguageSkill) is covered by
// __tests__/integration/account.test.js.

jest.mock('../../services/users');
jest.mock('../../services/email');

const UserService = require('../../services/users');
const { updateCredentialsEmail } = require('../../services/email');
const {
  updateOfficehours,
  updateCredentials,
  updateAcademicBackground,
  updateLanguageSkill,
  updateApplicationPreferenceSkill,
  updatePersonalData
} = require('../../controllers/account');
const { mockReq, mockRes } = require('../helpers/httpMocks');
const { student, agent } = require('../mock/user');

const studentId = student._id.toString();

// A minimal Mongoose-document double for the handlers that mutate a student doc
// (academic background / language). `profile` is a real array (so find/push
// work) augmented with a `.create()` factory and the doc carries a `.save()`.
const makeStudentDoc = (overrides = {}) => {
  const profile = [];
  profile.create = (fields) => ({ ...fields });
  return {
    profile,
    academic_background: {
      university: { isGraduated: 'No', high_school_isGraduated: 'pending' },
      language: {
        german_isPassed: '-',
        english_isPassed: '-',
        gre_isPassed: '-',
        gmat_isPassed: '-'
      }
    },
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides
  };
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('updateCredentials', () => {
  it('updates the user password and responds 200 (then sends the email)', async () => {
    UserService.updateUser.mockResolvedValue({ _id: studentId });
    updateCredentialsEmail.mockResolvedValue(undefined);
    const req = mockReq({
      user: student,
      body: { credentials: { new_password: 'somepassword' } }
    });
    const res = mockRes();

    await updateCredentials(req, res, jest.fn());

    expect(UserService.updateUser).toHaveBeenCalledWith(studentId, {
      password: 'somepassword'
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true });
    expect(updateCredentialsEmail).toHaveBeenCalledTimes(1);
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('db down');
    UserService.updateUser.mockRejectedValue(err);
    const next = jest.fn();

    await updateCredentials(
      mockReq({
        user: student,
        body: { credentials: { new_password: 'x' } }
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('updateOfficehours', () => {
  it('updates officehours + timezone and responds 200', async () => {
    UserService.updateUser.mockResolvedValue({ _id: agent._id.toString() });
    const req = mockReq({
      user: agent,
      body: { officehours: { mon: '9-5' }, timezone: 'UTC' }
    });
    const res = mockRes();

    await updateOfficehours(req, res, jest.fn());

    expect(UserService.updateUser).toHaveBeenCalledWith(agent._id.toString(), {
      officehours: { mon: '9-5' },
      timezone: 'UTC'
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true });
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('db down');
    UserService.updateUser.mockRejectedValue(err);
    const next = jest.fn();

    await updateOfficehours(
      mockReq({ user: agent, body: { officehours: {}, timezone: 'UTC' } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('updateApplicationPreferenceSkill', () => {
  it('updates application_preference and responds 200 with the saved preference', async () => {
    const application_preference = { target_degree: 'MSc' };
    UserService.updateUser.mockResolvedValue({ application_preference });
    const req = mockReq({
      params: { studentId },
      body: { application_preference }
    });
    const res = mockRes();

    await updateApplicationPreferenceSkill(req, res, jest.fn());

    expect(UserService.updateUser).toHaveBeenCalledWith(
      studentId,
      expect.objectContaining({
        application_preference: expect.objectContaining({
          target_degree: 'MSc'
        })
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({
      success: true,
      data: application_preference
    });
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('db down');
    UserService.updateUser.mockRejectedValue(err);
    const next = jest.fn();

    await updateApplicationPreferenceSkill(
      mockReq({ params: { studentId }, body: { application_preference: {} } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('updatePersonalData', () => {
  it('updates the user and responds 200 with the whitelisted profile fields', async () => {
    const updated = {
      firstname: 'New_FirstName',
      firstname_chinese: '',
      lastname: 'New_LastName',
      lastname_chinese: '',
      birthday: '',
      linkedIn: '',
      lineId: '',
      slackId: '',
      // a field the controller must NOT echo back
      password: 'secret'
    };
    UserService.updateUser.mockResolvedValue(updated);
    const req = mockReq({
      params: { user_id: studentId },
      body: { personaldata: { firstname: 'New_FirstName' } }
    });
    const res = mockRes();

    await updatePersonalData(req, res, jest.fn());

    expect(UserService.updateUser).toHaveBeenCalledWith(studentId, {
      firstname: 'New_FirstName'
    });
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.firstname).toBe('New_FirstName');
    expect(body.data.lastname).toBe('New_LastName');
    expect(body.data).not.toHaveProperty('password');
  });
});

describe('updateAcademicBackground', () => {
  it('persists the university block and responds 200 with the university data', async () => {
    const doc = makeStudentDoc();
    UserService.updateUserDoc.mockResolvedValue(doc);
    const university = { attended_university: '  National   Chiao Tung  ' };
    const req = mockReq({ params: { studentId }, body: { university } });
    const res = mockRes();

    await updateAcademicBackground(req, res, jest.fn());

    // updateUserDoc is called with the nested academic_background path.
    expect(UserService.updateUserDoc).toHaveBeenCalledWith(
      studentId,
      expect.objectContaining({
        'academic_background.university': expect.any(Object)
      }),
      { new: true }
    );
    // Name is normalized (collapsed whitespace + trimmed).
    expect(university.attended_university).toBe('National Chiao Tung');
    expect(doc.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data).toBe(university);
  });
});

describe('updateLanguageSkill', () => {
  it('persists the language block and responds 200 with the saved language', async () => {
    const doc = makeStudentDoc();
    UserService.updateUserDoc.mockResolvedValue(doc);
    const language = { english_certificate: 'TOEFL', english_score: '95' };
    const req = mockReq({ params: { studentId }, body: { language } });
    const res = mockRes();

    await updateLanguageSkill(req, res, jest.fn());

    expect(UserService.updateUserDoc).toHaveBeenCalledWith(
      studentId,
      expect.objectContaining({
        'academic_background.language': expect.any(Object)
      }),
      { upsert: true, new: true }
    );
    expect(doc.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.send.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data).toBe(doc.academic_background.language);
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('db down');
    UserService.updateUserDoc.mockRejectedValue(err);
    const next = jest.fn();

    await updateLanguageSkill(
      mockReq({ params: { studentId }, body: { language: {} } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(err);
  });
});
