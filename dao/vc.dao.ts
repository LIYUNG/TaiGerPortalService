import { FilterQuery } from 'mongoose';
import { VC } from '../models';

// VersionControl is a local-only model (models/VersionControl.ts) without a
// shared interface, so the filter/change shapes are typed inline.
interface IVersionControl {
  docId?: unknown;
  collectionName?: string;
  changes?: Record<string, unknown>[];
}

/**
 * VCDAO — data access for the VC (version control) model (central
 * default-connection model). Plain params, no req.
 */
const VCDAO = {
  async getVC(filter: FilterQuery<IVersionControl>) {
    return VC.findOne(filter).lean();
  },

  // Upsert the VC document and append a change entry.
  async pushChange(
    filter: FilterQuery<IVersionControl>,
    change: Record<string, unknown>
  ) {
    return VC.findOneAndUpdate(
      filter,
      { $push: { changes: change } },
      { upsert: true, new: true }
    );
  }
};

export = VCDAO;
