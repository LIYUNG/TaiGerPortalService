import { asyncHandler } from '../middlewares/error-handler';
import ApplicationService from '../services/applications';

const getApplicationConflicts = asyncHandler(async (req, res) => {
  const applicationConflicts =
    await ApplicationService.getApplicationConflicts();
  res.status(200).send({ success: true, data: applicationConflicts });
});

module.exports = {
  getApplicationConflicts
};
