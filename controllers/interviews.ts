import mongoose from 'mongoose';
import path from 'path';
import { Role, is_TaiGer_Student } from '@taiger-common/core';
import type {
  IInterview,
  IPermission,
  IStudent,
  IUser,
  IEvent,
  IProgram,
  IDocumentthread,
  IInterviewSurveyResponse
} from '@taiger-common/model';

import type { AuthenticatedUser } from '../types/express';
import { ErrorResponse } from '../common/errors';
import { asyncHandler } from '../middlewares/error-handler';
import logger from '../services/logger';
import { AWS_S3_BUCKET_NAME } from '../config';
import {
  sendInterviewConfirmationEmail,
  sendAssignTrainerReminderEmail,
  sendAssignedInterviewTrainerToTrainerEmail,
  sendAssignedInterviewTrainerToStudentEmail,
  InterviewCancelledReminderEmail,
  sendSetAsFinalInterviewEmail,
  InterviewSurveyFinishedEmail,
  InterviewSurveyFinishedToTaiGerEmail
} from '../services/email';
import { addMessageInThread } from '../utils/informEditor';
import { isNotArchiv } from '../constants';
import { getPermission } from '../utils/queryFunctions';
import { emptyS3Directory } from '../utils/modelHelper/versionControl';
import { userChangesHelperFunction } from '../utils/utils_function';
import StudentService from '../services/students';
import ApplicationService from '../services/applications';
import InterviewService from '../services/interviews';
import EventService from '../services/events';
import DocumentThreadService from '../services/documentthreads';
import PermissionService from '../services/permissions';
import AuditService from '../services/audit';

// A populated user ref (the `_id` is present on the hydrated/lean doc but not on
// the bare `IUser` model interface).
type PopulatedUser = IUser & { _id: mongoose.Types.ObjectId };

// An event with its requester/receiver refs populated, narrowed to the fields
// these handlers read.
type PopulatedEvent = Omit<IEvent, 'requester_id' | 'receiver_id'> & {
  _id: { toString(): string };
  requester_id: PopulatedUser[];
  receiver_id: PopulatedUser[];
};

// A student with its agent refs populated, narrowed to the fields read here.
type PopulatedStudent = IStudent & {
  _id: { toString(): string };
  agents?: PopulatedUser[];
  applications?: unknown;
};

// An interview with its refs populated, as returned by the populated lookups.
// Kept permissive (refs are accessed as populated objects after lookups).
type PopulatedInterview = Omit<
  IInterview,
  'student_id' | 'trainer_id' | 'thread_id' | 'program_id' | 'event_id'
> & {
  _id: { toString(): string };
  student_id: PopulatedUser;
  trainer_id: PopulatedUser[];
  thread_id: IDocumentthread & { _id: { toString(): string } };
  program_id: IProgram;
  event_id?: IEvent;
};

const PrecheckInterview = async (req: unknown, interview_id: string) => {
  const precheck_interview = await InterviewService.findByIdRaw(interview_id);
  if (precheck_interview?.isClosed) {
    logger.info('updateInterview: interview is closed!');
    throw new ErrorResponse(403, 'Interview is closed');
  }
};

const InterviewCancelledReminder = async (
  user: AuthenticatedUser,
  receiver: PopulatedUser,
  meeting_event: PopulatedEvent,
  cc: PopulatedUser[]
) => {
  InterviewCancelledReminderEmail(
    {
      id: receiver._id.toString(),
      firstname: receiver.firstname,
      lastname: receiver.lastname,
      address: receiver.email
    },
    {
      taiger_user: user,
      role: user.role,
      meeting_time: meeting_event.start,
      student_id: user._id.toString(),
      event: meeting_event,
      event_title: is_TaiGer_Student(user)
        ? `${user.firstname} ${user.lastname}`
        : `${meeting_event.receiver_id[0].firstname} ${meeting_event.receiver_id[0].lastname}`,
      isUpdatingEvent: false,
      cc
    }
  );
};

