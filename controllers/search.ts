const { asyncHandler } = require('../middlewares/error-handler');
const logger = require('../services/logger');
const SearchService = require('../services/search');

const getQueryPublicResults = asyncHandler(async (req, res) => {
  const data = await SearchService.getPublicResults(req.query.q);
  res.status(200).send({ success: true, data });
});

const getQueryResults = asyncHandler(async (req, res) => {
  try {
    const data = await SearchService.getResults(req.query.q);
    res.status(200).send({ success: true, data });
  } catch (e) {
    logger.error(e);
    res.status(200).send({ success: true, data: [] });
  }
});

const getQueryStudentsResults = asyncHandler(async (req, res) => {
  const data = await SearchService.getStudentsResults(req.query.q);
  res.status(200).send({ success: true, data });
});

module.exports = {
  getQueryStudentsResults,
  getQueryPublicResults,
  getQueryResults
};
