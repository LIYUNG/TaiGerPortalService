import { relations } from 'drizzle-orm';
import { leads } from './leads';
import { leadProfile } from './leadProfile';
import { leadTags } from './leadTags';
import { leadNotes } from './leadNotes';
import { leadSimilarUsers } from './leadSimilarUsers';
import { meetingTranscripts } from './meetingTranscripts';
import { salesReps } from './salesReps';
import { deals } from './deals';

export const leadsRelations = relations(leads, ({ many, one }) => ({
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

export const leadProfileRelations = relations(leadProfile, ({ one }) => ({
  lead: one(leads, {
    fields: [leadProfile.leadId],
    references: [leads.id]
  })
}));

export const leadTagsRelations = relations(leadTags, ({ one }) => ({
  lead: one(leads, {
    fields: [leadTags.leadId],
    references: [leads.id]
  })
}));

export const leadNotesRelations = relations(leadNotes, ({ one }) => ({
  lead: one(leads, {
    fields: [leadNotes.leadId],
    references: [leads.id]
  })
}));

export const dealsRelations = relations(deals, ({ one }) => ({
  lead: one(leads, {
    fields: [deals.leadId],
    references: [leads.id]
  }),
  salesRep: one(salesReps, {
    fields: [deals.salesUserId],
    references: [salesReps.userId]
  })
}));

export const meetingTranscriptsRelations = relations(
  meetingTranscripts,
  ({ one }) => ({
    lead: one(leads, {
      fields: [meetingTranscripts.leadId],
      references: [leads.id]
    })
  })
);

export const leadSimilarUsersRelations = relations(
  leadSimilarUsers,
  ({ one }) => ({
    lead: one(leads, {
      fields: [leadSimilarUsers.leadId],
      references: [leads.id]
    })
  })
);
