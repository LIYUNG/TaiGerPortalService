import { Role } from '@taiger-common/core';

// Mock every external boundary so the service logic is tested in isolation.
jest.mock('../../services/email/configuration', () => ({
  sendEmailWithAttachments: jest.fn()
}));
jest.mock('../../aws/s3', () => ({
  getS3Object: jest.fn(),
  headS3ObjectSize: jest.fn()
}));
jest.mock('../../services/users', () => ({
  findUsersByIds: jest.fn()
}));
jest.mock('../../services/students', () => ({
  getStudentById: jest.fn()
}));
jest.mock('../../services/documentthreads', () => ({
  getThreadByIdLean: jest.fn()
}));

import { sendEmailWithAttachments } from '../../services/email/configuration';
import { getS3Object, headS3ObjectSize } from '../../aws/s3';
import UserService from '../../services/users';
import StudentService from '../../services/students';
import DocumentThreadService from '../../services/documentthreads';
import ForwardDocumentsService from '../../services/forwardDocuments';

const oid = (id) => ({ toString: () => id });

const STUDENT_ID = '507f1f77bcf86cd799439055';

const agentUser = (id, email) => ({
  _id: oid(id),
  firstname: 'Ag',
  lastname: 'Ent',
  email,
  role: Role.Agent
});

const baseStudent = () => ({
  _id: oid(STUDENT_ID),
  firstname: 'Stu',
  lastname: 'Dent',
  profile: [
    { name: 'transcript.pdf', path: 'students/abc/transcript.pdf' },
    { name: 'passport.pdf', path: 'students/abc/passport.pdf' }
  ]
});

const cvThread = (studentId = STUDENT_ID) => ({
  _id: oid('thread-cv'),
  student_id: oid(studentId),
  file_type: 'CV',
  messages: [
    { file: [{ name: 'cv_v1.pdf', path: 'students/abc/cv_v1.pdf' }] },
    { file: [{ name: 'cv_v2.pdf', path: 'students/abc\\cv_v2.pdf' }] }
  ]
});

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) so any unconsumed mockResolvedValueOnce
  // queue from a prior test (e.g. an empty Bcc that never triggered a lookup)
  // does not leak into the next test's findUsersByIds calls.
  jest.resetAllMocks();
  // Each stored file reports a small size by default (well under the limit).
  (headS3ObjectSize as jest.Mock).mockResolvedValue(1024);
  (getS3Object as jest.Mock).mockResolvedValue(new Uint8Array([1, 2, 3]));
  (sendEmailWithAttachments as jest.Mock).mockResolvedValue({ accepted: [] });
  (StudentService.getStudentById as jest.Mock).mockResolvedValue(baseStudent());
});

