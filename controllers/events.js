const {
  is_TaiGer_Agent,
  is_TaiGer_Student,
  is_TaiGer_Editor
} = require('@taiger-common/core');
const { Types } = require('mongoose');

const { ErrorResponse } = require('../common/errors');
const { asyncHandler } = require('../middlewares/error-handler');
const {
  MeetingInvitationEmail,
  MeetingConfirmationReminderEmail,
  MeetingAdjustReminderEmail,
  MeetingCancelledReminderEmail
} = require('../services/email');
const logger = require('../services/logger');
const { TENANT_SHORT_NAME } = require('../constants/common');
const EventQueryBuilder = require('../builders/EventQueryBuilder');

const { scheduleInviteTA } = require('../utils/meeting-assistant.service');
const EventService = require('../services/events');
const UserService = require('../services/users');

const AGENT_OH_SELECT =
  'firstname lastname email selfIntroduction officehours timezone pictureUrl';
const AGENT_OH_SELECT_NO_PIC =
  'firstname lastname email selfIntroduction officehours timezone';

const handleTAScheduling = async (
  taigerRep,
  student,
  user,
  updatedEvent,
  eventId
) => {
  try {
    // success response example:
    // {success: true, meetingId: 'sk3s965j2qle9jtm6sufprc53s', meetingUrl: 'https://meet.jit.si/AJ-student_taiger_2025-…-23T06_00_00_000Z_6945cba8822419e279cf5f11', start: '2025-12-23T07:00:00+01:00', end: '2025-12-23T07:30:00+01:00', …}
    const data = await scheduleInviteTA(
      `[${taigerRep.firstname} OH] ${student?.firstname || user?.firstname} ${
        student?.lastname || user?.lastname
      } ###${student?._id || user?._id}###`,
      updatedEvent.meetingLink,
      updatedEvent.start,
      updatedEvent.end
    );
    if (!data.success) {
      logger.error(
        `TA schedule invite failed: ${JSON.stringify(
          data
        )} for event_id: ${eventId}`
      );
    } else {
      logger.info(`TA schedule invite succeeded for event_id: ${eventId}`);
    }
  } catch (err) {
    logger.error(err);
  }
};

const MeetingAdjustReminder = (receiver, user, meeting_event) => {
  MeetingAdjustReminderEmail(
    {
      id: receiver._id.toString(),
      firstname: receiver.firstname,
      lastname: receiver.lastname,
      address: receiver.email
    },
    {
      taiger_user_firstname: user.firstname,
      taiger_user_lastname: user.lastname,
      role: user.role,
      meeting_time: meeting_event.start,
      student_id: user._id.toString(),
      event: meeting_event,
      isUpdatingEvent: true
    }
  );
};

const MeetingCancelledReminder = (user, meeting_event) => {
  MeetingCancelledReminderEmail(
    is_TaiGer_Student(user)
      ? {
          id: meeting_event.receiver_id[0]._id.toString(),
          firstname: meeting_event.receiver_id[0].firstname,
          lastname: meeting_event.receiver_id[0].lastname,
          address: meeting_event.receiver_id[0].email
        }
      : {
          id: meeting_event.requester_id[0]._id.toString(),
          firstname: meeting_event.requester_id[0].firstname,
          lastname: meeting_event.requester_id[0].lastname,
          address: meeting_event.requester_id[0].email
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
      isUpdatingEvent: false
    }
  );
};

const meetingInvitation = (receiver, user, event) => {
  MeetingInvitationEmail(
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
      isUpdatingEvent: false,
      event,
      event_title: is_TaiGer_Student(user)
        ? `${user.firstname} ${user.lastname}`
        : `${receiver.firstname} ${receiver.lastname}`
    }
  );
};

const meetingConfirmationReminder = (receiver, user, start_time) => {
  MeetingConfirmationReminderEmail(
    {
      id: receiver._id.toString(),
      firstname: receiver.firstname,
      lastname: receiver.lastname,
      address: receiver.email
    },
    {
      taiger_user_firstname: user.firstname,
      taiger_user_lastname: user.lastname,
      role: user.role,
      meeting_time: start_time, // Replace with the actual meeting time
      student_id: user._id.toString()
    }
  );
};