const InterviewTrainingInvitation = async (
  receiver: PopulatedUser,
  user: AuthenticatedUser,
  event: PopulatedEvent,
  interview_id: string,
  program: unknown,
  isUpdatingEvent: boolean,
  cc: PopulatedUser[]
) => {
  sendInterviewConfirmationEmail(
    {
      id: receiver._id.toString(),
      firstname: receiver.firstname,
      lastname: receiver.lastname,
      address: receiver.email
    },
    {
      taiger_user: user,
      meeting_time: event.start, // Replace with the actual meeting time
      student_id: user._id.toString(),
      meeting_link: event.meetingLink,
      isUpdatingEvent,
      event,
      interview_id,
      program,
      cc
    }
  );
};

// Minimal view of the fields `addInterviewStatus` reads off each (populated)
// interview. Date-ish fields are typed as `number` because they are compared
// numerically against `Date.now()` (Mongoose `Date` values coerce at runtime).
interface InterviewStatusFields {
  interview_date?: number;
  event_id?: { start?: number };
  isClosed?: boolean;
  student_id?: { _id?: { toString(): string } };
}

const addInterviewStatus = async <T>(
  interviews: T[]
): Promise<Array<T & { status: string }>> => {
  const now = Date.now();
  const interviewsWithStatus: Array<T & { status: string }> = [];
  const openInterviews: T[] = [];

  for (const interview of interviews) {
    const { interview_date, event_id, isClosed } =
      interview as InterviewStatusFields;

    if (isClosed) {
      interviewsWithStatus.push({ ...interview, status: 'Closed' });
      continue;
    }

    if (interview_date && interview_date < now) {
      interviewsWithStatus.push({ ...interview, status: 'Interviewed' });
      continue;
    }

    if (event_id?.start) {
      interviewsWithStatus.push({
        ...interview,
        status: event_id.start < now ? 'Trained' : 'Scheduled'
      });
      continue;
    }

    // If none of the above, skip adding to interviewsWithStatus
    openInterviews.push(interview);
  }

  // Gather student IDs from 'Open' interviews
  const openStudentIds = new Set(
    openInterviews
      .map((i) => (i as InterviewStatusFields)?.student_id?._id?.toString())
      .filter((id): id is string => Boolean(id))
  );

  if (openStudentIds.size === 0) return interviewsWithStatus;
  const trainedStudentIds = (
    await InterviewService.distinctTrainedStudentIds(Array.from(openStudentIds))
  ).map((id) => id.toString());

  const openInterviewsWithStatus = openInterviews.map((interview) => {
    const studentId = (
      interview as InterviewStatusFields
    )?.student_id?._id?.toString();
    if (studentId && trainedStudentIds.includes(studentId)) {
      return { ...interview, status: 'N/A' };
    }
    return { ...interview, status: 'Open' };
  });

  return [...openInterviewsWithStatus, ...interviewsWithStatus];
};

// Server-side paginated / sorted / searchable all-interviews list (staff view).
// Base scope mirrors the legacy filter (isClosed / trainer_id / no_trainer); the
// computed status/isDuplicate/surveySubmitted columns are materialised in the
// aggregation so they remain filterable/sortable under pagination.
const getAllInterviewsPaginated = asyncHandler(async (req, res) => {
  const { isClosed, trainer_id, no_trainer } = req.query;
  const filter: Record<string, unknown> = {};
  if (isClosed) {
    filter.isClosed = isClosed;
  }
  if (no_trainer || no_trainer === 'true') {
    filter.trainer_id = { $size: 0 };
  } else if (trainer_id) {
    filter.trainer_id = trainer_id;
  }

  const result = await InterviewService.getInterviewsPaginated({
    filter,
    query: req.query
  });

  res.status(200).send({ success: true, data: result });
});

