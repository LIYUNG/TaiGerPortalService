const { pgTable, text, varchar, timestamp } = require('drizzle-orm/pg-core');
const { nanoid } = require('nanoid');
const { salesReps } = require('./salesReps');

const leads = pgTable('leads', {
  id: text('id')
    .primaryKey()
    .notNull()
    .$defaultFn(() => nanoid()),

  // Basic info
  fullName: varchar('full_name', { length: 255 }).notNull(),
  gender: varchar('gender', { length: 10 }),

  // Identity of the person filling the form
  applicantRole: text('applicant_role'), // 欲申請者本人, 欲申請者家長, Other

  // Contact
  preferredContact: varchar('preferred_contact', { length: 150 }),
  email: varchar('email', { length: 255 }),
  lineId: varchar('line_id', { length: 100 }),
  skypeId: varchar('skype_id', { length: 100 }),
  phone: varchar('phone', { length: 50 }),

  // Internal Tracking
  referralSource: varchar('referral_source', { length: 100 }),
  sourceCountry: varchar('source_country', { length: 100 }),
  status: varchar('status', { length: 50 }).default('open'),
  closeLikelihood: varchar('close_likelihood', { length: 50 }),
  userId: varchar('user_id', { length: 32 }),

  // Ownership/assignment
  salesUserId: varchar('sales_user_id', { length: 64 }).references(
    () => salesReps.userId,
    { onDelete: 'set null' }
  ),
  salesNote: text('sales_note'),

  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow()
});

module.exports = { leads };
