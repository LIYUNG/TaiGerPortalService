const { asyncHandler } = require('../middlewares/error-handler');

// TODO:
// - Implement transcrpipts schema
// - Implement the logic to fetch transcripts from Firefiles (currently hardcoded data in MongoDB)
const getTranscripts = asyncHandler(async (req, res) => {
  const transcripts = await req.db.collection('transcripts').find({}).toArray();
  res.status(200).send({ success: true, data: transcripts });
});

module.exports = {
  getTranscripts
};
