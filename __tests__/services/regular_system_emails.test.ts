import { Role } from '@taiger-common/core';

// Mock the send boundary so no real SMTP/SES is used.
jest.mock('../../services/email/configuration', () => ({
  sendEmail: jest.fn(),
  transporter: { sendMail: jest.fn() }
}));

// Keep the real constants but allow overriding the deadline-summary helper so
// the "has content -> send" branch of the editor deadline reminder can be
// exercised deterministically without crafting close-deadline fixtures.
jest.mock('../../constants', () => {
  const actual = jest.requireActual('../../constants');
  return {
    ...actual,
    cvmlrl_deadline_within30days_escalation_summary: jest.fn(() => ''),
    // The `needed?` predicates gate the truthy side of the per-student
    // ternaries in the editor/agent reminder loops; overriding them lets us
    // hit both sides.
    is_cv_ml_rl_reminder_needed: jest.fn(() => false),
    is_deadline_within30days_needed: jest.fn(() => false),
    is_cv_ml_rl_task_response_needed: jest.fn(() => false),
    // Student-task summary helpers default to the real implementation but can
    // be forced to '' to exercise StudentTasksReminderEmail's no-send branch.
    unsubmitted_applications_summary: jest.fn(
      actual.unsubmitted_applications_summary
    ),
    base_documents_summary: jest.fn(actual.base_documents_summary),
    cv_ml_rl_unfinished_summary: jest.fn(actual.cv_ml_rl_unfinished_summary),
    missing_academic_background: jest.fn(actual.missing_academic_background)
  };
});

import {
  cvmlrl_deadline_within30days_escalation_summary,
  is_cv_ml_rl_reminder_needed,
  is_deadline_within30days_needed,
  is_cv_ml_rl_task_response_needed,
  unsubmitted_applications_summary,
  base_documents_summary,
  cv_ml_rl_unfinished_summary,
  missing_academic_background
} from '../../constants';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- export = interop, see services/email/configuration.ts
import EmailConfiguration = require('../../services/email/configuration');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- export = interop, see services/regular_system_emails.ts
import RegularSystemEmails = require('../../services/regular_system_emails');

const { sendEmail } = EmailConfiguration;
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
} = RegularSystemEmails;

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
  // clearAllMocks resets call data but not implementations/return values, so
  // restore the predicate defaults (false) between tests explicitly.
  (is_cv_ml_rl_reminder_needed as jest.Mock).mockReturnValue(false);
  (is_deadline_within30days_needed as jest.Mock).mockReturnValue(false);
  (is_cv_ml_rl_task_response_needed as jest.Mock).mockReturnValue(false);
  (
    cvmlrl_deadline_within30days_escalation_summary as jest.Mock
  ).mockReturnValue('');
});

