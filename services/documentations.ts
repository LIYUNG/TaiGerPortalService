import DocspageDAO from '../dao/docspage.dao';
import DocumentationDAO from '../dao/documentation.dao';
import InternaldocDAO from '../dao/internaldoc.dao';
import type { Docspage, IDocspageDAO } from '../dao/docspage.dao.types';
import type {
  Documentation,
  IDocumentationDAO
} from '../dao/documentation.dao.types';
import type {
  IInternaldocDAO,
  Internaldoc
} from '../dao/internaldoc.dao.types';

/**
 * DocumentationService — business layer for the docs feature, composing the
 * Docspage (doc landing pages), Documentation (public docs) and Internaldoc
 * (internal docs) strategy contracts via constructor injection. Each storage
 * engine can be swapped by constructing the service with different DAOs.
 */
export class DocumentationService {
  constructor(
    private readonly docspageDao: IDocspageDAO,
    private readonly documentationDao: IDocumentationDAO,
    private readonly internaldocDao: IInternaldocDAO
  ) {}

  // ── Docspage ────────────────────────────────────────────────────────────────
  upsertDocspageByCategory(category: string, fields: Partial<Docspage>) {
    return this.docspageDao.upsertByCategory(category, fields);
  }

  getDocspageByCategory(category: string) {
    return this.docspageDao.getByCategory(category);
  }

  // ── Documentation ───────────────────────────────────────────────────────────
  getAllDocumentations() {
    return this.documentationDao.findAllTitleCategory();
  }

  getDocumentationById(docId: string) {
    return this.documentationDao.getById(docId);
  }

  createDocumentation(fields: Partial<Documentation>) {
    return this.documentationDao.create(fields);
  }

  updateDocumentationById(docId: string, fields: Partial<Documentation>) {
    return this.documentationDao.updateById(docId, fields);
  }

  deleteDocumentationById(docId: string) {
    return this.documentationDao.deleteById(docId);
  }

  // ── Internaldoc ─────────────────────────────────────────────────────────────
  getAllInternalDocumentations() {
    return this.internaldocDao.findAllTitleInternalCategory();
  }

  getInternalDocumentationById(docId: string) {
    return this.internaldocDao.getById(docId);
  }

  createInternalDocumentation(fields: Partial<Internaldoc>) {
    return this.internaldocDao.create(fields);
  }

  updateInternalDocumentationById(docId: string, fields: Partial<Internaldoc>) {
    return this.internaldocDao.updateById(docId, fields);
  }

  deleteInternalDocumentationById(docId: string) {
    return this.internaldocDao.deleteById(docId);
  }
}

// Production instance, wired to the MongoDB strategies.
const documentationService = new DocumentationService(
  DocspageDAO,
  DocumentationDAO,
  InternaldocDAO
);

export default documentationService;
