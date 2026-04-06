const { relations } = require('drizzle-orm');
const { leads } = require('./leads');
const { leadProfile } = require('./leadProfile');
const { leadTags } = require('./leadTags');
const { leadNotes } = require('./leadNotes');
const { leadSimilarUsers } = require('./leadSimilarUsers');
const { meetingTranscripts } = require('./meetingTranscripts');
const { salesReps } = require('./salesReps');
const { deals } = require('./deals');

const leadsRelations = relations(leads, ({ many, one }) => ({
  leadProfile: one(leadProfile, {
    fields: [leads.id],
    references: [leadProfile.leadId]
  }),
  leadTags: many(leadTags),
  leadNotes: many(leadNotes),
  meetingTranscripts: many(meetingTranscripts),
  leadSimilarUsers: many(leadSimilarUsers),
  deals: many(deals),
  salesRep: one(salesReps, {
    fields: [leads.salesUserId],
    references: [salesReps.userId]
  })
}));

const leadProfileRelations = relations(leadProfile, ({ one }) => ({
  lead: one(leads, {
    fields: [leadProfile.leadId],
    references: [leads.id]
  })
}));

const leadTagsRelations = relations(leadTags, ({ one }) => ({
  lead: one(leads, {
    fields: [leadTags.leadId],
    references: [leads.id]
  })
}));

const leadNotesRelations = relations(leadNotes, ({ one }) => ({
  lead: one(leads, {
    fields: [leadNotes.leadId],
    references: [leads.id]
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
  leadProfileRelations,
  leadTagsRelations,
  leadNotesRelations,
  dealsRelations,
  meetingTranscriptsRelations,
  leadSimilarUsersRelations
};
