// DAO-level integration test for NoteDAO against the in-memory MongoDB.
const { connect, clearDatabase } = require('../fixtures/db');
const { Note } = require('../../models');
const NoteDAO = require('../../dao/note.dao');
const { disconnectFromDatabase } = require('../../database');
const { TENANT_ID } = require('../fixtures/constants');
const { student } = require('../mock/user');
const { generateNote } = require('../mock/notes');

beforeAll(async () => {
  await connect();
});

afterAll(async () => {
  await disconnectFromDatabase(TENANT_ID);
  await clearDatabase();
});

beforeEach(async () => {
  await Note.deleteMany({});
});

describe('NoteDAO (in-memory)', () => {
  it('getNoteByStudentId returns null when no note exists', async () => {
    const note = await NoteDAO.getNoteByStudentId(student._id.toString());
    expect(note).toBeNull();
  });

  it('upsertNoteByStudentId creates a note when none exists', async () => {
    const created = await NoteDAO.upsertNoteByStudentId(
      student._id.toString(),
      { notes: 'first note' }
    );

    expect(created).toBeTruthy();
    expect(created.notes).toBe('first note');
    expect(created.student_id.toString()).toBe(student._id.toString());
    expect(await Note.countDocuments({})).toBe(1);
  });

  it('upsertNoteByStudentId updates the existing note in place', async () => {
    await Note.create(generateNote(student._id.toString()));

    const updated = await NoteDAO.upsertNoteByStudentId(
      student._id.toString(),
      { notes: 'updated note' }
    );

    expect(updated.notes).toBe('updated note');
    // Still exactly one note for the student (upsert did not duplicate).
    expect(await Note.countDocuments({})).toBe(1);
  });

  it('getNoteByStudentId returns the stored note', async () => {
    await Note.create(generateNote(student._id.toString()));

    const note = await NoteDAO.getNoteByStudentId(student._id.toString());

    expect(note).toBeTruthy();
    expect(note.student_id.toString()).toBe(student._id.toString());
  });
});
