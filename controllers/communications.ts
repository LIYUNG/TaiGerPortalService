import mongoose from 'mongoose';
import path from 'path';
import {
  is_TaiGer_Agent,
  is_TaiGer_Admin,
  is_TaiGer_Editor,
  is_TaiGer_Student,
  Role
} from '@taiger-common/core';

import { ErrorResponse } from '../common/errors';
import { asyncHandler } from '../middlewares/error-handler';
import {
  sendAgentNewMessageReminderEmail,
  sendStudentNewMessageReminderEmail
} from '../services/email';
import logger from '../services/logger';
import { isNotArchiv } from '../constants';
import { getPermission } from '../utils/queryFunctions';
import { AWS_S3_BUCKET_NAME } from '../config';
import { ten_minutes_cache } from '../cache/node-cache';
import { deleteS3Objects, getS3Object } from '../aws/s3';
import { TENANT_SHORT_NAME } from '../constants/common';
import CommunicationService from '../services/communications';
import StudentService from '../services/students';

const pageSize = 5;

// TODO
export const getSearchUserMessages = asyncHandler(async (req, res) => {
  const { user } = req;

  // Get only the last communication
  const studentsWithCommunications =
    await StudentService.getStudentsWithLatestCommunication();

  const permissions = await getPermission(req, user);
  if (
    is_TaiGer_Admin(user) ||
    (is_TaiGer_Agent(user) && permissions?.canAccessAllChat)
  ) {
    const students = await StudentService.searchStudentsByText(
      { $text: { $search: req.query.q } },
      'firstname lastname firstname_chinese lastname_chinese role pictureUrl'
    );
    // Merge the results
    const mergedResults = students.map((student) => {
      const aggregateData = studentsWithCommunications.find(
        (item) => item._id.toString() === student._id.toString()
      );
      return { ...aggregateData, ...student };
    });

    res
      .status(200)
      .send({ success: true, data: { students: mergedResults, user } });
  } else {
    const students_search = await StudentService.searchStudentsByText(
      {
        $text: { $search: req.query.q },
        agents: user._id.toString()
      },
      'firstname lastname firstname_chinese lastname_chinese role pictureUrl'
    );

    // Merge the results
    const mergedResults = students_search.map((student) => {
      const aggregateData = studentsWithCommunications.find(
        (item) => item._id.toString() === student._id.toString()
      );
      return { ...aggregateData, ...student };
    });

    res
      .status(200)
      .send({ success: true, data: { students: mergedResults, user } });
  }
});
export const getSearchMessageKeywords = asyncHandler(async (req, res) => {
  const { user } = req;

  // Get only the last communication
  const studentsWithCommunications =
    await StudentService.getStudentsWithLatestCommunication();
  if (is_TaiGer_Admin(user)) {
    const students = await StudentService.findStudentsSelect(
      { $or: [{ archiv: { $exists: false } }, { archiv: false }] },
      'firstname lastname firstname_chinese lastname_chinese role pictureUrl'
    );
    // Merge the results
    const mergedResults = students.map((student) => {
      const aggregateData = studentsWithCommunications.find(
        (item) => item._id.toString() === student._id.toString()
      );
      return { ...aggregateData, ...student };
    });

    return res
      .status(200)
      .send({ success: true, data: { students: mergedResults, user } });
  }
  const students_search = await StudentService.searchStudentsByText(
    {
      $text: { $search: req.query.q },
      agents: user._id.toString()
    },
    'firstname lastname firstname_chinese lastname_chinese role pictureUrl'
  );
  // Merge the results
  const mergedResults = students_search.map((student) => {
    const aggregateData = studentsWithCommunications.find(
      (item) => item._id.toString() === student._id.toString()
    );
    return { ...aggregateData, ...student };
  });

  return res
    .status(200)
    .send({ success: true, data: { students: mergedResults, user } });
});

export const getUnreadNumberMessages = asyncHandler(async (req, res) => {
  const { user } = req;
  if (is_TaiGer_Student(user)) {
    const latestMessage = await CommunicationService.getLatestByStudentId(
      user._id.toString()
    );
    const readBy = latestMessage?.readBy?.map((id) => id.toString()) || [];

    return res.status(200).send({
      success: true,
      data: readBy?.includes(user._id.toString()) ? 0 : 1
    });
  }
  if (
    user.role !== Role.Admin &&
    user.role !== Role.Agent &&
    user.role !== Role.Editor
  ) {
    logger.error(`getUnreadNumberMessages: no ${TENANT_SHORT_NAME} user!`);
    throw new ErrorResponse(401, `Invalid ${TENANT_SHORT_NAME} user`);
  }
  const permissions = await getPermission(req, user);

  const filter = {
    $or: [{ archiv: { $exists: false } }, { archiv: false }]
  };
  if (
    !(
      is_TaiGer_Admin(user) ||
      (is_TaiGer_Agent(user) && permissions?.canAccessAllChat)
    )
  ) {
    filter.agents = user._id.toString();
  }

  const students = await StudentService.findStudentsSelect(
    filter,
    'firstname lastname role pictureUrl'
  );
  const student_ids = students.map((stud) => stud._id);
  const studentsWithCommunications =
    await StudentService.getUnreadCommunicationStudents(student_ids, user._id);

  return res.status(200).send({
    success: true,
    data: studentsWithCommunications.length
  });
});