describe('forwardStudentDocuments', () => {
  it('resolves recipient emails from ids server-side and sends with attachments', async () => {
    (UserService.findUsersByIds as jest.Mock)
      .mockResolvedValueOnce([agentUser('rid1', 'to@taiger.com')]) // To
      .mockResolvedValueOnce([agentUser('cid1', 'cc@taiger.com')]) // Cc
      .mockResolvedValueOnce([]); // Bcc
    (DocumentThreadService.getThreadByIdLean as jest.Mock).mockResolvedValue(
      cvThread()
    );

    const result = await ForwardDocumentsService.forwardStudentDocuments({
      studentId: STUDENT_ID,
      recipientIds: ['rid1'],
      ccIds: ['cid1'],
      bccIds: [],
      threadIds: ['thread-cv'],
      baseDocumentNames: ['transcript.pdf'],
      subject: '  ',
      message: 'Hi',
      program: {
        school: 'TUM',
        program_name: 'CSE',
        degree: 'M.Sc.',
        semester: 'WS24'
      }
    });

    expect(sendEmailWithAttachments).toHaveBeenCalledTimes(1);
    const arg = (sendEmailWithAttachments as jest.Mock).mock.calls[0][0];
    // Emails come from the resolved users, never from the client payload.
    expect(arg.to).toEqual(['to@taiger.com']);
    expect(arg.cc).toEqual(['cc@taiger.com']);
    // transcript (base) + latest CV file => 2 attachments, all Buffers.
    expect(arg.attachments).toHaveLength(2);
    expect(arg.attachments.every((a) => Buffer.isBuffer(a.content))).toBe(true);
    // The email body lists the attached files and the program details.
    expect(arg.message).toContain('transcript.pdf');
    expect(arg.message).toContain('cv_v2.pdf');
    expect(arg.message).toContain('TUM');
    expect(arg.message).toContain('CSE');
    expect(arg.message).toContain('WS24');
    // Latest message's file wins (cv_v2), with the backslash key normalised.
    expect(getS3Object).toHaveBeenCalledWith(
      expect.anything(),
      'students/abc/cv_v2.pdf'
    );
    expect(result).toEqual({
      status: 'sent',
      sentTo: 1,
      ccCount: 1,
      bccCount: 0,
      attachmentCount: 2,
      skipped: []
    });
  });

  it('uses the sender note as the intro without duplicating the default sentence', async () => {
    (UserService.findUsersByIds as jest.Mock)
      .mockResolvedValueOnce([agentUser('rid1', 'to@taiger.com')])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await ForwardDocumentsService.forwardStudentDocuments({
      studentId: STUDENT_ID,
      recipientIds: ['rid1'],
      baseDocumentNames: ['transcript.pdf'],
      message: 'Here are the files you requested.'
    });

    const arg = (sendEmailWithAttachments as jest.Mock).mock.calls[0][0];
    expect(arg.message).toContain('Here are the files you requested.');
    // No appended default "Please find attached…" sentence when a note is given.
    expect(arg.message).not.toContain('Please find attached');
  });

  it('falls back to a default intro sentence when no note is provided', async () => {
    (UserService.findUsersByIds as jest.Mock)
      .mockResolvedValueOnce([agentUser('rid1', 'to@taiger.com')])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await ForwardDocumentsService.forwardStudentDocuments({
      studentId: STUDENT_ID,
      recipientIds: ['rid1'],
      baseDocumentNames: ['transcript.pdf']
    });

    const arg = (sendEmailWithAttachments as jest.Mock).mock.calls[0][0];
    expect(arg.message).toContain('Please find attached');
    // Only once.
    expect(arg.message.match(/Please find attached/g)).toHaveLength(1);
  });

  it('appends the file extension (from the S3 key) to base-document names', async () => {
    (UserService.findUsersByIds as jest.Mock)
      .mockResolvedValueOnce([agentUser('rid1', 'to@taiger.com')])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    // Base-document names are categories without an extension; the extension
    // lives in the stored path.
    (StudentService.getStudentById as jest.Mock).mockResolvedValueOnce({
      _id: oid(STUDENT_ID),
      firstname: 'Stu',
      lastname: 'Dent',
      profile: [{ name: 'Transcript', path: 'students/abc/raw_upload.pdf' }]
    });

    await ForwardDocumentsService.forwardStudentDocuments({
      studentId: STUDENT_ID,
      recipientIds: ['rid1'],
      baseDocumentNames: ['Transcript']
    });

    const arg = (sendEmailWithAttachments as jest.Mock).mock.calls[0][0];
    expect(arg.attachments).toHaveLength(1);
    expect(arg.attachments[0].filename).toBe('Transcript.pdf');
  });

  it('rejects when a recipient id does not resolve to a user', async () => {
    (UserService.findUsersByIds as jest.Mock).mockResolvedValueOnce([]); // none found
    (DocumentThreadService.getThreadByIdLean as jest.Mock).mockResolvedValue(
      cvThread()
    );

    await expect(
      ForwardDocumentsService.forwardStudentDocuments({
        studentId: STUDENT_ID,
        recipientIds: ['ghost'],
        threadIds: ['thread-cv']
      })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(sendEmailWithAttachments).not.toHaveBeenCalled();
  });

  it('rejects when a recipient is not TaiGer staff', async () => {
    (UserService.findUsersByIds as jest.Mock).mockResolvedValueOnce([
      { _id: oid('s1'), email: 'student@x.com', role: Role.Student }
    ]);

    await expect(
      ForwardDocumentsService.forwardStudentDocuments({
        studentId: STUDENT_ID,
        recipientIds: ['s1'],
        baseDocumentNames: ['transcript.pdf']
      })
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(sendEmailWithAttachments).not.toHaveBeenCalled();
  });

  it('rejects a thread that belongs to another student (no cross-student leakage)', async () => {
    (UserService.findUsersByIds as jest.Mock)
      .mockResolvedValueOnce([agentUser('rid1', 'to@taiger.com')])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    (DocumentThreadService.getThreadByIdLean as jest.Mock).mockResolvedValue(
      cvThread('someoneElse')
    );

    await expect(
      ForwardDocumentsService.forwardStudentDocuments({
        studentId: STUDENT_ID,
        recipientIds: ['rid1'],
        threadIds: ['thread-cv']
      })
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(sendEmailWithAttachments).not.toHaveBeenCalled();
  });

  it('requires at least one recipient', async () => {
    await expect(
      ForwardDocumentsService.forwardStudentDocuments({
        studentId: STUDENT_ID,
        recipientIds: [],
        baseDocumentNames: ['transcript.pdf']
      })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(UserService.findUsersByIds).not.toHaveBeenCalled();
  });

  it('requires at least one document to attach', async () => {
    (UserService.findUsersByIds as jest.Mock)
      .mockResolvedValueOnce([agentUser('rid1', 'to@taiger.com')])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await expect(
      ForwardDocumentsService.forwardStudentDocuments({
        studentId: STUDENT_ID,
        recipientIds: ['rid1'],
        threadIds: [],
        baseDocumentNames: []
      })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(sendEmailWithAttachments).not.toHaveBeenCalled();
  });

  it('asks for confirmation (does not send) when a thread has no uploaded file', async () => {
    (UserService.findUsersByIds as jest.Mock)
      .mockResolvedValueOnce([agentUser('rid1', 'to@taiger.com')])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    (DocumentThreadService.getThreadByIdLean as jest.Mock).mockResolvedValue({
      _id: oid('thread-empty'),
      student_id: oid(STUDENT_ID),
      file_type: 'ML',
      messages: [] // nothing uploaded yet
    });

    const result = await ForwardDocumentsService.forwardStudentDocuments({
      studentId: STUDENT_ID,
      recipientIds: ['rid1'],
      threadIds: ['thread-empty']
    });

    expect(result).toEqual({ status: 'missing_documents', missing: ['ML'] });
    expect(getS3Object).not.toHaveBeenCalled();
    expect(sendEmailWithAttachments).not.toHaveBeenCalled();
  });

  it('asks for confirmation when a stored file is missing from S3', async () => {
    (UserService.findUsersByIds as jest.Mock)
      .mockResolvedValueOnce([agentUser('rid1', 'to@taiger.com')])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    (DocumentThreadService.getThreadByIdLean as jest.Mock).mockResolvedValue(
      cvThread()
    );
    // The HeadObject existence check reports the object as absent.
    (headS3ObjectSize as jest.Mock).mockResolvedValue(null);

    const result = await ForwardDocumentsService.forwardStudentDocuments({
      studentId: STUDENT_ID,
      recipientIds: ['rid1'],
      threadIds: ['thread-cv']
    });

    expect(result).toEqual({ status: 'missing_documents', missing: ['CV'] });
    // Existence failed, so we never download the body, and never send.
    expect(getS3Object).not.toHaveBeenCalled();
    expect(sendEmailWithAttachments).not.toHaveBeenCalled();
  });

  it('with confirmMissing: sends the available documents and reports the skipped ones', async () => {
    (UserService.findUsersByIds as jest.Mock)
      .mockResolvedValueOnce([agentUser('rid1', 'to@taiger.com')])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    // The CV thread has no uploaded file; the base transcript does.
    (DocumentThreadService.getThreadByIdLean as jest.Mock).mockResolvedValue({
      _id: oid('thread-empty'),
      student_id: oid(STUDENT_ID),
      file_type: 'ML',
      messages: []
    });

    const result = await ForwardDocumentsService.forwardStudentDocuments({
      studentId: STUDENT_ID,
      recipientIds: ['rid1'],
      threadIds: ['thread-empty'],
      baseDocumentNames: ['transcript.pdf'],
      confirmMissing: true
    });

    expect(sendEmailWithAttachments).toHaveBeenCalledTimes(1);
    const arg = (sendEmailWithAttachments as jest.Mock).mock.calls[0][0];
    // Only the available transcript is attached; the empty ML is skipped.
    expect(arg.attachments).toHaveLength(1);
    expect(result).toMatchObject({
      status: 'sent',
      attachmentCount: 1,
      skipped: ['ML']
    });
  });

  it('with confirmMissing: still errors when NONE of the documents have a file', async () => {
    (UserService.findUsersByIds as jest.Mock)
      .mockResolvedValueOnce([agentUser('rid1', 'to@taiger.com')])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    (DocumentThreadService.getThreadByIdLean as jest.Mock).mockResolvedValue({
      _id: oid('thread-empty'),
      student_id: oid(STUDENT_ID),
      file_type: 'ML',
      messages: []
    });

    await expect(
      ForwardDocumentsService.forwardStudentDocuments({
        studentId: STUDENT_ID,
        recipientIds: ['rid1'],
        threadIds: ['thread-empty'],
        confirmMissing: true
      })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(sendEmailWithAttachments).not.toHaveBeenCalled();
  });

  it('rejects when the combined attachment size exceeds the limit', async () => {
    (UserService.findUsersByIds as jest.Mock)
      .mockResolvedValueOnce([agentUser('rid1', 'to@taiger.com')])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    (DocumentThreadService.getThreadByIdLean as jest.Mock).mockResolvedValue(
      cvThread()
    );
    // 25 MB file — over the 20 MB ceiling.
    (headS3ObjectSize as jest.Mock).mockResolvedValue(25 * 1024 * 1024);

    await expect(
      ForwardDocumentsService.forwardStudentDocuments({
        studentId: STUDENT_ID,
        recipientIds: ['rid1'],
        threadIds: ['thread-cv']
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining('limit')
    });
    // Over the limit, so we never download the body and never send.
    expect(getS3Object).not.toHaveBeenCalled();
    expect(sendEmailWithAttachments).not.toHaveBeenCalled();
  });

  it('asks for confirmation for an unknown base document name', async () => {
    (UserService.findUsersByIds as jest.Mock)
      .mockResolvedValueOnce([agentUser('rid1', 'to@taiger.com')])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await ForwardDocumentsService.forwardStudentDocuments({
      studentId: STUDENT_ID,
      recipientIds: ['rid1'],
      baseDocumentNames: ['does-not-exist.pdf']
    });

    expect(result).toEqual({
      status: 'missing_documents',
      missing: ['does-not-exist.pdf']
    });
    expect(sendEmailWithAttachments).not.toHaveBeenCalled();
  });
});
