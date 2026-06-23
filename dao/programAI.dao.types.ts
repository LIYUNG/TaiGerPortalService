/**
 * Persistence-agnostic AI-generated program-metadata entity. The model has no
 * `@taiger-common` interface, so fields stay loose; `_id` is kept as a STRING.
 */
export interface ProgramAI {
  _id: string;
  program_id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface IProgramAIDAO {
  getByProgramId(programId: string): Promise<ProgramAI | null>;
}
