const mongoose = require('mongoose');
const async = require('async');
const path = require('path');
const { Role, is_TaiGer_Student } = require('@taiger-common/core');

const { ErrorResponse } = require('../common/errors');
const { asyncHandler } = require('../middlewares/error-handler');
const logger = require('../services/logger');
const { AWS_S3_BUCKET_NAME } = require('../config');
const {
  sendInterviewConfirmationEmail,
  sendAssignTrainerReminderEmail,
  sendAssignedInterviewTrainerToTrainerEmail,
  sendAssignedInterviewTrainerToStudentEmail,
  InterviewCancelledReminderEmail,
  sendSetAsFinalInterviewEmail,
  InterviewSurveyFinishedEmail,
  InterviewSurveyFinishedToTaiGerEmail
} = require('../services/email');
const { addMessageInThread } = require('../utils/informEditor');
const { isNotArchiv } = require('../constants');
const { getPermission } = require('../utils/queryFunctions');
const { emptyS3Directory } = require('../utils/modelHelper/versionControl');
const { userChangesHelperFunction } = require('../utils/utils_function');
const StudentService = require('../services/students');

const PrecheckInterview = asyncHandler(async (req, interview_id) => {
  const precheck_interview = await req.db
    .model('Interview')
    .findById(interview_id);
  if (precheck_interview.isClosed) {
    logger.info('updateInterview: interview is closed!');
    throw new ErrorResponse(403, 'Interview is closed');
  }
});

