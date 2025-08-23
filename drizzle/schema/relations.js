const { relations } = require('drizzle-orm');
const { leads } = require('./leads');
const { leadSimilarUsers } = require('./leadSimilarUsers');
const { meetingTranscripts } = require('./meetingTranscripts');
const { salesMembers } = require('./salesMembers');
const { deals } = require('./deals');

const leadsRelations = relations(leads, ({ many, one }) => ({
  meetingTranscripts: many(meetingTranscripts),
  leadSimilarUsers: many(leadSimilarUsers),
  deals: many(deals),
  salesMember: one(salesMembers, {
    fields: [leads.salesUserId],
    references: [salesMembers.userId]
  })
}));

const dealsRelations = relations(deals, ({ one }) => ({
  lead: one(leads, {
    fields: [deals.leadId],
    references: [leads.id]
  }),
  salesMember: one(salesMembers, {
    fields: [deals.salesUserId],
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
  dealsRelations,
  meetingTranscriptsRelations,
  leadSimilarUsersRelations,
  deals
};
