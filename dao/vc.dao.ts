import { VC } from '../models';

/**
 * VCDAO — data access for the VC (version control) model (central
 * default-connection model). Plain params, no req.
 */
const VCDAO = {
  async getVC(filter) {
    return VC.findOne(filter).lean();
  },

  // Upsert the VC document and append a change entry.
  async pushChange(filter, change) {
    return VC.findOneAndUpdate(
      filter,
      { $push: { changes: change } },
      { upsert: true, new: true }
    );
  }
};

export = VCDAO;
