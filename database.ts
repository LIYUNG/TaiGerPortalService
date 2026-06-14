import mongoose from 'mongoose';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { MONGODB_URI, POSTGRES_URI, TENANT_ID } from './config';
import {
  UserSchema,
  Agent,
  Editor,
  Student,
  Admin,
  Guest,
  External
} from './models/User';
import postgresSchema from './drizzle/schema/schema.js';
import { EventSchema } from './models/Event';
import { documentThreadsSchema } from './models/Documentthread';
import { programSchema } from './models/Program';
import { programChangeRequestSchema } from './models/ProgramChangeRequest';
import { coursesSchema } from './models/Course';
import { basedocumentationslinksSchema } from './models/Basedocumentationslink';
import { communicationsSchema } from './models/Communication';
import { versionControlSchema } from './models/VersionControl';
import { ticketSchema } from './models/Ticket';
import { tokenSchema } from './models/Token';
import { templatesSchema } from './models/Template';
import { documentationsSchema } from './models/Documentation';
import { internaldocsSchema } from './models/Internaldoc';
import { docspagesSchema } from './models/Docspage';
import { expensesSchema } from './models/Expense';
import { incomesSchema } from './models/Income';
import { interviewsSchema } from './models/Interview';
import { intervalSchema } from './models/Interval';
import { interviewSurveyResponseSchema } from './models/InterviewSurveyResponse';
import { notesSchema } from './models/Note';
import { ResponseTimeSchema } from './models/ResponseTime';
import { surveyInputSchema } from './models/SurveyInput';
import { permissionSchema } from './models/Permission';
import { complaintSchema } from './models/Complaint';
import { keywordSetSchema } from './models/Keywordset';
import { programRequirementSchema } from './models/Programrequirement';
import { auditSchema } from './models/Audit';
import { allCourseSchema } from './models/Allcourse';
import { applicationSchema } from './models/Application';

// The service is no longer multi-tenant: we maintain exactly ONE shared
// Mongoose connection instead of a per-tenant map of connections.
let appConnection = null;
const tenantDb = 'Tenant';

const mongoDb = (dbName) =>
  `${MONGODB_URI}/${dbName}?retryWrites=true&w=majority`;

// The version-control + program-change plugins are applied ONCE on the shared
// programSchema in models/Program.js (they resolve sibling models from the
// model's own connection), so here we only need to compile the per-request
// Program model from that already-plugged schema.
const applyProgramSchema = (db) => db.model('Program', programSchema);

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

    // surveyInput's unique index is declared once on the schema in
    // models/SurveyInput.js (avoids a duplicate-index warning).
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
    applyProgramSchema(connection);
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

export = {
  mongoDb,
  getPostgresDb,
  closePostgresPool,
  tenantDb,
  connectToDatabase,
  disconnectFromDatabase
};
