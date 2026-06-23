import { ProgramAI as ProgramAIModel } from '../models';
import type { IProgramAIDAO, ProgramAI } from './programAI.dao.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toDomain = (doc: any): ProgramAI | null => {
  if (!doc) {
    return null;
  }
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const out = { ...plain };
  if (out._id != null) {
    out._id = String(out._id);
  }
  return out as ProgramAI;
};

/**
 * ProgramAIMongoDAO — MongoDB strategy for AI-generated program metadata.
 * Implements IProgramAIDAO.
 */
class ProgramAIMongoDAO implements IProgramAIDAO {
  async getByProgramId(programId: string): Promise<ProgramAI | null> {
    return toDomain(
      await ProgramAIModel.findOne({ program_id: programId }).lean()
    );
  }
}

export = new ProgramAIMongoDAO();
