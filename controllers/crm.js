const { asyncHandler } = require('../middlewares/error-handler');
const { meetingTranscripts, leads } = require('../drizzle/schema/schema');
const { postgresDb } = require('../database');

// TODO:
// - Implement meeting summary schema
// - Implement the logic to fetch meeting summary & transcripts from Firefiles (currently hardcoded data in MongoDB)
const getMeetingSummaries = asyncHandler(async (req, res) => {
  const meetingSummaries = await await postgresDb
    .select()
    .from(meetingTranscripts);
  res.status(200).send({ success: true, data: meetingSummaries });
});

const getCRMLeads = asyncHandler(async (req, res) => {
  const leadsRecords = await postgresDb.select().from(leads);
  res.status(200).send({ success: true, data: leadsRecords });
});

module.exports = {
  getMeetingSummaries,
  getCRMLeads
};
