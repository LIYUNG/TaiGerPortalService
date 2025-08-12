const { relations } = require('drizzle-orm');
const { leads } = require('./leads');
const { leadSimilarUsers } = require('./leadSimilarUsers');
const { meetingTranscripts } = require('./meetingTranscripts');

const leadsRelations = relations(leads, ({ many }) => ({
  meetingTranscripts: many(meetingTranscripts),
  leadSimilarUsers: many(leadSimilarUsers)
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

const leadSimilarUsersRelations = relations(leadSimilarUsers, ({ one }) => ({
  lead: one(leads, {
    fields: [leadSimilarUsers.leadId],
    references: [leads.id]
  })
}));

module.exports = {
  leadsRelations,
  meetingTranscriptsRelations,
  leadSimilarUsersRelations
};
