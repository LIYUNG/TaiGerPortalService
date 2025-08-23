const { relations } = require('drizzle-orm');
const { leads } = require('./leads');
const { leadSimilarUsers } = require('./leadSimilarUsers');
const { meetingTranscripts } = require('./meetingTranscripts');
const { salesMembers } = require('./salesMember');

const leadsRelations = relations(leads, ({ many, one }) => ({
  meetingTranscripts: many(meetingTranscripts),
  leadSimilarUsers: many(leadSimilarUsers),
  salesMember: one(salesMembers, {
    fields: [leads.salesUserId],
    references: [salesMembers.userId]
  })
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
