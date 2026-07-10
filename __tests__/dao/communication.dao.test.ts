// CommunicationDAO unit tests — the DAO is a thin query-building layer over the
// Communication model, so we mock the model entirely (NO database, in-memory or
// otherwise). These assert that each DAO method builds the expected query and
// forwards the model's result. Real query behaviour is covered by the
// integration suite (__tests__/integration).
jest.mock('../../models', () => {
  const model = () => ({
    find: jest.fn(),
    findById: jest.fn(),
    findOne: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findByIdAndDelete: jest.fn(),
    countDocuments: jest.fn(),
    create: jest.fn()
  });
  return {
    Communication: model()
  };
});

import { Communication as CommunicationModel } from '../../models';
import CommunicationDAO from '../../dao/communication.dao';

// The model is auto-mocked above (every method is a jest.fn()); retype it so
// the mock API (mockReturnValue/…) is visible to the type-checker.
const Communication = CommunicationModel as unknown as Record<
  string,
  jest.Mock
>;

// A query chain whose terminal `.lean()` resolves to `value`. Intermediate
// builder calls (populate/sort/skip/limit) return the same chain so they
// compose.
const leanChain = (value: unknown): any => {
  const chain: any = {
    populate: jest.fn(() => chain),
    select: jest.fn(() => chain),
    sort: jest.fn(() => chain),
    skip: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(value)
  };
  return chain;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('CommunicationDAO (mocked models)', () => {
  it('getCommunications forwards the query to find().populate().lean()', async () => {
    const docs = [{ _id: 'm1' }, { _id: 'm2' }];
    Communication.find.mockReturnValue(leanChain(docs));

    const query = { student_id: 's1' };
    const result = await CommunicationDAO.getCommunications(query);

    expect(Communication.find).toHaveBeenCalledWith(query);
    expect(result).toBe(docs);
  });

  it('getCommunicationById queries by id, populates and returns the lean doc', async () => {
    const doc = { _id: 'm1', message: 'hello' };
    Communication.findById.mockReturnValue(leanChain(doc));

    const found = await CommunicationDAO.getCommunicationById('m1');

    expect(Communication.findById).toHaveBeenCalledWith('m1');
    expect(found).toBe(doc);
  });

  it('updateCommunication uses findByIdAndUpdate with { new: true } and returns the lean doc', async () => {
    const updated = { _id: 'm1', message: 'after' };
    Communication.findByIdAndUpdate.mockReturnValue(leanChain(updated));

    const payload = { message: 'after' };
    const result = await CommunicationDAO.updateCommunication('m1', payload);

    expect(Communication.findByIdAndUpdate).toHaveBeenCalledWith(
      'm1',
      payload,
      {
        new: true
      }
    );
    expect(result).toBe(updated);
  });

  it('getCommunicationByStudentId queries by studentId and returns lean docs', async () => {
    const docs = [{ _id: 'm1' }];
    const chain = leanChain(docs);
    Communication.find.mockReturnValue(chain);

    const result = await CommunicationDAO.getCommunicationByStudentId('s1');

    expect(Communication.find).toHaveBeenCalledWith({ studentId: 's1' });
    expect(chain.populate).not.toHaveBeenCalled();
    expect(result).toBe(docs);
  });

  it('findPopulatedSorted applies sort + limit (defaults sort to newest-first)', async () => {
    const docs = [{ _id: 'm1' }];
    const chain = leanChain(docs);
    Communication.find.mockReturnValue(chain);

    const filter = { student_id: 's1' };
    const result = await CommunicationDAO.findPopulatedSorted(filter, {
      limit: 5
    });

    expect(Communication.find).toHaveBeenCalledWith(filter);
    expect(chain.populate).toHaveBeenCalledWith(
      'user_id',
      'firstname lastname role'
    );
    expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(chain.limit).toHaveBeenCalledWith(5);
    expect(result).toBe(docs);
  });

  it('findPopulatedSorted honours a caller-supplied sort and omitted options', async () => {
    const chain = leanChain([]);
    Communication.find.mockReturnValue(chain);

    await CommunicationDAO.findPopulatedSorted(
      { x: 1 },
      { sort: { createdAt: 1 } }
    );

    expect(chain.sort).toHaveBeenCalledWith({ createdAt: 1 });
    expect(chain.limit).toHaveBeenCalledWith(undefined);
  });

  it('findPopulatedSorted defaults the entire options object', async () => {
    const chain = leanChain([]);
    Communication.find.mockReturnValue(chain);

    await CommunicationDAO.findPopulatedSorted({ x: 1 });

    expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(chain.limit).toHaveBeenCalledWith(undefined);
  });

  it('getAllForIntervalGrouping populates student + author and returns lean docs', async () => {
    const docs = [{ _id: 'm1' }];
    const chain = leanChain(docs);
    Communication.find.mockReturnValue(chain);

    const result = await CommunicationDAO.getAllForIntervalGrouping();

    expect(Communication.find).toHaveBeenCalledWith();
    expect(chain.populate).toHaveBeenCalledWith(
      'student_id user_id',
      'firstname lastname email archiv'
    );
    expect(result).toBe(docs);
  });

  it('getByStudentIdForExport queries by student_id, populates and returns lean', async () => {
    const docs = [{ _id: 'm1' }];
    const chain = leanChain(docs);
    Communication.find.mockReturnValue(chain);

    const result = await CommunicationDAO.getByStudentIdForExport('s1');

    expect(Communication.find).toHaveBeenCalledWith({ student_id: 's1' });
    expect(chain.populate).toHaveBeenCalledWith(
      'student_id user_id',
      'firstname lastname firstname_chinese lastname_chinese role agents editors'
    );
    expect(result).toBe(docs);
  });

  it('getRecentByStudentId sorts newest-first, limits and returns lean', async () => {
    const docs = [{ _id: 'm1' }];
    const chain = leanChain(docs);
    Communication.find.mockReturnValue(chain);

    const result = await CommunicationDAO.getRecentByStudentId('s1', 10);

    expect(Communication.find).toHaveBeenCalledWith({ student_id: 's1' });
    expect(chain.populate).toHaveBeenCalledWith(
      'student_id user_id',
      'firstname lastname role'
    );
    expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(chain.limit).toHaveBeenCalledWith(10);
    expect(result).toBe(docs);
  });

  it('createCommunication forwards the payload to create', async () => {
    const created = { _id: 'm1' };
    Communication.create.mockResolvedValue(created);

    const result = await CommunicationDAO.createCommunication({
      message: 'hi'
    });

    expect(Communication.create).toHaveBeenCalledWith({ message: 'hi' });
    expect(result).toBe(created);
  });

  it('deleteById forwards the id to findByIdAndDelete', async () => {
    const deleted = { _id: 'm1' };
    Communication.findByIdAndDelete.mockResolvedValue(deleted);

    const result = await CommunicationDAO.deleteById('m1');

    expect(Communication.findByIdAndDelete).toHaveBeenCalledWith('m1');
    expect(result).toBe(deleted);
  });

  it('getLatestByStudentId returns the newest message (lean)', async () => {
    const doc = { _id: 'm1' };
    const chain = leanChain(doc);
    Communication.findOne.mockReturnValue(chain);

    const result = await CommunicationDAO.getLatestByStudentId('s1');

    expect(Communication.findOne).toHaveBeenCalledWith({ student_id: 's1' });
    expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(result).toBe(doc);
  });

  it('findThreadPopulated returns the live query by default (no lean, no skip/limit)', async () => {
    const chain = leanChain([{ _id: 'm1' }]);
    Communication.find.mockReturnValue(chain);

    const result = await CommunicationDAO.findThreadPopulated('s1', {
      populate: 'user_id',
      select: 'firstname'
    });

    expect(Communication.find).toHaveBeenCalledWith({ student_id: 's1' });
    expect(chain.populate).toHaveBeenCalledWith('user_id', 'firstname');
    expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(chain.skip).not.toHaveBeenCalled();
    expect(chain.limit).not.toHaveBeenCalled();
    expect(chain.lean).not.toHaveBeenCalled();
    // Live (non-lean) query is returned as-is.
    expect(result).toBe(chain);
  });

  it('findThreadPopulated applies skip + limit and returns lean when requested', async () => {
    const docs = [{ _id: 'm1' }];
    const chain = leanChain(docs);
    Communication.find.mockReturnValue(chain);

    const result = await CommunicationDAO.findThreadPopulated('s1', {
      populate: 'user_id',
      select: 'firstname',
      skip: 10,
      limit: 5,
      lean: true
    });

    expect(chain.skip).toHaveBeenCalledWith(10);
    expect(chain.limit).toHaveBeenCalledWith(5);
    expect(chain.lean).toHaveBeenCalled();
    expect(result).toBe(docs);
  });

  it('findThreadPopulated defaults the options object', async () => {
    const chain = leanChain([]);
    Communication.find.mockReturnValue(chain);

    const result = await CommunicationDAO.findThreadPopulated('s1');

    expect(Communication.find).toHaveBeenCalledWith({ student_id: 's1' });
    expect(chain.populate).toHaveBeenCalledWith(undefined, undefined);
    expect(chain.skip).not.toHaveBeenCalled();
    expect(chain.limit).not.toHaveBeenCalled();
    expect(result).toBe(chain);
  });

  it('searchThread builds a scoped case-insensitive regex query, newest-first, with a total count', async () => {
    const messages = [{ _id: 'm2' }, { _id: 'm1' }];
    const chain = leanChain(messages);
    Communication.find.mockReturnValue(chain);
    Communication.countDocuments.mockResolvedValue(2);

    const result = await CommunicationDAO.searchThread('s1', 'ielts');

    const filter = Communication.find.mock.calls[0][0];
    expect(filter.student_id).toBe('s1');
    expect(filter.message).toEqual({ $regex: 'ielts', $options: 'i' });
    expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(chain.limit).toHaveBeenCalledWith(50);
    expect(Communication.countDocuments).toHaveBeenCalledWith(filter);
    expect(result).toEqual({ messages, total: 2 });
  });

  it('searchThread escapes regex metacharacters in the query', async () => {
    Communication.find.mockReturnValue(leanChain([]));
    Communication.countDocuments.mockResolvedValue(0);

    await CommunicationDAO.searchThread('s1', 'C++ (a)');

    expect(Communication.find.mock.calls[0][0].message.$regex).toBe(
      'C\\+\\+ \\(a\\)'
    );
  });

  it('getThreadContext returns null when the message is not in the student thread', async () => {
    Communication.findOne.mockReturnValue(leanChain(null));

    const result = await CommunicationDAO.getThreadContext('s1', 'missing');

    expect(Communication.findOne).toHaveBeenCalledWith({
      _id: 'missing',
      student_id: 's1'
    });
    expect(result).toBeNull();
  });

  it('getThreadContext returns older + target + newer in oldest-first order with hasMore flags', async () => {
    const target = { _id: 't', createdAt: new Date('2024-06-15') };
    Communication.findOne.mockReturnValue(leanChain(target));
    // First find() call = older (desc), second = newer (asc).
    const olderDesc = [
      { _id: 'o2', createdAt: new Date('2024-06-14') },
      { _id: 'o1', createdAt: new Date('2024-06-13') }
    ];
    const newerAsc = [{ _id: 'n1', createdAt: new Date('2024-06-16') }];
    Communication.find
      .mockReturnValueOnce(leanChain(olderDesc))
      .mockReturnValueOnce(leanChain(newerAsc));

    const result = await CommunicationDAO.getThreadContext('s1', 't', {
      before: 2,
      after: 2
    });

    // older reversed to ascending, then target, then newer ascending
    expect(result!.messages.map((m) => m._id)).toEqual(['o1', 'o2', 't', 'n1']);
    // olderDesc filled the `before` limit (2) -> hasOlder; newer did not -> false
    expect(result!.hasOlder).toBe(true);
    expect(result!.hasNewer).toBe(false);
    expect(result!.targetId).toBe('t');
  });

  it('getAdjacentMessages (before) returns older messages oldest-first with hasMore', async () => {
    const anchor = { createdAt: new Date('2024-06-15') };
    Communication.findOne.mockReturnValue(leanChain(anchor));
    const olderDesc = [
      { _id: 'o2', createdAt: new Date('2024-06-14') },
      { _id: 'o1', createdAt: new Date('2024-06-13') }
    ];
    Communication.find.mockReturnValue(leanChain(olderDesc));

    const result = await CommunicationDAO.getAdjacentMessages(
      's1',
      'cursor',
      'before',
      2
    );

    const filter = Communication.find.mock.calls[0][0];
    expect(filter.student_id).toBe('s1');
    expect(filter.createdAt).toEqual({ $lt: anchor.createdAt });
    // reversed to ascending (oldest-first) for prepending
    expect(result.messages.map((m) => m._id)).toEqual(['o1', 'o2']);
    expect(result.hasMore).toBe(true);
  });

  it('getAdjacentMessages (after) returns newer messages oldest-first; hasMore false when under limit', async () => {
    Communication.findOne.mockReturnValue(
      leanChain({ createdAt: new Date('2024-06-15') })
    );
    const newerAsc = [{ _id: 'n1', createdAt: new Date('2024-06-16') }];
    Communication.find.mockReturnValue(leanChain(newerAsc));

    const result = await CommunicationDAO.getAdjacentMessages(
      's1',
      'cursor',
      'after',
      15
    );

    expect(Communication.find.mock.calls[0][0].createdAt).toEqual({
      $gt: expect.any(Date)
    });
    expect(result.messages.map((m) => m._id)).toEqual(['n1']);
    expect(result.hasMore).toBe(false);
  });

  it('getAdjacentMessages returns empty when the cursor message is missing', async () => {
    Communication.findOne.mockReturnValue(leanChain(null));

    const result = await CommunicationDAO.getAdjacentMessages(
      's1',
      'missing',
      'before'
    );

    expect(result).toEqual({ messages: [], hasMore: false });
    expect(Communication.find).not.toHaveBeenCalled();
  });
});
