// Controller UNIT test for controllers/files.
//
// The files controller manages template / profile / VPD / admission-letter file
// metadata and the matching S3 objects. Each handler is a plain (req, res, next)
// function (wrapped by asyncHandler), so we call them DIRECTLY with fake
// req/res/next from __tests__/helpers/httpMocks.js.
//
// CRITICAL: every external boundary is MOCKED so NOTHING real runs — no S3
// (aws/s3, aws), no email, no Slack, no database. We assert ONLY the
// controller's own work: the args forwarded to the services / S3 helpers, the
// status + payload written to res, and error forwarding (thrown ErrorResponse ->
// caught by asyncHandler -> next(err)). Route wiring + the real DB/S3 seam live
// in the integration suites.

jest.mock('../../aws/s3');
jest.mock('../../aws');
jest.mock('../../services/email');
jest.mock('../../services/applications');
jest.mock('../../services/templates');
jest.mock('../../services/students');
jest.mock('../../services/users');
jest.mock('../../services/basedocumentationslinks');
jest.mock('../../utils/slackUtils');

// node-cache: stub so downloadTemplateFile can exercise both cache-miss and
// cache-hit branches without a real cache instance.
jest.mock('../../cache/node-cache', () => ({
  ten_minutes_cache: { get: jest.fn(), set: jest.fn() }
}));

const { deleteS3Object, getS3Object } = require('../../aws/s3');
const EmailService = require('../../services/email');
const ApplicationService = require('../../services/applications');
const TemplateService = require('../../services/templates');
const StudentService = require('../../services/students');
const UserService = require('../../services/users');
const BasedocumentationslinkService = require('../../services/basedocumentationslinks');
const { sendSlackMessageToWinChannel } = require('../../utils/slackUtils');
const { ten_minutes_cache } = require('../../cache/node-cache');

const {
  getTemplates,
  deleteTemplate,
  uploadTemplate,
  downloadTemplateFile,
  saveProfileFilePath,
  updateVPDPayment,
  updateVPDFileNecessity,
  saveVPDFilePath,
  downloadVPDFile,
  downloadProfileFileURL,
  updateProfileDocumentStatus,
  updateStudentApplicationResultV2,
  updateStudentApplicationResult,
  deleteProfileFile,
  deleteVPDFile,
  removeNotification,
  removeAgentNotification,
  getMyAcademicBackground
} = require('../../controllers/files');
const { mockReq, mockRes } = require('../helpers/httpMocks');
const { admin, student } = require('../mock/user');

