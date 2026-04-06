const { ObjectId } = require('mongoose').Types;
const { faker } = require('@faker-js/faker');

const generateDocumentThread = ({
  studentId = new ObjectId().toHexString(),
  applicationId = null,
  fileType = 'ML',
  editorId = null
} = {}) => ({
  _id: new ObjectId().toHexString(),
  student_id: studentId,
  application_id: applicationId,
  file_type: fileType,
  isFinalVersion: false,
  isOutsourced: false,
  outsourced_user_id: [],
  editor_id: editorId ? [editorId] : [],
  flag_by_user_id: [],
  messages: [],
  updatedAt: new Date()
});

const generateDocumentThreadMessage = ({
  userId = new ObjectId().toHexString(),
  studentId = new ObjectId().toHexString()
} = {}) => ({
  _id: new ObjectId().toHexString(),
  user_id: userId,
  student_id: studentId,
  message:
    '{"time":1709677608094,"blocks":[{"id":"9ntXJB6f3L","type":"paragraph","data":{"text":"test message"}}],"version":"2.29.0"}',
  file: [],
  createdAt: new Date()
});

const generateSurveyInput = ({
  studentId = new ObjectId().toHexString(),
  threadId = new ObjectId().toHexString()
} = {}) => ({
  _id: new ObjectId().toHexString(),
  student_id: studentId,
  thread_id: threadId,
  survey_data: {
    field1: faker.lorem.words(3),
    field2: faker.lorem.words(3)
  },
  createdAt: new Date()
});

module.exports = {
  generateDocumentThread,
  generateDocumentThreadMessage,
  generateSurveyInput
};
