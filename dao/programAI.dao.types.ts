/**
 * Persistence-agnostic AI-generated program-metadata entity. The model has no
 * `@taiger-common` interface, so fields stay loose; `_id` is kept as a STRING.
 */
export interface ProgramAI {
  _id: string;
  program_id: string;
  [key: string]: unknown;
}

export interface IProgramAIDAO {
  getByProgramId(programId: string): Promise<ProgramAI | null>;
}
