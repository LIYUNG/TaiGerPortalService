const { asyncHandler } = require('../../middlewares/error-handler');
const UserlogService = require('../../services/userlogs');

const logAccess = asyncHandler(async (req, res, next) => {
  try {
    const { user } = req;
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const formattedDate = `${year}-${month}-${day}`;
    const filter = {
      user_id: user._id,
      apiPath: req.originalUrl,
      operation: req.originalMethod,
      date: formattedDate
    };
    const u = await UserlogService.findOneUserlog(filter);
    if (u) {
      // If a document exists, increment the access count
      await UserlogService.incrementUserlogCount(filter);
    } else {
      // If no document exists, create a new one with an access count of 1
      await UserlogService.incrementUserlogCount(filter, { upsert: true });
    }
  } catch (e) {
    // client.close();
  }
});

module.exports = {
  logAccess
};
