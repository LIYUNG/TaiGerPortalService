// DAO-level integration test for ComplaintDAO against the in-memory MongoDB.
const { connect, clearDatabase } = require('../fixtures/db');
const { Complaint, User } = require('../../models');
const ComplaintDAO = require('../../dao/complaint.dao');
const { disconnectFromDatabase } = require('../../database');
const { TENANT_ID } = require('../fixtures/constants');
const { users, student } = require('../mock/user');

beforeAll(async () => {
  await connect();
});

afterAll(async () => {
  await disconnectFromDatabase(TENANT_ID);
  await clearDatabase();
});

beforeEach(async () => {
  await Complaint.deleteMany({});
  await User.deleteMany({});
  await User.insertMany(users);
});

const makeTicket = () => ({
  requester_id: student._id.toString(),
  title: 'Cannot upload file',
  description: 'The upload button is broken',
  status: 'open',
  messages: []
});

describe('ComplaintDAO (in-memory)', () => {
  it('createComplaint inserts and getComplaintsByRequester returns it', async () => {
    await ComplaintDAO.createComplaint(makeTicket());

    const tickets = await ComplaintDAO.getComplaintsByRequester(
      student._id.toString()
    );

    expect(tickets).toHaveLength(1);
    expect(tickets[0].requester_id.firstname).toBe(student.firstname);
  });

  it('getComplaints applies the status filter', async () => {
    await ComplaintDAO.createComplaint(makeTicket());
    await ComplaintDAO.createComplaint({ ...makeTicket(), status: 'resolved' });

    const open = await ComplaintDAO.getComplaints({ status: 'open' });
    const resolved = await ComplaintDAO.getComplaints({ status: 'resolved' });

    expect(open).toHaveLength(1);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].status).toBe('resolved');
  });

  it('getComplaintDocById returns a live document that can be mutated and saved', async () => {
    const created = await ComplaintDAO.createComplaint(makeTicket());

    const doc = await ComplaintDAO.getComplaintDocById(created._id);
    doc.messages.push({ user_id: student._id.toString(), message: 'hello' });
    await doc.save();

    const reloaded = await ComplaintDAO.getComplaintByIdWithMessages(
      created._id
    );
    expect(reloaded.messages).toHaveLength(1);
  });

  it('updateComplaintById applies the update and populates the requester', async () => {
    const created = await ComplaintDAO.createComplaint(makeTicket());

    const updated = await ComplaintDAO.updateComplaintById(created._id, {
      status: 'resolved'
    });

    expect(updated.status).toBe('resolved');
    expect(updated.requester_id.firstname).toBe(student.firstname);
  });

  it('deleteComplaintById removes the record', async () => {
    const created = await ComplaintDAO.createComplaint(makeTicket());

    await ComplaintDAO.deleteComplaintById(created._id);

    expect(await Complaint.countDocuments({})).toBe(0);
  });
});
