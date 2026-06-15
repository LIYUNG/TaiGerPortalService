// ComplaintDAO unit tests — the DAO is a thin query-building layer over the
// Complaint Mongoose model, so we mock the model entirely (NO database).
// These assert that each DAO method builds the expected query/chain and
// forwards the model's result. Real query behaviour is covered by the
// integration suite.
jest.mock('../../models', () => {
  const model = () => ({
    find: jest.fn(),
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findByIdAndDelete: jest.fn(),
    create: jest.fn()
  });
  return {
    Complaint: model()
  };
});

import { Complaint } from '../../models';
import ComplaintDAO from '../../dao/complaint.dao';

// A query chain that is both chainable (populate/sort/select/limit/lean return
// the same chain) and thenable, so `await chain` (when no terminal .lean() is
// called) resolves to `value` too. Terminal `.lean()` also resolves to value.
const queryChain = (value) => {
  const chain = {
    populate: jest.fn(() => chain),
    sort: jest.fn(() => chain),
    select: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(value),
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject)
  };
  return chain;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ComplaintDAO (mocked models)', () => {
  it('getComplaintsByRequester filters by requester, populates and sorts desc', async () => {
    const docs = [{ _id: 't1' }];
    Complaint.find.mockReturnValue(queryChain(docs));

    const res = await ComplaintDAO.getComplaintsByRequester('u1');

    expect(Complaint.find).toHaveBeenCalledWith({ requester_id: 'u1' });
    const chain = Complaint.find.mock.results[0].value;
    expect(chain.populate).toHaveBeenCalledWith(
      'requester_id',
      'firstname lastname email pictureUrl'
    );
    expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(res).toBe(docs);
  });

  it('getComplaints forwards the query, populates and sorts desc', async () => {
    const docs = [{ status: 'open' }];
    Complaint.find.mockReturnValue(queryChain(docs));

    const res = await ComplaintDAO.getComplaints({ status: 'open' });

    expect(Complaint.find).toHaveBeenCalledWith({ status: 'open' });
    const chain = Complaint.find.mock.results[0].value;
    expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(res).toBe(docs);
  });

  it('findComplaintsSelect applies select + limit and returns the lean docs', async () => {
    const docs = [{ _id: 't1' }];
    Complaint.find.mockReturnValue(queryChain(docs));

    const res = await ComplaintDAO.findComplaintsSelect(
      { status: 'open' },
      'title description',
      5
    );

    expect(Complaint.find).toHaveBeenCalledWith({ status: 'open' });
    const chain = Complaint.find.mock.results[0].value;
    expect(chain.select).toHaveBeenCalledWith('title description');
    expect(chain.limit).toHaveBeenCalledWith(5);
    expect(chain.lean).toHaveBeenCalled();
    expect(res).toBe(docs);
  });

  it('getComplaintByIdPopulated finds by id and populates messages + requester', async () => {
    const doc = { _id: 't1' };
    Complaint.findById.mockReturnValue(queryChain(doc));

    const res = await ComplaintDAO.getComplaintByIdPopulated('t1');

    expect(Complaint.findById).toHaveBeenCalledWith('t1');
    const chain = Complaint.findById.mock.results[0].value;
    expect(chain.populate).toHaveBeenCalledWith(
      'messages.user_id',
      'firstname lastname email pictureUrl'
    );
    expect(chain.populate).toHaveBeenCalledWith(
      'requester_id',
      'firstname lastname email pictureUrl'
    );
    expect(res).toBe(doc);
  });

  it('createComplaint delegates to Complaint.create and returns the doc', async () => {
    const ticket = { title: 'x' };
    const created = { _id: 't1', ...ticket };
    Complaint.create.mockResolvedValue(created);

    const res = await ComplaintDAO.createComplaint(ticket);

    expect(Complaint.create).toHaveBeenCalledWith(ticket);
    expect(res).toBe(created);
  });

  it('getComplaintDocByIdWithRequester finds by id and populates requester', async () => {
    const doc = { _id: 't1' };
    Complaint.findById.mockReturnValue(queryChain(doc));

    const res = await ComplaintDAO.getComplaintDocByIdWithRequester('t1');

    expect(Complaint.findById).toHaveBeenCalledWith('t1');
    const chain = Complaint.findById.mock.results[0].value;
    expect(chain.populate).toHaveBeenCalledWith('requester_id');
    expect(res).toBe(doc);
  });

  it('getComplaintByIdWithMessages finds by id and populates requester + messages', async () => {
    const doc = { _id: 't1' };
    Complaint.findById.mockReturnValue(queryChain(doc));

    const res = await ComplaintDAO.getComplaintByIdWithMessages('t1');

    expect(Complaint.findById).toHaveBeenCalledWith('t1');
    const chain = Complaint.findById.mock.results[0].value;
    expect(chain.populate).toHaveBeenCalledWith(
      'requester_id messages.user_id'
    );
    expect(res).toBe(doc);
  });

  it('updateComplaintById updates with { new: true } and populates the requester', async () => {
    const updated = { _id: 't1', status: 'resolved' };
    Complaint.findByIdAndUpdate.mockReturnValue(queryChain(updated));

    const res = await ComplaintDAO.updateComplaintById('t1', {
      status: 'resolved'
    });

    expect(Complaint.findByIdAndUpdate).toHaveBeenCalledWith(
      't1',
      { status: 'resolved' },
      { new: true }
    );
    const chain = Complaint.findByIdAndUpdate.mock.results[0].value;
    expect(chain.populate).toHaveBeenCalledWith(
      'requester_id',
      'firstname lastname email archiv pictureUrl'
    );
    expect(res).toBe(updated);
  });

  it('getComplaintDocById finds by id and returns the live doc', async () => {
    const doc = { _id: 't1' };
    Complaint.findById.mockReturnValue(doc);

    const res = await ComplaintDAO.getComplaintDocById('t1');

    expect(Complaint.findById).toHaveBeenCalledWith('t1');
    expect(res).toBe(doc);
  });

  it('updateComplaintRaw updates with { upsert: false }', async () => {
    const updated = { _id: 't1' };
    Complaint.findByIdAndUpdate.mockResolvedValue(updated);

    const res = await ComplaintDAO.updateComplaintRaw('t1', { read: true });

    expect(Complaint.findByIdAndUpdate).toHaveBeenCalledWith(
      't1',
      { read: true },
      { upsert: false }
    );
    expect(res).toBe(updated);
  });

  it('pullMessageById issues a $pull on the message id', async () => {
    const updated = { _id: 't1' };
    Complaint.findByIdAndUpdate.mockResolvedValue(updated);

    const res = await ComplaintDAO.pullMessageById('t1', 'm1');

    expect(Complaint.findByIdAndUpdate).toHaveBeenCalledWith('t1', {
      $pull: { messages: { _id: 'm1' } }
    });
    expect(res).toBe(updated);
  });

  it('deleteComplaintById deletes by id and returns the result', async () => {
    const deleted = { _id: 't1' };
    Complaint.findByIdAndDelete.mockResolvedValue(deleted);

    const res = await ComplaintDAO.deleteComplaintById('t1');

    expect(Complaint.findByIdAndDelete).toHaveBeenCalledWith('t1');
    expect(res).toBe(deleted);
  });
});
