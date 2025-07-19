const { asyncHandler } = require('../middlewares/error-handler');
const ApplicationService = require('../services/applications');

const getApplicationConflicts = asyncHandler(async (req, res) => {
  const applicationConflicts = await ApplicationService.getApplicationConflicts(
    req
  );
  res.status(200).send({ success: true, data: applicationConflicts });
});

module.exports = {
  getApplicationConflicts
};
