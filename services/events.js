const EventDAO = require('../dao/event.dao');

/**
 * EventService — business layer for booking/meeting events. Delegates data
 * access to the DAO (controller -> service -> dao).
 */
const EventService = {
  findEvents(filter, options) {
    return EventDAO.findEvents(filter, options);
  },

  getEventById(eventId) {
    return EventDAO.getEventById(eventId);
  },

  getEventByIdPopulated(eventId, populateSelect) {
    return EventDAO.getEventByIdPopulated(eventId, populateSelect);
  },

  createEvent(payload) {
    return EventDAO.createEvent(payload);
  },

  updateEventById(eventId, payload, populateSelect) {
    return EventDAO.updateEventById(eventId, payload, populateSelect);
  },

  deleteEventById(eventId) {
    return EventDAO.deleteEventById(eventId);
  },

  updateEventRawById(eventId, payload) {
    return EventDAO.updateEventRawById(eventId, payload);
  },

  deleteEventByIdPopulated(eventId, populateSelect) {
    return EventDAO.deleteEventByIdPopulated(eventId, populateSelect);
  }
};

module.exports = EventService;
