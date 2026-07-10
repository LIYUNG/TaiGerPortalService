import {
  is_TaiGer_Agent,
  is_TaiGer_Editor,
  is_TaiGer_Student
} from '@taiger-common/core';
import type { IEvent } from '@taiger-common/model';
import type { Types } from 'mongoose';

import { ErrorResponse } from '../common/errors';
import { asyncHandler } from './error-handler';
import EventService from '../services/events';

export const event_multitenant_filter = asyncHandler(async (req, res, next) => {
  const {
    user,
    params: { event_id }
  } = req;
  if (is_TaiGer_Student(user)) {
    const event = (await EventService.getEventByIdLean(
      event_id
    )) as IEvent | null;
    const requesterIds = event?.requester_id as Types.ObjectId[] | undefined;
    const containsObjectId = requesterIds?.some((objectId) =>
      objectId.equals(user._id)
    );
    if (!containsObjectId) {
      return next(
        new ErrorResponse(403, 'Permission denied: Please contact TaiGer.')
      );
    }
  }

  if (is_TaiGer_Agent(user) || is_TaiGer_Editor(user)) {
    const event = (await EventService.getEventByIdLean(
      event_id
    )) as IEvent | null;
    const receiverIds = event?.receiver_id as Types.ObjectId[] | undefined;
    const containsObjectId = receiverIds?.some((objectId) =>
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
