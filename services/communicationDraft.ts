import type { ICommunicationFile } from '@taiger-common/model';
import CommunicationDraftDAO from '../dao/communicationDraft.dao';
import type { ICommunicationDraftDAO } from '../dao/communicationDraft.dao.types';

/**
 * CommunicationDraftService — business layer for message drafts. Depends only on
 * the ICommunicationDraftDAO strategy contract, injected via the constructor
 * (controller -> service -> dao). The storage engine is swapped by constructing
 * the service with a different DAO — no change here, in the controller, or in the
 * cleanup job:
 *
 *   // run on PostgreSQL instead:
 *   // import { CommunicationDraftPgDAO } from '../dao/communicationDraft.pg.dao';
 *   // export default new CommunicationDraftService(new CommunicationDraftPgDAO(pgPool));
 */
export class CommunicationDraftService {
  constructor(private readonly dao: ICommunicationDraftDAO) {}

  getDraft(userId: string, studentId: string) {
    return this.dao.getDraft(userId, studentId);
  }

  upsertDraft(userId: string, studentId: string, message: string) {
    return this.dao.upsertDraft(userId, studentId, message);
  }

  deleteDraft(userId: string, studentId: string) {
    return this.dao.deleteDraft(userId, studentId);
  }

  addDraftFiles(
    userId: string,
    studentId: string,
    files: ICommunicationFile[]
  ) {
    return this.dao.addDraftFiles(userId, studentId, files);
  }

  removeDraftFile(userId: string, studentId: string, filePath: string) {
    return this.dao.removeDraftFile(userId, studentId, filePath);
  }

  findStaleDrafts(before: Date) {
    return this.dao.findStaleDrafts(before);
  }
}

// Production instance, wired to the MongoDB strategy.
const communicationDraftService = new CommunicationDraftService(
  CommunicationDraftDAO
);

export default communicationDraftService;
