import { FilterQuery, UpdateQuery } from 'mongoose';
import { IEvent } from '@taiger-common/model';
import EventDAO from '../dao/event.dao';

/**
 * EventService — business layer for booking/meeting events. Delegates data
 * access to the DAO (controller -> service -> dao).
 */
const EventService = {
  findEvents(
    filter: FilterQuery<IEvent>,
    options?: { populate?: { path: string; select?: string }; select?: string }
  ) {
    return EventDAO.findEvents(filter, options);
  },

  getEventById(eventId: string) {
    return EventDAO.getEventById(eventId);
  },

  getEventByIdLean(eventId: string) {
    return EventDAO.getEventByIdLean(eventId);
  },

  getEventByIdPopulated(eventId: string, populateSelect: string) {
    return EventDAO.getEventByIdPopulated(eventId, populateSelect);
  },

  createEvent(payload: Partial<IEvent>) {
    return EventDAO.createEvent(payload);
  },

  updateEventById(
    eventId: string,
    payload: UpdateQuery<IEvent>,
    populateSelect: string
  ) {
    return EventDAO.updateEventById(eventId, payload, populateSelect);
  },

  deleteEventById(eventId: string) {
    return EventDAO.deleteEventById(eventId);
  },

  updateEventRawById(eventId: string, payload: UpdateQuery<IEvent>) {
    return EventDAO.updateEventRawById(eventId, payload);
  },

  deleteEventByIdPopulated(eventId: string, populateSelect: string) {
    return EventDAO.deleteEventByIdPopulated(eventId, populateSelect);
  },

  getEventsPaginated(args: {
    filter?: FilterQuery<IEvent>;
    query?: {
      page?: string | number;
      limit?: string | number;
      sortOrder?: string;
    };
  }) {
    return EventDAO.getEventsPaginated(args);
  }
};

export = EventService;
