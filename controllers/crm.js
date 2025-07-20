const { asyncHandler } = require('../middlewares/error-handler');
const { meetingTranscripts, leads } = require('../drizzle/schema/schema');
const { postgresDb } = require('../database');
const { sql, getTableColumns, eq, gte, desc } = require('drizzle-orm');

const getCRMStats = asyncHandler(async (req, res) => {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const [meetingCountResult, leadCountResult] = await Promise.all([
    postgresDb
      .select({
        totalCount: sql`count(*)`.mapWith(Number),
        recentCount:
          sql`count(*) FILTER (WHERE date >= ${sevenDaysAgo})`.mapWith(Number)
      })
      .from(meetingTranscripts),

    postgresDb
      .select({
        totalCount: sql`count(*)`.mapWith(Number),
        recentCount: sql`count(*) FILTER (WHERE created_at >= ${new Date(
          sevenDaysAgo
        )})`.mapWith(Number)
      })
      .from(leads)
  ]);

  res.status(200).send({
    success: true,
    data: {
      totalMeetingCount: meetingCountResult[0].totalCount,
      recentMeetingCount: meetingCountResult[0].recentCount,
      totalLeadCount: leadCountResult[0].totalCount,
      recentLeadCount: leadCountResult[0].recentCount
    }
  });
});

const getMeetingSummaries = asyncHandler(async (req, res) => {
  const meetingSummaries = await postgresDb
    .select({
      leadId: leads.id,
      leadFullName: leads.fullName,
      ...getTableColumns(meetingTranscripts) // meetingSummaries.*
    })
    .from(meetingTranscripts)
    .leftJoin(leads, eq(meetingTranscripts.leadId, leads.id))
    .where(
      sql`(meeting_info->>'fred_joined')::boolean = true AND
         (meeting_info->>'silent_meeting')::boolean = false AND
         (meeting_info->>'summary_status') != 'skipped' AND
         is_archived = false`
    )
    .orderBy(desc(meetingTranscripts.date));
  res.status(200).send({ success: true, data: meetingSummaries });
});

const getCRMLeads = asyncHandler(async (req, res) => {
  const leadsRecords = await postgresDb
    .select({
      id: leads.id,
      fullName: leads.fullName,
      gender: leads.gender,
      email: leads.email,
      lineId: leads.lineId,
      source: leads.source,
      createdAt: leads.createdAt
    })
    .from(leads)
    .orderBy(desc(leads.createdAt));
  res.status(200).send({ success: true, data: leadsRecords });
});

module.exports = {
  getCRMStats,
  getMeetingSummaries,
  getCRMLeads
};
