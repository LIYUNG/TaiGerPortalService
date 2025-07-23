const { asyncHandler } = require('../middlewares/error-handler');
const { meetingTranscripts, leads } = require('../drizzle/schema/schema');
const { postgresDb } = require('../database');
const { sql, getTableColumns, eq, desc } = require('drizzle-orm');

/**
 * Retrieves CRM statistics including weekly counts and total/recent counts for leads and meetings.
 *
 * - Aggregates leads and meetings by week and year.
 * - Calculates total and recent (last 7 days) counts for leads and meetings.
 * - Responds with a JSON object containing the aggregated statistics.
 *
 * @async
 * @function getCRMStats
 * @returns {Promise<void>} Sends a JSON response with CRM statistics.
 */
const getCRMStats = asyncHandler(async (req, res) => {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  // CTEs extracting year and week from leads.createdAt and meetingTranscripts.date timestamps.
  const leadWeeks = postgresDb.$with('lead_weeks').as(
    postgresDb
      .select({
        year: sql`EXTRACT(YEAR FROM ${leads.createdAt})`.as('year'),
        week: sql`EXTRACT(WEEK FROM ${leads.createdAt})`.as('week'),
        userId: leads.userId
      })
      .from(leads)
  );
  const meetingWeeks = postgresDb.$with('meeting_weeks').as(
    postgresDb
      .select({
        year: sql`EXTRACT(YEAR FROM to_timestamp(${meetingTranscripts.date} / 1000))`.as(
          'year'
        ),
        week: sql`EXTRACT(WEEK FROM to_timestamp(${meetingTranscripts.date} / 1000))`.as(
          'week'
        )
      })
      .from(meetingTranscripts)
  );

  const [
    leadsCountByDate,
    meetingCountByDate,
    meetingCountResult,
    leadCountResult
  ] = await Promise.all([
    postgresDb
      .with(leadWeeks)
      .select({
        week: sql`year::text || '-' || LPAD(week::text, 2, '0')`.as('week'),
        count: sql`COUNT(*)`.mapWith(Number),
        closedCount: sql`COUNT(*) FILTER (WHERE user_id IS NOT NULL)`.mapWith(
          Number
        )
      })
      .from(leadWeeks)
      .groupBy(sql`year, week`)
      .orderBy(sql`year, week`),
    postgresDb
      .with(meetingWeeks)
      .select({
        week: sql`year::text || '-' || LPAD(week::text, 2, '0')`.as('week'),
        count: sql`COUNT(*)`.mapWith(Number)
      })
      .from(meetingWeeks)
      .groupBy(sql`year, week`)
      .orderBy(sql`year, week`),
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
        )})`.mapWith(Number),
        closedCount: sql`COUNT(*) FILTER (WHERE user_id IS NOT NULL)`.mapWith(
          Number
        )
      })
      .from(leads)
  ]);

  res.status(200).send({
    success: true,
    data: {
      totalLeadCount: leadCountResult[0].totalCount,
      recentLeadCount: leadCountResult[0].recentCount,
      closedLeadCount: leadCountResult[0].closedCount,
      totalMeetingCount: meetingCountResult[0].totalCount,
      recentMeetingCount: meetingCountResult[0].recentCount,

      leadsCountByDate: leadsCountByDate,
      meetingCountByDate: meetingCountByDate
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

const updateMeeting = asyncHandler(async (req, res) => {
  const { meetingId } = req.params;
  const updateData = req.body;

  if (!meetingId) {
    return res
      .status(400)
      .send({ success: false, message: 'Meeting ID is required' });
  }

  if (!updateData || Object.keys(updateData).length === 0) {
    return res
      .status(400)
      .send({ success: false, message: 'Update data is required' });
  }

  // Perform the update directly
  const updatedMeeting = await postgresDb
    .update(meetingTranscripts)
    .set(updateData)
    .where(eq(meetingTranscripts.id, meetingId))
    .returning();

  if (updatedMeeting.length === 0) {
    return res
      .status(404)
      .send({ success: false, message: 'Meeting not found' });
  }

  res.status(200).send({
    success: true,
    message: 'Meeting updated successfully',
    data: updatedMeeting[0]
  });
});

module.exports = {
  getCRMStats,
  getLeads,
  getLead,
  getMeetings,
  getMeeting,
  updateMeeting
};
