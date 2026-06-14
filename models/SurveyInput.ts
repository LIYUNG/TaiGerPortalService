import { surveyInputSchema } from '@taiger-common/model';

// Declare the unique compound index ONCE here, on the shared schema object, so
// every connection that compiles this schema (the default-connection central
// registry in models/index.js and the per-tenant connection in database.js)
// inherits it. Declaring it in more than one place triggers Mongoose's
// "Duplicate schema index" warning.
surveyInputSchema.index(
  { studentId: 1, programId: 1, fileType: 1 },
  { unique: true }
);

export = { surveyInputSchema };
