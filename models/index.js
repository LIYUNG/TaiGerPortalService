// Central model registry.
//
// As part of moving off the per-request `req.db.model('X')` (multi-tenant)
// access pattern, all models are compiled ONCE on the default Mongoose
// connection here and imported directly by the DAO layer (controller -> service
// -> dao). `User` (+ discriminators) and `Program` are already compiled on the
// default connection at require-time in their own files; the remaining
// schema-only models are compiled here.
//
// NOTE (version control): the per-connection `Program` model wired up in
// database.js#applyProgramSchema applies the handleProgramChanges +
// enableVersionControl plugins. The default-connection `Program` re-exported
// here does NOT yet have that wiring, so DAOs must not move Program *writes*
// off req.db until that plugin is applied centrally. Reads are fine.
const mongoose = require('mongoose');

// Already compiled on the default connection.
const userModels = require('./User'); // User, Student, Agent, Editor, Admin, ...
const { Program } = require('./Program');

// Schema-only models (compiled below).
const { allCourseSchema } = require('./Allcourse');
const { applicationSchema } = require('./Application');
const { auditSchema } = require('./Audit');
const { basedocumentationslinksSchema } = require('./Basedocumentationslink');
const { communicationsSchema } = require('./Communication');
const { complaintSchema } = require('./Complaint');
const { coursesSchema } = require('./Course');
const { documentationsSchema } = require('./Documentation');
const { documentThreadsSchema } = require('./Documentthread');
const { docspagesSchema } = require('./Docspage');
const { EventSchema } = require('./Event');
const { expensesSchema } = require('./Expense');
const { incomesSchema } = require('./Income');
const { internaldocsSchema } = require('./Internaldoc');
const { intervalSchema } = require('./Interval');
const { interviewsSchema } = require('./Interview');
const { interviewSurveyResponseSchema } = require('./InterviewSurveyResponse');
const { keywordSetSchema } = require('./Keywordset');
const { notesSchema } = require('./Note');
const { permissionSchema } = require('./Permission');
const { programChangeRequestSchema } = require('./ProgramChangeRequest');
const { programRequirementSchema } = require('./Programrequirement');
const { ResponseTimeSchema } = require('./ResponseTime');
const { surveyInputSchema } = require('./SurveyInput');
const { templatesSchema } = require('./Template');
const { ticketSchema } = require('./Ticket');
const { tokenSchema } = require('./Token');
const { userlogSchema } = require('./Userlog');
const { versionControlSchema } = require('./VersionControl');

// Idempotent compile: reuse an already-registered model (avoids
// OverwriteModelError when this module is required more than once).
const compile = (name, schema) =>
  mongoose.models[name] || mongoose.model(name, schema);

const models = {
  // User + discriminators (already compiled in ./User).
  ...userModels,
  // Already compiled in ./Program.
  Program,
  // Compiled here on the default connection.
  Allcourse: compile('Allcourse', allCourseSchema),
  Application: compile('Application', applicationSchema),
  Audit: compile('Audit', auditSchema),
  Basedocumentationslink: compile(
    'Basedocumentationslink',
    basedocumentationslinksSchema
  ),
  Communication: compile('Communication', communicationsSchema),
  Complaint: compile('Complaint', complaintSchema),
  Course: compile('Course', coursesSchema),
  Documentation: compile('Documentation', documentationsSchema),
  Documentthread: compile('Documentthread', documentThreadsSchema),
  Docspage: compile('Docspage', docspagesSchema),
  Event: compile('Event', EventSchema),
  Expense: compile('Expense', expensesSchema),
  Incom: compile('Incom', incomesSchema),
  Internaldoc: compile('Internaldoc', internaldocsSchema),
  Interval: compile('Interval', intervalSchema),
  Interview: compile('Interview', interviewsSchema),
  InterviewSurveyResponse: compile(
    'InterviewSurveyResponse',
    interviewSurveyResponseSchema
  ),
  KeywordSet: compile('KeywordSet', keywordSetSchema),
  Note: compile('Note', notesSchema),
  Permission: compile('Permission', permissionSchema),
  ProgramChangeRequest: compile(
    'ProgramChangeRequest',
    programChangeRequestSchema
  ),
  ProgramRequirement: compile('ProgramRequirement', programRequirementSchema),
  ResponseTime: compile('ResponseTime', ResponseTimeSchema),
  surveyInput: compile('surveyInput', surveyInputSchema),
  Template: compile('Template', templatesSchema),
  Ticket: compile('Ticket', ticketSchema),
  Token: compile('Token', tokenSchema),
  Userlog: compile('Userlog', userlogSchema),
  VC: compile('VC', versionControlSchema)
};

module.exports = models;
