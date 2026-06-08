// Controller UNIT test for controllers/notes.
//
// The controller handlers are plain (req, res, next) functions, so we call them
// DIRECTLY with fake req/res/next and a mocked service. No route, no middleware,
// no database here — only the controller's own responsibilities:
//   - what it pulls off req (params/body),
//   - the args it forwards to the service,
//   - the status + body it writes to res,
//   - that it forwards a service error to next().
// Route + middleware wiring is covered by __tests__/integration/notes.test.js.

jest.mock('../../services/notes');

const NoteService = require('../../services/notes');
const {
  getStudentNotes,
  updateStudentNotes
} = require('../../controllers/notes');
const { mockReq, mockRes } = require('../helpers/httpMocks');
const { student } = require('../mock/user');

const studentId = student._id.toString();

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getStudentNotes', () => {
  it('responds 200 with the note resolved by the service for req.params.student_id', async () => {
    const note = { _id: 'n1', student_id: studentId, notes: 'hello' };
    NoteService.getNoteByStudentId.mockResolvedValue(note);
    const req = mockReq({ params: { student_id: studentId } });
    const res = mockRes();

    await getStudentNotes(req, res, jest.fn());

    expect(NoteService.getNoteByStudentId).toHaveBeenCalledWith(studentId);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: note });
  });

  it("forwards a service error to next() (status mapping is the error middleware's job)", async () => {
    const err = new Error('db down');
    NoteService.getNoteByStudentId.mockRejectedValue(err);
    const next = jest.fn();

    await getStudentNotes(
      mockReq({ params: { student_id: studentId } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('updateStudentNotes', () => {
  it('upserts with the body merged with student_id and responds 200 with the result', async () => {
    const saved = { student_id: studentId, notes: 'updated' };
    NoteService.upsertNoteByStudentId.mockResolvedValue(saved);
    const req = mockReq({
      params: { student_id: studentId },
      body: { notes: 'updated' }
    });
    const res = mockRes();

    await updateStudentNotes(req, res, jest.fn());

    expect(NoteService.upsertNoteByStudentId).toHaveBeenCalledWith(
      studentId,
      expect.objectContaining({ notes: 'updated', student_id: studentId })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ success: true, data: saved });
  });
});
