import { ProgramAI as ProgramAIModel } from '../models';
import type { IProgramAIDAO, ProgramAI } from './programAI.dao.types';

const toDomain = (doc: unknown): ProgramAI | null => {
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
