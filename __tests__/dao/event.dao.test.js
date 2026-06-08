// EventDAO unit tests — the DAO is a thin query-building layer over the Mongoose
// model, so we mock the model entirely (NO database). These assert that each DAO
// method builds the expected query/chain and forwards the model's result.
jest.mock('../../models', () => {
  const model = () => ({
    find: jest.fn(),
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findByIdAndDelete: jest.fn(),
    create: jest.fn()
  });
  return {
    Event: model()
  };
});

const { Event } = require('../../models');
const EventDAO = require('../../dao/event.dao');

// A query chain that is BOTH chainable AND thenable: builder calls
// (populate/select/sort/...) return the same chain so they compose, the terminal
// `.lean()` resolves to `value`, and awaiting the chain directly (no `.lean()`)
// also resolves to `value` via `then`.
const queryChain = (value) => {
  const chain = {
    select: jest.fn(() => chain),
    sort: jest.fn(() => chain),
    skip: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    populate: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(value),
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject)
  };
  return chain;
};

const TEAM_POPULATE_PATH = 'receiver_id requester_id';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('EventDAO (mocked models)', () => {
  it('findEvents forwards the filter and returns the lean docs (no options)', async () => {
    const docs = [{ _id: 'e1' }];
    Event.find.mockReturnValue(queryChain(docs));

    const result = await EventDAO.findEvents({ isConfirmedReceiver: true });

    expect(Event.find).toHaveBeenCalledWith({ isConfirmedReceiver: true });
    expect(result).toBe(docs);
  });

  it('findEvents applies populate and select when provided', async () => {
    const docs = [{ _id: 'e2' }];
    const chain = queryChain(docs);
    Event.find.mockReturnValue(chain);

    const result = await EventDAO.findEvents(
      { foo: 'bar' },
      {
        populate: { path: 'receiver_id', select: 'firstname' },
        select: 'title'
      }
    );

    expect(Event.find).toHaveBeenCalledWith({ foo: 'bar' });
    expect(chain.populate).toHaveBeenCalledWith('receiver_id', 'firstname');
    expect(chain.select).toHaveBeenCalledWith('title');
    expect(result).toBe(docs);
  });

  it('getEventById queries by id and returns the doc', async () => {
    const doc = { _id: 'e3' };
    Event.findById.mockReturnValue(queryChain(doc));

    const result = await EventDAO.getEventById('e3');

    expect(Event.findById).toHaveBeenCalledWith('e3');
    expect(result).toBe(doc);
  });

  it('getEventByIdLean queries by id and returns the lean doc', async () => {
    const doc = { _id: 'e4' };
    const chain = queryChain(doc);
    Event.findById.mockReturnValue(chain);

    const result = await EventDAO.getEventByIdLean('e4');

    expect(Event.findById).toHaveBeenCalledWith('e4');
    expect(chain.lean).toHaveBeenCalled();
    expect(result).toBe(doc);
  });

  it('getEventByIdPopulated populates the team path and returns the lean doc', async () => {
    const doc = { _id: 'e5' };
    const chain = queryChain(doc);
    Event.findById.mockReturnValue(chain);

    const result = await EventDAO.getEventByIdPopulated('e5', 'firstname');

    expect(Event.findById).toHaveBeenCalledWith('e5');
    expect(chain.populate).toHaveBeenCalledWith(
      TEAM_POPULATE_PATH,
      'firstname'
    );
    expect(result).toBe(doc);
  });

  it('createEvent forwards the payload and returns the created doc', async () => {
    const created = { _id: 'e6' };
    Event.create.mockResolvedValue(created);

    const payload = { title: 'Meeting' };
    const result = await EventDAO.createEvent(payload);

    expect(Event.create).toHaveBeenCalledWith(payload);
    expect(result).toBe(created);
  });

  it('updateEventById updates with { upsert:false, new:true }, populates, and returns the lean doc', async () => {
    const updated = { _id: 'e7' };
    const chain = queryChain(updated);
    Event.findByIdAndUpdate.mockReturnValue(chain);

    const payload = { title: 'Renamed' };
    const result = await EventDAO.updateEventById('e7', payload, 'firstname');

    expect(Event.findByIdAndUpdate).toHaveBeenCalledWith('e7', payload, {
      upsert: false,
      new: true
    });
    expect(chain.populate).toHaveBeenCalledWith(
      TEAM_POPULATE_PATH,
      'firstname'
    );
    expect(result).toBe(updated);
  });

  it('deleteEventById deletes by id and returns the deleted doc', async () => {
    const deleted = { _id: 'e8' };
    Event.findByIdAndDelete.mockResolvedValue(deleted);

    const result = await EventDAO.deleteEventById('e8');

    expect(Event.findByIdAndDelete).toHaveBeenCalledWith('e8');
    expect(result).toBe(deleted);
  });

  it('updateEventRawById updates with empty options and returns the result', async () => {
    const prev = { _id: 'e9' };
    Event.findByIdAndUpdate.mockResolvedValue(prev);

    const payload = { status: 'done' };
    const result = await EventDAO.updateEventRawById('e9', payload);

    expect(Event.findByIdAndUpdate).toHaveBeenCalledWith('e9', payload, {});
    expect(result).toBe(prev);
  });

  it('deleteEventByIdPopulated deletes, populates, and returns the lean doc', async () => {
    const deleted = { _id: 'e10' };
    const chain = queryChain(deleted);
    Event.findByIdAndDelete.mockReturnValue(chain);

    const result = await EventDAO.deleteEventByIdPopulated('e10', 'firstname');

    expect(Event.findByIdAndDelete).toHaveBeenCalledWith('e10');
    expect(chain.populate).toHaveBeenCalledWith(
      TEAM_POPULATE_PATH,
      'firstname'
    );
    expect(result).toBe(deleted);
  });
});