const getBookedEvents = asyncHandler(async (req, res, next) => {
  const { user } = req;
  const { startTime, endTime } = req.query;
  const { filter: startTimeEventQuery } = new EventQueryBuilder()
    .withStartTimeStart(startTime)
    .withStartTimeEnd(endTime)
    .build();

  // Only available for students
  if (!is_TaiGer_Student(user)) {
    return res.status(403).send({
      success: false,
      message: 'Booked events are only available for students'
    });
  }

  const agentsIds = user.agents;

  // Fetch booked events for student's agents
  const bookedEvents = await EventService.findEvents(
    {
      receiver_id: { $in: agentsIds },
      requester_id: { $ne: user._id },
      ...startTimeEventQuery
    },
    {
      populate: { path: 'receiver_id', select: 'firstname lastname email' },
      select: 'start'
    }
  );

  res.status(200).send({
    success: true,
    data: bookedEvents
  });
  return next();
});

const getEvents = asyncHandler(async (req, res, next) => {
  const { user } = req;
  const { startTime, endTime, requester_id, receiver_id } = req.query;
  // const { filter: startTimeEventQuery } = new EventQueryBuilder()
  //   .withStartTimeStart(startTime)
  //   .withStartTimeEnd(endTime)
  //   .withRequesterId(requester_id)
  //   .withReceiverId(receiver_id)
  //   .build();

  const { filter: endTimeEventQuery } = new EventQueryBuilder()
    .withEndTimeStart(startTime)
    .withEndTimeEnd(endTime)
    .withRequesterId(requester_id)
    .withReceiverId(receiver_id)
    .build();

  // Common response structure
  const response = {
    success: true,
    agents: [],
    data: [],
    hasEvents: false
  };

  // Role-based logic
  const agentsIds = user.agents;
  const editorsIds = user.editors;

  // Fetch student's agents
  const [agents, editors] = await Promise.all([
    UserService.findAgents({ _id: { $in: agentsIds } }, AGENT_OH_SELECT),
    UserService.findEditors({ _id: { $in: editorsIds } }, AGENT_OH_SELECT)
  ]);

  response.agents = agents;
  response.editors = editors;
  const events = await EventService.findEvents(endTimeEventQuery, {
    populate: {
      path: 'receiver_id requester_id',
      select: 'firstname lastname email pictureUrl'
    }
  });

  response.data = events;
  response.hasEvents = events.length > 0;

  res.status(200).send(response);
  return next();
});

const getActiveEventsNumber = asyncHandler(async (req, res) => {
  const { user } = req;
  const { filter: eventQuery } = new EventQueryBuilder()
    .withOrs([{ requester_id: user._id }, { receiver_id: user._id }])
    .withConfirmedReceiver(true)
    .withConfirmedRequester(true)
    .withStartTimeStart(new Date())
    .build();
  const futureEvents = await EventService.findEvents(eventQuery);
  res.status(200).send({ success: true, data: futureEvents.length });
});

const showEvent = asyncHandler(async (req, res, next) => {
  const { event_id } = req.params;
  const event = await EventService.getEventById(event_id);

  res.status(200).json(event);
  next();
});