// TODO: refactor permission to middleware
export const getMyMessages = asyncHandler(async (req, res) => {
  const { user } = req;

  // Role is enforced at the route via permit(Admin, Manager, Agent, Editor).
  const permissions = await getPermission(req, user);

  const filter = {
    $or: [{ archiv: { $exists: false } }, { archiv: false }]
  };
  if (
    !(
      is_TaiGer_Admin(user) ||
      (is_TaiGer_Agent(user) && permissions?.canAccessAllChat) ||
      (is_TaiGer_Editor(user) && permissions?.canAccessAllChat)
    )
  ) {
    // Scope to the caller's own students: agents match the `agents` field,
    // editors match the `editors` field (a user may hold both roles).
    const userId = user._id.toString();
    const ownStudentConditions = [];
    if (is_TaiGer_Agent(user)) {
      ownStudentConditions.push({ agents: userId });
    }
    if (is_TaiGer_Editor(user)) {
      ownStudentConditions.push({ editors: userId });
    }
    filter.$and = [{ $or: ownStudentConditions }];
  }

  const students = await StudentService.findStudentsSelect(
    filter,
    'firstname lastname role pictureUrl'
  );
  // Get only the last communication
  const student_ids = students.map((stud) => stud._id);
  const studentsWithCommunications =
    await StudentService.getStudentsWithLatestCommunicationSorted(student_ids);

  res.status(200).send({
    success: true,
    data: {
      students: studentsWithCommunications,
      user
    }
  });
});

export const loadMessages = asyncHandler(async (req, res) => {
  const {
    params: { studentId, pageNumber }
  } = req;

  const student = await StudentService.getStudentByIdSelectPopulated(
    studentId,
    'firstname lastname firstname_chinese lastname_chinese agents archiv pictureUrl',
    'agents',
    'firstname lastname email role pictureUrl'
  );
  if (!student) {
    logger.error('loadMessages: Invalid student id!');
    throw new ErrorResponse(404, 'Student tot found');
  }
  const skipAmount = (pageNumber - 1) * pageSize;
  const communication_thread = await CommunicationService.findThreadPopulated(
    studentId,
    {
      populate: 'student_id user_id readBy ignoredMessageBy',
      select:
        'firstname lastname firstname_chinese lastname_chinese role agents editors pictureUrl',
      skip: skipAmount,
      limit: pageSize
    }
  );

  // Multitenant-filter: Check student can only access their own thread!!!!

  res.status(200).send({
    success: true,
    data: [...communication_thread].reverse(),
    student
  });
});

export const getMessages = asyncHandler(async (req, res) => {
  const {
    user,
    params: { studentId }
  } = req;

  const student = await StudentService.getStudentByIdSelectPopulated(
    studentId,
    'firstname lastname firstname_chinese lastname_chinese agents lastLoginAt archiv pictureUrl',
    'agents editors',
    'firstname lastname email role pictureUrl'
  );
  if (!student) {
    logger.error('getMessages: Invalid student id!');
    throw new ErrorResponse(404, 'Student not found');
  }
  // Live docs: the newest message is marked-as-read (.save()) below.
  const communication_thread = await CommunicationService.findThreadPopulated(
    studentId,
    {
      populate: 'student_id user_id readBy ignoredMessageBy',
      select: 'firstname lastname role pictureUrl',
      limit: pageSize
    }
  );

  if (communication_thread.length > 0) {
    const lastElement = communication_thread[0];
    const userIdStr = user._id.toString();

    // Check if user is in the readBy list
    const isUserNotInReadBy = !lastElement.readBy.some(
      (usr) => usr._id.toString() === userIdStr
    );

    if (isUserNotInReadBy) {
      lastElement.readBy.push(new mongoose.Types.ObjectId(userIdStr));

      // Update timestamp for the user
      lastElement.timeStampReadBy = {
        ...lastElement.timeStampReadBy,
        [userIdStr]: new Date()
      };
      await lastElement.save();
      await lastElement.populate(
        'readBy',
        'firstname lastname role pictureUrl'
      );
    }
  }
  res.status(200).send({
    success: true,
    data: [...communication_thread].reverse(),
    student
  });
});

