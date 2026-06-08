const { Role } = require('@taiger-common/core');

// Mock the send boundary so no real SMTP/SES is used.
jest.mock('../../services/email/configuration', () => ({
  sendEmail: jest.fn(),
  transporter: { sendMail: jest.fn() }
}));

const { sendEmail } = require('../../services/email/configuration');
const {
  StudentTasksReminderEmail,
  EditorTasksReminderEmail,
  StudentApplicationsDeadline_Within30Days_DailyReminderEmail,
  StudentCourseSelectionReminderEmail,
  AgentCourseSelectionReminderEmail,
  StudentCVMLRLEssay_NoReplyAfter3Days_DailyReminderEmail,
  EditorCVMLRLEssay_NoReplyAfter7Days_DailyReminderEmail,
  AgentCVMLRLEssay_NoReplyAfterXDays_DailyReminderEmail,
  EditorCVMLRLEssayDeadline_Within30Days_DailyReminderEmail,
  AgentApplicationsDeadline_Within30Days_DailyReminderEmail
} = require('../../services/regular_system_emails');

const recipient = {
  _id: { toString: () => '507f1f77bcf86cd799439011' },
  id: '507f1f77bcf86cd799439011',
  firstname: 'First',
  lastname: 'Last',
  address: 'recipient@example.com',
  role: Role.Student
};

// A student with all arrays present and empty -> all summary helpers return ''.
const emptyStudent = () => ({
  _id: { toString: () => '507f1f77bcf86cd799439099' },
  firstname: 'Stu',
  lastname: 'Dent',
  applications: [],
  profile: [],
  generaldocs_threads: [],
  academic_background: {
    university: { high_school_isGraduated: 'Yes' },
    language: { english_isPassed: 'Yes' }
  },
  application_preference: { expected_application_date: '2025' }
});

// Returns a non-empty unsubmitted_applications summary.
const studentWithUnsubmittedApp = () => ({
  ...emptyStudent(),
  applications: [
    {
      decided: 'O',
      closed: '-',
      admission: '-',
      doc_modification_thread: [],
      programId: { school: 'TUM', program_name: 'CSE' }
    }
  ]
});

const editor = {
  _id: { toString: () => '507f1f77bcf86cd799439022' },
  firstname: 'Ed',
  lastname: 'Itor',
  role: Role.Editor
};