// Server-side paginated "My Interviews" view. Students are scoped to their own
// interviews and additionally get their applications + the program ids they
// already have an interview for, so the FE can build the "Add interview" list
// without loading the whole interview set.
const getMyInterviewPaginated = asyncHandler(async (req, res) => {
  const { user } = req;
  const filter: Record<string, unknown> = {};
  if (is_TaiGer_Student(user)) {
    filter.student_id = user._id.toString();
  }

  const result = await InterviewService.getInterviewsPaginated({
    filter,
    query: req.query
  });

  if (is_TaiGer_Student(user)) {
    const student = (await StudentService.getStudentById(
      user._id.toString()
    )) as PopulatedStudent | null;
    if (!student) {
      logger.info('getMyInterviewPaginated: Student not found!');
      throw new ErrorResponse(400, 'Student not found!');
    }
    const applications = await ApplicationService.getApplicationsByStudentId(
      user._id.toString()
    );
    student.applications = applications;
    const existingInterviewProgramIds =
      await InterviewService.studentInterviewProgramIds(user._id.toString());

    return res.status(200).send({
      success: true,
      data: result,
      student,
      existingInterviewProgramIds
    });
  }

  return res.status(200).send({ success: true, data: result });
});

const getInterviewQuestions = asyncHandler(async (req, res) => {
  const { programId } = req.params;

  // The list is filtered on the (populated) interview's program id, so narrow
  // `interview_id` to the shape actually read here.
  type SurveyWithInterview = IInterviewSurveyResponse & {
    interview_id: { program_id: { toString(): string } };
  };
  const interviewsSurveys = (await InterviewService.findSurveys({}, [
    ['student_id', 'firstname lastname email pictureUrl']
  ])) as unknown as SurveyWithInterview[];

  const questionsArray = interviewsSurveys.filter(
    (survey: SurveyWithInterview) =>
      survey.interview_id.program_id.toString() === programId
  );

  res.status(200).send({ success: true, data: questionsArray });
});

const getMyInterview = asyncHandler(async (req, res) => {
  const { user } = req;
  const filter: Record<string, unknown> = {};
  const studentFilter: Record<string, unknown> = {
    $or: [{ archiv: { $exists: false } }, { archiv: false }]
  };
  if (is_TaiGer_Student(user)) {
    filter.student_id = user._id.toString();
  }
  let interviews = (await InterviewService.findInterviews(filter, [
    ['student_id trainer_id', 'firstname lastname email pictureUrl'],
    ['program_id', 'school program_name degree semester'],
    ['thread_id event_id']
  ])) as unknown as PopulatedInterview[];
  if ([Role.Admin, Role.Agent, Role.Editor].includes(user.role)) {
    if ([Role.Agent, Role.Editor].includes(user.role)) {
      const permissions = (await getPermission(req, user)) as
        | IPermission
        | undefined;
      if (!(permissions?.canAssignAgents || permissions?.canAssignEditors)) {
        studentFilter.agents = user._id;
      }
    }

    interviews = await addInterviewStatus(interviews);
    const students = await StudentService.getStudentsWithApplications(
      studentFilter
    );

    if (!students) {
      logger.info('getMyInterview: No students found!');
      throw new ErrorResponse(400, 'No students found!');
    }

    res.status(200).send({ success: true, data: interviews, students });
  } else {
    const student = (await StudentService.getStudentById(
      user._id.toString()
    )) as PopulatedStudent | null;
    const applications = await ApplicationService.getApplicationsByStudentId(
      user._id.toString()
    );
    student!.applications = applications;
    if (!student) {
      logger.info('getMyInterview: Student not found!');
      throw new ErrorResponse(400, 'Student not found!');
    }

    res.status(200).send({ success: true, data: interviews, student });
  }
});

