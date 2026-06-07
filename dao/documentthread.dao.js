const { Documentthread } = require('../models');

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
  }
};

module.exports = DocumentthreadDAO;