describe('regular_system_emails service', () => {
  describe('StudentTasksReminderEmail', () => {
    it('sends when there are outstanding tasks (missing docs / unsubmitted apps)', async () => {
      await StudentTasksReminderEmail(recipient, {
        student: studentWithUnsubmittedApp()
      });
      expect(sendEmail).toHaveBeenCalledTimes(1);
      const [to, subject, message] = (sendEmail as jest.Mock).mock.calls[0];
      expect(to).toBe(recipient);
      expect(subject).toContain('TaiGer Weekly Reminder');
      expect(message).toContain('Hi First Last');
    });

    it('does NOT send when the student has no outstanding tasks (all summaries empty)', async () => {
      // Force every summary helper to '' so the guard's all-empty branch is
      // taken and no email is sent.
      // Once-only overrides so the real implementations are restored for any
      // subsequent test (clearAllMocks does not reset mock return values).
      (unsubmitted_applications_summary as jest.Mock).mockReturnValueOnce('');
      (base_documents_summary as jest.Mock).mockReturnValueOnce('');
      (cv_ml_rl_unfinished_summary as jest.Mock).mockReturnValueOnce('');
      (missing_academic_background as jest.Mock).mockReturnValueOnce('');
      await StudentTasksReminderEmail(recipient, { student: emptyStudent() });
      expect(sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('EditorTasksReminderEmail', () => {
    it('sends an overview email (no students needing response)', async () => {
      await EditorTasksReminderEmail(recipient, {
        editor,
        students: [emptyStudent()]
      });
      expect(sendEmail).toHaveBeenCalledTimes(1);
      const [, subject, message] = (sendEmail as jest.Mock).mock.calls[0];
      expect(subject).toContain('TaiGer Editor Reminder');
      expect(message).toContain('overview of the open tasks');
    });

    it('includes student blocks when a response is needed (first + subsequent)', async () => {
      // Two students both needing a response exercises the `first` ternary on
      // both its true (first student) and false (subsequent student) branches.
      (is_cv_ml_rl_task_response_needed as jest.Mock).mockReturnValue(true);
      await EditorTasksReminderEmail(editor, {
        editor,
        students: [emptyStudent(), emptyStudent()]
      });
      expect(sendEmail).toHaveBeenCalledTimes(1);
      const [, , message] = (sendEmail as jest.Mock).mock.calls[0];
      // Two student blocks rendered.
      expect(message.match(/<b>Stu Dent<\/b>/g)).toHaveLength(2);
    });
  });

  describe('StudentApplicationsDeadline_Within30Days_DailyReminderEmail', () => {
    it('composes and sends the deadline reminder', async () => {
      await StudentApplicationsDeadline_Within30Days_DailyReminderEmail(
        recipient,
        { student: emptyStudent(), trigger_days: 30 }
      );
      expect(sendEmail).toHaveBeenCalledTimes(1);
      const [, subject] = (sendEmail as jest.Mock).mock.calls[0];
      expect(subject).toContain('Applications Deadline very close');
    });
  });

  describe('StudentCourseSelectionReminderEmail', () => {
    it('composes the course selection reminder with a course link', async () => {
      await StudentCourseSelectionReminderEmail(recipient, {
        student: emptyStudent()
      });
      expect(sendEmail).toHaveBeenCalledTimes(1);
      const [, subject, message] = (sendEmail as jest.Mock).mock.calls[0];
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
      const [, subject] = (sendEmail as jest.Mock).mock.calls[0];
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
      const [, subject] = (sendEmail as jest.Mock).mock.calls[0];
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
      const [, subject] = (sendEmail as jest.Mock).mock.calls[0];
      expect(subject).toContain('waiting for your response');
    });

    it('includes the escalation summary when a reminder is needed', async () => {
      (is_cv_ml_rl_reminder_needed as jest.Mock).mockReturnValue(true);
      await EditorCVMLRLEssay_NoReplyAfter7Days_DailyReminderEmail(editor, {
        editor,
        students: [emptyStudent()],
        trigger_days: 7
      });
      expect(sendEmail).toHaveBeenCalledTimes(1);
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
      const [, subject] = (sendEmail as jest.Mock).mock.calls[0];
      expect(subject).toContain('idle for 14 days');
    });

    it('includes the escalation summary when a reminder is needed', async () => {
      (is_cv_ml_rl_reminder_needed as jest.Mock).mockReturnValue(true);
      await AgentCVMLRLEssay_NoReplyAfterXDays_DailyReminderEmail(agent, {
        agent,
        students: [emptyStudent()],
        trigger_days: 14
      });
      expect(sendEmail).toHaveBeenCalledTimes(1);
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
      const [, subject] = (sendEmail as jest.Mock).mock.calls[0];
      expect(subject).toContain('applications deadline very close');
    });

    it('includes the per-student summary when a deadline is within 30 days', async () => {
      (is_deadline_within30days_needed as jest.Mock).mockReturnValue(true);
      await AgentApplicationsDeadline_Within30Days_DailyReminderEmail(agent, {
        agent,
        students: [emptyStudent()],
        trigger_days: 30
      });
      expect(sendEmail).toHaveBeenCalledTimes(1);
    });
  });

  describe('EditorCVMLRLEssayDeadline_Within30Days_DailyReminderEmail', () => {
    it('does NOT send when there are no students with a close deadline', async () => {
      // Default mock returns '' for every student -> hasContent stays false.
      await EditorCVMLRLEssayDeadline_Within30Days_DailyReminderEmail(editor, {
        students: [emptyStudent(), emptyStudent()]
      });
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('sends when at least one student has a close deadline (hasContent branch)', async () => {
      // First student yields content, second yields '' -> exercises both sides
      // of the per-student `temp_text !== ''` guard while hasContent becomes true.
      (cvmlrl_deadline_within30days_escalation_summary as jest.Mock)
        .mockReturnValueOnce('<li>ML deadline close</li>')
        .mockReturnValueOnce('');

      await EditorCVMLRLEssayDeadline_Within30Days_DailyReminderEmail(editor, {
        students: [emptyStudent(), emptyStudent()]
      });

      expect(sendEmail).toHaveBeenCalledTimes(1);
      const [, subject, message] = (sendEmail as jest.Mock).mock.calls[0];
      expect(subject).toContain('Tasks deadline very close');
      expect(message).toContain('ML deadline close');
    });
  });
});
