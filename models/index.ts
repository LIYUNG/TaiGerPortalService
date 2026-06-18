// Central model registry.
//
// All models are compiled ONCE on the default Mongoose connection here and
// imported directly by the DAO layer (controller -> service -> dao). `User`
// (+ discriminators) and `Program` are already compiled on the default
// connection at require-time in their own files; the remaining schema-only
// models are compiled here.
//
// The `Program` schema (models/Program.js) carries the handleProgramChanges +
// enableVersionControl plugins, which resolve their sibling models from the
// firing model's own connection — so Program reads AND writes run safely on the
// default-connection model here.
import mongoose from 'mongoose';

// Already compiled on the default connection.
import userModels from './User'; // User, Student, Agent, Editor, Admin, ...
import { Program } from './Program';
import { ProgramAI } from './ProgramAI';

// Schema-only models (compiled below).
import { allCourseSchema } from './Allcourse';
import { applicationSchema } from './Application';
import { auditSchema } from './Audit';
import { basedocumentationslinksSchema } from './Basedocumentationslink';
import { communicationsSchema } from './Communication';
import { communicationDraftSchema } from './CommunicationDraft';
import { complaintSchema } from './Complaint';
import { coursesSchema } from './Course';
import { documentationsSchema } from './Documentation';
import { documentThreadsSchema } from './Documentthread';
import { docspagesSchema } from './Docspage';
import { EventSchema } from './Event';
import { expensesSchema } from './Expense';
import { incomesSchema } from './Income';
import { internaldocsSchema } from './Internaldoc';
import { intervalSchema } from './Interval';
import { interviewsSchema } from './Interview';
import { interviewSurveyResponseSchema } from './InterviewSurveyResponse';
import { keywordSetSchema } from './Keywordset';
import { notesSchema } from './Note';
import { permissionSchema } from './Permission';
import { programChangeRequestSchema } from './ProgramChangeRequest';
import { programRequirementSchema } from './Programrequirement';
import { ResponseTimeSchema } from './ResponseTime';
import { surveyInputSchema } from './SurveyInput';
import { templatesSchema } from './Template';
import { ticketSchema } from './Ticket';
import { tokenSchema } from './Token';
import { versionControlSchema } from './VersionControl';

// Idempotent compile: reuse an already-registered model (avoids
// OverwriteModelError when this module is required more than once).
const compile = (name, schema) =>
  mongoose.models[name] || mongoose.model(name, schema);

const models = {
  // User + discriminators (already compiled in ./User).
  ...userModels,
  // Already compiled in ./Program / ./ProgramAI.
  Program,
  ProgramAI,
  // Compiled here on the default connection.
  Allcourse: compile('Allcourse', allCourseSchema),
  Application: compile('Application', applicationSchema),
  Audit: compile('Audit', auditSchema),
  Basedocumentationslink: compile(
    'Basedocumentationslink',
    basedocumentationslinksSchema
  ),
  Communication: compile('Communication', communicationsSchema),
  CommunicationDraft: compile('CommunicationDraft', communicationDraftSchema),
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
  VC: compile('VC', versionControlSchema)
};

export = models;