const InterviewCancelledReminder = async (
  user,
  receiver,
  meeting_event,
  cc
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
  receiver,
  user,
  event,
  interview_id,
  program,
  isUpdatingEvent,
  cc
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

const addInterviewStatus = async (db, interviews) => {
  const now = Date.now();
  const interviewsWithStatus = [];
  let openInterviews = [];

  for (const interview of interviews) {
    const { interview_date, event_id, isClosed } = interview;

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
    openInterviews.map((i) => i?.student_id?._id?.toString()).filter(Boolean)
  );

  if (openStudentIds.size === 0) return interviewsWithStatus;
  const trainedStudentIds = (
    await db
      .model('Interview')
      .find({
        student_id: { $in: Array.from(openStudentIds) },
        event_id: { $exists: true, $ne: null }
      })
      .distinct('student_id')
  ).map((id) => id.toString());

  openInterviews = openInterviews.map((interview) => {
    const studentId = interview?.student_id?._id?.toString();
    if (studentId && trainedStudentIds.includes(studentId)) {
      return { ...interview, status: 'N/A' };
    }
    return { ...interview, status: 'Open' };
  });

  return [...openInterviews, ...interviewsWithStatus];
};

const getAllInterviews = asyncHandler(async (req, res) => {
  let interviews = await req.db
    .model('Interview')
    .find()
    .populate('student_id trainer_id', 'firstname lastname email')
    .populate('program_id', 'school program_name degree semester')
    .populate('event_id')
    .lean();

  interviews = await addInterviewStatus(req.db, interviews);
  res.status(200).send({ success: true, data: interviews });
});

const getInterviewQuestions = asyncHandler(async (req, res) => {
  const { programId } = req.params;

  const interviewsSurveys = await req.db
    .model('InterviewSurveyResponse')
    .find()
    .populate('student_id', 'firstname lastname email')
    .lean();

  const questionsArray = interviewsSurveys.filter(
    (survey) => survey.interview_id.program_id.toString() === programId
  );

  res.status(200).send({ success: true, data: questionsArray });
});

const getMyInterview = asyncHandler(async (req, res) => {
  const { user } = req;
  const filter = {};
  const studentFilter = {
    $or: [{ archiv: { $exists: false } }, { archiv: false }]
  };
  if (is_TaiGer_Student(user)) {
    filter.student_id = user._id.toString();
  }
  let interviews = await req.db
    .model('Interview')
    .find(filter)
    .populate('student_id trainer_id', 'firstname lastname email')
    .populate('program_id', 'school program_name degree semester')
    .populate('thread_id event_id')
    .lean();
  if ([Role.Admin, Role.Agent, Role.Editor].includes(user.role)) {
    if ([Role.Agent, Role.Editor].includes(user.role)) {
      const permissions = await getPermission(req, user);
      if (!(permissions?.canAssignAgents || permissions?.canAssignEditors)) {
        studentFilter.agents = user._id;
      }
    }

    interviews = await addInterviewStatus(req.db, interviews);
    const students = await req.db
      .model('Student')
      .find(studentFilter)
      .populate('agents editors', 'firstname lastname email')
      .populate('applications.programId', 'school program_name degree semester')
      .lean();

    if (!students) {
      logger.info('getMyInterview: No students found!');
      throw new ErrorResponse(400, 'No students found!');
    }

    res.status(200).send({ success: true, data: interviews, students });
  } else {
    const student = await req.db
      .model('Student')
      .findById(user._id.toString())
      .populate('applications.programId', 'school program_name degree semester')
      .lean();
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
    let interview = await req.db
      .model('Interview')
      .findById(interview_id)
      .populate('student_id trainer_id', 'firstname lastname email')
      .populate('program_id', 'school program_name degree semester')
      .populate({
        path: 'thread_id',
        select:
          'file_type isFinalVersion outsourced_user_id flag_by_user_id updatedAt messages.file messages.message messages.createdAt messages._id',
        populate: {
          path: 'messages.user_id',
          select: 'firstname lastname'
        }
      })
      .populate('event_id')
      .lean();

    if (interview) {
      const [updatedInterview] = await addInterviewStatus(req.db, [interview]);
      interview = updatedInterview;
    }

    if (!interview) {
      logger.info('getInterview: this interview is not found!');
      throw new ErrorResponse(404, 'this interview is not found!');
    }
    const interviewAuditLogPromise = req.db
      .model('Audit')
      .find({
        interviewThreadId: interview_id
      })
      .populate('performedBy targetUserId', 'firstname lastname role')
      .populate({
        path: 'targetDocumentThreadId interviewThreadId',
        select: 'program_id file_type',
        populate: {
          path: 'program_id',
          select: 'school program_name degree semester'
        }
      })
      .sort({ createdAt: -1 });

    const questionsNumPromise = req.db
      .model('InterviewSurveyResponse')
      .countDocuments({ 'interview_id.program_id': interview.program_id?._id });

    const [interviewAuditLog, questionsNum] = await Promise.all([
      interviewAuditLogPromise,
      questionsNumPromise
    ]);

    res.status(200).send({
      success: true,
      data: interview,
      questionsNum,
      interviewAuditLog
    });
  } catch (e) {
    logger.error(`getInterview: ${e.message}`);
    throw new ErrorResponse(404, 'this interview is not found!');
  }
});

const deleteInterview = asyncHandler(async (req, res) => {
  const {
    user,
    params: { interview_id }
  } = req;

  await PrecheckInterview(req, interview_id);

  const interview = await req.db.model('Interview').findById(interview_id);
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
      const toBeDeletedEvent = await req.db
        .model('Event')
        .findByIdAndDelete(interview.event_id)
        .populate('receiver_id requester_id', 'firstname lastname email archiv')
        .lean();
      const student_temp = await req.db
        .model('Student')
        .findById(interview.student_id)
        .populate('agents', 'firstname lastname email');
      const cc = [...toBeDeletedEvent.receiver_id, ...student_temp.agents];
      const receiver = toBeDeletedEvent.requester_id[0];
      if (isNotArchiv(receiver)) {
        await InterviewCancelledReminder(user, receiver, toBeDeletedEvent, cc);
      }

      await req.db.model('Event').findByIdAndDelete(interview.event_id);
    }
    // Delete interview thread in mongoDB
    await req.db.model('Documentthread').findByIdAndDelete(interview.thread_id);
  }

  // Delete interview  in mongoDB
  await req.db.model('Interview').findByIdAndDelete(interview_id);
  // Delete interview survey if existed
  await req.db.model('InterviewSurveyResponse').findOneAndDelete({
    interview_id
  });

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
    let newEvent;
    if (oldEvent._id) {
      try {
        await req.db
          .model('Event')
          .findByIdAndUpdate(oldEvent._id, { ...oldEvent }, {});
        newEvent = await req.db
          .model('Event')
          .findById(oldEvent._id)
          .populate(
            'receiver_id requester_id',
            'firstname lastname email archiv'
          )
          .lean();
        await req.db
          .model('Interview')
          .findByIdAndUpdate(
            interview_id,
            { event_id: oldEvent._id, status: 'Scheduled' },
            {}
          );
        isUpdatingEvent = true;
      } catch (e) {
        logger.error(`addInterviewTrainingDateTime: ${e.message}`);
        throw new ErrorResponse(403, e.message);
      }
    } else {
      const write_NewEvent = await req.db.model('Event').create(oldEvent);
      await write_NewEvent.save();
      newEvent = await req.db
        .model('Event')
        .findById(write_NewEvent._id)
        .populate('receiver_id requester_id', 'firstname lastname email archiv')
        .lean();
      await req.db
        .model('Interview')
        .findByIdAndUpdate(
          interview_id,
          { event_id: write_NewEvent._id?.toString(), status: 'Scheduled' },
          {}
        );
    }

    res.status(200).send({
      success: true
    });

    const interview_tmep = await req.db
      .model('Interview')
      .findById(interview_id)
      .populate('program_id')
      .lean();
    // inform agent for confirmed training date
    const student_temp = await req.db
      .model('Student')
      .findById(interview_tmep.student_id)
      .populate('agents', 'firstname lastname email');

    const cc = [...newEvent.receiver_id, ...student_temp.agents];

    const emailRequestsRequesters = newEvent.requester_id.map(
      (receiver) =>
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

    // const updatedEvent = await req.db.model('Event').findById(write_NewEvent._id)
    //   .populate('requester_id receiver_id', 'firstname lastname email')
    //   .lean();
    // updatedEvent.requester_id.forEach((requester) => {
    //   meetingConfirmationReminder(requester, user, updatedEvent.start);
    // });
    next();
  } catch (err) {
    logger.error(`postEvent: ${err.message}`);
    throw new ErrorResponse(500, err.message);
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
  const beforeUpdate = await req.db
    .model('Interview')
    .findById(interview_id)
    .populate('student_id trainer_id', 'firstname lastname email archiv')
    .populate('program_id', 'school program_name degree semester')
    .populate('thread_id event_id')
    .lean();

  if (!beforeUpdate) {
    return res.status(404).json({ error: 'Interview not found' });
  }

  const interview = await req.db
    .model('Interview')
    .findByIdAndUpdate(interview_id, payload, {
      new: true
    })
    .populate('student_id trainer_id', 'firstname lastname email archiv role')
    .populate('program_id', 'school program_name degree semester')
    .populate('thread_id event_id')
    .lean();

  if (!interview) {
    return res.status(500).json({ error: 'Failed to update interview' });
  }
  const trainerObj = {};
  payload.trainer_id?.forEach((id) => {
    trainerObj[id] = true;
  });

  const {
    addedUsers: addedInterviewers,
    removedUsers: removedInterviewers,
    updatedUsers: updatedInterviewers,
    toBeInformedUsers: toBeInformedInterviewers,
    updatedUserIds: updatedInterviewerIds
  } = await userChangesHelperFunction(req, trainerObj, beforeUpdate.trainer_id);

  if (payload.isClosed === true || payload.isClosed === false) {
    await req.db
      .model('Documentthread')
      .findByIdAndUpdate(
        interview.thread_id?._id.toString(),
        { isFinalVersion: payload.isClosed },
        {}
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
      (trainer) =>
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

  const interviewSurvey = await req.db
    .model('InterviewSurveyResponse')
    .findOne({
      interview_id
    })
    .populate('student_id', 'firstname lastname email')
    .populate('program_id', 'school program_name degree semester')
    .lean();

  res.status(200).send({ success: true, data: interviewSurvey });
});

const updateInterviewSurvey = asyncHandler(async (req, res) => {
  const {
    user,
    params: { interview_id }
  } = req;

  const payload = req.body;
  const interviewSurvey = await req.db
    .model('InterviewSurveyResponse')
    .findOneAndUpdate({ interview_id }, payload, {
      new: true,
      upsert: true
    })
    .populate('student_id', 'firstname lastname email')
    .populate('program_id', 'school program_name degree semester')
    .lean();

  res.status(200).send({ success: true, data: interviewSurvey });
  // Inform Trainer
  const interview = await req.db
    .model('Interview')
    .findById(interview_id)
    .populate('student_id trainer_id', 'firstname lastname email archiv')
    .populate('program_id', 'school program_name degree semester')
    .lean();
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

    const activeTrainers = interview?.trainer_id?.filter((trainer) =>
      isNotArchiv(trainer)
    );

    activeTrainers?.map((trainer) =>
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
        req,
        `Automatic Notification: Hi ${interview.student_id.firstname}, thank you for filling the interview training survey. I wish you having a great result for the application.`,
        interview?.thread_id,
        notificationUser
      );
    }

    //  close interview
    await req.db
      .model('Interview')
      .findByIdAndUpdate(
        interview_id,
        { isClosed: true, status: 'Closed' },
        {}
      );
  }
});

