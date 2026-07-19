const { ObjectId } = require('mongoose').Types;
const { faker } = require('@faker-js/faker');

const generateUser = (role) => ({
  _id: new ObjectId().toHexString(),
  firstname: faker.person.firstName(),
  lastname: faker.person.lastName(),
  // Pinned to example.com because the API runs every email through
  // express-validator's normalizeEmail(). Its provider-specific rules rewrite
  // real domains — a yahoo.com address treats `-` as a subaddress separator, so
  // `ida.schuster-veum73@yahoo.com` reaches the DAO as `ida.schuster@yahoo.com`
  // and any assertion against the raw fixture email fails. faker's default
  // provider list includes yahoo/gmail/hotmail, so this fired at random. Under
  // example.com normalization is the identity and the fixture round-trips.
  email: faker.internet.email({ provider: 'example.com' }).toLowerCase(),
  password: '$2a$10$Xv45poDOdKSjmxPp7FSEfOYNfSDfLZyOEjt7z.WO7sOBKNyS25k1S', // somePassword
  generaldocs_threads: [],
  applications: [],
  isAccountActivated: true,
  archiv: false,
  birthday: '',
  role
});

const generateAgent = (studentIds) => ({
  ...generateUser(),
  students: studentIds
});

const generateEditor = (studentIds) => ({
  ...generateUser(),
  students: studentIds
});

const generateStudent = (agentIds, editorIds) => ({
  ...generateUser(),
  agents: agentIds,
  editors: editorIds,
  personaldata: {},
  academic_background: { language: {}, university: {} }
});

const generateTicket = ({ programId, requesterId = null }) => ({
  _id: new ObjectId().toHexString(),
  program_id: programId,
  requester_id: requesterId,
  type: 'program',
  status: 'open',
  description: 'deadline wrong'
});

const generateEvent = (requesterId, receiverId, minutes) => {
  const now = new Date();
  const start = new Date(now.getTime() + minutes * 60 * 1000);
  const end = new Date(start.getTime() + 30 * 60 * 1000); // Add 30 minutes

  return {
    _id: new ObjectId().toHexString(),
    requester_id: [requesterId],
    receiver_id: [receiverId],
    start,
    end,
    title: faker.lorem.word(10),
    description: faker.lorem.word(10)
  };
};

const generateInterview = (programId, studentId) => ({
  _id: new ObjectId().toHexString(),
  program_id: programId,
  student_id: studentId,
  interview_date: new Date(),
  interview_description: faker.lorem.word(10)
});

const generateProgramRequirement = (programId) => ({
  _id: new ObjectId().toHexString(),
  programId: [programId],
  attributes: ['ELEC-ENG'],
  program_categories: [
    {
      program_category: faker.lorem.word(10),
      category_description: faker.lorem.word(10),
      requiredECTS: 15,
      keywordSets: [{ _id: new ObjectId().toHexString() }],
      maxScore: 5
    }
  ],
  interview_description: faker.lorem.word(10)
});

const generateProgram = (requiredDocuments, optionalDocuments) => ({
  _id: new ObjectId().toHexString(),
  school: faker.company.name(),
  program_name: faker.lorem.word(10),
  degree: faker.lorem.word(20),
  website: faker.internet.url(),
  semester: 'summer',
  application_start: faker.date.recent(),
  application_deadline: faker.date.future(),
  isArchiv: false,
  ml_required: 'yes',
  requiredDocuments,
  optionalDocuments
});

const generateAllCourse = () => ({
  _id: new ObjectId().toHexString(),
  all_course_chinese: faker.lorem.word(10),
  all_course_english: faker.lorem.word(10)
});

const generateCourseKeywordsSet = () => ({
  _id: new ObjectId().toHexString(),
  categoryName: faker.lorem.word(10),
  description: faker.lorem.word(10),
  keywords: {
    zh: Array.from({ length: 3 }, () => faker.lorem.word()),
    en: Array.from({ length: 3 }, () => faker.lorem.word())
  },
  antiKeywords: {
    zh: Array.from({ length: 3 }, () => faker.lorem.word()),
    en: Array.from({ length: 3 }, () => faker.lorem.word())
  }
});

const generateCourse = (student_id) => ({
  _id: new ObjectId().toHexString(),
  student_id,
  name: faker.lorem.word(10),
  table_data_string_locked: false,
  table_data_string:
    '[{"course_chinese":"(Example)微積分一","course_english":"calculus","credits":"2","grades":"73"}]',
  table_data_string_taiger_guided:
    '[{"course_chinese":"(Example)物理二","course_english":"physics ii","credits":"2","grades":"73"}]'
});

const generateCommunicationMessage = (props) => ({
  _id: new ObjectId().toHexString(),
  student_id: props.studnet_id,
  user_id: props.user_id,
  message: faker.lorem.words(20),
  readBy: []
});

const generateComlaintTicket = ({
  requesterId = new ObjectId().toHexString(),
  withMessage = false,
  userId = new ObjectId().toHexString()
}) => ({
  _id: new ObjectId().toHexString(),
  requester_id: requesterId,
  title: faker.lorem.words(20),
  description: faker.lorem.words(20),
  messages: withMessage
    ? [
        {
          _id: new ObjectId().toHexString(),
          user_id: userId,
          message:
            '{"time":1709677608094,"blocks":[{"id":"9ntXJB6f3L","type":"paragraph","data":{"text":"old message"}}],"version":"2.29.0"}',
          file: []
        }
      ]
    : []
});

module.exports = {
  generateAgent,
  generateAllCourse,
  generateCourseKeywordsSet,
  generateCourse,
  generateCommunicationMessage,
  generateComlaintTicket,
  generateEditor,
  generateEvent,
  generateInterview,
  generateProgramRequirement,
  generateProgram,
  generateStudent,
  generateTicket,
  generateUser
};
