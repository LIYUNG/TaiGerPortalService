const mongoose = require('mongoose');
const { drizzle } = require('drizzle-orm/node-postgres');
const { Pool } = require('pg');
const { MONGODB_URI, POSTGRES_URI, TENANT_ID } = require('./config');
const {
  UserSchema,
  Agent,
  Editor,
  Student,
  Admin,
  Guest,
  External
} = require('./models/User');
const postgresSchema = require('./drizzle/schema/schema.js');
const { EventSchema } = require('./models/Event');
const { documentThreadsSchema } = require('./models/Documentthread');
const { programSchema } = require('./models/Program');
const { programChangeRequestSchema } = require('./models/ProgramChangeRequest');
const { coursesSchema } = require('./models/Course');
const {
  basedocumentationslinksSchema
} = require('./models/Basedocumentationslink');
const { communicationsSchema } = require('./models/Communication');
const { versionControlSchema } = require('./models/VersionControl');
const { ticketSchema } = require('./models/Ticket');
const { tokenSchema } = require('./models/Token');
const { templatesSchema } = require('./models/Template');
const { documentationsSchema } = require('./models/Documentation');
const { internaldocsSchema } = require('./models/Internaldoc');
const {
  enableVersionControl,
  handleProgramChanges
} = require('./utils/modelHelper/versionControl');
const { docspagesSchema } = require('./models/Docspage');
const { expensesSchema } = require('./models/Expense');
const { incomesSchema } = require('./models/Income');
const { interviewsSchema } = require('./models/Interview');
const { intervalSchema } = require('./models/Interval');
const {
  interviewSurveyResponseSchema
} = require('./models/InterviewSurveyResponse');
const { notesSchema } = require('./models/Note');
const { userlogSchema } = require('./models/Userlog');
const { ResponseTimeSchema } = require('./models/ResponseTime');
const { surveyInputSchema } = require('./models/SurveyInput');
const { permissionSchema } = require('./models/Permission');
const { complaintSchema } = require('./models/Complaint');
const { keywordSetSchema } = require('./models/Keywordset');
const { programRequirementSchema } = require('./models/Programrequirement');
const { auditSchema } = require('./models/Audit');
const { allCourseSchema } = require('./models/Allcourse');
const { applicationSchema } = require('./models/Application');

// The service is no longer multi-tenant: we maintain exactly ONE shared
// Mongoose connection instead of a per-tenant map of connections.
let appConnection = null;
const tenantDb = 'Tenant';

const mongoDb = (dbName) =>
  `${MONGODB_URI}/${dbName}?retryWrites=true&w=majority`;

const applyProgramSchema = (
  db,
  VCModel,
  StudentModel,
  ApplicationModel,
  DocumentthreadModel,
  surveyInputModel
) => {
  programSchema.plugin(handleProgramChanges, {
    StudentModel,
    ApplicationModel,
    DocumentthreadModel,
    surveyInputModel
  });
  programSchema.plugin(enableVersionControl, { VCModel });
  return db.model('Program', programSchema);
};

// Returns the single shared application database connection, creating it on
// first use. `tenant` is accepted for backward compatibility with existing
// callers (and tests) but no longer selects a database. `uri` lets tests point
// the connection at an in-memory server.
const connectToDatabase = (tenant, uri = null) => {
  if (!appConnection) {
    const dbUri = uri || `${mongoDb(TENANT_ID)}`;
    const connection = mongoose.createConnection(dbUri, {});
    appConnection = connection;

    connection.model('Allcourse', allCourseSchema);
    connection.model('Application', applicationSchema);
    connection.model('Audit', auditSchema);
    connection.model('Basedocumentationslink', basedocumentationslinksSchema);
    connection.model('Communication', communicationsSchema);
    connection.model('Complaint', complaintSchema);
    connection.model('Course', coursesSchema);
    connection.model('Documentation', documentationsSchema);
    connection.model('Documentthread', documentThreadsSchema);
    connection.model('Docspage', docspagesSchema);
    connection.model('Event', EventSchema);
    connection.model('Expense', expensesSchema);
    connection.model('Incom', incomesSchema);
    connection.model('Internaldoc', internaldocsSchema);
    connection.model('Interval', intervalSchema);
    connection.model('Interview', interviewsSchema);

    connection.model('InterviewSurveyResponse', interviewSurveyResponseSchema);
    connection.model('KeywordSet', keywordSetSchema);
    connection.model('Note', notesSchema);
    connection.model('Permission', permissionSchema);
    connection.model('ProgramRequirement', programRequirementSchema);
    connection.model('ResponseTime', ResponseTimeSchema);

    surveyInputSchema.index(
      { studentId: 1, programId: 1, fileType: 1 },
      { unique: true }
    );

    connection.model('surveyInput', surveyInputSchema);
    connection.model('Template', templatesSchema);
    connection.model('Ticket', ticketSchema);
    connection.model('Token', tokenSchema);
    // Register base models
    connection.model('User', UserSchema);

    // Register discriminators
    connection.model('User').discriminator('Agent', Agent.schema);
    connection.model('User').discriminator('Editor', Editor.schema);
    connection.model('User').discriminator('Student', Student.schema);
    connection.model('User').discriminator('Admin', Admin.schema);
    connection.model('User').discriminator('External', External.schema);
    connection.model('User').discriminator('Guest', Guest.schema);

    connection.model('ProgramChangeRequest', programChangeRequestSchema);
    connection.model('VC', versionControlSchema);
    applyProgramSchema(
      connection,
      connection.model('VC'),
      connection.model('Student'),
      connection.model('Application'),
      connection.model('Documentthread'),
      connection.model('surveyInput')
    );
    connection.model('Userlog', userlogSchema);
  }
  return appConnection;
};

// Close the single shared connection. `tenant` is accepted for backward
// compatibility but ignored.
const disconnectFromDatabase = async () => {
  if (appConnection) {
    await appConnection.close();
    appConnection = null;
  }
};

let postgresPool;
let postgresClient;

const getPostgresPool = () => {
  if (!postgresPool) {
    postgresPool = new Pool({ connectionString: POSTGRES_URI });
  }
  return postgresPool;
};

const getPostgresDb = () => {
  if (!postgresClient) {
    postgresPool = getPostgresPool();
    postgresClient = drizzle(postgresPool, { schema: postgresSchema });
  }
  return postgresClient;
};

const closePostgresPool = async () => {
  if (postgresPool) {
    await postgresPool.end();
    postgresPool = null;
    postgresClient = null;
  }
};

module.exports = {
  mongoDb,
  getPostgresDb,
  closePostgresPool,
  tenantDb,
  connectToDatabase,
  disconnectFromDatabase
};
