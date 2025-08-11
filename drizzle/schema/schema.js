const { leads } = require('./leads');
const { meetingTranscripts } = require('./meetingTranscripts');
const { studentEmbeddings } = require('./studentEmbeddings');
const { leadsRelations, meetingTranscriptsRelations } = require('./relations');

module.exports = {
  leads,
  meetingTranscripts,
  studentEmbeddings,
  leadsRelations,
  meetingTranscriptsRelations
};
