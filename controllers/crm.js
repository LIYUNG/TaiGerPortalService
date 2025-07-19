const { asyncHandler } = require('../middlewares/error-handler');
const { meetingTranscripts, leads } = require('../drizzle/schema/schema');
const { postgresDb } = require('../database');
const { sql } = require('drizzle-orm');

const getMeetingSummaries = asyncHandler(async (req, res) => {
  const meetingSummaries = await await postgresDb
    .select()
    .from(meetingTranscripts)
    .where(sql`(meeting_info->>'fred_joined')::boolean = true AND
         (meeting_info->>'silent_meeting')::boolean = false AND
         (meeting_info->>'summary_status') != 'skipped'`);
  res.status(200).send({ success: true, data: meetingSummaries });
});

const getCRMLeads = asyncHandler(async (req, res) => {
  const leadsRecords = await postgresDb
    .select({
      fullName: leads.fullName,
      gender: leads.gender,
      email: leads.email,
      lineId: leads.lineId,
      source: leads.source
    })
    .from(leads);
  res.status(200).send({ success: true, data: leadsRecords });
});

module.exports = {
  getMeetingSummaries,
  getCRMLeads
};
