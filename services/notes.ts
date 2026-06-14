import NoteDAO from '../dao/note.dao';

/**
 * NoteService — business layer for student notes. Delegates data access to the
 * DAO (controller -> service -> dao).
 */
const NoteService = {
  getNoteByStudentId(studentId) {
    return NoteDAO.getNoteByStudentId(studentId);
  },

  upsertNoteByStudentId(studentId, fields) {
    return NoteDAO.upsertNoteByStudentId(studentId, fields);
  }
};

module.exports = NoteService;
