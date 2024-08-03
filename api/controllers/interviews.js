const async = require('async');
const path = require('path');
const { ErrorResponse } = require('../common/errors');
const { asyncHandler } = require('../middlewares/error-handler');
const { Role } = require('../constants');
const logger = require('../services/logger');
const { emptyS3Directory } = require('../utils/utils_function');
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

const PrecheckInterview = asyncHandler(async (req, interview_id) => {
  const precheck_interview = await req.db
    .model('Interview')
    .findById(interview_id);
  if (precheck_interview.isClosed) {
    logger.info('updateInterview: interview is closed!');
    throw new ErrorResponse(403, 'Interview is closed');
  }
});

const InterviewCancelledReminder = asyncHandler(
  async (user, receiver, meeting_event, cc) => {
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
        event_title:
          user.role === 'Student'
            ? `${user.firstname} ${user.lastname}`
            : `${meeting_event.receiver_id[0].firstname} ${meeting_event.receiver_id[0].lastname}`,
        isUpdatingEvent: false,
        cc
      }
    );
  }
);

const InterviewTrainingInvitation = asyncHandler(
  async (receiver, user, event, interview_id, program, isUpdatingEvent, cc) => {
    await sendInterviewConfirmationEmail(
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
  }
);

const getAllInterviews = asyncHandler(async (req, res) => {
  const interviews = await req.db
    .model('Interview')
    .find()
    .populate('student_id trainer_id', 'firstname lastname email')
    .populate('program_id', 'school program_name degree semester')
    .populate('event_id')
    .lean();

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
  if (user.role === Role.Student) {
    filter.student_id = user._id.toString();
  }
  const interviews = await req.db
    .model('Interview')
    .find(filter)
    .populate('student_id trainer_id', 'firstname lastname email')
    .populate('program_id', 'school program_name degree semester')
    .populate('thread_id event_id')
    .lean();
  if (
    user.role === Role.Admin ||
    user.role === Role.Agent ||
    user.role === Role.Editor
  ) {
    if (user.role === Role.Agent || user.role === Role.Editor) {
      const permissions = await getPermission(req, user);
      if (!(permissions?.canAssignAgents || permissions?.canAssignEditors)) {
        studentFilter.agents = user._id;
      }
    }
    const students = await req.db
      .model('Student')
      .find(studentFilter)
      .populate('agents editors', 'firstname lastname email')
      .populate('applications.programId', 'school program_name degree semester')
      .lean();
    if (!students) {
      logger.info('getMyInterview: this student is not existed!');
      throw new ErrorResponse(400, 'this student is not existed!');
    }

    res.status(200).send({ success: true, data: interviews, students });
  } else {
    const student = await req.db
      .model('Student')
      .findById(user._id.toString())
      .populate('applications.programId', 'school program_name degree semester')
      .lean();
    if (!student) {
      logger.info('getMyInterview: this student is not existed!');
      throw new ErrorResponse(400, 'this student is not existed!');
    }

    res.status(200).send({ success: true, data: interviews, student });
  }
});

const getInterview = asyncHandler(async (req, res) => {
  const {
    params: { interview_id }
  } = req;
  try {
    const interview = await req.db
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

    if (!interview) {
      logger.info('getInterview: this interview is not found!');
      throw new ErrorResponse(404, 'this interview is not found!');
    }

    const interviewsSurveys = await req.db
      .model('InterviewSurveyResponse')
      .find()
      .populate('interview_id')
      .lean();

    const num = interviewsSurveys.filter(
      (survey) =>
        survey.interview_id.program_id.toString() ===
        interview.program_id?._id?.toString()
    )?.length;
    res.status(200).send({ success: true, data: interview, questionsNum: num });
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
      // TODO: send delete event email
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
      .populate('program_id');
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

const updateInterview = asyncHandler(async (req, res) => {
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

  const interview = await req.db
    .model('Interview')
    .findByIdAndUpdate(interview_id, payload, {
      new: true
    })
    .populate('student_id trainer_id', 'firstname lastname email archiv')
    .populate('program_id', 'school program_name degree semester')
    .populate('thread_id event_id')
    .lean();
  if (payload.isClosed === true || payload.isClosed === false) {
    await req.db
      .model('Documentthread')
      .findByIdAndUpdate(
        interview.thread_id._id.toString(),
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
  }
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
  // TODO Inform Trainer
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
  const student = await req.db
    .model('Student')
    .findById(studentId)
    .populate('applications.programId')
    .populate('agents editors', 'firstname lastname email')
    .exec();
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
    res.status(200).send({ success: true });
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
  createInterview
};
