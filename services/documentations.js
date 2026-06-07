const DocspageDAO = require('../dao/docspage.dao');
const DocumentationDAO = require('../dao/documentation.dao');
const InternaldocDAO = require('../dao/internaldoc.dao');

/**
 * DocumentationService — business layer for the docs feature, composing the
 * Docspage (doc landing pages), Documentation (public docs) and Internaldoc
 * (internal docs) DAOs (controller -> service -> dao).
 */
const DocumentationService = {
  // ── Docspage ──────────────────────────────────────────────────────────────
  upsertDocspageByCategory(category, fields) {
    return DocspageDAO.upsertByCategory(category, fields);
  },

  getDocspageByCategory(category) {
    return DocspageDAO.getByCategory(category);
  },

  // ── Documentation ─────────────────────────────────────────────────────────
  getDocumentationsByCategory(category) {
    return DocumentationDAO.findByCategory(category);
  },

  getAllDocumentations() {
    return DocumentationDAO.findAllTitleCategory();
  },

  getDocumentationById(docId) {
    return DocumentationDAO.getById(docId);
  },

  createDocumentation(fields) {
    return DocumentationDAO.create(fields);
  },

  updateDocumentationById(docId, fields) {
    return DocumentationDAO.updateById(docId, fields);
  },

  deleteDocumentationById(docId) {
    return DocumentationDAO.deleteById(docId);
  },

  // ── Internaldoc ───────────────────────────────────────────────────────────
  getAllInternalDocumentations() {
    return InternaldocDAO.findAllTitleInternalCategory();
  },

  getInternalDocumentationById(docId) {
    return InternaldocDAO.getById(docId);
  },

  createInternalDocumentation(fields) {
    return InternaldocDAO.create(fields);
  },

  updateInternalDocumentationById(docId, fields) {
    return InternaldocDAO.updateById(docId, fields);
  },

  deleteInternalDocumentationById(docId) {
    return InternaldocDAO.deleteById(docId);
  }
};

module.exports = DocumentationService;
