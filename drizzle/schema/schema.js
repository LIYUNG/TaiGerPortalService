const { leads } = require('./leads');
const { meetingTranscripts } = require('./meetingTranscripts');
const { studentEmbeddings } = require('./studentEmbeddings');
const {
  leadsRelations,
  meetingTranscriptsRelations,
  leadSimilarUsersRelations
} = require('./relations');
const { leadSimilarUsers } = require('./leadSimilarUsers');
const { salesMembers } = require('./salesMembers');
const { deals } = require('./deals');

module.exports = {
  leads,
  meetingTranscripts,
  studentEmbeddings,
  leadSimilarUsers,
  deals,
  leadsRelations,
  meetingTranscriptsRelations,
  leadSimilarUsersRelations,
  salesMembers
};