const getInterview = asyncHandler(async (req, res) => {
  const {
    params: { interview_id }
  } = req;
  try {
    let interview = await InterviewService.findInterviewByIdPopulated(
      interview_id,
      [
        ['student_id trainer_id', 'firstname lastname email pictureUrl'],
        ['program_id', 'school program_name degree semester'],
        [
          {
            path: 'thread_id',
            select:
              'file_type isFinalVersion outsourced_user_id flag_by_user_id updatedAt messages.file messages.message messages.createdAt messages._id',
            populate: {
              path: 'messages.user_id',
              select: 'firstname lastname'
            }
          }
        ],
        ['event_id']
      ]
    );

    if (interview) {
      const [updatedInterview] = await addInterviewStatus([interview]);
      interview = updatedInterview;
    }

    if (!interview) {
      logger.info('getInterview: this interview is not found!');
      throw new ErrorResponse(404, 'this interview is not found!');
    }
    const interviewAuditLogPromise = AuditService.getAuditLogs(
      { interviewThreadId: interview_id },
      { sort: { createdAt: -1 } } as unknown as {
        limit: number;
        skip: number;
        sort: Record<string, 1 | -1>;
      }
    );

    const [interviewAuditLog] = await Promise.all([interviewAuditLogPromise]);

    res.status(200).send({
      success: true,
      data: interview,
      interviewAuditLog
    });
  } catch (e) {
    logger.error(`getInterview: ${(e as Error).message}`);
    throw new ErrorResponse(404, 'this interview is not found!');
  }
});

const deleteInterview = asyncHandler(async (req, res) => {
  const {
    user,
    params: { interview_id }
  } = req;

  await PrecheckInterview(req, interview_id);

  const interview = await InterviewService.findByIdRaw(interview_id);
  // Delete files in S3
  if (
    interview.thread_id?.toString() &&
    interview.thread_id?.toString() !== ''
  ) {
    let directory = path.join(
      interview.student_id?.toString(),
      interview.thread_id?.toString() || ''
    );
    logger.info('Trying to delete interview thread and folder');
    directory = directory.replace(/\\/g, '/');
    emptyS3Directory(AWS_S3_BUCKET_NAME, directory);
    // Delete event
    if (interview.event_id) {
      // send delete event email
      const toBeDeletedEvent = (await EventService.deleteEventByIdPopulated(
        interview.event_id,
        'firstname lastname email archiv'
      )) as unknown as PopulatedEvent;
      const student_temp = (await StudentService.getStudentByIdWithAgents(
        interview.student_id
      )) as unknown as PopulatedStudent;
      const cc = [
        ...toBeDeletedEvent.receiver_id,
        ...(student_temp.agents ?? [])
      ];
      const receiver = toBeDeletedEvent.requester_id[0];
      if (isNotArchiv(receiver)) {
        await InterviewCancelledReminder(user, receiver, toBeDeletedEvent, cc);
      }

      await EventService.deleteEventById(interview.event_id);
    }
    // Delete interview thread in mongoDB
    await DocumentThreadService.deleteThreadById(interview.thread_id);
  }

  // Delete interview  in mongoDB
  await InterviewService.deleteInterviewById(interview_id);
  // Delete interview survey if existed
  await InterviewService.deleteOneSurvey({ interview_id });

  res.status(200).send({ success: true });
});

