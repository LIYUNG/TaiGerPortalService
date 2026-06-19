import { DocumentStatusType } from '@taiger-common/model';

// Mock the send boundary so no real SMTP/SES is used. `sendEmail` is used by
// most templates; `transporter.sendMail` is used by the calendar-event emails.
jest.mock('../../services/email/configuration', () => ({
  sendEmail: jest.fn(),
  transporter: { sendMail: jest.fn() }
}));

import { sendEmail, transporter } from '../../services/email/configuration';
import * as email from '../../services/email';

const oid = (id) => ({ toString: () => id });

const recipient = {
  _id: oid('507f1f77bcf86cd799439011'),
  id: '507f1f77bcf86cd799439011',
  firstname: 'Recip',
  lastname: 'Ient',
  address: 'recip@example.com'
};

const program = {
  _id: oid('507f1f77bcf86cd7994390aa'),
  school: 'TUM',
  program_name: 'CSE',
  degree: 'M.Sc.',
  semester: 'WS'
};

const student = {
  _id: oid('507f1f77bcf86cd799439055'),
  firstname: 'Stu',
  lastname: 'Dent',
  email: 'stu@example.com'
};

const people = [
  { firstname: 'Al', lastname: 'Pha', email: 'a@example.com' },
  { firstname: 'Be', lastname: 'Ta', email: 'b@example.com' }
];

const event = {
  _id: oid('507f1f77bcf86cd7994390ee'),
  start: '2025-01-01T10:00:00.000Z',
  end: '2025-01-01T11:00:00.000Z',
  description: 'Discussion',
  meetingLink: 'https://meet.example.com/abc',
  title: 'Meeting'
};

beforeEach(() => {
  jest.clearAllMocks();
});

// Asserts sendEmail was called once with (recipient, subject, message)
const expectSent = (subjectIncludes) => {
  expect(sendEmail).toHaveBeenCalledTimes(1);
  const [to, subject, message] = sendEmail.mock.calls[0];
  expect(to).toBe(recipient);
  expect(typeof subject).toBe('string');
  expect(typeof message).toBe('string');
  if (subjectIncludes) {
    expect(subject).toContain(subjectIncludes);
  }
};

