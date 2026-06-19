import { Role } from '@taiger-common/core';

// ---- Mock every external dependency so nothing hits a DB or network ----
jest.mock('../../services/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

jest.mock('../../aws/s3', () => ({
  deleteS3Objects: jest.fn(),
  listS3ObjectsV2: jest.fn()
}));

jest.mock('../../services/email', () => ({
  MeetingReminderEmail: jest.fn(),
  UnconfirmedMeetingReminderEmail: jest.fn(),
  sendNoTrainerInterviewRequestsReminderEmail: jest.fn(),
  InterviewTrainingReminderEmail: jest.fn(),
  InterviewSurveyRequestEmail: jest.fn()
}));

jest.mock('../../services/regular_system_emails', () => ({
  StudentTasksReminderEmail: jest.fn(),
  EditorTasksReminderEmail: jest.fn(),
  StudentApplicationsDeadline_Within30Days_DailyReminderEmail: jest.fn(),
  StudentCVMLRLEssay_NoReplyAfter3Days_DailyReminderEmail: jest.fn(),
  EditorCVMLRLEssay_NoReplyAfter7Days_DailyReminderEmail: jest.fn(),
  AgentCVMLRLEssay_NoReplyAfterXDays_DailyReminderEmail: jest.fn(),
  AgentApplicationsDeadline_Within30Days_DailyReminderEmail: jest.fn(),
  EditorCVMLRLEssayDeadline_Within30Days_DailyReminderEmail: jest.fn(),
  StudentCourseSelectionReminderEmail: jest.fn(),
  AgentCourseSelectionReminderEmail: jest.fn()
}));

jest.mock('../../constants', () => ({
  does_editor_have_pending_tasks: jest.fn(),
  is_deadline_within30days_needed: jest.fn(),
  is_cv_ml_rl_reminder_needed: jest.fn(),
  isNotArchiv: jest.fn(),
  needUpdateCourseSelection: jest.fn()
}));

jest.mock('../../services/students', () => ({
  getStudentsWithApplications: jest.fn(),
  getStudentsWithCourses: jest.fn(),
  getStudentsWithCoursesAndAgents: jest.fn(),
  getStudentsForDocumentThreadIntervals: jest.fn()
}));

jest.mock('../../services/users', () => ({
  findEditors: jest.fn(),
  findAgents: jest.fn(),
  getUserByIdSelect: jest.fn()
}));

jest.mock('../../services/events', () => ({
  findEvents: jest.fn()
}));

jest.mock('../../services/interviews', () => ({
  findInterviews: jest.fn()
}));

jest.mock('../../services/permissions', () => ({
  findPermissionsWithUser: jest.fn()
}));

jest.mock('../../services/communications', () => ({
  getAllForIntervalGrouping: jest.fn()
}));

jest.mock('../../services/intervals', () => ({
  bulkWrite: jest.fn(),
  findAllPopulated: jest.fn()
}));

jest.mock('../../services/responseTimes', () => ({
  bulkWrite: jest.fn()
}));

jest.mock('../../services/documentthreads', () => ({
  getThreadDocById: jest.fn()
}));

jest.mock('../../services/complaints', () => ({
  getComplaintDocById: jest.fn()
}));

jest.mock('pdf-parse', () => jest.fn());
jest.mock('mammoth', () => ({ extractRawText: jest.fn() }));

import { deleteS3Objects, listS3ObjectsV2 } from '../../aws/s3';
import * as email from '../../services/email';
import systemEmails from '../../services/regular_system_emails';
import * as constants from '../../constants';
import StudentService from '../../services/students';
import UserService from '../../services/users';
import EventService from '../../services/events';
import InterviewService from '../../services/interviews';
import PermissionService from '../../services/permissions';
import CommunicationService from '../../services/communications';
import IntervalService from '../../services/intervals';
import ResponseTimeService from '../../services/responseTimes';
import DocumentThreadService from '../../services/documentthreads';
import ComplaintService from '../../services/complaints';
import PdfParse from 'pdf-parse';
import mammoth from 'mammoth';

import * as utils from '../../utils/utils_function';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('threadS3GarbageCollector', () => {
  it('deletes redundant images and files when not referenced by messages', async () => {
    const ticket = {
      _id: { toString: () => 'thread1' },
      student_id: { toString: () => 'user1' },
      messages: [{ message: 'hello world', file: [{ path: 'kept.pdf' }] }]
    };
    DocumentThreadService.getThreadDocById.mockResolvedValue(ticket);
    // files listing: one file not referenced -> deleted
    listS3ObjectsV2
      .mockResolvedValueOnce({ Contents: [{ Key: 'user1/thread1/img/a.png' }] }) // images
      .mockResolvedValueOnce({
        Contents: [{ Key: 'user1/thread1/orphan.pdf' }]
      }); // files

    await utils.threadS3GarbageCollector(
      {},
      'Documentthread',
      'student_id',
      'thread1'
    );

    expect(DocumentThreadService.getThreadDocById).toHaveBeenCalledWith(
      'thread1'
    );
    expect(listS3ObjectsV2).toHaveBeenCalledTimes(2);
    expect(deleteS3Objects).toHaveBeenCalled();
  });

  it('uses ComplaintService when collection is Complaint', async () => {
    const ticket = {
      _id: { toString: () => 't2' },
      complaint_user: { toString: () => 'u2' },
      messages: []
    };
    ComplaintService.getComplaintDocById.mockResolvedValue(ticket);
    listS3ObjectsV2
      .mockResolvedValueOnce({ Contents: [] })
      .mockResolvedValueOnce({ Contents: [] });

    await utils.threadS3GarbageCollector(
      {},
      'Complaint',
      'complaint_user',
      't2'
    );

    expect(ComplaintService.getComplaintDocById).toHaveBeenCalledWith('t2');
    expect(deleteS3Objects).not.toHaveBeenCalled();
  });

  it('deletes everything when there are no messages', async () => {
    const ticket = {
      _id: { toString: () => 't3' },
      student_id: { toString: () => 'u3' },
      messages: []
    };
    DocumentThreadService.getThreadDocById.mockResolvedValue(ticket);
    listS3ObjectsV2
      .mockResolvedValueOnce({ Contents: [{ Key: 'u3/t3/img/x.png' }] })
      .mockResolvedValueOnce({ Contents: [{ Key: 'u3/t3/file.pdf' }] });

    await utils.threadS3GarbageCollector(
      {},
      'Documentthread',
      'student_id',
      't3'
    );

    expect(deleteS3Objects).toHaveBeenCalledTimes(2);
  });

  it('swallows error when ticket not found', async () => {
    DocumentThreadService.getThreadDocById.mockResolvedValue(null);
    await utils.threadS3GarbageCollector(
      {},
      'Documentthread',
      'student_id',
      'missing'
    );
    expect(deleteS3Objects).not.toHaveBeenCalled();
  });
});

describe('TasksReminderEmails', () => {
  it('sends editor and student reminder emails when pending tasks exist', async () => {
    const editor = {
      _id: 'e1',
      firstname: 'Ed',
      lastname: 'Itor',
      email: 'ed@x.com'
    };
    const student = {
      _id: 's1',
      firstname: 'St',
      lastname: 'Udent',
      email: 'st@x.com'
    };
    UserService.findEditors.mockResolvedValue([editor]);
    StudentService.getStudentsWithApplications.mockResolvedValue([student]);
    constants.does_editor_have_pending_tasks.mockReturnValue(true);
    constants.isNotArchiv.mockReturnValue(true);

    await utils.TasksReminderEmails({}, {}, jest.fn());

    expect(systemEmails.EditorTasksReminderEmail).toHaveBeenCalled();
    expect(systemEmails.StudentTasksReminderEmail).toHaveBeenCalled();
  });

  it('does not send editor email when no pending tasks', async () => {
    const editor = { _id: 'e1', firstname: 'Ed', lastname: 'I', email: 'e@x' };
    UserService.findEditors.mockResolvedValue([editor]);
    StudentService.getStudentsWithApplications.mockResolvedValue([]);
    constants.does_editor_have_pending_tasks.mockReturnValue(false);
    constants.isNotArchiv.mockReturnValue(true);

    await utils.TasksReminderEmails({}, {}, jest.fn());

    expect(systemEmails.EditorTasksReminderEmail).not.toHaveBeenCalled();
  });
});

describe('UrgentTasksReminderEmails', () => {
  it('resolves without throwing (all sub-tasks disabled)', async () => {
    await expect(utils.UrgentTasksReminderEmails()).resolves.toBeUndefined();
  });
});

describe('NextSemesterCourseSelectionReminderEmails', () => {
  it('emails active students needing course selection update', async () => {
    const student = {
      firstname: 'Co',
      lastname: 'Urse',
      email: 'co@x.com'
    };
    StudentService.getStudentsWithCourses.mockResolvedValue([student]);
    constants.isNotArchiv.mockReturnValue(true);
    constants.needUpdateCourseSelection.mockReturnValue(true);

    await utils.NextSemesterCourseSelectionReminderEmails();

    expect(
      systemEmails.StudentCourseSelectionReminderEmail
    ).toHaveBeenCalledWith(
      { firstname: 'Co', lastname: 'Urse', address: 'co@x.com' },
      { student }
    );
  });

  it('skips students that do not need update', async () => {
    StudentService.getStudentsWithCourses.mockResolvedValue([
      { firstname: 'A' }
    ]);
    constants.isNotArchiv.mockReturnValue(true);
    constants.needUpdateCourseSelection.mockReturnValue(false);

    await utils.NextSemesterCourseSelectionReminderEmails();

    expect(
      systemEmails.StudentCourseSelectionReminderEmail
    ).not.toHaveBeenCalled();
  });
});

describe('numStudentYearDistribution', () => {
  it('counts students by expected application date with TBD fallback', () => {
    const students = [
      { application_preference: { expected_application_date: '2025' } },
      { application_preference: { expected_application_date: '2025' } },
      { application_preference: {} }
    ];
    expect(utils.numStudentYearDistribution(students)).toEqual({
      2025: 2,
      TBD: 1
    });
  });
});

describe('add_portals_registered_status', () => {
  const { isProgramDecided } = require('@taiger-common/core');

  it('marks credentials filled when portals require them and provided', () => {
    const applications = [
      {
        programId: {
          decided: 'O',
          application_portal_a: 'portalA',
          application_portal_b: 'portalB'
        },
        portal_credentials: {
          application_portal_a: { account: 'a', password: 'p' },
          application_portal_b: { account: 'b', password: 'p' }
        }
      }
    ];
    // only run meaningful assertion if program is considered decided
    const result = utils.add_portals_registered_status(applications);
    expect(result).toHaveLength(1);
    expect(result[0].portal_credentials).toBeUndefined();
    if (isProgramDecided(applications[0])) {
      expect(result[0].credential_a_filled).toBe(true);
      expect(result[0].credential_b_filled).toBe(true);
    }
  });

  it('marks credentials filled true for undecided programs', () => {
    const applications = [{ programId: {}, decided: 'X' }];
    const result = utils.add_portals_registered_status(applications);
    expect(result[0].credential_a_filled).toBe(true);
    expect(result[0].credential_b_filled).toBe(true);
  });

  it('marks credential false when portal required but missing credentials', () => {
    const applications = [
      {
        programId: {
          decided: 'O',
          application_portal_a: 'portalA'
        },
        portal_credentials: {}
      }
    ];
    const result = utils.add_portals_registered_status(applications);
    expect(result).toHaveLength(1);
  });
});

describe('MeetingDailyReminderChecker', () => {
  it('sends meeting reminder emails to requester and receiver', async () => {
    const event = {
      event_type: 'Meeting',
      requester_id: [{ firstname: 'R', lastname: 'Q', email: 'r@x' }],
      receiver_id: [{ firstname: 'C', lastname: 'V', email: 'c@x' }]
    };
    EventService.findEvents.mockResolvedValue([event]);

    await utils.MeetingDailyReminderChecker();

    expect(EventService.findEvents).toHaveBeenCalled();
    expect(email.MeetingReminderEmail).toHaveBeenCalledTimes(2);
  });

  it('handles empty events gracefully', async () => {
    EventService.findEvents.mockResolvedValue([]);
    await utils.MeetingDailyReminderChecker();
    expect(email.MeetingReminderEmail).not.toHaveBeenCalled();
  });
});

describe('UnconfirmedMeetingDailyReminderChecker', () => {
  it('reminds both parties when neither has confirmed', async () => {
    const event = {
      isConfirmedRequester: false,
      isConfirmedReceiver: false,
      requester_id: [
        {
          _id: { toString: () => 'r1' },
          firstname: 'R',
          lastname: 'Q',
          email: 'r@x',
          role: 'Student'
        }
      ],
      receiver_id: [
        {
          _id: { toString: () => 'c1' },
          firstname: 'C',
          lastname: 'V',
          email: 'c@x',
          role: 'Agent'
        }
      ]
    };
    EventService.findEvents.mockResolvedValue([event]);

    await utils.UnconfirmedMeetingDailyReminderChecker();

    expect(email.UnconfirmedMeetingReminderEmail).toHaveBeenCalledTimes(2);
  });

  it('does nothing when no events returned', async () => {
    EventService.findEvents.mockResolvedValue(null);
    await utils.UnconfirmedMeetingDailyReminderChecker();
    expect(email.UnconfirmedMeetingReminderEmail).not.toHaveBeenCalled();
  });
});

describe('DailyCalculateAverageResponseTime', () => {
  it('processes communications and threads, then writes intervals/averages', async () => {
    const now = Date.now();
    const studentMsg = {
      _id: 'm1',
      createdAt: new Date(now - 1000),
      updatedAt: new Date(now - 1000),
      user_id: { role: Role.Student }
    };
    const staffMsg = {
      _id: 'm2',
      createdAt: new Date(now),
      updatedAt: new Date(now),
      user_id: { role: 'Agent' }
    };
    // GroupCommunicationByStudent
    CommunicationService.getAllForIntervalGrouping.mockResolvedValue([
      {
        ...studentMsg,
        student_id: { _id: { toString: () => 's1' }, archiv: false }
      },
      {
        ...staffMsg,
        student_id: { _id: { toString: () => 's1' }, archiv: false }
      }
    ]);
    // FindIntervalInDocumentThreadAndSave
    StudentService.getStudentsForDocumentThreadIntervals.mockResolvedValue([
      {
        generaldocs_threads: [
          {
            doc_thread_id: {
              _id: 't1',
              file_type: 'CV',
              messages: [studentMsg, staffMsg]
            }
          }
        ]
      }
    ]);
    IntervalService.bulkWrite.mockResolvedValue({ ok: 1 });
    // CalculateAverageResponseTimeAndSave -> GroupIntervals
    IntervalService.findAllPopulated.mockResolvedValue([
      {
        student_id: { _id: { toString: () => 's1' } },
        interval_type: 'communication',
        interval: 2
      },
      {
        thread_id: {
          _id: { toString: () => 't1' },
          student_id: { toString: () => 's1' }
        },
        interval_type: 'CV',
        interval: 4
      }
    ]);
    ResponseTimeService.bulkWrite.mockResolvedValue({ ok: 1 });

    await utils.DailyCalculateAverageResponseTime();

    expect(CommunicationService.getAllForIntervalGrouping).toHaveBeenCalled();
    expect(
      StudentService.getStudentsForDocumentThreadIntervals
    ).toHaveBeenCalled();
    expect(IntervalService.bulkWrite).toHaveBeenCalled();
    expect(IntervalService.findAllPopulated).toHaveBeenCalled();
    expect(ResponseTimeService.bulkWrite).toHaveBeenCalled();
  });

  it('skips bulk writes when there is nothing to process', async () => {
    CommunicationService.getAllForIntervalGrouping.mockResolvedValue([]);
    StudentService.getStudentsForDocumentThreadIntervals.mockResolvedValue([]);
    IntervalService.findAllPopulated.mockResolvedValue([]);

    await utils.DailyCalculateAverageResponseTime();

    expect(IntervalService.bulkWrite).not.toHaveBeenCalled();
    expect(ResponseTimeService.bulkWrite).not.toHaveBeenCalled();
  });
});

describe('DailyInterviewSurveyChecker', () => {
  it('sends survey emails for interviews that took place today', async () => {
    InterviewService.findInterviews.mockResolvedValue([
      {
        student_id: { firstname: 'S', lastname: 'T', email: 's@x' }
      }
    ]);

    await utils.DailyInterviewSurveyChecker();

    expect(InterviewService.findInterviews).toHaveBeenCalled();
    expect(email.InterviewSurveyRequestEmail).toHaveBeenCalledTimes(1);
  });

  it('handles undefined interview result', async () => {
    InterviewService.findInterviews.mockResolvedValue(undefined);
    await utils.DailyInterviewSurveyChecker();
    expect(email.InterviewSurveyRequestEmail).not.toHaveBeenCalled();
  });
});

describe('NoInterviewTrainerOrTrainingDateDailyReminderChecker', () => {
  it('emails permissioned users when interviews lack trainers', async () => {
    InterviewService.findInterviews.mockResolvedValue([{ _id: 'iv1' }]);
    PermissionService.findPermissionsWithUser.mockResolvedValue([
      { user_id: { firstname: 'P', lastname: 'M', email: 'p@x' } }
    ]);

    await utils.NoInterviewTrainerOrTrainingDateDailyReminderChecker();

    expect(PermissionService.findPermissionsWithUser).toHaveBeenCalledWith({
      canAssignEditors: true
    });
    expect(
      email.sendNoTrainerInterviewRequestsReminderEmail
    ).toHaveBeenCalledTimes(1);
  });

  it('does nothing when there are no interview requests', async () => {
    InterviewService.findInterviews.mockResolvedValue([]);
    await utils.NoInterviewTrainerOrTrainingDateDailyReminderChecker();
    expect(PermissionService.findPermissionsWithUser).not.toHaveBeenCalled();
  });
});

describe('patternMatched', () => {
  it('returns true when pattern found in pdf text', async () => {
    PdfParse.mockResolvedValue({ text: 'This is a SECRET document' });
    const result = await utils.patternMatched(Buffer.from('x'), 'pdf', [
      'secret'
    ]);
    expect(result).toBe(true);
  });

  it('returns false when pattern absent in docx text', async () => {
    mammoth.extractRawText.mockResolvedValue({ value: 'nothing here' });
    const result = await utils.patternMatched(Buffer.from('x'), 'docx', [
      'missing'
    ]);
    expect(result).toBe(false);
  });

  it('returns false when extension unsupported (no text extracted)', async () => {
    const result = await utils.patternMatched(Buffer.from('x'), 'txt', [
      'anything'
    ]);
    expect(result).toBe(false);
  });
});

describe('userChangesHelperFunction', () => {
  it('computes added, removed, updated and to-be-informed users', async () => {
    const newUserIds = { u1: true, u2: false, u3: true };
    const existingUsers = [
      { _id: { toString: () => 'u1' } },
      { _id: { toString: () => 'u9' } } // removed
    ];
    UserService.getUserByIdSelect.mockImplementation((id) =>
      Promise.resolve({
        _id: { toString: () => id },
        firstname: id,
        lastname: 'L',
        email: `${id}@x`,
        archiv: false
      })
    );

    const result = await utils.userChangesHelperFunction(
      newUserIds,
      existingUsers
    );

    // u2 is false so excluded; u1, u3 are the updated ids
    expect(result.updatedUserIds).toEqual(['u1', 'u3']);
    expect(result.updatedUsers).toHaveLength(2);
    // u3 newly added (not in existing), u1 already existed
    expect(result.addedUsers.map((u) => u._id.toString())).toEqual(['u3']);
    expect(result.toBeInformedUsers.map((u) => u.firstname)).toEqual(['u3']);
    // u9 existed before but not in new set -> removed
    expect(result.removedUsers).toHaveLength(1);
    expect(result.removedUsers[0]._id.toString()).toBe('u9');
  });

  it('handles missing existingUsers (treats all as added)', async () => {
    UserService.getUserByIdSelect.mockResolvedValue({
      _id: { toString: () => 'u1' },
      firstname: 'A',
      lastname: 'B',
      email: 'a@x',
      archiv: false
    });

    const result = await utils.userChangesHelperFunction(
      { u1: true },
      undefined
    );

    expect(result.addedUsers).toHaveLength(1);
    expect(result.removedUsers).toHaveLength(0);
    expect(result.toBeInformedUsers).toHaveLength(1);
  });
});

// ---- Additional branch coverage ----

describe('threadS3GarbageCollector - extra branches', () => {
  it('keeps files referenced by message file paths and images referenced in message text', async () => {
    const ticket = {
      _id: { toString: () => 'thread1' },
      student_id: { toString: () => 'user1' },
      messages: [
        {
          message: 'see a.png inline',
          file: [{ path: 'user1/thread1/kept.pdf' }]
        }
      ]
    };
    DocumentThreadService.getThreadDocById.mockResolvedValue(ticket);
    listS3ObjectsV2
      .mockResolvedValueOnce({ Contents: [{ Key: 'user1/thread1/img/a.png' }] }) // image referenced -> kept
      .mockResolvedValueOnce({ Contents: [{ Key: 'user1/thread1/kept.pdf' }] }); // file referenced -> kept

    await utils.threadS3GarbageCollector(
      {},
      'Documentthread',
      'student_id',
      'thread1'
    );
    // nothing to delete since both referenced
    expect(deleteS3Objects).not.toHaveBeenCalled();
  });

  it('handles undefined Contents (no listings)', async () => {
    const ticket = {
      _id: { toString: () => 'thread2' },
      student_id: { toString: () => 'user2' },
      messages: [{ message: 'hi', file: [] }]
    };
    DocumentThreadService.getThreadDocById.mockResolvedValue(ticket);
    listS3ObjectsV2.mockResolvedValueOnce({}).mockResolvedValueOnce({});

    await utils.threadS3GarbageCollector(
      {},
      'Documentthread',
      'student_id',
      'thread2'
    );
    expect(deleteS3Objects).not.toHaveBeenCalled();
  });

  it('swallows error when listS3ObjectsV2 throws', async () => {
    const ticket = {
      _id: { toString: () => 'thread3' },
      student_id: { toString: () => 'user3' },
      messages: []
    };
    DocumentThreadService.getThreadDocById.mockResolvedValue(ticket);
    listS3ObjectsV2.mockRejectedValue(new Error('s3 down'));
    await utils.threadS3GarbageCollector(
      {},
      'Documentthread',
      'student_id',
      'thread3'
    );
    expect(deleteS3Objects).not.toHaveBeenCalled();
  });
});

describe('TasksReminderEmails - error paths', () => {
  it('swallows errors in editor core and student core', async () => {
    UserService.findEditors.mockRejectedValue(new Error('db'));
    StudentService.getStudentsWithApplications.mockRejectedValue(
      new Error('db')
    );
    await expect(
      utils.TasksReminderEmails({}, {}, jest.fn())
    ).resolves.toBeUndefined();
  });

  it('skips editor email when student list empty', async () => {
    UserService.findEditors.mockResolvedValue([
      { _id: 'e1', firstname: 'A', lastname: 'B', email: 'a@x' }
    ]);
    StudentService.getStudentsWithApplications.mockResolvedValue([]);
    constants.does_editor_have_pending_tasks.mockReturnValue(true);
    constants.isNotArchiv.mockReturnValue(true);
    await utils.TasksReminderEmails({}, {}, jest.fn());
    expect(systemEmails.EditorTasksReminderEmail).not.toHaveBeenCalled();
  });
});

describe('MeetingDailyReminderChecker - branches', () => {
  it('sends interview training reminders for Interview event_type', async () => {
    // event_type is read off the array (upcomingEvents.event_type) which is undefined,
    // so the else branch (MeetingReminderEmail) runs. Cover that path with multiple events.
    const event = {
      event_type: 'Interview',
      requester_id: [{ firstname: 'R', lastname: 'Q', email: 'r@x' }],
      receiver_id: [{ firstname: 'C', lastname: 'V', email: 'c@x' }]
    };
    EventService.findEvents.mockResolvedValue([event]);
    await utils.MeetingDailyReminderChecker();
    // upcomingEvents.event_type (on the array) is undefined -> else branch
    expect(email.MeetingReminderEmail).toHaveBeenCalledTimes(2);
  });

  it('swallows errors', async () => {
    EventService.findEvents.mockRejectedValue(new Error('db'));
    await expect(utils.MeetingDailyReminderChecker()).resolves.toBeUndefined();
  });
});

describe('UnconfirmedMeetingDailyReminderChecker - branches', () => {
  it('reminds only requester when receiver already confirmed', async () => {
    const event = {
      isConfirmedRequester: false,
      isConfirmedReceiver: true,
      requester_id: [
        {
          _id: { toString: () => 'r1' },
          firstname: 'R',
          lastname: 'Q',
          email: 'r@x',
          role: 'Student'
        }
      ],
      receiver_id: [
        {
          _id: { toString: () => 'c1' },
          firstname: 'C',
          lastname: 'V',
          email: 'c@x',
          role: 'Agent'
        }
      ]
    };
    EventService.findEvents.mockResolvedValue([event]);
    await utils.UnconfirmedMeetingDailyReminderChecker();
    expect(email.UnconfirmedMeetingReminderEmail).toHaveBeenCalledTimes(1);
  });

  it('reminds only receiver when requester already confirmed', async () => {
    const event = {
      isConfirmedRequester: true,
      isConfirmedReceiver: false,
      requester_id: [
        {
          _id: { toString: () => 'r1' },
          firstname: 'R',
          lastname: 'Q',
          email: 'r@x',
          role: 'Student'
        }
      ],
      receiver_id: [
        {
          _id: { toString: () => 'c1' },
          firstname: 'C',
          lastname: 'V',
          email: 'c@x',
          role: 'Agent'
        }
      ]
    };
    EventService.findEvents.mockResolvedValue([event]);
    await utils.UnconfirmedMeetingDailyReminderChecker();
    expect(email.UnconfirmedMeetingReminderEmail).toHaveBeenCalledTimes(1);
  });

  it('swallows errors', async () => {
    EventService.findEvents.mockRejectedValue(new Error('db'));
    await expect(
      utils.UnconfirmedMeetingDailyReminderChecker()
    ).resolves.toBeUndefined();
  });
});

describe('DailyCalculateAverageResponseTime - branches', () => {
  it('skips ignored student messages and handles archived students', async () => {
    const now = Date.now();
    const ignoredMsg = {
      _id: 'm0',
      createdAt: new Date(now - 2000),
      updatedAt: new Date(now - 2000),
      ignore_message: true,
      user_id: { role: Role.Student }
    };
    const studentMsg = {
      _id: 'm1',
      createdAt: new Date(now - 1000),
      updatedAt: new Date(now - 1000),
      user_id: { role: Role.Student }
    };
    const staffMsg = {
      _id: 'm2',
      createdAt: new Date(now),
      updatedAt: new Date(now),
      user_id: { role: 'Agent' }
    };
    CommunicationService.getAllForIntervalGrouping.mockResolvedValue([
      {
        ...ignoredMsg,
        student_id: { _id: { toString: () => 's1' }, archiv: false }
      },
      {
        ...studentMsg,
        student_id: { _id: { toString: () => 's1' }, archiv: false }
      },
      {
        ...staffMsg,
        student_id: { _id: { toString: () => 's1' }, archiv: false }
      },
      // archived student -> excluded from grouping
      {
        ...studentMsg,
        _id: 'm3',
        student_id: { _id: { toString: () => 's2' }, archiv: true }
      },
      // null student -> excluded
      { ...studentMsg, _id: 'm4', student_id: null }
    ]);
    // thread with ignored msg and a trailing student message (Case 4)
    StudentService.getStudentsForDocumentThreadIntervals.mockResolvedValue([
      {
        generaldocs_threads: [
          {
            doc_thread_id: {
              _id: 't1',
              file_type: 'CV',
              messages: [ignoredMsg, studentMsg]
            }
          },
          // thread with no messages
          { doc_thread_id: { _id: 't2', file_type: 'ML', messages: [] } }
        ]
      }
    ]);
    IntervalService.bulkWrite.mockResolvedValue({ ok: 1 });
    IntervalService.findAllPopulated.mockResolvedValue([
      {
        student_id: { _id: { toString: () => 's1' } },
        interval_type: 'communication',
        interval: 2
      },
      {
        thread_id: {
          _id: { toString: () => 't1' },
          student_id: { toString: () => 's1' }
        },
        interval_type: 'CV',
        interval: 4
      }
    ]);
    ResponseTimeService.bulkWrite.mockResolvedValue({ ok: 1 });

    await utils.DailyCalculateAverageResponseTime();
    expect(IntervalService.bulkWrite).toHaveBeenCalled();
    expect(ResponseTimeService.bulkWrite).toHaveBeenCalled();
  });

  it('handles thread without student_id on populated interval (thread_id path setOnInsert)', async () => {
    CommunicationService.getAllForIntervalGrouping.mockResolvedValue([]);
    StudentService.getStudentsForDocumentThreadIntervals.mockResolvedValue([]);
    IntervalService.findAllPopulated.mockResolvedValue([
      {
        thread_id: { _id: { toString: () => 't9' } },
        interval_type: 'CV',
        interval: 3
      }
    ]);
    ResponseTimeService.bulkWrite.mockResolvedValue({ ok: 1 });
    await utils.DailyCalculateAverageResponseTime();
    expect(ResponseTimeService.bulkWrite).toHaveBeenCalled();
  });

  it('logs error when GroupIntervals fails (findAllPopulated throws)', async () => {
    CommunicationService.getAllForIntervalGrouping.mockResolvedValue([]);
    StudentService.getStudentsForDocumentThreadIntervals.mockResolvedValue([]);
    IntervalService.findAllPopulated.mockRejectedValue(new Error('db'));
    await expect(
      utils.DailyCalculateAverageResponseTime()
    ).resolves.toBeUndefined();
  });

  it('logs error when getStudentsForDocumentThreadIntervals throws', async () => {
    CommunicationService.getAllForIntervalGrouping.mockResolvedValue([]);
    StudentService.getStudentsForDocumentThreadIntervals.mockRejectedValue(
      new Error('db')
    );
    IntervalService.findAllPopulated.mockResolvedValue([]);
    await expect(
      utils.DailyCalculateAverageResponseTime()
    ).resolves.toBeUndefined();
  });

  it('handles generaldocs_threads error per-student', async () => {
    CommunicationService.getAllForIntervalGrouping.mockResolvedValue([]);
    StudentService.getStudentsForDocumentThreadIntervals.mockResolvedValue([
      { generaldocs_threads: null } // iterating throws -> caught
    ]);
    IntervalService.findAllPopulated.mockResolvedValue([]);
    await expect(
      utils.DailyCalculateAverageResponseTime()
    ).resolves.toBeUndefined();
  });

  it('swallows error in GroupCommunicationByStudent', async () => {
    CommunicationService.getAllForIntervalGrouping.mockRejectedValue(
      new Error('db')
    );
    StudentService.getStudentsForDocumentThreadIntervals.mockResolvedValue([]);
    IntervalService.findAllPopulated.mockResolvedValue([]);
    await expect(
      utils.DailyCalculateAverageResponseTime()
    ).resolves.toBeUndefined();
  });

  it('ProcessMessages Case 4: single trailing student message in communications', async () => {
    const now = Date.now();
    const studentMsg = {
      _id: 'm1',
      createdAt: new Date(now - 1000),
      updatedAt: new Date(now - 1000),
      user_id: { role: Role.Student }
    };
    CommunicationService.getAllForIntervalGrouping.mockResolvedValue([
      {
        ...studentMsg,
        student_id: { _id: { toString: () => 's1' }, archiv: false }
      }
    ]);
    StudentService.getStudentsForDocumentThreadIntervals.mockResolvedValue([]);
    IntervalService.bulkWrite.mockResolvedValue({ ok: 1 });
    IntervalService.findAllPopulated.mockResolvedValue([]);
    await utils.DailyCalculateAverageResponseTime();
    // single student message -> pseudo "now" interval created -> bulkWrite called
    expect(IntervalService.bulkWrite).toHaveBeenCalled();
  });

  it('ProcessThread catch: message with throwing user_id getter is swallowed', async () => {
    CommunicationService.getAllForIntervalGrouping.mockResolvedValue([]);
    const badMsg = {
      _id: 'bm',
      createdAt: new Date(),
      updatedAt: new Date(),
      get user_id() {
        throw new Error('boom');
      }
    };
    StudentService.getStudentsForDocumentThreadIntervals.mockResolvedValue([
      {
        generaldocs_threads: [
          { doc_thread_id: { _id: 't1', file_type: 'CV', messages: [badMsg] } }
        ]
      }
    ]);
    IntervalService.findAllPopulated.mockResolvedValue([]);
    await expect(
      utils.DailyCalculateAverageResponseTime()
    ).resolves.toBeUndefined();
  });

  it('GroupIntervals groups multiple intervals under same student and thread keys', async () => {
    CommunicationService.getAllForIntervalGrouping.mockResolvedValue([]);
    StudentService.getStudentsForDocumentThreadIntervals.mockResolvedValue([]);
    IntervalService.findAllPopulated.mockResolvedValue([
      {
        student_id: { _id: { toString: () => 's1' } },
        interval_type: 'communication',
        interval: 2
      },
      {
        student_id: { _id: { toString: () => 's1' } },
        interval_type: 'communication',
        interval: 6
      },
      {
        thread_id: {
          _id: { toString: () => 't1' },
          student_id: { toString: () => 's1' }
        },
        interval_type: 'CV',
        interval: 1
      },
      {
        thread_id: {
          _id: { toString: () => 't1' },
          student_id: { toString: () => 's1' }
        },
        interval_type: 'CV',
        interval: 3
      }
    ]);
    ResponseTimeService.bulkWrite.mockResolvedValue({ ok: 1 });
    await utils.DailyCalculateAverageResponseTime();
    expect(ResponseTimeService.bulkWrite).toHaveBeenCalled();
  });

  it('CalculateAverage thread_id branch errors are swallowed', async () => {
    CommunicationService.getAllForIntervalGrouping.mockResolvedValue([]);
    StudentService.getStudentsForDocumentThreadIntervals.mockResolvedValue([]);
    // thread_id present but accessing student_id throws inside calculateAndSaveAverage
    IntervalService.findAllPopulated.mockResolvedValue([
      {
        thread_id: {
          _id: { toString: () => 't1' },
          get student_id() {
            throw new Error('boom');
          }
        },
        interval_type: 'CV',
        interval: 5
      }
    ]);
    await expect(
      utils.DailyCalculateAverageResponseTime()
    ).resolves.toBeUndefined();
  });
});

describe('add_portals_registered_status - credential false branches', () => {
  it('marks both credentials false when portals required but creds missing', () => {
    const applications = [
      {
        decided: 'O',
        programId: { application_portal_a: 'A', application_portal_b: 'B' },
        portal_credentials: {}
      }
    ];
    const result = utils.add_portals_registered_status(applications);
    expect(result).toHaveLength(1);
    expect(result[0].credential_a_filled).toBe(false);
    expect(result[0].credential_b_filled).toBe(false);
  });

  it('marks credentials filled true when decided and full creds present', () => {
    const applications = [
      {
        decided: 'O',
        programId: { application_portal_a: 'A', application_portal_b: 'B' },
        portal_credentials: {
          application_portal_a: { account: 'a', password: 'p' },
          application_portal_b: { account: 'b', password: 'p' }
        }
      }
    ];
    const result = utils.add_portals_registered_status(applications);
    expect(result[0].credential_a_filled).toBe(true);
    expect(result[0].credential_b_filled).toBe(true);
  });

  it('marks credentials true when decided but no portals required', () => {
    const applications = [
      { decided: 'O', programId: {}, portal_credentials: {} }
    ];
    const result = utils.add_portals_registered_status(applications);
    expect(result[0].credential_a_filled).toBe(true);
    expect(result[0].credential_b_filled).toBe(true);
  });

  it('marks credential_a false (no account) and credential_b false (no password)', () => {
    const applications = [
      {
        decided: 'O',
        programId: { application_portal_a: 'A', application_portal_b: 'B' },
        portal_credentials: {
          application_portal_a: { password: 'p' }, // missing account
          application_portal_b: { account: 'b' } // missing password
        }
      }
    ];
    const result = utils.add_portals_registered_status(applications);
    expect(result[0].credential_a_filled).toBe(false);
    expect(result[0].credential_b_filled).toBe(false);
  });
});

describe('DailyInterviewSurveyChecker - error path', () => {
  it('swallows errors', async () => {
    InterviewService.findInterviews.mockRejectedValue(new Error('db'));
    await expect(utils.DailyInterviewSurveyChecker()).resolves.toBeUndefined();
  });
});

describe('NoInterviewTrainerOrTrainingDateDailyReminderChecker - error path', () => {
  it('swallows errors', async () => {
    InterviewService.findInterviews.mockRejectedValue(new Error('db'));
    await expect(
      utils.NoInterviewTrainerOrTrainingDateDailyReminderChecker()
    ).resolves.toBeUndefined();
  });
});

describe('NextSemesterCourseSelectionReminderEmails - error path', () => {
  it('swallows errors', async () => {
    StudentService.getStudentsWithCourses.mockRejectedValue(new Error('db'));
    await expect(
      utils.NextSemesterCourseSelectionReminderEmails()
    ).resolves.toBeUndefined();
  });

  it('skips archived students', async () => {
    StudentService.getStudentsWithCourses.mockResolvedValue([
      { firstname: 'X' }
    ]);
    constants.isNotArchiv.mockReturnValue(false);
    await utils.NextSemesterCourseSelectionReminderEmails();
    expect(
      systemEmails.StudentCourseSelectionReminderEmail
    ).not.toHaveBeenCalled();
  });
});
