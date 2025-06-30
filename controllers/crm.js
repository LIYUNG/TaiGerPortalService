const { asyncHandler } = require('../middlewares/error-handler');

// TODO:
// - Implement meeting summary schema
// - Implement the logic to fetch meeting summary & transcripts from Firefiles (currently hardcoded data in MongoDB)
const getMeetingSummaries = asyncHandler(async (req, res) => {
  const meetingSummaries = await req.db
    .collection('meetingsummaries')
    .find({})
    .toArray();
  res.status(200).send({ success: true, data: meetingSummaries });
});

module.exports = {
  getMeetingSummaries
};
