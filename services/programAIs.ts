import ProgramAIDAO from '../dao/programAI.dao';
import type { IProgramAIDAO } from '../dao/programAI.dao.types';

/**
 * ProgramAIService — business layer for AI-generated program metadata. Depends
 * only on the IProgramAIDAO strategy contract (constructor injection).
 */
export class ProgramAIService {
  constructor(private readonly dao: IProgramAIDAO) {}

  getByProgramId(programId: string) {
    return this.dao.getByProgramId(programId);
  }
}

// Production instance, wired to the MongoDB strategy.
const programAIService = new ProgramAIService(ProgramAIDAO);

export default programAIService;