describe('email service - sendEmail-based templates', () => {
  it('updateNotificationEmail', async () => {
    await email.updateNotificationEmail(recipient, {});
    expectSent('user role');
  });

  it('updatePermissionNotificationEmail', async () => {
    await email.updatePermissionNotificationEmail(recipient, {});
    expectSent('user permissions');
  });

  it('deleteTemplateSuccessEmail', async () => {
    await email.deleteTemplateSuccessEmail(recipient, {
      category_name: 'CV',
      updatedAt: '2025-01-01'
    });
    expectSent('deleted successfully');
  });

  it('sendInvitationReminderEmail', async () => {
    await email.sendInvitationReminderEmail(recipient, {
      token: 'tok',
      password: 'pw'
    });
    expectSent('Activation Reminder');
  });

  it('sendInvitationEmail', async () => {
    await email.sendInvitationEmail(recipient, {
      token: 'tok',
      password: 'pw'
    });
    expectSent('Email verification');
  });

  it('sendConfirmationEmail', async () => {
    await email.sendConfirmationEmail(recipient, 'token123');
    expectSent('Email verification');
  });

  it('sendForgotPasswordEmail', async () => {
    await email.sendForgotPasswordEmail(recipient, 'token123');
    expectSent('Password reset instructions');
  });

  it('sendPasswordResetEmail', async () => {
    await email.sendPasswordResetEmail(recipient);
    expectSent('Password reset successfully');
  });

  it('sendAccountActivationConfirmationEmail', async () => {
    await email.sendAccountActivationConfirmationEmail(recipient, {});
    expectSent('activation confirmation');
  });

  it('sendAgentUploadedProfileFilesForStudentEmail', async () => {
    await email.sendAgentUploadedProfileFilesForStudentEmail(recipient, {
      uploaded_documentname: 'CV',
      agent_firstname: 'Ag',
      agent_lastname: 'Ent',
      uploaded_updatedAt: '2025-01-01'
    });
    expectSent('successfully uploaded');
  });

  it('sendAgentUploadedVPDForStudentEmail', async () => {
    await email.sendAgentUploadedVPDForStudentEmail(recipient, {
      fileType: 'VPD',
      agent_firstname: 'Ag',
      agent_lastname: 'Ent',
      uploaded_documentname: 'VPD doc',
      uploaded_updatedAt: '2025-01-01'
    });
    expectSent('successfully uploaded');
  });

  it('sendUploadedProfileFilesRemindForAgentEmail', async () => {
    await email.sendUploadedProfileFilesRemindForAgentEmail(recipient, {
      student_firstname: 'Stu',
      student_lastname: 'Dent',
      student_id: '507f1f77bcf86cd799439055',
      uploaded_documentname: 'CV',
      uploaded_updatedAt: '2025-01-01'
    });
    expectSent('uploaded from');
  });

  it('sendUploadedVPDRemindForAgentEmail', async () => {
    await email.sendUploadedVPDRemindForAgentEmail(recipient, {
      fileType: 'VPD',
      student_firstname: 'Stu',
      student_lastname: 'Dent',
      student_id: '507f1f77bcf86cd799439055',
      uploaded_documentname: 'VPD doc',
      uploaded_updatedAt: '2025-01-01'
    });
    expectSent('uploaded from');
  });

  it('sendChangedProfileFileStatusEmail - rejected branch', async () => {
    await email.sendChangedProfileFileStatusEmail(recipient, {
      status: DocumentStatusType.Rejected,
      category: 'CV',
      message: 'bad scan'
    });
    expectSent('Action Required');
  });

  it('sendChangedProfileFileStatusEmail - valid branch', async () => {
    await email.sendChangedProfileFileStatusEmail(recipient, {
      status: DocumentStatusType.Accepted,
      category: 'CV',
      message: ''
    });
    expectSent('Closed');
  });

  it('updateCredentialsEmail', async () => {
    await email.updateCredentialsEmail(recipient, {});
    expectSent('passwords updated');
  });

  it('informAgentManagerNewStudentEmail', async () => {
    await email.informAgentManagerNewStudentEmail(recipient, {
      std_firstname: 'Stu',
      std_lastname: 'Dent',
      std_id: '507f1f77bcf86cd799439055',
      agents: people
    });
    expectSent('New student');
  });

  it('informAgentNewStudentEmail', async () => {
    await email.informAgentNewStudentEmail(recipient, {
      std_firstname: 'Stu',
      std_lastname: 'Dent',
      std_id: '507f1f77bcf86cd799439055'
    });
    expectSent('assigned to you');
  });

  it('informStudentTheirAgentEmail', async () => {
    await email.informStudentTheirAgentEmail(recipient, { agents: people });
    expectSent('Your Agent');
  });

  it('informAgentEssayAssignedEmail - Essay branch', async () => {
    await email.informAgentEssayAssignedEmail(recipient, {
      thread_id: 't1',
      file_type: 'Essay',
      program,
      std_firstname: 'Stu',
      std_lastname: 'Dent',
      essay_writers: people
    });
    expectSent('Essay writer assigned');
  });

  it('informAgentEssayAssignedEmail - Editor branch with no program', async () => {
    // file_type !== 'Essay' -> "Editor"; missing program -> empty docName.
    await email.informAgentEssayAssignedEmail(recipient, {
      thread_id: 't1',
      file_type: 'ML',
      std_firstname: 'Stu',
      std_lastname: 'Dent',
      essay_writers: people
    });
    expectSent('Editor assigned');
  });

  it('informEssayWriterNewEssayEmail - no program branch', async () => {
    await email.informEssayWriterNewEssayEmail(recipient, {
      thread_id: 't1',
      file_type: 'ML',
      std_firstname: 'Stu',
      std_lastname: 'Dent'
    });
    expectSent('New ML');
  });

  it('informAgentStudentAssignedEmail', async () => {
    await email.informAgentStudentAssignedEmail(recipient, {
      std_firstname: 'Stu',
      std_lastname: 'Dent',
      std_id: '507f1f77bcf86cd799439055',
      editors: people
    });
    expectSent('Editor assigned');
  });

  it('informEssayWriterNewEssayEmail', async () => {
    await email.informEssayWriterNewEssayEmail(recipient, {
      thread_id: 't1',
      file_type: 'Essay',
      program,
      std_firstname: 'Stu',
      std_lastname: 'Dent'
    });
    expectSent('assigned to you');
  });

  it('informEditorNewStudentEmail', async () => {
    await email.informEditorNewStudentEmail(recipient, {
      std_firstname: 'Stu',
      std_lastname: 'Dent',
      std_id: '507f1f77bcf86cd799439055'
    });
    expectSent('assigned to you');
  });

  it('informEditorArchivedStudentEmail', async () => {
    await email.informEditorArchivedStudentEmail(recipient, {
      std_firstname: 'Stu',
      std_lastname: 'Dent'
    });
    expectSent('is close');
  });

  it('informStudentArchivedStudentEmail', async () => {
    await email.informStudentArchivedStudentEmail(recipient, {
      student: { agents: people }
    });
    expectSent('service ends');
  });

  it('informStudentTheirEssayWriterEmail', async () => {
    await email.informStudentTheirEssayWriterEmail(recipient, {
      thread_id: 't1',
      file_type: 'Essay',
      program,
      editors: people
    });
    expectSent('Essay');
  });

  it('informStudentTheirEssayWriterEmail - Editor branch', async () => {
    // file_type !== 'Essay' -> "Editor" wording on both language halves.
    await email.informStudentTheirEssayWriterEmail(recipient, {
      thread_id: 't1',
      file_type: 'ML',
      program,
      editors: people
    });
    expectSent('Editor');
  });

  it('informStudentTheirEssayWriterEmail - no program branch', async () => {
    await email.informStudentTheirEssayWriterEmail(recipient, {
      thread_id: 't1',
      file_type: 'Essay',
      editors: people // no program -> empty docName
    });
    expectSent('Essay');
  });

  it('informStudentTheirEditorEmail', async () => {
    await email.informStudentTheirEditorEmail(recipient, { editors: people });
    expectSent('Your Editor');
  });

  it('createApplicationToStudentEmail', async () => {
    await email.createApplicationToStudentEmail(recipient, {
      agent_firstname: 'Ag',
      agent_lastname: 'Ent',
      programs: [
        { school: 'TUM', program_name: 'CSE' },
        { school: 'RWTH', program_name: 'CS' }
      ]
    });
    expectSent('New Programs assigned');
  });

  it('UpdateStudentApplicationsEmail - empty applications branch', async () => {
    await email.UpdateStudentApplicationsEmail(recipient, {
      sender_firstname: 'Se',
      sender_lastname: 'Nder',
      student,
      student_applications: [],
      new_app_decided_idx: []
    });
    expectSent('updated application status');
  });

  it('UpdateStudentApplicationsEmail - with applications branch', async () => {
    await email.UpdateStudentApplicationsEmail(recipient, {
      sender_firstname: 'Se',
      sender_lastname: 'Nder',
      student,
      student_applications: [{ programId: program }],
      new_app_decided_idx: [0]
    });
    expectSent('updated application status');
  });

  it('UpdateStudentApplicationsEmail - multiple decided applications (append branch)', async () => {
    await email.UpdateStudentApplicationsEmail(recipient, {
      sender_firstname: 'Se',
      sender_lastname: 'Nder',
      student,
      student_applications: [{ programId: program }, { programId: program }],
      new_app_decided_idx: [0, 1]
    });
    expectSent('updated application status');
  });

  it('NewMLRLEssayTasksEmail - empty applications branch (no decided idx)', async () => {
    await email.NewMLRLEssayTasksEmail(recipient, {
      sender_firstname: 'Se',
      sender_lastname: 'Nder',
      student_applications: [{ programId: program }],
      new_app_decided_idx: [] // nothing decided -> applications_name stays ''
    });
    expectSent('updated application status');
  });

  it('NewMLRLEssayTasksEmail - multiple decided applications (append branch)', async () => {
    await email.NewMLRLEssayTasksEmail(recipient, {
      sender_firstname: 'Se',
      sender_lastname: 'Nder',
      student_applications: [{ programId: program }, { programId: program }],
      new_app_decided_idx: [0, 1]
    });
    expectSent('updated application status');
  });

  it('UpdateStudentApplicationsEmail - some applications not decided (includes false side)', async () => {
    // Index 0 is not in new_app_decided_idx (skipped), index 1 is (first kept).
    await email.UpdateStudentApplicationsEmail(recipient, {
      sender_firstname: 'Se',
      sender_lastname: 'Nder',
      student,
      student_applications: [{ programId: program }, { programId: program }],
      new_app_decided_idx: [1]
    });
    expectSent('updated application status');
  });

  it('NewMLRLEssayTasksEmailFromTaiGer - empty applications branch (no decided idx)', async () => {
    await email.NewMLRLEssayTasksEmailFromTaiGer(recipient, {
      sender_firstname: 'Se',
      sender_lastname: 'Nder',
      student_firstname: 'Stu',
      student_lastname: 'Dent',
      student_applications: [{ programId: program }],
      new_app_decided_idx: [] // applications_name stays '' -> skip the </ul> append
    });
    expectSent('updated application status');
  });

  it('NewMLRLEssayTasksEmailFromTaiGer - some applications not decided (includes false side)', async () => {
    await email.NewMLRLEssayTasksEmailFromTaiGer(recipient, {
      sender_firstname: 'Se',
      sender_lastname: 'Nder',
      student_firstname: 'Stu',
      student_lastname: 'Dent',
      student_applications: [{ programId: program }, { programId: program }],
      new_app_decided_idx: [1]
    });
    expectSent('updated application status');
  });

  it('NewMLRLEssayTasksEmail', async () => {
    await email.NewMLRLEssayTasksEmail(recipient, {
      sender_firstname: 'Se',
      sender_lastname: 'Nder',
      student_applications: [{ programId: program }],
      new_app_decided_idx: [0]
    });
    expectSent('updated application status');
  });

  it('NewMLRLEssayTasksEmailFromTaiGer', async () => {
    await email.NewMLRLEssayTasksEmailFromTaiGer(recipient, {
      sender_firstname: 'Se',
      sender_lastname: 'Nder',
      student_firstname: 'Stu',
      student_lastname: 'Dent',
      student_applications: [{ programId: program }],
      new_app_decided_idx: [0]
    });
    expectSent('updated application status');
  });

  it('AdmissionResultInformEmailToTaiGer - admission', async () => {
    await email.AdmissionResultInformEmailToTaiGer(recipient, {
      admission: 'O',
      student_firstname: 'Stu',
      student_lastname: 'Dent',
      student_id: '507f1f77bcf86cd799439055',
      udpatedApplication: { programId: program }
    });
    expectSent('Admission');
  });

  it('AdmissionResultInformEmailToTaiGer - rejection', async () => {
    await email.AdmissionResultInformEmailToTaiGer(recipient, {
      admission: 'X',
      student_firstname: 'Stu',
      student_lastname: 'Dent',
      student_id: '507f1f77bcf86cd799439055',
      udpatedApplication: { programId: program }
    });
    expectSent('Rejection');
  });

  it('sendNewInterviewMessageInThreadEmail', async () => {
    await email.sendNewInterviewMessageInThreadEmail(recipient, {
      interview_id: 'i1',
      program,
      student_firstname: 'Stu',
      student_lastname: 'Dent',
      writer_firstname: 'Wr',
      writer_lastname: 'Iter',
      uploaded_updatedAt: '2025-01-01'
    });
    expectSent('sent a new message');
  });

  it('sendNewApplicationMessageInThreadEmail', async () => {
    await email.sendNewApplicationMessageInThreadEmail(recipient, {
      thread_id: 't1',
      student_firstname: 'Stu',
      student_lastname: 'Dent',
      school: 'TUM',
      program_name: 'CSE',
      uploaded_documentname: 'ML',
      writer_firstname: 'Wr',
      writer_lastname: 'Iter',
      uploaded_updatedAt: '2025-01-01'
    });
    expectSent('sent a new message');
  });

  it('sendNewGeneraldocMessageInThreadEmail', async () => {
    await email.sendNewGeneraldocMessageInThreadEmail(recipient, {
      thread_id: 't1',
      student_firstname: 'Stu',
      student_lastname: 'Dent',
      uploaded_documentname: 'CV',
      writer_firstname: 'Wr',
      writer_lastname: 'Iter',
      uploaded_updatedAt: '2025-01-01'
    });
    expectSent('new message');
  });

  describe('sendSetAsFinalGeneralFileForAgentEmail', () => {
    const base = {
      thread_id: 't1',
      student_firstname: 'Stu',
      student_lastname: 'Dent',
      editor_firstname: 'Ed',
      editor_lastname: 'Itor',
      uploaded_documentname: 'CV',
      uploaded_updatedAt: '2025-01-01'
    };
    it('final branch', async () => {
      await email.sendSetAsFinalGeneralFileForAgentEmail(recipient, {
        ...base,
        isFinalVersion: true
      });
      expectSent('Close');
    });
    it('reopen branch', async () => {
      await email.sendSetAsFinalGeneralFileForAgentEmail(recipient, {
        ...base,
        isFinalVersion: false
      });
      expectSent('Reopen');
    });
  });

  describe('sendSetAsFinalGeneralFileForStudentEmail', () => {
    const base = {
      thread_id: 't1',
      editor_firstname: 'Ed',
      editor_lastname: 'Itor',
      uploaded_documentname: 'CV',
      uploaded_updatedAt: '2025-01-01'
    };
    it('final branch', async () => {
      await email.sendSetAsFinalGeneralFileForStudentEmail(recipient, {
        ...base,
        isFinalVersion: true
      });
      expectSent('finished');
    });
    it('reopen branch', async () => {
      await email.sendSetAsFinalGeneralFileForStudentEmail(recipient, {
        ...base,
        isFinalVersion: false
      });
      expectSent('not finished');
    });
  });

  describe('sendSetAsFinalProgramSpecificFileForStudentEmail', () => {
    const base = {
      thread_id: 't1',
      school: 'TUM',
      program_name: 'CSE',
      editor_firstname: 'Ed',
      editor_lastname: 'Itor',
      uploaded_documentname: 'ML',
      uploaded_updatedAt: '2025-01-01'
    };
    it('final branch', async () => {
      await email.sendSetAsFinalProgramSpecificFileForStudentEmail(recipient, {
        ...base,
        isFinalVersion: true
      });
      expectSent('finished');
    });
    it('reopen branch', async () => {
      await email.sendSetAsFinalProgramSpecificFileForStudentEmail(recipient, {
        ...base,
        isFinalVersion: false
      });
      expectSent('not finished');
    });
  });

  describe('sendSetAsFinalProgramSpecificFileForAgentEmail', () => {
    const base = {
      thread_id: 't1',
      school: 'TUM',
      program_name: 'CSE',
      student_firstname: 'Stu',
      student_lastname: 'Dent',
      editor_firstname: 'Ed',
      editor_lastname: 'Itor',
      uploaded_documentname: 'ML',
      uploaded_updatedAt: '2025-01-01'
    };
    it('final branch', async () => {
      await email.sendSetAsFinalProgramSpecificFileForAgentEmail(recipient, {
        ...base,
        isFinalVersion: true
      });
      expectSent('finished');
    });
    it('reopen branch', async () => {
      await email.sendSetAsFinalProgramSpecificFileForAgentEmail(recipient, {
        ...base,
        isFinalVersion: false
      });
      expectSent('reopen');
    });
  });

  it('assignEssayTaskToEditorEmail', async () => {
    await email.assignEssayTaskToEditorEmail(recipient, {
      student_firstname: 'Stu',
      student_lastname: 'Dent',
      program_name: 'CSE',
      thread_id: 't1'
    });
    expectSent('Assign Essay Writer');
  });

  it('assignDocumentTaskToEditorEmail', async () => {
    await email.assignDocumentTaskToEditorEmail(recipient, {
      student_firstname: 'Stu',
      student_lastname: 'Dent',
      documentname: 'CV',
      thread_id: 't1',
      updatedAt: '2025-01-01'
    });
    expectSent('assigned to you');
  });

  it('assignDocumentTaskToStudentEmail', async () => {
    await email.assignDocumentTaskToStudentEmail(recipient, {
      documentname: 'CV',
      thread_id: 't1',
      updatedAt: '2025-01-01'
    });
    expectSent('New Task');
  });

  it('AnalysedCoursesDataStudentEmail', async () => {
    await email.AnalysedCoursesDataStudentEmail(recipient, {
      student_id: '507f1f77bcf86cd799439055'
    });
    expectSent('Course data analysed');
  });

  it('updateCoursesDataAgentEmail', async () => {
    await email.updateCoursesDataAgentEmail(recipient, {
      student_firstname: 'Stu',
      student_lastname: 'Dent',
      student_id: '507f1f77bcf86cd799439055'
    });
    expectSent('Course anaylsis');
  });

  it('sendSomeReminderEmail', async () => {
    await email.sendSomeReminderEmail(recipient);
    expectSent('File Status changes');
  });

  it('sendAssignEditorReminderEmail', async () => {
    await email.sendAssignEditorReminderEmail(recipient, {
      student_firstname: 'Stu',
      student_lastname: 'Dent',
      student_id: '507f1f77bcf86cd799439055'
    });
    expectSent('Assign Editor Reminder');
  });

  it('sendNoTrainerInterviewRequestsReminderEmail', async () => {
    await email.sendNoTrainerInterviewRequestsReminderEmail(recipient, {
      interviewRequests: [
        {
          _id: oid('507f1f77bcf86cd799439077'),
          student_id: { firstname: 'Stu', lastname: 'Dent' },
          program_id: program,
          interview_date: '2025-01-01'
        }
      ]
    });
    expectSent('Assign Interview Trainer');
  });

  it('sendAssignTrainerReminderEmail', async () => {
    await email.sendAssignTrainerReminderEmail(recipient, {
      program,
      student_firstname: 'Stu',
      student_lastname: 'Dent',
      interview_id: 'i1'
    });
    expectSent('Assign Interview Trainer');
  });

  it('sendAgentNewMessageReminderEmail', async () => {
    await email.sendAgentNewMessageReminderEmail(recipient, {
      student_firstname: 'Stu',
      student_lastname: 'Dent',
      student_id: '507f1f77bcf86cd799439055'
    });
    expectSent('New Message');
  });

  it('sendStudentNewMessageReminderEmail', async () => {
    await email.sendStudentNewMessageReminderEmail(recipient, {
      student_id: '507f1f77bcf86cd799439055',
      taiger_user_firstname: 'Ta',
      taiger_user_lastname: 'Iger'
    });
    expectSent('New Message');
  });

  it('MeetingAdjustReminderEmail', async () => {
    await email.MeetingAdjustReminderEmail(recipient, {
      taiger_user_firstname: 'Ta',
      taiger_user_lastname: 'Iger',
      role: 'Student',
      meeting_time: '2025-01-01 10:00'
    });
    expectSent('Meeting confirmation required');
  });

  it('MeetingConfirmationReminderEmail', async () => {
    await email.MeetingConfirmationReminderEmail(recipient, {
      taiger_user_firstname: 'Ta',
      taiger_user_lastname: 'Iger',
      role: 'Agent',
      meeting_time: '2025-01-01 10:00'
    });
    expectSent('Meeting Invitation');
  });

  it('MeetingAdjustReminderEmail - non-Student role (agent calendar branch)', async () => {
    await email.MeetingAdjustReminderEmail(recipient, {
      taiger_user_firstname: 'Ta',
      taiger_user_lastname: 'Iger',
      role: 'Agent',
      meeting_time: '2025-01-01 10:00'
    });
    expectSent('Meeting confirmation required');
  });

  it('MeetingConfirmationReminderEmail - Student role (student calendar branch)', async () => {
    await email.MeetingConfirmationReminderEmail(recipient, {
      taiger_user_firstname: 'Ta',
      taiger_user_lastname: 'Iger',
      role: 'Student',
      meeting_time: '2025-01-01 10:00'
    });
    expectSent('Meeting Invitation');
  });

  it('MeetingReminderEmail', async () => {
    await email.MeetingReminderEmail(recipient, { event });
    expectSent('Meeting Reminder');
  });

  it('UnconfirmedMeetingReminderEmail', async () => {
    await email.UnconfirmedMeetingReminderEmail(recipient, {
      role: 'Student',
      id: '507f1f77bcf86cd799439055',
      firstname: 'Other',
      lastname: 'User'
    });
    expectSent('Meeting to confirm reminder');
  });

  it('UnconfirmedMeetingReminderEmail - non-Student role (agent calendar branch)', async () => {
    await email.UnconfirmedMeetingReminderEmail(recipient, {
      role: 'Agent',
      id: '507f1f77bcf86cd799439055',
      firstname: 'Other',
      lastname: 'User'
    });
    expectSent('Meeting to confirm reminder');
  });

  it('TicketCreatedAgentEmail', async () => {
    await email.TicketCreatedAgentEmail(recipient, {
      program,
      student
    });
    expectSent('Update request');
  });

  it('TicketResolvedRequesterReminderEmail', async () => {
    await email.TicketResolvedRequesterReminderEmail(recipient, {
      program,
      taigerUser: { firstname: 'Ta', lastname: 'Iger' }
    });
    expectSent('Program Update Request');
  });

  it('TicketResolvedStudentEmail', async () => {
    await email.TicketResolvedStudentEmail(recipient, {
      program,
      student,
      agent: { firstname: 'Ag', lastname: 'Ent' }
    });
    expectSent('Request for');
  });

  it('sendAssignEssayWriterReminderEmail', async () => {
    await email.sendAssignEssayWriterReminderEmail(recipient, {
      student_firstname: 'Stu',
      student_lastname: 'Dent',
      student_id: '507f1f77bcf86cd799439055'
    });
    expectSent('Assign Essay Writer Reminder');
  });

  it('sendAssignedInterviewTrainerToTrainerEmail', async () => {
    await email.sendAssignedInterviewTrainerToTrainerEmail(recipient, {
      interview: {
        _id: oid('507f1f77bcf86cd799439088'),
        program_id: program,
        student_id: { firstname: 'Stu', lastname: 'Dent' }
      }
    });
    expectSent('Interview Training Request');
  });

  it('sendAssignedInterviewTrainerToStudentEmail', async () => {
    await email.sendAssignedInterviewTrainerToStudentEmail(recipient, {
      interview: {
        _id: oid('507f1f77bcf86cd799439088'),
        program_id: program,
        student_id: { firstname: 'Stu', lastname: 'Dent' },
        trainer_id: people
      }
    });
    expectSent('Interview Trainer assigned');
  });

  it('InterviewTrainingReminderEmail', async () => {
    await email.InterviewTrainingReminderEmail(recipient, { event });
    expectSent('Training Reminder');
  });

  describe('sendSetAsFinalInterviewEmail', () => {
    const interview = {
      _id: oid('507f1f77bcf86cd799439088'),
      program_id: program,
      student_id: { firstname: 'Stu', lastname: 'Dent' }
    };
    const user = { firstname: 'Us', lastname: 'Er' };
    it('closed branch', async () => {
      await email.sendSetAsFinalInterviewEmail(recipient, {
        isClosed: true,
        interview,
        user
      });
      expectSent('Close');
    });
    it('reopen branch', async () => {
      await email.sendSetAsFinalInterviewEmail(recipient, {
        isClosed: false,
        interview,
        user
      });
      expectSent('Reopen');
    });
  });

  it('InterviewSurveyRequestEmail', async () => {
    await email.InterviewSurveyRequestEmail(recipient, {
      interview: { _id: oid('507f1f77bcf86cd799439088'), program_id: program }
    });
    expectSent('Interview Survey');
  });

  it('InterviewSurveyFinishedEmail', async () => {
    await email.InterviewSurveyFinishedEmail(recipient, {
      user: { firstname: 'Us', lastname: 'Er' },
      interview: {
        _id: oid('507f1f77bcf86cd799439088'),
        program_id: program,
        student_id: { firstname: 'Stu', lastname: 'Dent' }
      }
    });
    expectSent('Interview survey finished');
  });

  it('InterviewSurveyFinishedToTaiGerEmail', async () => {
    await email.InterviewSurveyFinishedToTaiGerEmail(recipient, {
      user: { firstname: 'Us', lastname: 'Er' },
      interview: {
        _id: oid('507f1f77bcf86cd799439088'),
        program_id: program,
        student_id: { firstname: 'Stu', lastname: 'Dent' }
      }
    });
    expectSent('Interview survey finished');
  });
});

