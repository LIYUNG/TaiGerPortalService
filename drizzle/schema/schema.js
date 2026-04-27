const { leads } = require('./leads');
const { leadProfile } = require('./leadProfile');
const { leadTags } = require('./leadTags');
const { leadNotes } = require('./leadNotes');
const { meetingTranscripts } = require('./meetingTranscripts');
const { studentEmbeddings } = require('./studentEmbeddings');
const {
  leadsRelations,
  leadProfileRelations,
  leadTagsRelations,
  leadNotesRelations,
  dealsRelations,
  meetingTranscriptsRelations,
  leadSimilarUsersRelations
} = require('./relations');
const { leadSimilarUsers } = require('./leadSimilarUsers');
const { salesReps } = require('./salesReps');
const { deals, dealStatusEnum } = require('./deals');
const {
  aiAssistConversations,
  aiAssistMessages,
  aiAssistToolCalls
} = require('./aiAssist');

module.exports = {
  aiAssistConversations,
  aiAssistMessages,
  aiAssistToolCalls,
  leads,
  leadProfile,
  leadTags,
  leadNotes,
  meetingTranscripts,
  studentEmbeddings,
  leadSimilarUsers,
  deals,
  dealStatusEnum,
  leadsRelations,
  leadProfileRelations,
  leadTagsRelations,
  leadNotesRelations,
  dealsRelations,
  meetingTranscriptsRelations,
  leadSimilarUsersRelations,
  salesReps
};
