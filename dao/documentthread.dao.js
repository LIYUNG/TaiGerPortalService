const { Documentthread } = require('../models');

const applyPopulates = (query, populates = []) => {
  populates.forEach((args) => {
    query = query.populate(...args);
  });
  return query;
};

/**
 * DocumentthreadDAO — data access for the Documentthread model
 * (default-connection model from models/index.js). Plain params, no req.
 *
 * Only the methods needed by the already-migrated callers live here; the legacy
 * read-heavy DocumentThreadService still uses req.db for its aggregations.
 */
const DocumentthreadDAO = {
  // Construct an UNSAVED thread document so the caller can build the matching
  // application/student subdocument entries before persisting with .save().
  newThread(payload) {
    return new Documentthread(payload);
  },

  async countThreads(filter) {
    return Documentthread.countDocuments(filter);
  },

  async createThread(payload) {
    return Documentthread.create(payload);
  },

  async deleteThreadById(id) {
    return Documentthread.findByIdAndDelete(id);
  },

  // Raw field update (no populate, returns pre-update doc).
  async updateThreadFields(id, payload) {
    return Documentthread.findByIdAndUpdate(id, payload, {});
  },

  async getThreadByIdLean(id) {
    return Documentthread.findById(id).lean();
  },

  // Live (non-lean) document — caller mutates messages/fields and calls .save().
  async getThreadDocById(id) {
    return Documentthread.findById(id);
  },

  async getThreadDocByIdPopulated(id, populates = []) {
    return applyPopulates(Documentthread.findById(id), populates);
  },

  async findThreadByIdPopulated(id, populates = []) {
    return applyPopulates(Documentthread.findById(id), populates).lean();
  },

  // findOne with the program populated (lean) — survey-input notifications.
  async findOneThreadPopulated(filter, populates = []) {
    return applyPopulates(Documentthread.findOne(filter), populates).lean();
  },

  // Live findOne document.
  async findOneThreadDoc(filter) {
    return Documentthread.findOne(filter);
  },

  async clearAllOutsourcedUsers() {
    return Documentthread.updateMany(
      { outsourced_user_id: { $exists: true } },
      { $set: { outsourced_user_id: [] } }
    );
  },

  async setMessageIgnore(messageId, ignoreMessageState) {
    return Documentthread.updateOne(
      { 'messages._id': messageId },
      { $set: { 'messages.$.ignore_message': ignoreMessageState } }
    );
  }
};

module.exports = DocumentthreadDAO;
