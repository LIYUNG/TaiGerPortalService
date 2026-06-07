const { Event } = require('../models');

const TEAM_POPULATE_PATH = 'receiver_id requester_id';

/**
 * EventDAO — data access for the Event model (default-connection model from
 * models/index.js). Plain params, no req.
 */
const EventDAO = {
  // Flexible event query. `populate` = { path, select }; `select` projects the
  // event document itself.
  async findEvents(filter, { populate, select } = {}) {
    let query = Event.find(filter);
    if (populate) {
      query = query.populate(populate.path, populate.select);
    }
    if (select) {
      query = query.select(select);
    }
    return query.lean();
  },

  async getEventById(eventId) {
    return Event.findById(eventId);
  },

  async getEventByIdPopulated(eventId, populateSelect) {
    return Event.findById(eventId)
      .populate(TEAM_POPULATE_PATH, populateSelect)
      .lean();
  },

  async createEvent(payload) {
    return Event.create(payload);
  },

  async updateEventById(eventId, payload, populateSelect) {
    return Event.findByIdAndUpdate(eventId, payload, {
      upsert: false,
      new: true
    })
      .populate(TEAM_POPULATE_PATH, populateSelect)
      .lean();
  },

  async deleteEventById(eventId) {
    return Event.findByIdAndDelete(eventId);
  },

  // Raw update (no populate, returns the pre-update doc) — used where the result
  // is not consumed.
  async updateEventRawById(eventId, payload) {
    return Event.findByIdAndUpdate(eventId, payload, {});
  },

  // Delete and return the deleted event populated (for cancellation emails).
  async deleteEventByIdPopulated(eventId, populateSelect) {
    return Event.findByIdAndDelete(eventId)
      .populate(TEAM_POPULATE_PATH, populateSelect)
      .lean();
  }
};

module.exports = EventDAO;