const addInterviewTrainingDateTime = asyncHandler(async (req, res, next) => {
  const { user } = req;
  const {
    params: { interview_id }
  } = req;

  await PrecheckInterview(req, interview_id);

  const oldEvent = req.body;
  try {
    const date = new Date(oldEvent.start);
    oldEvent.isConfirmedReceiver = true;
    oldEvent.isConfirmedRequester = true;
    let isUpdatingEvent = false;
    let concat_name = '';
    let concat_id = '';
    // eslint-disable-next-line no-restricted-syntax
    for (const requester of oldEvent.requester_id) {
      concat_name += `${requester.firstname}_${requester.lastname}`;
      concat_id += `${requester._id.toString()}`;
    }
    oldEvent.meetingLink = `https://meet.jit.si/${concat_name}_${date
      .toISOString()
      .replace(/:/g, '_')
      .replace(/\./g, '_')}_${concat_id}`.replace(/ /g, '_');
    let newEvent: PopulatedEvent;
    if (oldEvent._id) {
      try {
        await EventService.updateEventRawById(oldEvent._id, { ...oldEvent });
        newEvent = (await EventService.getEventByIdPopulated(
          oldEvent._id,
          'firstname lastname email archiv'
        )) as unknown as PopulatedEvent;
        await InterviewService.updateInterviewByIdRaw(interview_id, {
          event_id: oldEvent._id,
          status: 'Scheduled'
        });
        isUpdatingEvent = true;
      } catch (e) {
        logger.error(`addInterviewTrainingDateTime: ${(e as Error).message}`);
        throw new ErrorResponse(403, (e as Error).message);
      }
    } else {
      const write_NewEvent = await EventService.createEvent(oldEvent);
      newEvent = (await EventService.getEventByIdPopulated(
        write_NewEvent._id,
        'firstname lastname email archiv'
      )) as unknown as PopulatedEvent;
      await InterviewService.updateInterviewByIdRaw(interview_id, {
        event_id: write_NewEvent._id?.toString(),
        status: 'Scheduled'
      });
    }

    res.status(200).send({
      success: true
    });

    const interview_tmep = (await InterviewService.findInterviewByIdPopulated(
      interview_id,
      [['program_id']]
    )) as unknown as PopulatedInterview;
    // inform agent for confirmed training date
    const student_temp = (await StudentService.getStudentByIdWithAgents(
      // `student_id` is unpopulated here (only `program_id` is populated above),
      // so at runtime this is the raw id accepted by the service.
      interview_tmep.student_id as unknown as string
    )) as unknown as PopulatedStudent;

    const cc = [...newEvent.receiver_id, ...(student_temp.agents ?? [])];

    const emailRequestsRequesters = newEvent.requester_id.map(
      (receiver: PopulatedUser) =>
        isNotArchiv(receiver) &&
        InterviewTrainingInvitation(
          receiver,
          user,
          newEvent,
          interview_id,
          interview_tmep.program_id,
          isUpdatingEvent,
          cc
        )
    );

    await Promise.all(emailRequestsRequesters);

    next();
  } catch (err) {
    logger.error(`postEvent: ${(err as Error).message}`);
    throw new ErrorResponse(500, (err as Error).message);
  }
});

