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

const getLeads = asyncHandler(async (req, res) => {
  const leadsRecords = await postgresDb
    .select({
      id: leads.id,
      fullName: leads.fullName,
      source: leads.source,
      email: leads.email,
      phone: leads.phone,
      status: leads.status,
      intendedStartTime: leads.intendedStartTime,
      intendedProgramLevel: leads.intendedProgramLevel,
      intendedDirection: leads.intendedDirection,
      createdAt: leads.createdAt
    })
    .from(leads)
    .orderBy(desc(leads.createdAt));
  res.status(200).send({ success: true, data: leadsRecords });
});

const getLead = asyncHandler(async (req, res) => {
  const { leadId } = req.params;

  if (!leadId) {
    return res
      .status(400)
      .send({ success: false, message: 'Lead ID is required' });
  }

  const leadRecord = await postgresDb
    .select()
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1);

  if (leadRecord.length === 0) {
    return res.status(404).send({ success: false, message: 'Lead not found' });
  }

  res.status(200).send({ success: true, data: leadRecord[0] });
});

const getMeetings = asyncHandler(async (req, res) => {
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

const getMeeting = asyncHandler(async (req, res) => {
  const { meetingId } = req.params;

  if (!meetingId) {
    return res
      .status(400)
      .send({ success: false, message: 'Meeting ID is required' });
  }

  const meetingRecord = await postgresDb
    .select()
    .from(meetingTranscripts)
    .where(eq(meetingTranscripts.id, meetingId))
    .limit(1);

  if (meetingRecord.length === 0) {
    return res
      .status(404)
      .send({ success: false, message: 'Meeting not found' });
  }

  res.status(200).send({ success: true, data: meetingRecord[0] });
});

module.exports = {
  getCRMStats,
  getLeads,
  getLead,
  getMeetings,
  getMeeting
};
