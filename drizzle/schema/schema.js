const { leads } = require('./leads');
const { meetingTranscripts } = require('./meetingTranscripts');
const { studentEmbeddings } = require('./studentEmbeddings');
const {
  leadsRelations,
  dealsRelations,
  meetingTranscriptsRelations,
  leadSimilarUsersRelations
} = require('./relations');
const { leadSimilarUsers } = require('./leadSimilarUsers');
const { salesReps } = require('./salesReps');
const { deals } = require('./deals');

module.exports = {
  leads,
  meetingTranscripts,
  studentEmbeddings,
  leadSimilarUsers,
  deals,
  leadsRelations,
  dealsRelations,
  meetingTranscriptsRelations,
  leadSimilarUsersRelations,
  salesReps
};