const updateInterview = asyncHandler(async (req, res, next) => {
  const {
    user,
    params: { interview_id }
  } = req;

  const payload = req.body;
  if (!('isClosed' in payload)) {
    await PrecheckInterview(req, interview_id);
  }

  delete payload.thread_id;
  delete payload.program_id;
  delete payload.student_id;
  // Step 1: Fetch the current state (before update)
  const beforeUpdate = (await InterviewService.findInterviewByIdPopulated(
    interview_id,
    [
      ['student_id trainer_id', 'firstname lastname email archiv pictureUrl'],
      ['program_id', 'school program_name degree semester'],
      ['thread_id event_id']
    ]
  )) as unknown as PopulatedInterview | null;

  if (!beforeUpdate) {
    return res.status(404).json({ error: 'Interview not found' });
  }

  const interview = (await InterviewService.updateInterviewByIdPopulated(
    interview_id,
    payload,
    [
      [
        'student_id trainer_id',
        'firstname lastname email archiv role pictureUrl'
      ],
      ['program_id', 'school program_name degree semester'],
      ['thread_id event_id']
    ]
  )) as unknown as PopulatedInterview | null;

  if (!interview) {
    return res.status(500).json({ error: 'Failed to update interview' });
  }
  const trainerObj: Record<string, boolean> = {};
  payload.trainer_id?.forEach((id: string) => {
    trainerObj[id] = true;
  });

  const {
    addedUsers: addedInterviewers,
    removedUsers: removedInterviewers,
    updatedUsers: _updatedInterviewers,
    toBeInformedUsers: _toBeInformedInterviewers,
    updatedUserIds: _updatedInterviewerIds
  } = await userChangesHelperFunction(trainerObj, beforeUpdate.trainer_id);

  if (payload.isClosed === true || payload.isClosed === false) {
    await DocumentThreadService.updateThreadFields(
      interview.thread_id?._id.toString(),
      { isFinalVersion: payload.isClosed }
    );
  }
  res.status(200).send({ success: true, data: interview });
  if (payload.trainer_id?.length > 0) {
    if (isNotArchiv(interview.student_id)) {
      await sendAssignedInterviewTrainerToStudentEmail(
        {
          firstname: interview.student_id.firstname,
          lastname: interview.student_id.lastname,
          address: interview.student_id.email
        },
        { interview }
      );
    }

    const emailRequests = interview.trainer_id?.map(
      (trainer: PopulatedUser) =>
        isNotArchiv(trainer) &&
        sendAssignedInterviewTrainerToTrainerEmail(
          {
            firstname: trainer.firstname,
            lastname: trainer.lastname,
            address: trainer.email
          },
          { interview }
        )
    );
    await Promise.all(emailRequests);
    logger.info('Update trainer');
  }
  if ('isClosed' in payload) {
    if (isNotArchiv(interview.student_id)) {
      await sendSetAsFinalInterviewEmail(
        {
          firstname: interview.student_id.firstname,
          lastname: interview.student_id.lastname,
          address: interview.student_id.email
        },
        { interview, isClosed: payload.isClosed, user }
      );
    }
    req.audit = {
      performedBy: user._id,
      targetUserId: interview.student_id._id, // Change this if you have a different target user ID
      interviewThreadId: interview._id,
      action: 'update', // Action performed
      field: 'status', // Field that was updated (if applicable)
      changes: {
        before: beforeUpdate.isClosed, // Before state
        after: payload.isClosed
      }
    };
  }
  if ('trainer_id' in payload) {
    req.audit = {
      performedBy: user._id,
      targetUserId: interview.student_id._id, // Change this if you have a different target user ID
      interviewThreadId: interview._id,
      action: 'update', // Action performed
      field: 'interview trainer', // Field that was updated (if applicable)
      changes: {
        before: interview.trainer_id, // Before state
        after: {
          added: addedInterviewers,
          removed: removedInterviewers
        }
      }
    };
  }

  next();
});

const getInterviewSurvey = asyncHandler(async (req, res) => {
  const {
    params: { interview_id }
  } = req;

  const interviewSurvey = await InterviewService.findOneSurvey(
    { interview_id },
    [
      ['student_id', 'firstname lastname email pictureUrl'],
      ['program_id', 'school program_name degree semester']
    ]
  );

  res.status(200).send({ success: true, data: interviewSurvey });
});

const updateInterviewSurvey = asyncHandler(async (req, res) => {
  const {
    user,
    params: { interview_id }
  } = req;

  const payload = req.body;
  const interviewSurvey = await InterviewService.upsertSurvey(
    { interview_id },
    payload,
    [
      ['student_id', 'firstname lastname email'],
      ['program_id', 'school program_name degree semester']
    ]
  );

  res.status(200).send({ success: true, data: interviewSurvey });
  // Inform Trainer
  const interview = (await InterviewService.findInterviewByIdPopulated(
    interview_id,
    [
      ['student_id trainer_id', 'firstname lastname email archiv pictureUrl'],
      ['program_id', 'school program_name degree semester']
    ]
  )) as unknown as PopulatedInterview;
  if (payload.isFinal) {
    if (isNotArchiv(interview.student_id)) {
      InterviewSurveyFinishedEmail(
        {
          firstname: interview.student_id.firstname,
          lastname: interview.student_id.lastname,
          address: interview.student_id.email
        },
        { interview, user }
      );
    }

    const activeTrainers = interview?.trainer_id?.filter(
      (trainer: PopulatedUser) => isNotArchiv(trainer)
    );

    activeTrainers?.map((trainer: PopulatedUser) =>
      InterviewSurveyFinishedToTaiGerEmail(
        {
          firstname: trainer.firstname,
          lastname: trainer.lastname,
          address: trainer.email
        },
        { interview, user }
      )
    );
    const notificationUser =
      interview?.trainer_id?.length > 0
        ? interview?.trainer_id[0]._id
        : undefined;
    if (notificationUser) {
      await addMessageInThread(
        `Automatic Notification: Hi ${interview.student_id.firstname}, thank you for filling the interview training survey. I wish you having a great result for the application.`,
        // `thread_id` is unpopulated here, i.e. the raw thread id at runtime.
        interview?.thread_id as unknown as mongoose.Types.ObjectId,
        notificationUser
      );
    }

    //  close interview
    await InterviewService.updateInterviewByIdRaw(interview_id, {
      isClosed: true,
      status: 'Closed'
    });
  }
});

