const path = require('path');
const { is_TaiGer_Student } = require('@taiger-common/core');

const { ErrorResponse } = require('../common/errors');
const { asyncHandler } = require('../middlewares/error-handler');
const logger = require('../services/logger');
const { isNotArchiv } = require('../constants');

const {
  newCustomerCenterTicketEmail,
  newCustomerCenterTicketSubmitConfirmationEmail,
  complaintResolvedRequesterReminderEmail,
  newCustomerCenterTicketMessageEmail
} = require('../services/email/complaints');
const { one_day_cache } = require('../cache/node-cache');
const { AWS_S3_BUCKET_NAME } = require('../config');
const { emptyS3Directory } = require('../utils/modelHelper/versionControl');
const { threadS3GarbageCollector } = require('../utils/utils_function');
const { getS3Object } = require('../aws/s3');

const getManagers = async (req) =>
  req.db
    .model('Permission')
    .find({
      $or: [
        { canAssignEditors: true },
        { canAssignAgents: true },
        { canModifyAllBaseDocuments: true },
        { canAccessAllChat: true }
      ]
    })
    .populate('user_id', 'firstname lastname email archiv pictureUrl')
    .lean();

const getComplaints = asyncHandler(async (req, res) => {
  const { user } = req;

  const { type, status } = req.query;
  const query = {};
  if (type) {
    // query.type = type;
  }

  if (status) {
    query.status = status;
  }
  if (is_TaiGer_Student(user)) {
    const tickets = await req.db
      .model('Complaint')
      .find({ requester_id: user._id })
      .populate('requester_id', 'firstname lastname email pictureUrl')
      .sort({ createdAt: -1 });
    res.send({ success: true, data: tickets });
  } else {
    const tickets = await req.db
      .model('Complaint')
      .find(query)
      .populate('requester_id', 'firstname lastname email pictureUrl')
      .sort({ createdAt: -1 });
    res.send({ success: true, data: tickets });
  }
});

const getComplaint = asyncHandler(async (req, res) => {
  const { ticketId } = req.params;

  const ticket = await req.db
    .model('Complaint')
    .findById(ticketId)
    .populate('messages.user_id', 'firstname lastname email pictureUrl')
    .populate('requester_id', 'firstname lastname email pictureUrl');
  if (!ticket) {
    logger.error('getComplaint: Invalid ticket id');
    throw new ErrorResponse(404, 'Complaint not found');
  }
  res.send({ success: true, data: ticket });
});

const createComplaint = asyncHandler(async (req, res) => {
  const { user } = req;
  const { ticket } = req.body;
  ticket.requester_id = user._id.toString();
  // TODO: DO not create the same
  const new_ticket = await req.db.model('Complaint').create(ticket);

  res.status(201).send({ success: true, data: new_ticket });

  // inform manager
  const permissions = await getManagers(req);
  const users = permissions.map((p) => p.user_id);
  for (let x = 0; x < users.length; x += 1) {
    if (isNotArchiv(users[x])) {
      newCustomerCenterTicketEmail(
        {
          firstname: users[x].firstname,
          lastname: users[x].lastname,
          address: users[x].email
        },
        {
          requester: user,
          ticket_id: new_ticket._id?.toString(),
          ticket_title: new_ticket.title,
          ticket_description: new_ticket.description,
          createdAt: new Date()
        }
      );
    }
  }

  if (isNotArchiv(user)) {
    newCustomerCenterTicketSubmitConfirmationEmail(
      {
        firstname: user.firstname,
        lastname: user.lastname,
        address: user.email
      },
      {
        ticket_id: new_ticket._id?.toString(),
        ticket_title: new_ticket.title,
        ticket_description: new_ticket.description,
        createdAt: new Date()
      }
    );
  }
});

const getMessageFileInTicket = asyncHandler(async (req, res) => {
  const {
    params: { ticketId, studentId, fileKey: filename }
  } = req;

  logger.info('Trying to download ticket file', filename);
  const fileKey = path.join(studentId, ticketId, filename).replace(/\\/g, '/');

  // messageid + extension
  const cache_key = `${studentId}${ticketId}${encodeURIComponent(fileKey)}`;
  const value = one_day_cache.get(cache_key); // file name
  if (value === undefined) {
    const response = await getS3Object(AWS_S3_BUCKET_NAME, fileKey);
    const success = one_day_cache.set(cache_key, Buffer.from(response));
    if (success) {
      logger.info('ticket file cache set successfully');
    }
    res.attachment(fileKey);
    return res.end(response);
  }

  logger.info('ticket file cache hit');
  res.attachment(fileKey);
  return res.end(value);
});

