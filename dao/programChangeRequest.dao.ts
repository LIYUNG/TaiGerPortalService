import { ProgramChangeRequest as ProgramChangeRequestModel } from '../models';
import type {
  IProgramChangeRequestDAO,
  ProgramChangeRequest
} from './programChangeRequest.dao.types';

const toDomain = (doc: unknown): ProgramChangeRequest | null => {
  if (!doc) {
    return null;
  }
  const source = doc as { toObject?: () => Record<string, unknown> };
  const plain =
    typeof source.toObject === 'function'
      ? source.toObject()
      : (doc as Record<string, unknown>);
  const out = { ...plain };
  if (out._id != null) {
    out._id = String(out._id);
  }
  return out as ProgramChangeRequest;
};

/**
 * ProgramChangeRequestMongoDAO — MongoDB strategy for program change requests.
 * Implements IProgramChangeRequestDAO; the open-request query is built HERE.
 */
class ProgramChangeRequestMongoDAO implements IProgramChangeRequestDAO {
  async getOpenChangeRequestsByProgramId(
    programId: string
  ): Promise<ProgramChangeRequest[]> {
    const docs = await ProgramChangeRequestModel.find({
      programId,
      reviewedBy: { $exists: false }
    }).populate('requestedBy', 'firstname lastname');
    return docs
      .map((doc) => toDomain(doc))
      .filter((cr): cr is ProgramChangeRequest => cr !== null);
  }

  async upsertChangeRequest(
    programId: string,
    requestedBy: string,
    changes: Record<string, unknown>
  ): Promise<ProgramChangeRequest | null> {
    return toDomain(
      await ProgramChangeRequestModel.findOneAndUpdate(
        { programId, requestedBy, reviewedBy: { $exists: false } },
        { programChanges: changes },
        { upsert: true }
      )
    );
  }

  async getChangeRequestById(
    requestId: string
  ): Promise<ProgramChangeRequest | null> {
    return toDomain(await ProgramChangeRequestModel.findById(requestId));
  }

  async updateChangeRequestById(
    requestId: string,
    payload: Record<string, unknown>
  ): Promise<ProgramChangeRequest | null> {
    return toDomain(
      await ProgramChangeRequestModel.findByIdAndUpdate(requestId, payload, {
        new: true
      })
    );
  }
}

export = new ProgramChangeRequestMongoDAO();
