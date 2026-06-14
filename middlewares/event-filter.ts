const {
  is_TaiGer_Agent,
  is_TaiGer_Editor,
  is_TaiGer_Student
} = require('@taiger-common/core');

const { ErrorResponse } = require('../common/errors');
const { asyncHandler } = require('./error-handler');
const EventService = require('../services/events');

const event_multitenant_filter = asyncHandler(async (req, res, next) => {
  const {
    user,
    params: { event_id }
  } = req;
  if (is_TaiGer_Student(user)) {
    const event = await EventService.getEventByIdLean(event_id);
    const containsObjectId = event?.requester_id.some((objectId) =>
      objectId.equals(user._id)
    );
    if (!containsObjectId) {
      return next(
        new ErrorResponse(403, 'Permission denied: Please contact TaiGer.')
      );
    }
  }

  if (is_TaiGer_Agent(user) || is_TaiGer_Editor(user)) {
    const event = await EventService.getEventByIdLean(event_id);
    const containsObjectId = event?.receiver_id.some((objectId) =>
      objectId.equals(user._id)
    );
    if (!containsObjectId) {
      return next(
        new ErrorResponse(403, 'Permission denied: Please contact TaiGer.')
      );
    }
  }

  next();
});

module.exports = {
  event_multitenant_filter
};