// (O) notification email works
const postMessageInTicket = asyncHandler(async (req, res) => {
  const {
    user,
    params: { ticketId }
  } = req;
  const { message } = req.body;
  const ticket = await req.db
    .model('Complaint')
    .findById(ticketId)
    .populate('requester_id');
  if (!ticket) {
    logger.info('postMessageInTicket: Invalid message thread id');
    throw new ErrorResponse(404, 'Thread Id not found');
  }

  if (ticket?.status === 'resolved') {
    logger.info('postMessageInTicket: thread is closed! Please refresh!');
    throw new ErrorResponse(403, ' thread is closed! Please refresh!');
  }
  try {
    JSON.parse(message);
  } catch (e) {
    logger.error(`Thread message collapse ${message}`);
    throw new ErrorResponse(400, 'message collapse');
  }
  // Check student can only access their own thread!!!!
  if (is_TaiGer_Student(user)) {
    if (ticket.requester_id._id.toString() !== user._id.toString()) {
      logger.error('getMessages: Unauthorized request!');
      throw new ErrorResponse(403, 'Unauthorized request');
    }
  }
  let newfile = [];
  if (req.files) {
    for (let i = 0; i < req.files.length; i += 1) {
      const fileName = req.files[i].key.split('/')[2];
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

  const new_message = {
    user_id: user._id,
    message,
    createdAt: new Date(),
    file: newfile
  };
  // TODO: prevent abuse! if ticket.messages.length > 30, too much message in a thread!
  ticket.messages.push(new_message);
  ticket.updatedAt = new Date();
  await ticket.save();
  const ticket2 = await req.db
    .model('Complaint')
    .findById(ticketId)
    .populate('requester_id messages.user_id');

  res.status(201).send({ success: true, data: ticket2 });

  const student = await req.db
    .model('Student')
    .findById(ticket.requester_id)
    .populate('editors agents', 'firstname lastname email archiv pictureUrl');

  const payload = {
    student_firstname: student.firstname,
    student_lastname: student.lastname,
    ticket_id: ticket._id.toString(),
    ticket_title: ticket.title
  };

  if (is_TaiGer_Student(user)) {
    // TODO: Inform Manager
    if (isNotArchiv(student)) {
      const permissions = await getManagers(req);
      const users = permissions.map((p) => p.user_id);
      for (let i = 0; i < users.length; i += 1) {
        if (isNotArchiv(users[i])) {
          const manager_recipent = {
            firstname: users[i].firstname,
            lastname: users[i].lastname,
            address: users[i].email
          };
          newCustomerCenterTicketMessageEmail(manager_recipent, payload);
        }
      }
    }
    return;
  }

  // Inform student
  if (isNotArchiv(ticket.requester_id)) {
    const student_recipient = {
      firstname: ticket2.requester_id.firstname,
      lastname: ticket2.requester_id.lastname,
      address: ticket2.requester_id.email
    };
    newCustomerCenterTicketMessageEmail(student_recipient, payload);
  }
});

const updateComplaint = asyncHandler(async (req, res) => {
  const { user } = req;
  const { ticketId } = req.params;
  const fields = req.body;

  fields.updatedAt = new Date();
  // TODO: update resolver_id
  const updatedComplaint = await req.db
    .model('Complaint')
    .findByIdAndUpdate(ticketId, fields, {
      new: true
    })
    .populate('requester_id', 'firstname lastname email archiv pictureUrl');

  if (!updatedComplaint) {
    logger.error('updateComplaint: Invalid message thread id');
    throw new ErrorResponse(404, 'Thread not found');
  }

  res.status(200).send({ success: true, data: updatedComplaint });

  // TODO: to avoid resolved many times
  if (fields?.status === 'resolved') {
    // cleanup
    logger.info('cleanup files');
    const collection = 'Complaint';
    const userFolder = 'requester_id';
    try {
      await threadS3GarbageCollector(req, collection, userFolder, ticketId);
    } catch (error) {
      logger.error('Failed to cleanup complaint files:', {
        error: error?.message,
        stack: error?.stack,
        ticketId,
        collection,
        userFolder
      });
      // Don't throw the error to avoid breaking the main flow
    }
    // inform student
    if (isNotArchiv(updatedComplaint.requester_id)) {
      complaintResolvedRequesterReminderEmail(
        {
          firstname: updatedComplaint.requester_id.firstname,
          lastname: updatedComplaint.requester_id.lastname,
          address: updatedComplaint.requester_id.email
        },
        {
          ticket_id: updatedComplaint._id,
          student: updatedComplaint.requester_id,
          taigerUser: user
        }
      );
    }
  }
});

const updateAMessageInComplaint = asyncHandler(async (req, res) => {
  const { user } = req;
  const { ticketId, messageId } = req.params;
  const payload = req.body;

  const ticket = await req.db.model('Complaint').findById(ticketId);
  if (!ticket) {
    logger.error('updateAMessageInComplaint : Invalid message thread id');
    throw new ErrorResponse(404, 'Thread not found');
  }
  if (ticket.status === 'closed') {
    logger.error('updateAMessageInComplaint : ticket is closed.');
    throw new ErrorResponse(423, 'Ticket is closed.');
  }
  const msg = ticket.messages.find(
    (message) => message._id?.toString() === messageId
  );

  if (!msg) {
    logger.error('updateAMessageInComplaint : Invalid message id');
    throw new ErrorResponse(404, 'Message not found');
  }
  // Prevent multitenant
  if (msg.user_id?.toString() !== user._id?.toString()) {
    logger.error(
      'updateAMessageInComplaint : You can only modify your own message.'
    );
    throw new ErrorResponse(409, 'You can only modify your own message.');
  }

  // Don't need so delete in S3 , will delete by garbage collector
  await req.db
    .model('Complaint')
    .findByIdAndUpdate(ticketId, payload, { upsert: false });

  res.status(200).send({ success: true });
});

const deleteAMessageInComplaint = asyncHandler(async (req, res) => {
  const { user } = req;
  const { ticketId, messageId } = req.params;

  const ticket = await req.db.model('Complaint').findById(ticketId);
  if (!ticket) {
    logger.error('deleteAMessageInComplaint : Invalid message thread id');
    throw new ErrorResponse(404, 'Thread not found');
  }
  if (ticket.status === 'resolved') {
    logger.error('deleteAMessageInComplaint : ticket is closed.');
    throw new ErrorResponse(423, 'Ticket is closed.');
  }
  const msg = ticket.messages.find(
    (message) => message._id.toString() === messageId
  );

  if (!msg) {
    logger.error('deleteAMessageInComplaint : Invalid message id');
    throw new ErrorResponse(404, 'Message not found');
  }
  // Prevent multitenant
  if (msg.user_id.toString() !== user._id.toString()) {
    logger.error(
      'deleteAMessageInComplaint : You can only delete your own message.'
    );
    throw new ErrorResponse(409, 'You can only delete your own message.');
  }

  // Don't need so delete in S3 , will delete by garbage collector
  await req.db.model('Complaint').findByIdAndUpdate(ticketId, {
    $pull: {
      messages: { _id: messageId }
    }
  });

  res.status(200).send({ success: true });
});

const deleteTicketFiles = asyncHandler(async (req, studentId, ticketId) => {
  // Delete folder
  let directory = path.join(studentId, ticketId);
  logger.info(`Trying to delete folder /${studentId}/${ticketId}`);
  directory = directory.replace(/\\/g, '/');

  emptyS3Directory(AWS_S3_BUCKET_NAME, directory);
});

const deleteComplaint = asyncHandler(async (req, res) => {
  const { ticketId } = req.params;
  const toBeDeletedTicket = await req.db.model('Complaint').findById(ticketId);
  await req.db.model('Complaint').findByIdAndDelete(ticketId);
  await deleteTicketFiles(
    req,
    toBeDeletedTicket.requester_id.toString(),
    ticketId
  );

  res.status(200).send({ success: true });
});

module.exports = {
  getComplaints,
  getComplaint,
  createComplaint,
  updateComplaint,
  getMessageFileInTicket,
  postMessageInTicket,
  updateAMessageInComplaint,
  deleteAMessageInComplaint,
  deleteComplaint
};
