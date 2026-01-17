const { leads } = require('./leads');
const { leadAdditional } = require('./leadAdditional');
const { leadTags } = require('./leadTags');
const { leadNotes } = require('./leadNotes');
const { meetingTranscripts } = require('./meetingTranscripts');
const { studentEmbeddings } = require('./studentEmbeddings');
const {
  leadsRelations,
  leadAdditionalRelations,
  leadTagsRelations,
  leadNotesRelations,
  dealsRelations,
  meetingTranscriptsRelations,
  leadSimilarUsersRelations
} = require('./relations');
const { leadSimilarUsers } = require('./leadSimilarUsers');
const { salesReps } = require('./salesReps');
const { deals, dealStatusEnum } = require('./deals');

module.exports = {
  leads,
  leadAdditional,
  leadTags,
  leadNotes,
  meetingTranscripts,
  studentEmbeddings,
  leadSimilarUsers,
  deals,
  dealStatusEnum,
  leadsRelations,
  leadAdditionalRelations,
  leadTagsRelations,
  leadNotesRelations,
  dealsRelations,
  meetingTranscriptsRelations,
  leadSimilarUsersRelations,
  salesReps
};
