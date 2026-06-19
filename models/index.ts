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
import * as userModels from './User'; // User, Student, Agent, Editor, Admin, ...
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

// User + discriminators (already compiled in ./User).
export const User = userModels.User;
export const UserSchema = userModels.UserSchema;
export const Guest = userModels.Guest;
export const Student = userModels.Student;
export const Agent = userModels.Agent;
export const External = userModels.External;
export const Editor = userModels.Editor;
export const Manager = userModels.Manager;
export const Admin = userModels.Admin;

// Already compiled in ./Program / ./ProgramAI.
export { Program, ProgramAI };

// Compiled here on the default connection.
export const Allcourse = compile('Allcourse', allCourseSchema);
export const Application = compile('Application', applicationSchema);
export const Audit = compile('Audit', auditSchema);
export const Basedocumentationslink = compile(
  'Basedocumentationslink',
  basedocumentationslinksSchema
);
export const Communication = compile('Communication', communicationsSchema);
export const CommunicationDraft = compile(
  'CommunicationDraft',
  communicationDraftSchema
);
export const Complaint = compile('Complaint', complaintSchema);
export const Course = compile('Course', coursesSchema);
export const Documentation = compile('Documentation', documentationsSchema);
export const Documentthread = compile('Documentthread', documentThreadsSchema);
export const Docspage = compile('Docspage', docspagesSchema);
export const Event = compile('Event', EventSchema);
export const Expense = compile('Expense', expensesSchema);
export const Incom = compile('Incom', incomesSchema);
export const Internaldoc = compile('Internaldoc', internaldocsSchema);
export const Interval = compile('Interval', intervalSchema);
export const Interview = compile('Interview', interviewsSchema);
export const InterviewSurveyResponse = compile(
  'InterviewSurveyResponse',
  interviewSurveyResponseSchema
);
export const KeywordSet = compile('KeywordSet', keywordSetSchema);
export const Note = compile('Note', notesSchema);
export const Permission = compile('Permission', permissionSchema);
export const ProgramChangeRequest = compile(
  'ProgramChangeRequest',
  programChangeRequestSchema
);
export const ProgramRequirement = compile(
  'ProgramRequirement',
  programRequirementSchema
);
export const ResponseTime = compile('ResponseTime', ResponseTimeSchema);
export const surveyInput = compile('surveyInput', surveyInputSchema);
export const Template = compile('Template', templatesSchema);
export const Ticket = compile('Ticket', ticketSchema);
export const Token = compile('Token', tokenSchema);
export const VC = compile('VC', versionControlSchema);
