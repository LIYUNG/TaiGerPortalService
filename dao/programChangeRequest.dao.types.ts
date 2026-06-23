/**
 * Persistence-agnostic program-change-request entity. The model has no
 * `@taiger-common` interface, so fields stay loose; `_id` is kept as a STRING.
 */
export interface ProgramChangeRequest {
  _id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface IProgramChangeRequestDAO {
  getOpenChangeRequestsByProgramId(
    programId: string
  ): Promise<ProgramChangeRequest[]>;
  upsertChangeRequest(
    programId: string,
    requestedBy: string,
    changes: Record<string, unknown>
  ): Promise<ProgramChangeRequest | null>;
  getChangeRequestById(requestId: string): Promise<ProgramChangeRequest | null>;
  updateChangeRequestById(
    requestId: string,
    payload: Record<string, unknown>
  ): Promise<ProgramChangeRequest | null>;
}