const createInterview = asyncHandler(async (req, res) => {
  const {
    params: { program_id, studentId },
    body: payload
  } = req;
  const student = (await StudentService.getStudentById(
    studentId
  )) as unknown as PopulatedStudent | null;
  if (!student) {
    logger.info('createInterview: Invalid student id!');
    throw new ErrorResponse(400, 'Invalid student id');
  }

  const interview_existed = await InterviewService.findOneInterview(
    { student_id: studentId, program_id },
    [
      ['student_id trainer_id', 'firstname lastname email pictureUrl'],
      ['program_id', 'school program_name degree semester']
    ]
  );
  if (interview_existed) {
    logger.info('createInterview: Interview already existed!');
    throw new ErrorResponse(409, 'Interview already existed!');
  } else {
    try {
      const createdDocument = await DocumentThreadService.createThread({
        student_id: studentId,
        program_id,
        file_type: 'Interview'
      });

      payload.thread_id = createdDocument._id?.toString();

      await InterviewService.upsertInterviewPopulated(
        { student_id: studentId, program_id },
        payload,
        [
          ['student_id trainer_id', 'firstname lastname email pictureUrl'],
          ['program_id', 'school program_name degree semester']
        ]
      );
    } catch (err) {
      logger.error(err as string);
      throw new ErrorResponse(404, err as string);
    }
    res.status(201).send({ success: true });
    // inform interview assign
    // inform editor-lead
    const permissions = (await PermissionService.findPermissionsWithUser(
      { canAssignEditors: true },
      'firstname lastname email archiv'
    )) as unknown as Array<{ user_id: PopulatedUser }> | null;
    const newlyCreatedInterview = (await InterviewService.findOneInterview(
      { student_id: studentId, program_id },
      [
        ['student_id', 'firstname lastname email'],
        ['program_id', 'school program_name degree semester']
      ]
    )) as unknown as PopulatedInterview;

    if (permissions) {
      const sendEditorLeadEmailPromises = permissions.map(
        (permission: { user_id: PopulatedUser }) =>
          isNotArchiv(permission.user_id) &&
          sendAssignTrainerReminderEmail(
            {
              firstname: permission.user_id.firstname,
              lastname: permission.user_id.lastname,
              address: permission.user_id.email
            },
            {
              student_firstname: student.firstname,
              student_id: student._id.toString(),
              student_lastname: student.lastname,
              interview_id: newlyCreatedInterview._id.toString(),
              program: newlyCreatedInterview.program_id
            }
          )
      );

      await Promise.all(sendEditorLeadEmailPromises);
    }
    if ((student.agents?.length ?? 0) > 0) {
      const sendAgentsEmailPromises = (student.agents ?? []).map(
        (agent: PopulatedUser) =>
          isNotArchiv(agent) &&
          sendAssignTrainerReminderEmail(
            {
              firstname: agent.firstname,
              lastname: agent.lastname,
              address: agent.email
            },
            {
              student_firstname: student.firstname,
              student_id: student._id.toString(),
              student_lastname: student.lastname,
              interview_id: newlyCreatedInterview._id.toString(),
              program: newlyCreatedInterview.program_id
            }
          )
      );

      await Promise.all(sendAgentsEmailPromises);
    }
  }
});

const getAllOpenInterviews = asyncHandler(async (req, res) => {
  let interviews = (await InterviewService.findInterviews({ isClosed: false }, [
    ['student_id trainer_id', 'firstname lastname email'],
    ['program_id', 'school program_name degree semester'],
    ['event_id']
  ])) as unknown as PopulatedInterview[];

  interviews = await addInterviewStatus(interviews);
  res.status(200).send({ success: true, data: interviews });
});

