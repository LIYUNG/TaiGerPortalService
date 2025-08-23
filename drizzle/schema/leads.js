const { pgTable, text, varchar, timestamp } = require('drizzle-orm/pg-core');
const createId = () => import('nanoid').then((mod) => mod.nanoid());
const { salesMembers } = require('./salesMembers');

const leads = pgTable('leads', {
  id: text('id').primaryKey().$default(createId).notNull(),

  // Basic info
  fullName: varchar('full_name', { length: 255 }).notNull(),
  gender: varchar('gender', { length: 10 }),

  // Identity of the person filling the form
  applicantRole: text('applicant_role'), // 欲申請者本人, 欲申請者家長, Other

  // Contact
  preferredContact: varchar('preferred_contact', { length: 50 }),
  email: varchar('email', { length: 255 }),
  lineId: varchar('line_id', { length: 100 }),
  skypeId: varchar('skype_id', { length: 100 }),
  phone: varchar('phone', { length: 50 }),

  // Internal Tracking
  source: varchar('source', { length: 100 }),
  status: varchar('status', { length: 50 }).default('open'),
  closeLikelihood: varchar('close_likelihood', { length: 50 }),
  tags: text('tags'),
  notes: text('notes'),
  userId: varchar('user_id', { length: 32 }),

  // Personal & educational status
  isCurrentlyStudying: text('is_currently_studying'),
  currentYearOrGraduated: text('current_year_or_graduated'),
  currentStatus: text('current_status'),

  // Academic background
  bachelorSchool: text('bachelor_school'),
  bachelorGPA: text('bachelor_gpa'),
  bachelorProgramName: text('bachelor_program_name'),
  graduatedBachelorSchool: text('graduated_bachelor_school'),
  graduatedBachelorProgram: text('graduated_bachelor_program'),
  graduatedBachelorGPA: text('graduated_bachelor_gpa'),
  masterSchool: text('master_school'),
  masterProgramName: text('master_program_name'),
  masterGPA: text('master_gpa'),
  highestEducation: text('highest_education'),

  // High school details
  highschoolName: text('highschool_name'),
  highschoolGPA: text('highschool_gpa'),

  // Application plan
  intendedPrograms: text('intended_programs'),
  intendedDirection: text('intended_direction'),
  intendedStartTime: text('intended_start_time'),
  intendedProgramLevel: text('intended_program_level'), // e.g., 碩士, 博士

  // Language levels
  englishLevel: text('english_level'),
  germanLevel: text('german_level'),

  // Experience and extras
  workExperience: text('work_experience'),
  otherActivities: text('other_activities'),
  awards: text('awards'),
  additionalInfo: text('additional_info'),
  reasonForGermany: text('reason_for_germany'),

  // Motivation
  reasonsToStudyAbroad: text('reasons_to_study_abroad'), // Multi-select string or JSON
  promoCode: text('promo_code'),

  // Ownership/assignment
  salesUserId: varchar('sales_user_id', { length: 64 }).references(
    () => salesMembers.userId,
    { onDelete: 'set null' }
  ),
  salesNote: text('sales_note'),

  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow()
});

module.exports = { leads };