const postEvent = asyncHandler(async (req, res, next) => {
  const { user } = req;
  const newEvent = req.body;
  let events;

  if (is_TaiGer_Student(user)) {
    let write_NewEvent;
    delete newEvent.id;
    newEvent.isConfirmedRequester = true;
    // TODO: verify requester_id and receiver_id?
    // Check if there is already future timeslot, same student?
    const currentDate = new Date();
    try {
      events = await EventService.findEvents(
        {
          $or: [
            {
              start: newEvent.start,
              receiver_id: {
                $in: [new Types.ObjectId(newEvent.receiver_id)]
              }
            }, // Start date is the same as the provided date
            {
              start: { $gt: currentDate }, // Start date is in the future
              requester_id: {
                $in: [new Types.ObjectId(newEvent.requester_id)]
              },
              receiver_id: {
                $in: [new Types.ObjectId(newEvent.receiver_id)]
              }
            }
          ]
        },
        {
          populate: {
            path: 'requester_id receiver_id',
            select: 'firstname lastname email pictureUrl'
          }
        }
      );
    } catch (e) {
      logger.error(e);
    }

    // Check if there is already booked upcoming events
    if (events.length === 0) {
      // TODO: additional check if the timeslot is in agent office hour?
      write_NewEvent = await EventService.createEvent(newEvent);
    } else {
      logger.error('Student book a conflicting event in this time slot.');
      throw new ErrorResponse(
        403,
        'You are not allowed to book further timeslot, if you have already an upcoming timeslot of the agent or editor.'
      );
    }
    events = await EventService.findEvents(
      {
        requester_id: {
          $in: [new Types.ObjectId(newEvent.requester_id)]
        }
      },
      {
        populate: {
          path: 'requester_id receiver_id',
          select: 'firstname lastname email pictureUrl'
        }
      }
    );
    const agents_ids = user.agents;
    const agents = await UserService.findAgents(
      { _id: agents_ids },
      AGENT_OH_SELECT
    );
    res.status(201).send({
      success: true,
      agents,
      data: events,
      hasEvents: events.length !== 0
    });

    // TODO Sent email to receiver
    const updatedEvent = await EventService.getEventByIdPopulated(
      write_NewEvent._id,
      'firstname lastname email'
    );

    updatedEvent.receiver_id.forEach((receiver) => {
      meetingConfirmationReminder(receiver, user, updatedEvent.start);
    });
  } else {
    try {
      let write_NewEvent;
      delete newEvent.id;
      newEvent.isConfirmedReceiver = true;
      events = await EventService.findEvents(
        {
          start: newEvent.start,
          $or: [
            {
              requester_id: { $in: [new Types.ObjectId(newEvent.requester_id)] }
            },
            {
              receiver_id: { $in: [new Types.ObjectId(newEvent.requester_id)] }
            }
          ]
        },
        {
          populate: {
            path: 'receiver_id',
            select: 'firstname lastname email pictureUrl'
          }
        }
      );
      // Check if there is any already booked upcoming events
      if (events.length === 0) {
        write_NewEvent = await EventService.createEvent(newEvent);
      } else {
        logger.error(
          `${TENANT_SHORT_NAME} user books a conflicting event in this time slot.`
        );
        throw new ErrorResponse(
          403,
          'You are not allowed to book further timeslot, if you have already an upcoming timeslot.'
        );
      }
      events = await EventService.findEvents(
        {
          $or: [{ requester_id: user._id }, { receiver_id: user._id }]
        },
        {
          populate: {
            path: 'receiver_id requester_id',
            select: 'firstname lastname email pictureUrl'
          }
        }
      );
      const agents_ids = user.agents;
      const agents = await UserService.findAgents(
        { _id: agents_ids },
        AGENT_OH_SELECT
      );
      res.status(201).send({
        success: true,
        agents,
        data: events,
        hasEvents: events.length !== 0
      });
      const updatedEvent = await EventService.getEventByIdPopulated(
        write_NewEvent._id,
        'firstname lastname email pictureUrl'
      );
      updatedEvent.requester_id.forEach((requester) => {
        meetingConfirmationReminder(requester, user, updatedEvent.start);
      });
    } catch (err) {
      logger.error(`postEvent: ${err.message}`);
      throw new ErrorResponse(500, err.message);
    }
  }
  next();
});

const confirmEvent = asyncHandler(async (req, res, next) => {
  const { event_id } = req.params;
  const { user } = req;
  const updated_event = req.body;
  const { addMeetingAssistant = true } = updated_event;

  let student;
  let taigerRep;

  try {
    const date = new Date(updated_event.start);
    if (is_TaiGer_Student(user)) {
      updated_event.isConfirmedRequester = true;
      updated_event.meetingLink = `https://meet.jit.si/${user.firstname}_${
        user.lastname
      }_${date
        .toISOString()
        .replace(/:/g, '_')
        .replace(/\./g, '_')}_${user._id.toString()}`.replace(/ /g, '_');
    }
    if (is_TaiGer_Agent(user) || is_TaiGer_Editor(user)) {
      const event_temp = await EventService.getEventByIdPopulated(
        event_id,
        'firstname lastname email pictureUrl'
      );
      let concat_name = '';
      let concat_id = '';
      // eslint-disable-next-line no-restricted-syntax
      for (const requester of event_temp.requester_id) {
        concat_name += `${requester.firstname}_${requester.lastname}`;
        concat_id += `${requester._id.toString()}`;
      }
      if (event_temp) {
        updated_event.isConfirmedReceiver = true;
        updated_event.meetingLink = `https://meet.jit.si/${concat_name}_${date
          .toISOString()
          .replace(/:/g, '_')
          .replace(/\./g, '_')}_${concat_id}`.replace(/ /g, '_');
      } else {
        logger.error('confirmEvent: No event found!');
        throw new ErrorResponse(404, 'No event found!');
      }
    }
    updated_event.end = new Date(date.getTime() + 60000 * 30);
    const event = await EventService.updateEventById(
      event_id,
      updated_event,
      'firstname lastname email pictureUrl'
    );
    if (event) {
      res.status(200).send({ success: true, data: event });
    }
    if (!event) {
      res.status(404).json({ error: 'event is not found' });
    }
    // TODO Sent email to requester
    if (is_TaiGer_Student(user)) {
      student = user;
      taigerRep = event.receiver_id[0];
      event.receiver_id.forEach((receiver) => {
        meetingInvitation(receiver, user, event);
      });
    }
    if (is_TaiGer_Agent(user) || is_TaiGer_Editor(user)) {
      student = event.requester_id[0];
      taigerRep = user;
      event.requester_id.forEach((requester) => {
        meetingInvitation(requester, user, event);
      });
    }
  } catch (err) {
    logger.error(err);
    throw new ErrorResponse(400, err);
  }

  logger.info(
    `[${event_id}] Confirm event called with addMeetingAssistant: ${addMeetingAssistant}`
  );
  if (addMeetingAssistant) {
    handleTAScheduling(taigerRep, student, user, updated_event, event_id);
  }
  next();
});

