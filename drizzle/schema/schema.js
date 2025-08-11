const { leads } = require('./leads');
const { meetingTranscripts } = require('./meetingTranscripts');
const { studentEmbeddings } = require('./studentEmbeddings');
const { leadsRelations, meetingTranscriptsRelations } = require('./relations');
const { leadSimilarUsers } = require('./leadSimilarUsers');

module.exports = {
  leads,
  meetingTranscripts,
  studentEmbeddings,
  leadSimilarUsers,
  leadsRelations,
  meetingTranscriptsRelations
};
