const { asyncHandler } = require('../middlewares/error-handler');
const { transcripts } = require('../drizzle/schema/schema');
const { postgresDb } = require('../database');

// TODO:
// - Implement meeting summary schema
// - Implement the logic to fetch meeting summary & transcripts from Firefiles (currently hardcoded data in MongoDB)
const getMeetingSummaries = asyncHandler(async (req, res) => {
  const meetingSummaries = await await postgresDb.select().from(transcripts);
  res.status(200).send({ success: true, data: meetingSummaries });
});

module.exports = {
  getMeetingSummaries
};
