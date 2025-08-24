const { relations } = require('drizzle-orm');
const { leads } = require('./leads');
const { leadSimilarUsers } = require('./leadSimilarUsers');
const { meetingTranscripts } = require('./meetingTranscripts');
const { salesReps } = require('./salesReps');
const { deals } = require('./deals');

const leadsRelations = relations(leads, ({ many, one }) => ({
  meetingTranscripts: many(meetingTranscripts),
  leadSimilarUsers: many(leadSimilarUsers),
  deals: many(deals),
  salesRep: one(salesReps, {
    fields: [leads.salesUserId],
    references: [salesReps.userId]
  })
}));

const dealsRelations = relations(deals, ({ one }) => ({
  lead: one(leads, {
    fields: [deals.leadId],
    references: [leads.id]
  }),
  salesRep: one(salesReps, {
    fields: [deals.salesUserId],
    references: [salesReps.userId]
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
  leadSimilarUsersRelations
};
