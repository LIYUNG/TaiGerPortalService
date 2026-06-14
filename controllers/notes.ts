import { asyncHandler } from '../middlewares/error-handler';
import NoteService from '../services/notes';

const getStudentNotes = asyncHandler(async (req, res) => {
  const { student_id } = req.params;
  const notes = await NoteService.getNoteByStudentId(student_id);
  res.status(200).send({ success: true, data: notes });
});

const updateStudentNotes = asyncHandler(async (req, res) => {
  const fields = req.body;
  fields.student_id = req.params.student_id;
  const users = await NoteService.upsertNoteByStudentId(
    req.params.student_id,
    fields
  );
  res.status(200).send({ success: true, data: users });
});

export = {
  getStudentNotes,
  updateStudentNotes
};
