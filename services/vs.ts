import { FilterQuery } from 'mongoose';
import VCDAO from '../dao/vc.dao';

// VersionControl is a local-only model without a shared interface, so the
// filter/change shapes are typed inline (mirrors dao/vc.dao.ts).
interface IVersionControl {
  docId?: unknown;
  collectionName?: string;
  changes?: Record<string, unknown>[];
}

/**
 * VCService — business layer; delegates data access to the DAO.
 */
const VCService = {
  getVC(filter: FilterQuery<IVersionControl>) {
    return VCDAO.getVC(filter);
  },

  pushChange(
    filter: FilterQuery<IVersionControl>,
    change: Record<string, unknown>
  ) {
    return VCDAO.pushChange(filter, change);
  }
};

export = VCService;
