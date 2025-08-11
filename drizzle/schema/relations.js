const { relations } = require('drizzle-orm');
const { leads } = require('./leads');
const { meetingTranscripts } = require('./meetingTranscripts');

const leadsRelations = relations(leads, ({ many }) => ({
  meetingTranscripts: many(meetingTranscripts)
}));

const meetingTranscriptsRelations = relations(
  meetingTranscripts,
  ({ one }) => ({
    lead: one(leads, {
      fields: [meetingTranscripts.leadId],
      references: [leads.id]
    })
  })
);

module.exports = { leadsRelations, meetingTranscriptsRelations };
