const { leads } = require('./leads');
const { meetingTranscripts } = require('./meetingTranscripts');
const { studentEmbeddings } = require('./studentEmbeddings');
const {
  leadsRelations,
  meetingTranscriptsRelations,
  leadSimilarUsersRelations
} = require('./relations');
const { leadSimilarUsers } = require('./leadSimilarUsers');
const { salesMembers } = require('./salesMember');

module.exports = {
  leads,
  meetingTranscripts,
  studentEmbeddings,
  leadSimilarUsers,
  leadsRelations,
  meetingTranscriptsRelations,
  leadSimilarUsersRelations,
  salesMembers
};
