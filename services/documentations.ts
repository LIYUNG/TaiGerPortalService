import { UpdateQuery } from 'mongoose';
import { IDocspage, IDocumentation, IInternaldoc } from '@taiger-common/model';
import DocspageDAO from '../dao/docspage.dao';
import DocumentationDAO from '../dao/documentation.dao';
import InternaldocDAO from '../dao/internaldoc.dao';

/**
 * DocumentationService — business layer for the docs feature, composing the
 * Docspage (doc landing pages), Documentation (public docs) and Internaldoc
 * (internal docs) DAOs (controller -> service -> dao).
 */
const DocumentationService = {
  // ── Docspage ──────────────────────────────────────────────────────────────
  upsertDocspageByCategory(category: string, fields: UpdateQuery<IDocspage>) {
    return DocspageDAO.upsertByCategory(category, fields);
  },

  getDocspageByCategory(category: string) {
    return DocspageDAO.getByCategory(category);
  },

  // ── Documentation ─────────────────────────────────────────────────────────
  getAllDocumentations() {
    return DocumentationDAO.findAllTitleCategory();
  },

  getDocumentationById(docId: string) {
    return DocumentationDAO.getById(docId);
  },

  createDocumentation(fields: Partial<IDocumentation>) {
    return DocumentationDAO.create(fields);
  },

  updateDocumentationById(docId: string, fields: UpdateQuery<IDocumentation>) {
    return DocumentationDAO.updateById(docId, fields);
  },

  deleteDocumentationById(docId: string) {
    return DocumentationDAO.deleteById(docId);
  },

  // ── Internaldoc ───────────────────────────────────────────────────────────
  getAllInternalDocumentations() {
    return InternaldocDAO.findAllTitleInternalCategory();
  },

  getInternalDocumentationById(docId: string) {
    return InternaldocDAO.getById(docId);
  },

  createInternalDocumentation(fields: Partial<IInternaldoc>) {
    return InternaldocDAO.create(fields);
  },

  updateInternalDocumentationById(
    docId: string,
    fields: UpdateQuery<IInternaldoc>
  ) {
    return InternaldocDAO.updateById(docId, fields);
  },

  deleteInternalDocumentationById(docId: string) {
    return InternaldocDAO.deleteById(docId);
  }
};

export = DocumentationService;