const createInterview = asyncHandler(async (req, res) => {
  const {
    params: { program_id, studentId },
    body: payload
  } = req;
  const student = await StudentService.getStudentById(req, studentId);
  if (!student) {
    logger.info('createInterview: Invalid student id!');
    throw new ErrorResponse(400, 'Invalid student id');
  }

  const interview_existed = await req.db
    .model('Interview')
    .findOne({
      student_id: studentId,
      program_id
    })
    .populate('student_id trainer_id', 'firstname lastname email')
    .populate('program_id', 'school program_name degree semester')
    .lean();
  if (interview_existed) {
    logger.info('createInterview: Interview already existed!');
    throw new ErrorResponse(409, 'Interview already existed!');
  } else {
    try {
      const createdDocument = await req.db.model('Documentthread').create({
        student_id: studentId,
        program_id,
        file_type: 'Interview'
      });

      payload.thread_id = createdDocument._id?.toString();

      await req.db
        .model('Interview')
        .findOneAndUpdate(
          {
            student_id: studentId,
            program_id
          },
          payload,
          { upsert: true }
        )
        .populate('student_id trainer_id', 'firstname lastname email')
        .populate('program_id', 'school program_name degree semester')
        .lean();
    } catch (err) {
      logger.error(err);
      throw new ErrorResponse(404, err);
    }
    res.status(201).send({ success: true });
    // inform interview assign
    // inform editor-lead
    const permissions = await req.db
      .model('Permission')
      .find({
        canAssignEditors: true
      })
      .populate('user_id', 'firstname lastname email archiv')
      .lean();
    const newlyCreatedInterview = await req.db
      .model('Interview')
      .findOne({
        student_id: studentId,
        program_id
      })
      .populate('student_id', 'firstname lastname email')
      .populate('program_id', 'school program_name degree semester')
      .lean();

    if (permissions) {
      const sendEditorLeadEmailPromises = permissions.map(
        (permission) =>
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
    if (student.agents?.length > 0) {
      const sendAgentsEmailPromises = student.agents.map(
        (agent) =>
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
  const now = Date.now();
  let interviews = await req.db
    .model('Interview')
    .find({ isClosed: false })
    .populate('student_id trainer_id', 'firstname lastname email')
    .populate('program_id', 'school program_name degree semester')
    .populate('event_id')
    .lean();

  interviews = await addInterviewStatus(req.db, interviews);
  res.status(200).send({ success: true, data: interviews });
});

const getInterviewsByProgramId = asyncHandler(async (req, res) => {
  const { programId } = req.params;
  if (!programId) {
    return res
      .status(400)
      .send({ success: false, message: 'Program ID is required' });
  }

  try {
    let interviews = await req.db
      .model('Interview')
      .find({ program_id: programId })
      .populate('student_id', 'firstname lastname email')
      .populate('trainer_id', 'firstname lastname email') // This will populate an array of trainers
      .populate('program_id', 'school program_name degree semester')
      .populate('event_id')
      .populate('thread_id')
      .lean();

    interviews = await addInterviewStatus(req.db, interviews);
    res
      .status(200)
      .send({ success: true, data: interviews, count: interviews.length });
  } catch (error) {
    res.status(500).send({ success: false, message: error.message });
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
    let interviews = await req.db
      .model('Interview')
      .find({ student_id: studentId })
      .populate('student_id', 'firstname lastname email')
      .populate('trainer_id', 'firstname lastname email') // This will populate an array of trainers
      .populate('program_id', 'school program_name degree semester')
      .populate('event_id')
      .populate('thread_id')
      .lean();

    interviews = await addInterviewStatus(req.db, interviews);

    res
      .status(200)
      .send({ success: true, data: interviews, count: interviews.length });
  } catch (error) {
    res.status(500).send({ success: false, message: error.message });
  }
});

module.exports = {
  getAllInterviews,
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