const studentId = student._id.toString();

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getTemplates', () => {
  it('returns 201 with the templates from the service', async () => {
    const templates = [{ category_name: 'CV' }];
    TemplateService.getTemplates.mockResolvedValue(templates);
    const res = mockRes();
    const next = jest.fn();

    await getTemplates(mockReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: templates });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('forwards a service error to next()', async () => {
    const err = new Error('db down');
    TemplateService.getTemplates.mockRejectedValue(err);
    const next = jest.fn();

    await getTemplates(mockReq(), mockRes(), next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('deleteTemplate', () => {
  it('deletes the S3 object, removes the template, returns 201-less 200 and emails admin', async () => {
    TemplateService.getTemplateByCategory.mockResolvedValue({
      path: 'taiger_template/CV_TaiGer_Template.pdf'
    });
    deleteS3Object.mockResolvedValue();
    TemplateService.deleteTemplateByCategory.mockResolvedValue();
    TemplateService.getTemplates.mockResolvedValue([]);
    EmailService.deleteTemplateSuccessEmail.mockResolvedValue();
    const res = mockRes();
    const next = jest.fn();

    await deleteTemplate(
      mockReq({ user: admin, params: { category_name: 'CV' } }),
      res,
      next
    );

    expect(deleteS3Object).toHaveBeenCalledTimes(1);
    expect(TemplateService.deleteTemplateByCategory).toHaveBeenCalledWith('CV');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: [] });
    expect(EmailService.deleteTemplateSuccessEmail).toHaveBeenCalledTimes(1);
  });

  it('throws 500 when S3 delete fails (forwarded to next)', async () => {
    TemplateService.getTemplateByCategory.mockResolvedValue({
      path: 'taiger_template/CV_TaiGer_Template.pdf'
    });
    deleteS3Object.mockRejectedValue(new Error('s3 boom'));
    const next = jest.fn();

    await deleteTemplate(
      mockReq({ user: admin, params: { category_name: 'CV' } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].statusCode).toBe(500);
  });
});

describe('uploadTemplate', () => {
  it('upserts the template using the uploaded file key and returns 201', async () => {
    TemplateService.upsertTemplate.mockResolvedValue({ name: 'k' });
    const res = mockRes();
    const next = jest.fn();

    await uploadTemplate(
      mockReq({
        params: { category_name: 'CV' },
        file: { key: 'taiger_template/CV.pdf' }
      }),
      res,
      next
    );

    expect(TemplateService.upsertTemplate).toHaveBeenCalledWith(
      'CV',
      expect.objectContaining({
        name: 'taiger_template/CV.pdf',
        category_name: 'CV',
        path: 'taiger_template/CV.pdf'
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('downloadTemplateFile', () => {
  it('cache MISS: fetches from S3, caches the buffer and attaches the response', async () => {
    TemplateService.getTemplateByCategory.mockResolvedValue({
      path: 'taiger_template/CV.pdf'
    });
    ten_minutes_cache.get.mockReturnValue(undefined);
    ten_minutes_cache.set.mockReturnValue(true);
    getS3Object.mockResolvedValue(Buffer.from('pdf-bytes'));
    const res = mockRes();
    res.attachment = jest.fn(() => res);
    const next = jest.fn();

    await downloadTemplateFile(
      mockReq({ params: { category_name: 'CV' } }),
      res,
      next
    );

    expect(getS3Object).toHaveBeenCalledTimes(1);
    expect(ten_minutes_cache.set).toHaveBeenCalledTimes(1);
    expect(res.attachment).toHaveBeenCalled();
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('cache HIT: serves the cached buffer without calling S3', async () => {
    TemplateService.getTemplateByCategory.mockResolvedValue({
      path: 'taiger_template/CV.pdf'
    });
    ten_minutes_cache.get.mockReturnValue(Buffer.from('cached'));
    const res = mockRes();
    res.attachment = jest.fn(() => res);
    const next = jest.fn();

    await downloadTemplateFile(
      mockReq({ params: { category_name: 'CV' } }),
      res,
      next
    );

    expect(getS3Object).not.toHaveBeenCalled();
    expect(res.end).toHaveBeenCalledTimes(1);
  });
});

describe('saveProfileFilePath', () => {
  it('returns 404 when the student is not found', async () => {
    StudentService.getStudentDocByIdPopulated.mockResolvedValue(null);
    const next = jest.fn();

    await saveProfileFilePath(
      mockReq({
        user: admin,
        params: { studentId, category: 'CV' },
        file: { key: 'k.pdf' }
      }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });

  it('creates a new profile document (Admin uploads, emails the student) and returns 201', async () => {
    const profile = [];
    profile.create = (obj) => ({ ...obj });
    const studentDoc = {
      _id: { toString: () => studentId },
      firstname: 'Stu',
      lastname: 'Dent',
      email: 's@example.com',
      archiv: false,
      agents: [],
      profile,
      save: jest.fn().mockResolvedValue()
    };
    StudentService.getStudentDocByIdPopulated.mockResolvedValue(studentDoc);
    EmailService.sendAgentUploadedProfileFilesForStudentEmail.mockResolvedValue();
    const res = mockRes();
    const next = jest.fn();

    await saveProfileFilePath(
      mockReq({
        user: admin, // Admin -> not a student -> email goes to the student
        params: { studentId, category: 'CV' },
        file: { key: `${studentId}/CV.pdf` }
      }),
      res,
      next
    );

    expect(studentDoc.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(
      EmailService.sendAgentUploadedProfileFilesForStudentEmail
    ).toHaveBeenCalledTimes(1);
  });

  it('updates an existing profile document and returns 201', async () => {
    const existing = { name: 'CV' };
    const profile = [existing];
    const studentDoc = {
      _id: { toString: () => studentId },
      firstname: 'Stu',
      lastname: 'Dent',
      email: 's@example.com',
      archiv: false,
      agents: [],
      profile,
      save: jest.fn().mockResolvedValue()
    };
    StudentService.getStudentDocByIdPopulated.mockResolvedValue(studentDoc);
    EmailService.sendAgentUploadedProfileFilesForStudentEmail.mockResolvedValue();
    const res = mockRes();
    const next = jest.fn();

    await saveProfileFilePath(
      mockReq({
        user: admin,
        params: { studentId, category: 'CV' },
        file: { key: `${studentId}/CV.pdf` }
      }),
      res,
      next
    );

    expect(existing.status).toBe('uploaded');
    expect(studentDoc.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('student uploads a NEW profile doc: notifies + reminds the (active) agents', async () => {
    const profile = [];
    profile.create = (obj) => ({ ...obj });
    const agentDoc = {
      _id: { toString: () => 'agent-1' },
      firstname: 'Ag',
      lastname: 'Ent',
      email: 'a@example.com',
      archiv: false,
      // Seed an entry for a DIFFERENT student so the .find() predicate runs but
      // does not match => the new entry is still appended.
      agent_notification: {
        isRead_new_base_docs_uploaded: [{ student_id: 'someone-else' }]
      },
      save: jest.fn().mockResolvedValue()
    };
    const studentDoc = {
      _id: { toString: () => studentId },
      firstname: 'Stu',
      lastname: 'Dent',
      email: 's@example.com',
      archiv: false,
      agents: [agentDoc],
      profile,
      save: jest.fn().mockResolvedValue()
    };
    StudentService.getStudentDocByIdPopulated.mockResolvedValue(studentDoc);
    UserService.getAgentDocById.mockResolvedValue(agentDoc);
    EmailService.sendUploadedProfileFilesRemindForAgentEmail.mockResolvedValue();
    const res = mockRes();
    const next = jest.fn();

    await saveProfileFilePath(
      mockReq({
        user: student, // role Student => is_TaiGer_Student true
        params: { studentId, category: 'CV' },
        file: { key: `${studentId}/CV.pdf` }
      }),
      res,
      next
    );

    expect(UserService.getAgentDocById).toHaveBeenCalledWith('agent-1');
    // The new student notification entry is appended (now 2 total).
    expect(
      agentDoc.agent_notification.isRead_new_base_docs_uploaded
    ).toHaveLength(2);
    expect(agentDoc.save).toHaveBeenCalled();
    expect(
      EmailService.sendUploadedProfileFilesRemindForAgentEmail
    ).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('student uploads a NEW profile doc: skips notification push when the agent has no notification object', async () => {
    const profile = [];
    profile.create = (obj) => ({ ...obj });
    const agentDoc = {
      _id: { toString: () => 'agent-1' },
      firstname: 'Ag',
      lastname: 'Ent',
      email: 'a@example.com',
      archiv: false,
      // No agent_notification => the `if (agent.agent_notification)` guard is false.
      save: jest.fn().mockResolvedValue()
    };
    const studentDoc = {
      _id: { toString: () => studentId },
      firstname: 'Stu',
      lastname: 'Dent',
      email: 's@example.com',
      archiv: false,
      agents: [agentDoc],
      profile,
      save: jest.fn().mockResolvedValue()
    };
    StudentService.getStudentDocByIdPopulated.mockResolvedValue(studentDoc);
    UserService.getAgentDocById.mockResolvedValue(agentDoc);
    EmailService.sendUploadedProfileFilesRemindForAgentEmail.mockResolvedValue();
    const res = mockRes();
    const next = jest.fn();

    await saveProfileFilePath(
      mockReq({
        user: student,
        params: { studentId, category: 'CV' },
        file: { key: `${studentId}/CV.pdf` }
      }),
      res,
      next
    );

    expect(agentDoc.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('student uploads to an EXISTING profile doc: notifies + reminds the agents', async () => {
    const existing = { name: 'CV' };
    const profile = [existing];
    const agentDoc = {
      _id: { toString: () => 'agent-1' },
      firstname: 'Ag',
      lastname: 'Ent',
      email: 'a@example.com',
      archiv: false,
      // Notified for a DIFFERENT student => the new entry is appended (line 230).
      agent_notification: {
        isRead_new_base_docs_uploaded: [{ student_id: 'someone-else' }]
      },
      save: jest.fn().mockResolvedValue()
    };
    const studentDoc = {
      _id: { toString: () => studentId },
      firstname: 'Stu',
      lastname: 'Dent',
      email: 's@example.com',
      archiv: false,
      agents: [agentDoc],
      profile,
      save: jest.fn().mockResolvedValue()
    };
    StudentService.getStudentDocByIdPopulated.mockResolvedValue(studentDoc);
    UserService.getAgentDocById.mockResolvedValue(agentDoc);
    EmailService.sendUploadedProfileFilesRemindForAgentEmail.mockResolvedValue();
    const res = mockRes();
    const next = jest.fn();

    await saveProfileFilePath(
      mockReq({
        user: student,
        params: { studentId, category: 'CV' },
        file: { key: `${studentId}/CV.pdf` }
      }),
      res,
      next
    );

    // The new entry is appended (now 2 total).
    expect(
      agentDoc.agent_notification.isRead_new_base_docs_uploaded
    ).toHaveLength(2);
    expect(existing.status).toBe('uploaded');
    expect(res.status).toHaveBeenCalledWith(201);
    expect(
      EmailService.sendUploadedProfileFilesRemindForAgentEmail
    ).toHaveBeenCalledTimes(1);
  });

  it('student uploads to an EXISTING profile doc: agent with no notification object is skipped', async () => {
    const existing = { name: 'CV' };
    const agentDoc = {
      _id: { toString: () => 'agent-1' },
      firstname: 'Ag',
      lastname: 'Ent',
      email: 'a@example.com',
      archiv: false,
      // No agent_notification => guard false in the existing-doc branch (line 230).
      save: jest.fn().mockResolvedValue()
    };
    const studentDoc = {
      _id: { toString: () => studentId },
      firstname: 'Stu',
      lastname: 'Dent',
      email: 's@example.com',
      archiv: false,
      agents: [agentDoc],
      profile: [existing],
      save: jest.fn().mockResolvedValue()
    };
    StudentService.getStudentDocByIdPopulated.mockResolvedValue(studentDoc);
    UserService.getAgentDocById.mockResolvedValue(agentDoc);
    EmailService.sendUploadedProfileFilesRemindForAgentEmail.mockResolvedValue();
    const res = mockRes();
    const next = jest.fn();

    await saveProfileFilePath(
      mockReq({
        user: student,
        params: { studentId, category: 'CV' },
        file: { key: `${studentId}/CV.pdf` }
      }),
      res,
      next
    );

    expect(agentDoc.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('updateVPDPayment', () => {
  it('returns 404 when the application is missing', async () => {
    ApplicationService.getApplicationById.mockResolvedValue(null);
    const next = jest.fn();

    await updateVPDPayment(
      mockReq({ params: { applicationId: 'a1' }, body: { isPaid: true } }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });

  it('updates uni_assist.isPaid and returns 201', async () => {
    ApplicationService.getApplicationById.mockResolvedValue({
      uni_assist: { status: 'missing' }
    });
    ApplicationService.updateApplication.mockResolvedValue({ _id: 'a1' });
    const res = mockRes();
    const next = jest.fn();

    await updateVPDPayment(
      mockReq({ params: { applicationId: 'a1' }, body: { isPaid: true } }),
      res,
      next
    );

    expect(ApplicationService.updateApplication).toHaveBeenCalledWith(
      { _id: 'a1' },
      expect.objectContaining({
        uni_assist: expect.objectContaining({ isPaid: true })
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('updateVPDFileNecessity', () => {
  it('returns 404 when the application is missing', async () => {
    ApplicationService.getApplicationById.mockResolvedValue(null);
    const next = jest.fn();

    await updateVPDFileNecessity(
      mockReq({ params: { applicationId: 'a1' } }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });

  it('toggles status from NotNeeded to Missing', async () => {
    ApplicationService.getApplicationById.mockResolvedValue({
      uni_assist: { status: 'notneeded' }
    });
    ApplicationService.updateApplication.mockResolvedValue({});
    const res = mockRes();
    const next = jest.fn();

    await updateVPDFileNecessity(
      mockReq({ params: { applicationId: 'a1' } }),
      res,
      next
    );

    expect(ApplicationService.updateApplication).toHaveBeenCalledWith(
      { _id: 'a1' },
      expect.objectContaining({
        uni_assist: expect.objectContaining({ status: 'missing' })
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('saveVPDFilePath', () => {
  it('returns 404 when the application is missing', async () => {
    ApplicationService.getApplicationDocByIdWithProgram.mockResolvedValue(null);
    const next = jest.fn();

    await saveVPDFilePath(
      mockReq({
        user: admin,
        params: { studentId, applicationId: 'a1', fileType: 'VPD' },
        file: { key: 'k.pdf' }
      }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });

  it('saves a VPD file path, returns 201 and emails the student (Admin upload)', async () => {
    const app = {
      uni_assist: {},
      save: jest.fn().mockResolvedValue()
    };
    ApplicationService.getApplicationDocByIdWithProgram.mockResolvedValue(app);
    StudentService.getStudentByIdPopulated.mockResolvedValue({
      _id: { toString: () => studentId },
      firstname: 'Stu',
      lastname: 'Dent',
      email: 's@example.com',
      archiv: false,
      agents: []
    });
    EmailService.sendAgentUploadedVPDForStudentEmail.mockResolvedValue();
    const res = mockRes();
    const next = jest.fn();

    await saveVPDFilePath(
      mockReq({
        user: admin,
        params: { studentId, applicationId: 'a1', fileType: 'VPD' },
        file: { key: `${studentId}/vpd.pdf` }
      }),
      res,
      next
    );

    expect(app.uni_assist.vpd_file_path).toBe(`${studentId}/vpd.pdf`);
    expect(app.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(
      EmailService.sendAgentUploadedVPDForStudentEmail
    ).toHaveBeenCalledTimes(1);
  });

  it('saves a VPDConfirmation file and (student upload) reminds the active agents', async () => {
    const app = { uni_assist: {}, save: jest.fn().mockResolvedValue() };
    ApplicationService.getApplicationDocByIdWithProgram.mockResolvedValue(app);
    StudentService.getStudentByIdPopulated.mockResolvedValue({
      _id: { toString: () => studentId },
      firstname: 'Stu',
      lastname: 'Dent',
      email: 's@example.com',
      archiv: false,
      agents: [
        {
          firstname: 'Ag',
          lastname: 'Ent',
          email: 'a@example.com',
          archiv: false
        }
      ]
    });
    EmailService.sendUploadedVPDRemindForAgentEmail.mockResolvedValue();
    const res = mockRes();
    const next = jest.fn();

    await saveVPDFilePath(
      mockReq({
        user: student, // is_TaiGer_Student => agent-reminder branch
        params: {
          studentId,
          applicationId: 'a1',
          fileType: 'VPDConfirmation'
        },
        file: { key: `${studentId}/vpdconf.pdf` }
      }),
      res,
      next
    );

    expect(app.uni_assist.vpd_paid_confirmation_file_path).toBe(
      `${studentId}/vpdconf.pdf`
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(
      EmailService.sendUploadedVPDRemindForAgentEmail
    ).toHaveBeenCalledTimes(1);
  });
});

describe('downloadVPDFile', () => {
  it('returns 404 when the application is missing', async () => {
    ApplicationService.getApplicationDocByIdWithProgram.mockResolvedValue(null);
    const next = jest.fn();

    await downloadVPDFile(
      mockReq({
        user: admin,
        params: { applicationId: 'a1', fileType: 'VPD' }
      }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });

  it('returns 404 when the VPD file has not been uploaded', async () => {
    ApplicationService.getApplicationDocByIdWithProgram.mockResolvedValue({
      uni_assist: { vpd_file_path: '' }
    });
    const next = jest.fn();

    await downloadVPDFile(
      mockReq({
        user: admin,
        params: { applicationId: 'a1', fileType: 'VPD' }
      }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });

  it('streams the VPD file from S3 with a UTF-8 content-disposition header', async () => {
    ApplicationService.getApplicationDocByIdWithProgram.mockResolvedValue({
      uni_assist: { vpd_file_path: `${studentId}/vpd.pdf` }
    });
    getS3Object.mockResolvedValue(Buffer.from('bytes'));
    const res = mockRes();
    res.attachment = jest.fn(() => res);
    res.setHeader = jest.fn(() => res);
    const next = jest.fn();

    await downloadVPDFile(
      mockReq({
        user: admin,
        params: { applicationId: 'a1', fileType: 'VPD' }
      }),
      res,
      next
    );

    expect(getS3Object).toHaveBeenCalledTimes(1);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining('attachment;')
    );
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when the VPDConfirmation file has not been uploaded', async () => {
    ApplicationService.getApplicationDocByIdWithProgram.mockResolvedValue({
      uni_assist: { vpd_paid_confirmation_file_path: '' }
    });
    const next = jest.fn();

    await downloadVPDFile(
      mockReq({
        user: admin,
        params: { applicationId: 'a1', fileType: 'VPDConfirmation' }
      }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });

  it('streams the VPDConfirmation file from S3', async () => {
    ApplicationService.getApplicationDocByIdWithProgram.mockResolvedValue({
      uni_assist: {
        vpd_paid_confirmation_file_path: `${studentId}/vpdconf.pdf`
      }
    });
    getS3Object.mockResolvedValue(Buffer.from('bytes'));
    const res = mockRes();
    res.attachment = jest.fn(() => res);
    res.setHeader = jest.fn(() => res);
    const next = jest.fn();

    await downloadVPDFile(
      mockReq({
        user: admin,
        params: { applicationId: 'a1', fileType: 'VPDConfirmation' }
      }),
      res,
      next
    );

    expect(getS3Object).toHaveBeenCalledTimes(1);
    expect(res.end).toHaveBeenCalledTimes(1);
  });
});

describe('downloadProfileFileURL', () => {
  it('returns 404 when the student is missing', async () => {
    StudentService.getStudentDocById.mockResolvedValue(null);
    const next = jest.fn();

    await downloadProfileFileURL(
      mockReq({ params: { studentId, file_key: 'CV' } }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });

  it('returns 404 when no matching document is found', async () => {
    StudentService.getStudentDocById.mockResolvedValue({ profile: [] });
    const next = jest.fn();

    await downloadProfileFileURL(
      mockReq({ params: { studentId, file_key: 'CV' } }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });

  it('returns 404 when the matched document has an empty path', async () => {
    // file_key '' makes ''.includes('') match a doc with an empty path, which
    // then trips the `!document.path` guard.
    StudentService.getStudentDocById.mockResolvedValue({
      profile: [{ path: '' }]
    });
    const next = jest.fn();

    await downloadProfileFileURL(
      mockReq({ params: { studentId, file_key: '' } }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });

  it('streams the matching profile file from S3', async () => {
    StudentService.getStudentDocById.mockResolvedValue({
      profile: [{ path: `${studentId}/CV.pdf` }]
    });
    getS3Object.mockResolvedValue(Buffer.from('bytes'));
    const res = mockRes();
    res.attachment = jest.fn(() => res);
    const next = jest.fn();

    await downloadProfileFileURL(
      mockReq({ params: { studentId, file_key: 'CV' } }),
      res,
      next
    );

    expect(getS3Object).toHaveBeenCalledTimes(1);
    expect(res.end).toHaveBeenCalledTimes(1);
  });
});

describe('updateProfileDocumentStatus', () => {
  it('throws 403 for an invalid status', async () => {
    const next = jest.fn();

    await updateProfileDocumentStatus(
      mockReq({
        params: { studentId, category: 'CV' },
        body: { status: 'not-a-status' }
      }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(403);
  });

  it('throws 404 when the student is missing', async () => {
    StudentService.getStudentDocByIdPopulated.mockResolvedValue(null);
    const next = jest.fn();

    await updateProfileDocumentStatus(
      mockReq({
        params: { studentId, category: 'CV' },
        body: { status: 'accepted' }
      }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });

  it('updates an existing document status to rejected and emails the student', async () => {
    const existing = { name: 'CV' };
    const studentDoc = {
      firstname: 'Stu',
      lastname: 'Dent',
      email: 's@example.com',
      archiv: false,
      notification: {},
      profile: [existing],
      save: jest.fn().mockResolvedValue()
    };
    StudentService.getStudentDocByIdPopulated.mockResolvedValue(studentDoc);
    EmailService.sendChangedProfileFileStatusEmail.mockResolvedValue();
    const res = mockRes();
    const next = jest.fn();

    await updateProfileDocumentStatus(
      mockReq({
        params: { studentId, category: 'CV' },
        body: { status: 'rejected', feedback: 'fix it' }
      }),
      res,
      next
    );

    expect(existing.status).toBe('rejected');
    expect(studentDoc.notification.isRead_base_documents_rejected).toBe(false);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(
      EmailService.sendChangedProfileFileStatusEmail
    ).toHaveBeenCalledTimes(1);
  });

  it('creates a new (NotNeeded) document when the category does not exist yet', async () => {
    const profile = [];
    profile.create = (obj) => ({ ...obj });
    const studentDoc = {
      firstname: 'Stu',
      lastname: 'Dent',
      email: 's@example.com',
      archiv: false,
      notification: {},
      profile,
      save: jest.fn().mockResolvedValue()
    };
    StudentService.getStudentDocByIdPopulated.mockResolvedValue(studentDoc);
    const res = mockRes();
    const next = jest.fn();

    await updateProfileDocumentStatus(
      mockReq({
        params: { studentId, category: 'CV' },
        body: { status: 'missing', feedback: '' }
      }),
      res,
      next
    );

    // A brand-new doc is pushed and the student saved; no email for new docs.
    expect(profile).toHaveLength(1);
    expect(studentDoc.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(
      EmailService.sendChangedProfileFileStatusEmail
    ).not.toHaveBeenCalled();
  });

  it('clears feedback when an existing document is accepted (no email for accepted? emails)', async () => {
    const existing = { name: 'CV', feedback: 'old feedback' };
    const studentDoc = {
      firstname: 'Stu',
      lastname: 'Dent',
      email: 's@example.com',
      archiv: false,
      notification: {},
      profile: [existing],
      save: jest.fn().mockResolvedValue()
    };
    StudentService.getStudentDocByIdPopulated.mockResolvedValue(studentDoc);
    EmailService.sendChangedProfileFileStatusEmail.mockResolvedValue();
    const res = mockRes();
    const next = jest.fn();

    await updateProfileDocumentStatus(
      mockReq({
        params: { studentId, category: 'CV' },
        body: { status: 'accepted', feedback: 'ignored' }
      }),
      res,
      next
    );

    // Accepted clears feedback and still emails (status is not NotNeeded/Missing).
    expect(existing.feedback).toBe('');
    expect(existing.status).toBe('accepted');
    expect(res.status).toHaveBeenCalledWith(201);
    expect(
      EmailService.sendChangedProfileFileStatusEmail
    ).toHaveBeenCalledTimes(1);
  });

  it('swallows a save error (catch branch) without forwarding it', async () => {
    const existing = { name: 'CV' };
    const studentDoc = {
      firstname: 'Stu',
      lastname: 'Dent',
      email: 's@example.com',
      archiv: false,
      notification: {},
      profile: [existing],
      save: jest.fn().mockRejectedValue(new Error('save boom'))
    };
    StudentService.getStudentDocByIdPopulated.mockResolvedValue(studentDoc);
    const res = mockRes();
    const next = jest.fn();

    await updateProfileDocumentStatus(
      mockReq({
        params: { studentId, category: 'CV' },
        body: { status: 'missing' }
      }),
      res,
      next
    );

    // The handler catches the error internally; res is never sent and next gets
    // no error (asyncHandler still calls next() via the wrapper).
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('updateStudentApplicationResultV2', () => {
  const programId = 'dddddddddddddddddddddddd';

  it('throws 404 when the student is missing', async () => {
    StudentService.getStudentDocByIdPopulated.mockResolvedValue(null);
    const next = jest.fn();

    await updateStudentApplicationResultV2(
      mockReq({
        user: admin,
        params: { studentId, programId },
        body: { admission: 'O' }
      }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });

  it('closes an application (closed branch) and responds 200', async () => {
    StudentService.getStudentDocByIdPopulated.mockResolvedValue({
      _id: { toString: () => studentId },
      firstname: 'Stu',
      lastname: 'Dent',
      agents: [],
      editors: [],
      applications: []
    });
    StudentService.updateStudentByFilter.mockResolvedValue({
      applications: [{ programId: { toString: () => programId }, closed: 'O' }]
    });
    const res = mockRes();
    const next = jest.fn();

    await updateStudentApplicationResultV2(
      mockReq({
        user: admin,
        params: { studentId, programId },
        body: { closed: 'O' }
      }),
      res,
      next
    );

    expect(StudentService.updateStudentByFilter).toHaveBeenCalledWith(
      { _id: studentId, 'applications.programId': programId },
      { 'applications.$.closed': 'O' }
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('uploads an admission letter file and emails active agents + editors (taiger student)', async () => {
    StudentService.getStudentDocByIdPopulated.mockResolvedValue({
      _id: { toString: () => studentId },
      firstname: 'Stu',
      lastname: 'Dent',
      agents: [
        {
          firstname: 'Ag',
          lastname: 'Ent',
          email: 'a@e.c',
          archiv: false
        }
      ],
      editors: [
        {
          firstname: 'Ed',
          lastname: 'Itor',
          email: 'e@e.c',
          archiv: false
        }
      ],
      applications: [{ programId: { id: { toString: () => programId } } }]
    });
    StudentService.updateStudentByFilter.mockResolvedValue({
      applications: [{ programId: { toString: () => programId } }]
    });
    EmailService.AdmissionResultInformEmailToTaiGer.mockResolvedValue();
    const res = mockRes();
    const next = jest.fn();

    await updateStudentApplicationResultV2(
      mockReq({
        user: student, // is_TaiGer_Student => email branch
        params: { studentId, programId },
        body: { admission: 'O' },
        file: { key: `${studentId}/admission/letter.pdf` }
      }),
      res,
      next
    );

    expect(StudentService.updateStudentByFilter).toHaveBeenCalledWith(
      { _id: studentId, 'applications.programId': programId },
      expect.objectContaining({ 'applications.$.admission': 'O' })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(
      EmailService.AdmissionResultInformEmailToTaiGer
    ).toHaveBeenCalledTimes(2);
  });

  it('removes an existing admission letter from S3 when admission is "-"', async () => {
    StudentService.getStudentDocByIdPopulated.mockResolvedValue({
      _id: { toString: () => studentId },
      firstname: 'Stu',
      lastname: 'Dent',
      agents: [],
      editors: [],
      applications: [
        {
          programId: {
            _id: { toString: () => programId },
            id: { toString: () => programId }
          },
          admission_letter: {
            admission_file_path: `${studentId}/admission/x.pdf`
          }
        }
      ]
    });
    deleteS3Object.mockResolvedValue();
    StudentService.updateStudentByFilter.mockResolvedValue({
      applications: [{ programId: { toString: () => programId } }]
    });
    const res = mockRes();
    const next = jest.fn();

    await updateStudentApplicationResultV2(
      mockReq({
        user: admin,
        params: { studentId, programId },
        body: { admission: '-' }
      }),
      res,
      next
    );

    expect(deleteS3Object).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('throws 500 when removing the admission letter from S3 fails (admission "-")', async () => {
    StudentService.getStudentDocByIdPopulated.mockResolvedValue({
      _id: { toString: () => studentId },
      firstname: 'Stu',
      lastname: 'Dent',
      agents: [],
      editors: [],
      applications: [
        {
          programId: { _id: { toString: () => programId } },
          admission_letter: {
            admission_file_path: `${studentId}/admission/x.pdf`
          }
        }
      ]
    });
    deleteS3Object.mockRejectedValue(new Error('s3 boom'));
    const next = jest.fn();

    await updateStudentApplicationResultV2(
      mockReq({
        user: admin,
        params: { studentId, programId },
        body: { admission: '-' }
      }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(500);
  });

  it('updates a plain admission result (no file, not "-")', async () => {
    StudentService.getStudentDocByIdPopulated.mockResolvedValue({
      _id: { toString: () => studentId },
      firstname: 'Stu',
      lastname: 'Dent',
      agents: [],
      editors: [],
      applications: [{ programId: { id: { toString: () => programId } } }]
    });
    StudentService.updateStudentByFilter.mockResolvedValue({
      applications: [{ programId: { toString: () => programId } }]
    });
    const res = mockRes();
    const next = jest.fn();

    await updateStudentApplicationResultV2(
      mockReq({
        user: admin, // not a taiger student => no emails
        params: { studentId, programId },
        body: { admission: 'X' }
      }),
      res,
      next
    );

    expect(StudentService.updateStudentByFilter).toHaveBeenCalledWith(
      { _id: studentId, 'applications.programId': programId },
      { 'applications.$.admission': 'X' }
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(
      EmailService.AdmissionResultInformEmailToTaiGer
    ).not.toHaveBeenCalled();
  });
});

describe('updateStudentApplicationResult', () => {
  it('updates admission result (no file, plain result) and emails staff', async () => {
    ApplicationService.updateApplication.mockResolvedValue({});
    ApplicationService.getApplicationById.mockResolvedValue({ _id: 'a1' });
    StudentService.getStudentByIdPopulated.mockResolvedValue({
      _id: { toString: () => studentId },
      firstname: 'Stu',
      lastname: 'Dent',
      agents: [],
      editors: []
    });
    const res = mockRes();
    const next = jest.fn();

    await updateStudentApplicationResult(
      mockReq({
        user: admin,
        params: { studentId, applicationId: 'a1', result: 'X' }
      }),
      res,
      next
    );

    expect(ApplicationService.updateApplication).toHaveBeenCalledWith(
      { _id: 'a1' },
      { admission: 'X' }
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('emails the active, non-triggering staff (agents + editors) for a real result', async () => {
    ApplicationService.updateApplication.mockResolvedValue({});
    ApplicationService.getApplicationById.mockResolvedValue({ _id: 'a1' });
    StudentService.getStudentByIdPopulated.mockResolvedValue({
      _id: { toString: () => studentId },
      firstname: 'Stu',
      lastname: 'Dent',
      agents: [
        {
          _id: 'ag1',
          firstname: 'Ag',
          lastname: 'Ent',
          email: 'a@e.c',
          archiv: false
        }
      ],
      editors: [
        {
          _id: 'ed1',
          firstname: 'Ed',
          lastname: 'Itor',
          email: 'e@e.c',
          archiv: false
        }
      ]
    });
    EmailService.AdmissionResultInformEmailToTaiGer.mockResolvedValue();
    const res = mockRes();
    const next = jest.fn();

    await updateStudentApplicationResult(
      mockReq({
        user: admin,
        params: { studentId, applicationId: 'a1', result: 'X' }
      }),
      res,
      next
    );

    // One agent + one editor, neither archived nor the trigger user.
    expect(
      EmailService.AdmissionResultInformEmailToTaiGer
    ).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('persists the uploaded admission letter when a file is present', async () => {
    ApplicationService.updateApplication.mockResolvedValue({});
    ApplicationService.getApplicationById.mockResolvedValue({ _id: 'a1' });
    StudentService.getStudentByIdPopulated.mockResolvedValue({
      _id: { toString: () => studentId },
      firstname: 'Stu',
      lastname: 'Dent',
      agents: [],
      editors: []
    });
    const res = mockRes();
    const next = jest.fn();

    await updateStudentApplicationResult(
      mockReq({
        user: admin,
        params: { studentId, applicationId: 'a1', result: 'O' },
        file: { key: `${studentId}/admission/letter.pdf` }
      }),
      res,
      next
    );

    expect(ApplicationService.updateApplication).toHaveBeenCalledWith(
      { _id: 'a1' },
      expect.objectContaining({
        admission: 'O',
        admission_letter: expect.objectContaining({
          admission_file_path: `${studentId}/admission/letter.pdf`
        })
      })
    );
    expect(sendSlackMessageToWinChannel).toHaveBeenCalledTimes(1);
  });

  it('deletes the existing letter from S3 when result is "-"', async () => {
    ApplicationService.getApplicationById.mockResolvedValue({
      _id: 'a1',
      admission_letter: { admission_file_path: `${studentId}/admission/x.pdf` }
    });
    ApplicationService.updateApplication.mockResolvedValue({});
    deleteS3Object.mockResolvedValue();
    StudentService.getStudentByIdPopulated.mockResolvedValue({
      _id: { toString: () => studentId },
      firstname: 'Stu',
      lastname: 'Dent',
      agents: [],
      editors: []
    });
    const res = mockRes();
    const next = jest.fn();

    await updateStudentApplicationResult(
      mockReq({
        user: admin,
        params: { studentId, applicationId: 'a1', result: '-' }
      }),
      res,
      next
    );

    expect(deleteS3Object).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('throws 500 when deleting the existing letter from S3 fails (result "-")', async () => {
    ApplicationService.getApplicationById.mockResolvedValue({
      _id: 'a1',
      admission_letter: { admission_file_path: `${studentId}/admission/x.pdf` }
    });
    deleteS3Object.mockRejectedValue(new Error('s3 boom'));
    const next = jest.fn();

    await updateStudentApplicationResult(
      mockReq({
        user: admin,
        params: { studentId, applicationId: 'a1', result: '-' }
      }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(500);
  });

  it('throws 404 when the student is missing', async () => {
    ApplicationService.updateApplication.mockResolvedValue({});
    ApplicationService.getApplicationById.mockResolvedValue({ _id: 'a1' });
    StudentService.getStudentByIdPopulated.mockResolvedValue(null);
    const next = jest.fn();

    await updateStudentApplicationResult(
      mockReq({
        user: admin,
        params: { studentId, applicationId: 'a1', result: 'X' }
      }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });
});

describe('deleteProfileFile', () => {
  it('returns 404 when the student is missing', async () => {
    StudentService.getStudentDocById.mockResolvedValue(null);
    const next = jest.fn();

    await deleteProfileFile(
      mockReq({ params: { studentId, category: 'CV' } }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });

  it('returns 404 when the document is missing', async () => {
    StudentService.getStudentDocById.mockResolvedValue({ profile: [] });
    const next = jest.fn();

    await deleteProfileFile(
      mockReq({ params: { studentId, category: 'CV' } }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });

  it('returns 404 when the document has no path', async () => {
    StudentService.getStudentDocById.mockResolvedValue({
      profile: [{ name: 'CV', path: '' }]
    });
    const next = jest.fn();

    await deleteProfileFile(
      mockReq({ params: { studentId, category: 'CV' } }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });

  it('deletes the S3 object, marks the document Missing and returns 200', async () => {
    const doc = { name: 'CV', path: `${studentId}/CV.pdf` };
    const studentDoc = {
      profile: [doc],
      save: jest.fn()
    };
    StudentService.getStudentDocById.mockResolvedValue(studentDoc);
    deleteS3Object.mockResolvedValue();
    const res = mockRes();
    const next = jest.fn();

    await deleteProfileFile(
      mockReq({ params: { studentId, category: 'CV' } }),
      res,
      next
    );

    expect(deleteS3Object).toHaveBeenCalledTimes(1);
    expect(doc.status).toBe('missing');
    expect(doc.path).toBe('');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('throws 500 when the S3 delete fails', async () => {
    const doc = { name: 'CV', path: `${studentId}/CV.pdf` };
    StudentService.getStudentDocById.mockResolvedValue({
      profile: [doc],
      save: jest.fn()
    });
    deleteS3Object.mockRejectedValue(new Error('s3 boom'));
    const next = jest.fn();

    await deleteProfileFile(
      mockReq({ params: { studentId, category: 'CV' } }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(500);
  });
});

describe('deleteVPDFile', () => {
  it('returns 404 when the application is missing', async () => {
    ApplicationService.getApplicationDocByIdWithProgram.mockResolvedValue(null);
    const next = jest.fn();

    await deleteVPDFile(
      mockReq({ params: { applicationId: 'a1', fileType: 'VPD' } }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });

  it('returns 404 when the VPD file does not exist', async () => {
    ApplicationService.getApplicationDocByIdWithProgram.mockResolvedValue({
      uni_assist: { vpd_file_path: '' }
    });
    const next = jest.fn();

    await deleteVPDFile(
      mockReq({ params: { applicationId: 'a1', fileType: 'VPD' } }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });

  it('deletes the S3 object and updates the application (200)', async () => {
    ApplicationService.getApplicationDocByIdWithProgram.mockResolvedValue({
      uni_assist: { vpd_file_path: `${studentId}/vpd.pdf`, status: 'uploaded' }
    });
    deleteS3Object.mockResolvedValue();
    ApplicationService.updateApplication.mockResolvedValue({ _id: 'a1' });
    const res = mockRes();
    const next = jest.fn();

    await deleteVPDFile(
      mockReq({ params: { applicationId: 'a1', fileType: 'VPD' } }),
      res,
      next
    );

    expect(deleteS3Object).toHaveBeenCalledTimes(1);
    expect(ApplicationService.updateApplication).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 404 when the VPDConfirmation file does not exist', async () => {
    ApplicationService.getApplicationDocByIdWithProgram.mockResolvedValue({
      uni_assist: { vpd_paid_confirmation_file_path: '' }
    });
    const next = jest.fn();

    await deleteVPDFile(
      mockReq({ params: { applicationId: 'a1', fileType: 'VPDConfirmation' } }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });

  it('deletes a VPDConfirmation file from S3 and clears its path (200)', async () => {
    ApplicationService.getApplicationDocByIdWithProgram.mockResolvedValue({
      uni_assist: {
        vpd_paid_confirmation_file_path: `${studentId}/vpdconf.pdf`,
        status: 'uploaded'
      }
    });
    deleteS3Object.mockResolvedValue();
    ApplicationService.updateApplication.mockResolvedValue({ _id: 'a1' });
    const res = mockRes();
    const next = jest.fn();

    await deleteVPDFile(
      mockReq({ params: { applicationId: 'a1', fileType: 'VPDConfirmation' } }),
      res,
      next
    );

    expect(deleteS3Object).toHaveBeenCalledTimes(1);
    expect(ApplicationService.updateApplication).toHaveBeenCalledWith(
      { _id: 'a1' },
      expect.objectContaining({
        uni_assist: expect.objectContaining({
          vpd_paid_confirmation_file_path: ''
        })
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('removeNotification', () => {
  it('marks the notification key true on the user and returns 200', async () => {
    const me = { notification: { foo: false } };
    UserService.getUserDocById.mockResolvedValue(me);
    UserService.updateUser.mockResolvedValue();
    const res = mockRes();
    const next = jest.fn();

    await removeNotification(
      mockReq({ user: admin, body: { notification_key: 'foo' } }),
      res,
      next
    );

    expect(UserService.updateUser).toHaveBeenCalledWith(admin._id.toString(), {
      notification: { foo: true }
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('removeAgentNotification', () => {
  it('throws 403 when the student id is not in the notification list', async () => {
    UserService.getAgentDocById.mockResolvedValue({
      agent_notification: { isRead_new_base_docs_uploaded: [] }
    });
    const next = jest.fn();

    await removeAgentNotification(
      mockReq({
        user: admin,
        body: {
          notification_key: 'isRead_new_base_docs_uploaded',
          student_id: studentId
        }
      }),
      mockRes(),
      next
    );

    expect(next.mock.calls[0][0].statusCode).toBe(403);
  });

  it('splices out the matched student notification and returns 200', async () => {
    const me = {
      agent_notification: {
        isRead_new_base_docs_uploaded: [{ student_id: studentId }]
      },
      save: jest.fn().mockResolvedValue()
    };
    UserService.getAgentDocById.mockResolvedValue(me);
    const res = mockRes();
    const next = jest.fn();

    await removeAgentNotification(
      mockReq({
        user: admin,
        body: {
          notification_key: 'isRead_new_base_docs_uploaded',
          student_id: studentId
        }
      }),
      res,
      next
    );

    expect(me.agent_notification.isRead_new_base_docs_uploaded).toHaveLength(0);
    expect(me.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('getMyAcademicBackground', () => {
  it('returns the academic background plus the survey link', async () => {
    const me = {
      agents: [],
      editors: [],
      academic_background: { foo: 'bar' },
      application_preference: {},
      save: jest.fn().mockResolvedValue()
    };
    UserService.getUserDocById.mockResolvedValue(me);
    BasedocumentationslinkService.findByCategory.mockResolvedValue({
      link: 'http://survey'
    });
    const res = mockRes();
    const next = jest.fn();

    await getMyAcademicBackground(
      mockReq({ user: { _id: admin._id } }),
      res,
      next
    );

    expect(BasedocumentationslinkService.findByCategory).toHaveBeenCalledWith(
      'survey'
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        survey_link: { link: 'http://survey' }
      })
    );
  });

  it('initialises academic_background when undefined', async () => {
    const me = {
      agents: [],
      editors: [],
      academic_background: undefined,
      application_preference: {},
      save: jest.fn().mockResolvedValue()
    };
    UserService.getUserDocById.mockResolvedValue(me);
    BasedocumentationslinkService.findByCategory.mockResolvedValue(null);
    const res = mockRes();
    const next = jest.fn();

    await getMyAcademicBackground(
      mockReq({ user: { _id: admin._id } }),
      res,
      next
    );

    expect(me.academic_background).toEqual({});
    expect(me.save).toHaveBeenCalled();
  });
});
