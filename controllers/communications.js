const mongoose = require('mongoose');
const path = require('path');
const {
  is_TaiGer_Agent,
  is_TaiGer_Admin,
  is_TaiGer_Student
} = require('@taiger-common/core');
const { Role } = require('@taiger-common/core');

const { ErrorResponse } = require('../common/errors');
const { asyncHandler } = require('../middlewares/error-handler');
const {
  sendAgentNewMessageReminderEmail,
  sendStudentNewMessageReminderEmail
} = require('../services/email');
const logger = require('../services/logger');
const { isNotArchiv } = require('../constants');
const { getPermission } = require('../utils/queryFunctions');
const { AWS_S3_BUCKET_NAME } = require('../config');
const { one_day_cache } = require('../cache/node-cache');
const { deleteS3Objects } = require('../aws/s3');
const { TENANT_SHORT_NAME } = require('../constants/common');
const { getS3Object } = require('../aws/s3');
const CommunicationService = require('../services/communications');
const StudentService = require('../services/students');

const pageSize = 5;

// TODO
const getSearchUserMessages = asyncHandler(async (req, res, next) => {
  const { user } = req;

  // Get only the last communication
  const studentsWithCommunications = await req.db.model('Student').aggregate([
    {
      $lookup: {
        from: 'communications',
        localField: '_id',
        foreignField: 'student_id',
        as: 'communications'
      }
    },
    {
      $project: {
        firstname: 1,
        lastname: 1,
        role: 1,
        latestCommunication: {
          $arrayElemAt: ['$communications', -1]
        }
        // communications: {
        //   _id: 1,
        //   user_id: 1,
        //   message: 1,
        //   readBy: 1
        //   // Include only the fields you want to retrieve
        // }
      }
    }
  ]);

  const permissions = await getPermission(req, user);
  if (
    is_TaiGer_Admin(user) ||
    (is_TaiGer_Agent(user) && permissions?.canAccessAllChat)
  ) {
    const students = await req.db
      .model('Student')
      .find(
        {
          $text: { $search: req.query.q }
        },
        { score: { $meta: 'textScore' } }
      )
      .sort({ score: { $meta: 'textScore' } })
      .limit(10)
      .select(
        'firstname lastname firstname_chinese lastname_chinese role pictureUrl'
      )
      .lean();
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
    const students_search = await req.db
      .model('Student')
      .find(
        {
          $text: { $search: req.query.q },
          agents: user._id.toString()
        },
        { score: { $meta: 'textScore' } }
      )
      .sort({ score: { $meta: 'textScore' } })
      .limit(10)
      .select(
        'firstname lastname firstname_chinese lastname_chinese role pictureUrl'
      )
      .lean();

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
  next();
});
const getSearchMessageKeywords = asyncHandler(async (req, res) => {
  const { user } = req;

  // Get only the last communication
  const studentsWithCommunications = await req.db.model('Student').aggregate([
    {
      $lookup: {
        from: 'communications',
        localField: '_id',
        foreignField: 'student_id',
        as: 'communications'
      }
    },
    {
      $project: {
        firstname: 1,
        lastname: 1,
        role: 1,
        latestCommunication: {
          $arrayElemAt: ['$communications', -1]
        }
        // communications: {
        //   _id: 1,
        //   user_id: 1,
        //   message: 1,
        //   readBy: 1
        //   // Include only the fields you want to retrieve
        // }
      }
    }
  ]);
  if (is_TaiGer_Admin(user)) {
    const students = await req.db
      .model('Student')
      .find({
        $or: [{ archiv: { $exists: false } }, { archiv: false }]
      })
      .select(
        'firstname lastname firstname_chinese lastname_chinese role pictureUrl'
      )
      .lean();
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
  const students_search = await req.db
    .model('Student')
    .find(
      {
        $text: { $search: req.query.q },
        agents: user._id.toString()
      },
      { score: { $meta: 'textScore' } }
    )
    .sort({ score: { $meta: 'textScore' } })
    .limit(10)
    .select(
      'firstname lastname firstname_chinese lastname_chinese role pictureUrl'
    )
    .lean();
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

const getUnreadNumberMessages = asyncHandler(async (req, res) => {
  const { user } = req;
  if (is_TaiGer_Student(user)) {
    const latestMessage = await req.db
      .model('Communication')
      .findOne({
        student_id: user._id.toString()
      })
      .sort({ createdAt: -1 })
      .lean();
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

  const students = await req.db
    .model('Student')
    .find(filter)
    .select('firstname lastname role pictureUrl')
    .lean();
  const student_ids = students.map((stud) => stud._id);
  const studentsWithCommunications = await req.db.model('Student').aggregate([
    {
      $lookup: {
        from: 'communications',
        localField: '_id',
        foreignField: 'student_id',
        as: 'communications'
      }
    },
    {
      $project: {
        firstname: 1,
        lastname: 1,
        firstname_chinese: 1,
        lastname_chinese: 1,
        role: 1,
        latestCommunication: {
          $arrayElemAt: ['$communications', -1]
        }
      }
    },
    {
      $match: {
        'latestCommunication.student_id': { $in: student_ids },
        'latestCommunication.readBy': { $nin: [user._id] }
      }
    }
  ]);

  return res.status(200).send({
    success: true,
    data: studentsWithCommunications.length
  });
});

// TODO: refactor permission to middleware
const getMyMessages = asyncHandler(async (req, res, next) => {
  const { user } = req;

  if (
    user.role !== Role.Admin &&
    user.role !== Role.Agent &&
    user.role !== Role.Editor
  ) {
    logger.error(`getMyMessages: not ${TENANT_SHORT_NAME} user!`);
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

  const students = await req.db
    .model('Student')
    .find(filter)
    .select('firstname lastname role pictureUrl')
    .lean();
  // Get only the last communication
  const student_ids = students.map((stud) => stud._id);
  const studentsWithCommunications = await req.db.model('Student').aggregate([
    {
      $lookup: {
        from: 'communications',
        localField: '_id',
        foreignField: 'student_id',
        as: 'communications'
      }
    },
    {
      $project: {
        firstname: 1,
        lastname: 1,
        firstname_chinese: 1,
        lastname_chinese: 1,
        pictureUrl: 1,
        role: 1,
        attributes: 1,
        latestCommunication: {
          $arrayElemAt: ['$communications', -1]
        }
      }
    },
    {
      $match: {
        'latestCommunication.student_id': { $in: student_ids }
      }
    },
    {
      $sort: {
        'latestCommunication.createdAt': -1
      }
    }
  ]);

  res.status(200).send({
    success: true,
    data: {
      students: studentsWithCommunications,
      user
    }
  });

  next();
});

const loadMessages = asyncHandler(async (req, res, next) => {
  const {
    params: { studentId, pageNumber }
  } = req;

  const student = await req.db
    .model('Student')
    .findById(studentId)
    .select(
      'firstname lastname firstname_chinese lastname_chinese agents archiv pictureUrl'
    )
    .populate('agents', 'firstname lastname email role pictureUrl');
  if (!student) {
    logger.error('loadMessages: Invalid student id!');
    throw new ErrorResponse(404, 'Student tot found');
  }
  const skipAmount = (pageNumber - 1) * pageSize;
  const communication_thread = await req.db
    .model('Communication')
    .find({
      student_id: studentId
    })
    .populate(
      'student_id user_id readBy ignoredMessageBy',
      'firstname lastname firstname_chinese lastname_chinese role agents editors pictureUrl'
    )
    .sort({ createdAt: -1 })
    .skip(skipAmount) // skip first x items.
    .limit(pageSize); // show only first y limit items after skip.

  // Multitenant-filter: Check student can only access their own thread!!!!

  res.status(200).send({
    success: true,
    data: [...communication_thread].reverse(),
    student
  });
  next();
});

const getMessages = asyncHandler(async (req, res, next) => {
  const {
    user,
    params: { studentId }
  } = req;

  const student = await req.db
    .model('Student')
    .findById(studentId)
    .select(
      'firstname lastname firstname_chinese lastname_chinese agents lastLoginAt archiv pictureUrl'
    )
    .populate('agents editors', 'firstname lastname email role pictureUrl');
  if (!student) {
    logger.error('getMessages: Invalid student id!');
    throw new ErrorResponse(404, 'Student not found');
  }
  const communication_thread = await req.db
    .model('Communication')
    .find({
      student_id: new mongoose.Types.ObjectId(studentId)
    })
    .populate(
      'student_id user_id readBy ignoredMessageBy',
      'firstname lastname role pictureUrl'
    )
    .sort({ createdAt: -1 }) // 0: latest!
    .limit(pageSize); // show only first y limit items after skip.

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
  next();
});

const getChatFile = asyncHandler(async (req, res, next) => {
  const {
    params: { studentId, fileName }
  } = req;

  const fileKey = path.join(studentId, 'chat', fileName).replace(/\\/g, '/');

  const cache_key = `chat-${studentId}${req.originalUrl.split('/')[5]}`;
  const value = one_day_cache.get(cache_key); // image name
  if (value === undefined) {
    const response = await getS3Object(AWS_S3_BUCKET_NAME, fileKey);
    const success = one_day_cache.set(cache_key, Buffer.from(response));
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
const postMessages = asyncHandler(async (req, res, next) => {
  const {
    user,
    params: { studentId }
  } = req;
  const { message } = req.body;
  // TODO: check if consecutive post?
  if (is_TaiGer_Student(user)) {
    const communication_thread = await req.db
      .model('Communication')
      .find({
        student_id: studentId
      })
      .populate('student_id user_id', 'firstname lastname role pictureUrl')
      .sort({ createdAt: -1 }) // 0: latest!
      .limit(3); // show only first 3 limit items after skip.

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
  let newfile = [];
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
  const Communication = req.db.model('Communication'); // Get the Communication model from the tenant-specific connection

  const new_message = new Communication({
    student_id: studentId,
    user_id: user._id,
    message,
    readBy: [new mongoose.Types.ObjectId(user._id)],
    timeStampReadBy: { [user._id?.toString()]: new Date() },
    files: newfile,
    createdAt: new Date()
  });

  await new_message.save();
  const communication_latest = await req.db
    .model('Communication')
    .find({
      student_id: studentId
    })
    .populate('student_id user_id readBy', 'firstname lastname pictureUrl')
    .sort({ createdAt: -1 }) // 0: latest!
    .limit(1);
  res.status(200).send({ success: true, data: communication_latest });

  const student = await StudentService.getStudentById(req, studentId);

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
  next();
});

// (-) TODO email : no notification needed
const updateAMessageInThread = asyncHandler(async (req, res, next) => {
  const {
    params: { messageId }
  } = req;
  const { message } = req.body;
  try {
    const thread = await CommunicationService.updateCommunication(
      req,
      messageId,
      { message }
    );

    if (!thread) {
      logger.error('updateAMessageInThread : Invalid message thread id');
      throw new ErrorResponse(404, 'Thread not found');
    }
    res.status(200).send({ success: true, data: thread });
  } catch (e) {
    logger.error(`updateAMessageInThread error for messageId ${messageId}`);
    throw new ErrorResponse(400, 'message collapse');
  }
  next();
});

// (-) TODO email : no notification needed
const deleteAMessageInCommunicationThread = asyncHandler(
  async (req, res, next) => {
    const {
      params: { messageId }
    } = req;
    const msg = await CommunicationService.getCommunicationById(req, messageId);

    // remove chat attachment cache.
    msg.files?.map((file) =>
      one_day_cache.del(`chat-${msg.student_id?.toString()}${file.name}`)
    );

    try {
      if (msg.files.filter((file) => file.path !== '')?.length > 0) {
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
      await req.db.model('Communication').findByIdAndDelete(messageId);
      res.status(200).send({ success: true });
      next();
    } catch (e) {
      logger.error(`Delete error for messageId ${messageId}`);
      throw new ErrorResponse(400, 'message collapse');
    }
  }
);

const IgnoreMessage = asyncHandler(async (req, res, next) => {
  const {
    user,
    params: { communication_messageId, ignoreMessageState }
  } = req;

  try {
    await CommunicationService.updateCommunication(
      req,
      communication_messageId,
      {
        ignore_message: ignoreMessageState,
        ignoredMessageBy: user._id,
        ignoredMessageUpdatedAt: new Date()
      }
    );
  } catch (e) {
    logger.error(
      `IgnoreMessage error for messageId ${communication_messageId}, state: ${ignoreMessageState}`
    );
    throw new ErrorResponse(400, 'message collapse');
  }

  logger.info('IgnoreMessage : save succeeds');
  res.status(200).send({ success: true });
  next();
});

module.exports = {
  getSearchUserMessages,
  getSearchMessageKeywords,
  getUnreadNumberMessages,
  getMyMessages,
  loadMessages,
  getMessages,
  getChatFile,
  postMessages,
  updateAMessageInThread,
  deleteAMessageInCommunicationThread,
  IgnoreMessage
};