// Search a single student's chat history (this conversation only). Access is
// already scoped by multitenant_filter + chatMultitenantFilter on the route.
export const searchThreadMessages = asyncHandler(async (req, res) => {
  const {
    params: { studentId },
    query: { q }
  } = req;

  const term = typeof q === 'string' ? q.trim() : '';
  // Require at least 2 chars to avoid scanning the whole thread for noise.
  if (term.length < 2) {
    return res.status(200).send({ success: true, data: [], total: 0 });
  }

  const { messages, total } = await CommunicationService.searchThread(
    studentId,
    term
  );

  res.status(200).send({ success: true, data: messages, total });
});

// Messages around a specific message (Instagram-style "jump to message" from a
// search result). Access scoped by multitenant_filter + chatMultitenantFilter.
export const getThreadContextMessages = asyncHandler(async (req, res) => {
  const {
    params: { studentId, messageId }
  } = req;

  const context = await CommunicationService.getThreadContext(
    studentId,
    messageId
  );
  if (!context) {
    throw new ErrorResponse(404, 'Message not found');
  }

  res.status(200).send({
    success: true,
    data: context.messages,
    hasOlder: context.hasOlder,
    hasNewer: context.hasNewer,
    targetId: context.targetId
  });
});

// A chunk of messages before/after a cursor message — lets the client load
// older (scroll up) or newer (scroll down) chunks from a jumped-to position.
export const getAdjacentThreadMessages = asyncHandler(async (req, res) => {
  const {
    params: { studentId, messageId },
    query: { direction }
  } = req;

  const dir = direction === 'before' ? 'before' : 'after';
  const { messages, hasMore } = await CommunicationService.getAdjacentMessages(
    studentId,
    messageId,
    dir
  );

  res
    .status(200)
    .send({ success: true, data: messages, hasMore, direction: dir });
});

export const getChatFile = asyncHandler(async (req, res) => {
  const {
    params: { studentId, fileName }
  } = req;

  const fileKey = path.join(studentId, 'chat', fileName).replace(/\\/g, '/');

  const cache_key = `chat-${studentId}${req.originalUrl.split('/')[5]}`;
  const value = ten_minutes_cache.get(cache_key); // image name
  if (value === undefined) {
    const response = await getS3Object(AWS_S3_BUCKET_NAME, fileKey);
    const success = ten_minutes_cache.set(cache_key, Buffer.from(response));
    if (success) {
      logger.info('image cache set successfully');
    }
    res.attachment(fileName);
    return res.end(response);
  }
  logger.info('cache hit');
  res.attachment(fileName);
  return res.end(value);
});