const agent = {
  _id: { toString: () => '507f1f77bcf86cd799439033' },
  firstname: 'Ag',
  lastname: 'Ent',
  role: Role.Agent
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('regular_system_emails service', () => {
  describe('StudentTasksReminderEmail', () => {
    it('sends when there are outstanding tasks (missing docs / unsubmitted apps)', async () => {
      await StudentTasksReminderEmail(recipient, {
        student: studentWithUnsubmittedApp()
      });
      expect(sendEmail).toHaveBeenCalledTimes(1);
      const [to, subject, message] = sendEmail.mock.calls[0];
      expect(to).toBe(recipient);
      expect(subject).toContain('TaiGer Weekly Reminder');
      expect(message).toContain('Hi First Last');
    });
  });

  describe('EditorTasksReminderEmail', () => {
    it('sends an overview email (no students needing response)', async () => {
      await EditorTasksReminderEmail(recipient, {
        editor,
        students: [emptyStudent()]
      });
      expect(sendEmail).toHaveBeenCalledTimes(1);
      const [, subject, message] = sendEmail.mock.calls[0];
      expect(subject).toContain('TaiGer Editor Reminder');
      expect(message).toContain('overview of the open tasks');
    });

    it('includes a student block when a response is needed', async () => {
      const student = emptyStudent();
      student.generaldocs_threads = [
        {
          isFinalVersion: false,
          latest_message_left_by_id: 'someone-else',
          updatedAt: new Date('2020-01-01'),
          doc_thread_id: {
            _id: { toString: () => 'thread1' },
            file_type: 'CV',
            updatedAt: new Date('2020-01-01')
          }
        }
      ];
      await EditorTasksReminderEmail(editor, { editor, students: [student] });
      expect(sendEmail).toHaveBeenCalledTimes(1);
    });
  });

  describe('StudentApplicationsDeadline_Within30Days_DailyReminderEmail', () => {
    it('composes and sends the deadline reminder', async () => {
      await StudentApplicationsDeadline_Within30Days_DailyReminderEmail(
        recipient,
        { student: emptyStudent(), trigger_days: 30 }
      );
      expect(sendEmail).toHaveBeenCalledTimes(1);
      const [, subject] = sendEmail.mock.calls[0];
      expect(subject).toContain('Applications Deadline very close');
    });
  });

  describe('StudentCourseSelectionReminderEmail', () => {
    it('composes the course selection reminder with a course link', async () => {
      await StudentCourseSelectionReminderEmail(recipient, {
        student: emptyStudent()
      });
      expect(sendEmail).toHaveBeenCalledTimes(1);
      const [, subject, message] = sendEmail.mock.calls[0];
      expect(subject).toContain('Courses Update');
      expect(message).toContain('My Course');
    });
  });

  describe('AgentCourseSelectionReminderEmail', () => {
    it('composes the agent course reminder', async () => {
      await AgentCourseSelectionReminderEmail(agent, {
        student: emptyStudent()
      });
      expect(sendEmail).toHaveBeenCalledTimes(1);
      const [, subject] = sendEmail.mock.calls[0];
      expect(subject).toContain('Courses Update');
    });
  });

  describe('StudentCVMLRLEssay_NoReplyAfter3Days_DailyReminderEmail', () => {
    it('composes the no-reply escalation email', async () => {
      await StudentCVMLRLEssay_NoReplyAfter3Days_DailyReminderEmail(recipient, {
        student: emptyStudent(),
        trigger_days: 3
      });
      expect(sendEmail).toHaveBeenCalledTimes(1);
      const [, subject] = sendEmail.mock.calls[0];
      expect(subject).toContain('Your Editor is waiting for you');
    });
  });

  describe('EditorCVMLRLEssay_NoReplyAfter7Days_DailyReminderEmail', () => {
    it('composes the editor escalation email', async () => {
      await EditorCVMLRLEssay_NoReplyAfter7Days_DailyReminderEmail(editor, {
        editor,
        students: [emptyStudent()],
        trigger_days: 7
      });
      expect(sendEmail).toHaveBeenCalledTimes(1);
      const [, subject] = sendEmail.mock.calls[0];
      expect(subject).toContain('waiting for your response');
    });
  });

  describe('AgentCVMLRLEssay_NoReplyAfterXDays_DailyReminderEmail', () => {
    it('composes the agent escalation email', async () => {
      await AgentCVMLRLEssay_NoReplyAfterXDays_DailyReminderEmail(agent, {
        agent,
        students: [emptyStudent()],
        trigger_days: 14
      });
      expect(sendEmail).toHaveBeenCalledTimes(1);
      const [, subject] = sendEmail.mock.calls[0];
      expect(subject).toContain('idle for 14 days');
    });
  });

  describe('AgentApplicationsDeadline_Within30Days_DailyReminderEmail', () => {
    it('composes the agent applications deadline email', async () => {
      await AgentApplicationsDeadline_Within30Days_DailyReminderEmail(agent, {
        agent,
        students: [emptyStudent()],
        trigger_days: 30
      });
      expect(sendEmail).toHaveBeenCalledTimes(1);
      const [, subject] = sendEmail.mock.calls[0];
      expect(subject).toContain('applications deadline very close');
    });
  });

  describe('EditorCVMLRLEssayDeadline_Within30Days_DailyReminderEmail', () => {
    it('does NOT send when there are no students with a close deadline', async () => {
      await EditorCVMLRLEssayDeadline_Within30Days_DailyReminderEmail(editor, {
        students: []
      });
      expect(sendEmail).not.toHaveBeenCalled();
    });
  });
});