describe('email service - calendar event templates (transporter.sendMail)', () => {
  const taiger_user = {
    firstname: 'Ta',
    lastname: 'Iger',
    email: 'taiger@example.com'
  };

  it('MeetingInvitationEmail builds an ICS and sends via transporter', async () => {
    await email.MeetingInvitationEmail(recipient, {
      taiger_user,
      meeting_time: '2025-01-01 10:00',
      meeting_link: 'https://meet.example.com/x',
      event,
      event_title: 'Meeting',
      isUpdatingEvent: false
    });
    expect(transporter.sendMail).toHaveBeenCalledTimes(1);
    const mail = transporter.sendMail.mock.calls[0][0];
    expect(mail.to).toBe(recipient);
    expect(mail.subject).toContain('Meeting Confirmed');
    expect(mail.attachments[0].filename).toBe('event.ics');
  });

  it('MeetingCancelledReminderEmail sends a cancellation ICS (no reason)', async () => {
    await email.MeetingCancelledReminderEmail(recipient, {
      taiger_user,
      meeting_time: '2025-01-01 10:00',
      event,
      event_title: 'Meeting',
      isUpdatingEvent: true
    });
    expect(transporter.sendMail).toHaveBeenCalledTimes(1);
    expect(transporter.sendMail.mock.calls[0][0].subject).toContain(
      'Meeting Cancelled'
    );
  });

  it('MeetingCancelledReminderEmail includes the reason block when a reason is given', async () => {
    await email.MeetingCancelledReminderEmail(recipient, {
      taiger_user,
      meeting_time: '2025-01-01 10:00',
      reason: 'Scheduling conflict',
      event,
      event_title: 'Meeting',
      isUpdatingEvent: true
    });
    expect(transporter.sendMail).toHaveBeenCalledTimes(1);
    expect(transporter.sendMail.mock.calls[0][0].html).toContain(
      'Scheduling conflict'
    );
  });

  it('InterviewCancelledReminderEmail sends a cancellation ICS', async () => {
    await email.InterviewCancelledReminderEmail(recipient, {
      taiger_user,
      cc: [taiger_user],
      event,
      event_title: 'Interview',
      isUpdatingEvent: true
    });
    expect(transporter.sendMail).toHaveBeenCalledTimes(1);
    expect(transporter.sendMail.mock.calls[0][0].subject).toContain(
      'Interview Training Cancelled'
    );
  });

  it('sendInterviewConfirmationEmail sends an ICS via transporter', async () => {
    await email.sendInterviewConfirmationEmail(recipient, {
      taiger_user,
      program,
      cc: [taiger_user],
      event,
      meeting_link: 'https://meet.example.com/y',
      interview_id: 'i1',
      isUpdatingEvent: false
    });
    expect(transporter.sendMail).toHaveBeenCalledTimes(1);
    expect(transporter.sendMail.mock.calls[0][0].subject).toContain(
      'Confirmed'
    );
  });

  it('sendInterviewCancelEmail sends a cancellation ICS', async () => {
    await email.sendInterviewCancelEmail(recipient, {
      taiger_user,
      program,
      event,
      event_title: 'Interview',
      isUpdatingEvent: false
    });
    expect(transporter.sendMail).toHaveBeenCalledTimes(1);
    expect(transporter.sendMail.mock.calls[0][0].subject).toContain(
      'Cancelled'
    );
  });
});