const updateEvent = asyncHandler(async (req, res, next) => {
  const { event_id } = req.params;
  const { user } = req;
  const updated_event = req.body;
  const { addMeetingAssistant = true } = updated_event;

  let student;
  let taigerRep;

  try {
    const date = new Date(updated_event.start);
    if (is_TaiGer_Student(user)) {
      updated_event.isConfirmedRequester = true;
      updated_event.isConfirmedReceiver = false;
    }
    if (is_TaiGer_Agent(user) || is_TaiGer_Editor(user)) {
      updated_event.isConfirmedRequester = false;
      updated_event.isConfirmedReceiver = true;
    }

    updated_event.end = new Date(date.getTime() + 60000 * 30);
    const event = await EventService.updateEventById(
      event_id,
      updated_event,
      'firstname lastname email'
    );
    if (event) {
      res.status(200).send({ success: true, data: event });
    }
    if (!event) {
      res.status(404).json({ error: 'event is not found' });
    }
    // Sent email to receiver
    // sync with google calendar.
    if (is_TaiGer_Student(user)) {
      student = user;
      taigerRep = event.receiver_id[0];
      event.receiver_id.forEach((receiver) => {
        MeetingAdjustReminder(receiver, user, event);
      });
    }
    if (is_TaiGer_Agent(user) || is_TaiGer_Editor(user)) {
      student = event.requester_id[0];
      taigerRep = user;
      event.requester_id.forEach((requester) => {
        MeetingAdjustReminder(requester, user, event);
      });
    }
    next();
  } catch (err) {
    logger.error(err);
    throw new ErrorResponse(400, err);
  }

  logger.info(
    `[${event_id}] Update event called with addMeetingAssistant: ${addMeetingAssistant}`
  );
  if (addMeetingAssistant) {
    handleTAScheduling(taigerRep, student, user, updated_event, event_id);
  }
});

const deleteEvent = asyncHandler(async (req, res, next) => {
  const { event_id } = req.params;
  const { user } = req;
  try {
    const toBeDeletedEvent = await EventService.getEventByIdPopulated(
      event_id,
      'firstname lastname email'
    );
    await EventService.deleteEventById(event_id);
    let events;
    if (is_TaiGer_Student(user)) {
      events = await EventService.findEvents(
        { requester_id: user._id },
        {
          populate: {
            path: 'receiver_id requester_id',
            select: 'firstname lastname email'
          }
        }
      );
      const agents_ids = user.agents;
      const agents = await UserService.findAgents(
        { _id: agents_ids },
        AGENT_OH_SELECT_NO_PIC
      );
      res.status(200).send({
        success: true,
        agents,
        data: events.length === 0 ? [] : events,
        hasEvents: events.length !== 0
      });
      MeetingCancelledReminder(user, toBeDeletedEvent);
    } else if (is_TaiGer_Agent(user) || is_TaiGer_Editor(user)) {
      events = await EventService.findEvents(
        {
          $or: [
            { requester_id: user._id.toString() },
            { receiver_id: user._id.toString() }
          ]
        },
        {
          populate: {
            path: 'receiver_id requester_id',
            select: 'firstname lastname email'
          }
        }
      );
      const agents = await UserService.findAgents(
        { _id: user._id.toString() },
        AGENT_OH_SELECT_NO_PIC
      );
      res.status(200).send({
        success: true,
        agents,
        data: events.length === 0 ? [] : events,
        hasEvents: events.length !== 0
      });
      MeetingCancelledReminder(user, toBeDeletedEvent);
    } else {
      res.status(200).send({ success: true, hasEvents: false });
    }
    // TODO: remind receiver or reqester
    next();
  } catch (err) {
    throw new ErrorResponse(400, err);
  }
});

module.exports = {
  getEvents,
  getBookedEvents,
  getActiveEventsNumber,
  showEvent,
  postEvent,
  confirmEvent,
  updateEvent,
  deleteEvent
};