// (O) notification email works
export const postMessages = asyncHandler(async (req, res) => {
  const {
    user,
    params: { studentId }
  } = req;
  const { message } = req.body;
  // TODO: check if consecutive post?
  if (is_TaiGer_Student(user)) {
    const communication_thread = await CommunicationService.findThreadPopulated(
      studentId,
      {
        populate: 'student_id user_id',
        select: 'firstname lastname role pictureUrl',
        limit: 3
      }
    );

    if (communication_thread.length === 3) {
      let flag = true;
      for (let i = 0; i < communication_thread.length; i += 1) {
        if (communication_thread[i]?.user_id?._id.toString() === studentId) {
          flag =
            flag &&
            communication_thread[i]?.user_id?._id.toString() === studentId;
        } else {
          flag = false;
          break;
        }
      }
      if (flag) {
        logger.error(`Too much message by ${studentId}`);
        throw new ErrorResponse(
          429,
          '您至多只能發連續三條訊息！請整理好您的問題一次發問，方便 Agent 一次回復。若 Agent 尚未回覆當前留言，請把問題集中於最新一次的留言，該留言右上角鉛筆可以編輯。您的 Agent 會盡速回復您！'
        );
      }
    }
  }
  try {
    JSON.parse(message);
  } catch (e) {
    logger.error(`message collapse ${message}`);
    throw new ErrorResponse(400, 'message collapse');
  }
  const newfile = [];
  if (req.files) {
    for (let i = 0; i < req.files.length; i += 1) {
      const filePath = req.files[i].key.split('/');
      const fileName = filePath[2];
      newfile.push({
        name: fileName,
        path: req.files[i].key
      });
      // Check for duplicate file extensions
      const fileExtensions = req.files.map(
        (file) => file.mimetype.split('/')[1]
      );
      const uniqueFileExtensions = new Set(fileExtensions);
      if (fileExtensions.length !== uniqueFileExtensions.size) {
        logger.error('Error: Duplicate file extensions found!');
        throw new ErrorResponse(
          423,
          'Error: Duplicate file extensions found. Due to the system automatical naming mechanism, the files with same extension (said .pdf) will be overwritten. You can not upload 2 same files extension (2 .pdf or 2 .docx) at the same message. But 1 .pdf and 1 .docx are allowed.'
        );
      }
    }
  }
  await CommunicationService.createCommunication({
    student_id: studentId,
    user_id: user._id,
    message,
    readBy: [new mongoose.Types.ObjectId(user._id)],
    timeStampReadBy: { [user._id?.toString()]: new Date() },
    files: newfile,
    createdAt: new Date()
  });

  const communication_latest = await CommunicationService.findThreadPopulated(
    studentId,
    {
      populate: 'student_id user_id readBy',
      select: 'firstname lastname pictureUrl',
      limit: 1
    }
  );
  res.status(200).send({ success: true, data: communication_latest });

  const student = await StudentService.getStudentById(studentId);

  // inform agent/student
  if (is_TaiGer_Student(user)) {
    for (let i = 0; i < student.agents.length; i += 1) {
      // inform active-agent
      if (isNotArchiv(student)) {
        if (isNotArchiv(student.agents[i])) {
          // inform agent
          sendAgentNewMessageReminderEmail(
            {
              firstname: student.agents[i].firstname,
              lastname: student.agents[i].lastname,
              address: student.agents[i].email
            },
            {
              student_firstname: student.firstname,
              student_id: student._id.toString(),
              student_lastname: student.lastname
            }
          );
        }
      }
    }
  } else {
    sendStudentNewMessageReminderEmail(
      {
        firstname: student.firstname,
        lastname: student.lastname,
        address: student.email
      },
      {
        taiger_user_firstname: user.firstname,
        student_id: student._id.toString(),
        taiger_user_lastname: user.lastname
      }
    );
  }
});

// (-) TODO email : no notification needed
export const updateAMessageInThread = asyncHandler(async (req, res) => {
  const {
    params: { messageId }
  } = req;
  const { message } = req.body;
  try {
    const thread = await CommunicationService.updateCommunication(messageId, {
      message
    });

    if (!thread) {
      logger.error('updateAMessageInThread : Invalid message thread id');
      throw new ErrorResponse(404, 'Thread not found');
    }
    res.status(200).send({ success: true, data: thread });
  } catch (e) {
    logger.error(`updateAMessageInThread error for messageId ${messageId}`);
    throw new ErrorResponse(400, 'message collapse');
  }
});

// (-) TODO email : no notification needed
export const deleteAMessageInCommunicationThread = asyncHandler(
  async (req, res) => {
    const {
      params: { messageId }
    } = req;
    const msg = await CommunicationService.getCommunicationById(messageId);

    // remove chat attachment cache.
    msg.files?.map((file) =>
      ten_minutes_cache.del(`chat-${msg.student_id?.toString()}${file.name}`)
    );

    try {
      logger.info('msg.files', { files: msg.files });
      if (msg.files?.filter((file) => file.path !== '')?.length > 0) {
        await deleteS3Objects({
          bucketName: AWS_S3_BUCKET_NAME,
          objectKeys: msg.files
            .filter((file) => file.path !== '')
            .map((file) => ({
              Key: file.path
            }))
        });
      }
    } catch (err) {
      if (err) {
        logger.error('delete chat files: ', err);
        throw new ErrorResponse(500, 'Error occurs while deleting');
      }
    }

    try {
      await CommunicationService.deleteById(messageId);
      res.status(200).send({ success: true });
    } catch (e) {
      logger.error(`Delete error for messageId ${messageId}`);
      throw new ErrorResponse(400, 'message collapse');
    }
  }
);

export const IgnoreMessage = asyncHandler(async (req, res) => {
  const {
    user,
    params: { communication_messageId, ignoreMessageState }
  } = req;

  try {
    await CommunicationService.updateCommunication(communication_messageId, {
      ignore_message: ignoreMessageState,
      ignoredMessageBy: user._id,
      ignoredMessageUpdatedAt: new Date()
    });
  } catch (e) {
    logger.error(
      `IgnoreMessage error for messageId ${communication_messageId}, state: ${ignoreMessageState}`
    );
    throw new ErrorResponse(400, 'message collapse');
  }

  logger.info('IgnoreMessage : save succeeds');
  res.status(200).send({ success: true });
});