const getInterviewsByProgramId = asyncHandler(async (req, res) => {
  const { programId } = req.params;
  if (!programId) {
    return res
      .status(400)
      .send({ success: false, message: 'Program ID is required' });
  }

  // Shape produced by the aggregation below: student_id/trainer_id are reduced
  // to name/email projections and the date is projected through for sorting.
  interface AggregatedInterview {
    _id: { toString(): string };
    student_id?: { firstname?: string; lastname?: string; email?: string };
    trainer_id?: Array<{
      firstname?: string;
      lastname?: string;
      email?: string;
    }>;
    interview_date: Date;
    event_id?: unknown;
    status?: string;
    isClosed?: boolean;
  }

  try {
    let interviews = (await InterviewService.aggregateInterviews([
      {
        $match: {
          program_id: mongoose.Types.ObjectId.createFromHexString(programId)
        }
      },
      {
        $project: {
          _id: 1,
          student_id: 1,
          trainer_id: 1,
          interview_date: 1,
          event_id: 1,
          status: 1,
          isClosed: 1
        }
      },
      {
        $lookup: {
          from: 'interviewsurveyresponses', // Collection name in MongoDB
          localField: '_id',
          foreignField: 'interview_id',
          as: 'surveyResponses'
        }
      },
      // $lookup cannot mix `pipeline` with `localField`/`foreignField` (MongoDB error 51174).
      {
        $lookup: {
          from: 'users',
          localField: 'student_id',
          foreignField: '_id',
          as: 'student_id'
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'trainer_id',
          foreignField: '_id',
          as: 'trainer_id'
        }
      },
      {
        $addFields: {
          student_id: {
            $map: {
              input: '$student_id',
              as: 's',
              in: {
                firstname: '$$s.firstname',
                lastname: '$$s.lastname',
                email: '$$s.email'
              }
            }
          },
          trainer_id: {
            $map: {
              input: '$trainer_id',
              as: 't',
              in: {
                firstname: '$$t.firstname',
                lastname: '$$t.lastname',
                email: '$$t.email'
              }
            }
          }
        }
      },
      {
        $unwind: {
          path: '$student_id',
          preserveNullAndEmptyArrays: true
        }
      }
    ])) as unknown as AggregatedInterview[];

    interviews = await addInterviewStatus(interviews);
    interviews = interviews.sort((a, b) => {
      return (
        new Date(b.interview_date).getTime() -
        new Date(a.interview_date).getTime()
      );
    });

    res
      .status(200)
      .send({ success: true, data: interviews, count: interviews.length });
  } catch (error) {
    res.status(500).send({ success: false, message: (error as Error).message });
  }
});

const getInterviewsByStudentId = asyncHandler(async (req, res) => {
  const { studentId } = req.params;
  if (!studentId) {
    return res
      .status(400)
      .send({ success: false, message: 'Student ID is required' });
  }

  try {
    let interviews = (await InterviewService.findInterviews(
      { student_id: studentId },
      [
        ['student_id', 'firstname lastname email'],
        ['trainer_id', 'firstname lastname email'],
        ['program_id', 'school program_name degree semester']
      ]
    )) as unknown as PopulatedInterview[];

    interviews = await addInterviewStatus(interviews);

    res
      .status(200)
      .send({ success: true, data: interviews, count: interviews.length });
  } catch (error) {
    res.status(500).send({ success: false, message: (error as Error).message });
  }
});

export = {
  getAllInterviewsPaginated,
  getMyInterviewPaginated,
  getInterviewQuestions,
  getMyInterview,
  getInterview,
  addInterviewTrainingDateTime,
  updateInterview,
  getInterviewSurvey,
  updateInterviewSurvey,
  deleteInterview,
  createInterview,
  getAllOpenInterviews,
  getInterviewsByProgramId,
  getInterviewsByStudentId
};
