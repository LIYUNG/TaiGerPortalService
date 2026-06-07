const mongoose = require('mongoose');
const { connect, clearDatabase } = require('../fixtures/db');
const { Interview } = require('../../models');
const InterviewDAO = require('../../dao/interview.dao');
const { disconnectFromDatabase } = require('../../database');
const { TENANT_ID } = require('../fixtures/constants');

beforeAll(async () => {
  await connect();
});

afterAll(async () => {
  await disconnectFromDatabase(TENANT_ID);
  await clearDatabase();
});

beforeEach(async () => {
  await Interview.deleteMany({});
});

describe('InterviewDAO (in-memory)', () => {
  it("getInterviewsByStudentId returns that student's interviews", async () => {
    const studentA = new mongoose.Types.ObjectId();
    // Unique index on (student_id, program_id, thread_id) — give each a
    // distinct program_id so inserts don't collide.
    await Interview.create([
      {
        student_id: studentA,
        program_id: new mongoose.Types.ObjectId(),
        interview_description: 'a'
      },
      {
        student_id: studentA,
        program_id: new mongoose.Types.ObjectId(),
        interview_description: 'b'
      },
      {
        student_id: new mongoose.Types.ObjectId(),
        program_id: new mongoose.Types.ObjectId(),
        interview_description: 'c'
      }
    ]);

    const res = await InterviewDAO.getInterviewsByStudentId(studentA);

    expect(res).toHaveLength(2);
  });

  it('getInterviews returns docs matching the filter', async () => {
    await Interview.create([
      {
        isClosed: true,
        program_id: new mongoose.Types.ObjectId(),
        interview_description: 'closed'
      },
      {
        isClosed: false,
        program_id: new mongoose.Types.ObjectId(),
        interview_description: 'open'
      }
    ]);

    const res = await InterviewDAO.getInterviews({ isClosed: true });

    expect(res).toHaveLength(1);
    expect(res[0].interview_description).toBe('closed');
  });

  it('getInterviewById returns the document', async () => {
    const created = await Interview.create({
      program_id: new mongoose.Types.ObjectId(),
      interview_description: 'x'
    });

    const found = await InterviewDAO.getInterviewById(created._id);

    expect(found._id.toString()).toBe(created._id.toString());
  });
});
