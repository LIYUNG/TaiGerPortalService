// EventService is a thin business layer over EventDAO. This is a UNIT test: the
// DAO is mocked so no database (in-memory or otherwise) is touched. Every method
// delegates verbatim, so we assert the DAO is called with the exact args and the
// service returns the DAO result.
jest.mock('../../dao/event.dao');

import EventDAOReal from '../../dao/event.dao';
import EventService from '../../services/events';

const EventDAO = EventDAOReal as unknown as Record<string, jest.Mock>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('EventService (mocked DAO)', () => {
  it('findEvents delegates to DAO with filter and options', async () => {
    const filter = { isConfirmedReceiver: true };
    const options = { sort: { start: 1 } };
    const daoResult = [{ _id: 'e1' }];
    EventDAO.findEvents.mockResolvedValue(daoResult);

    const result = await EventService.findEvents(filter, options as any);

    expect(EventDAO.findEvents).toHaveBeenCalledTimes(1);
    expect(EventDAO.findEvents).toHaveBeenCalledWith(filter, options);
    expect(result).toBe(daoResult);
  });

  it('getEventById delegates to DAO with eventId', async () => {
    const daoResult = { _id: 'e1' };
    EventDAO.getEventById.mockResolvedValue(daoResult);

    const result = await EventService.getEventById('e1');

    expect(EventDAO.getEventById).toHaveBeenCalledTimes(1);
    expect(EventDAO.getEventById).toHaveBeenCalledWith('e1');
    expect(result).toBe(daoResult);
  });

  it('getEventByIdLean delegates to DAO with eventId', async () => {
    const daoResult = { _id: 'e1' };
    EventDAO.getEventByIdLean.mockResolvedValue(daoResult);

    const result = await EventService.getEventByIdLean('e1');

    expect(EventDAO.getEventByIdLean).toHaveBeenCalledTimes(1);
    expect(EventDAO.getEventByIdLean).toHaveBeenCalledWith('e1');
    expect(result).toBe(daoResult);
  });

  it('getEventByIdPopulated delegates to DAO with eventId and populateSelect', async () => {
    const populateSelect = 'firstname lastname';
    const daoResult = { _id: 'e1' };
    EventDAO.getEventByIdPopulated.mockResolvedValue(daoResult);

    const result = await EventService.getEventByIdPopulated(
      'e1',
      populateSelect
    );

    expect(EventDAO.getEventByIdPopulated).toHaveBeenCalledTimes(1);
    expect(EventDAO.getEventByIdPopulated).toHaveBeenCalledWith(
      'e1',
      populateSelect
    );
    expect(result).toBe(daoResult);
  });

  it('createEvent delegates to DAO with payload', async () => {
    const payload = { title: 'Meeting' };
    const daoResult = { _id: 'e1', title: 'Meeting' };
    EventDAO.createEvent.mockResolvedValue(daoResult);

    const result = await EventService.createEvent(payload);

    expect(EventDAO.createEvent).toHaveBeenCalledTimes(1);
    expect(EventDAO.createEvent).toHaveBeenCalledWith(payload);
    expect(result).toBe(daoResult);
  });

  it('updateEventById delegates to DAO with eventId, payload, populateSelect', async () => {
    const payload = { title: 'Updated' };
    const populateSelect = 'firstname lastname';
    const daoResult = { _id: 'e1', title: 'Updated' };
    EventDAO.updateEventById.mockResolvedValue(daoResult);

    const result = await EventService.updateEventById(
      'e1',
      payload,
      populateSelect
    );

    expect(EventDAO.updateEventById).toHaveBeenCalledTimes(1);
    expect(EventDAO.updateEventById).toHaveBeenCalledWith(
      'e1',
      payload,
      populateSelect
    );
    expect(result).toBe(daoResult);
  });

  it('deleteEventById delegates to DAO with eventId', async () => {
    const daoResult = { deletedCount: 1 };
    EventDAO.deleteEventById.mockResolvedValue(daoResult);

    const result = await EventService.deleteEventById('e1');

    expect(EventDAO.deleteEventById).toHaveBeenCalledTimes(1);
    expect(EventDAO.deleteEventById).toHaveBeenCalledWith('e1');
    expect(result).toBe(daoResult);
  });

  it('updateEventRawById delegates to DAO with eventId and payload', async () => {
    const payload = { $set: { isConfirmedReceiver: true } };
    const daoResult = { acknowledged: true };
    EventDAO.updateEventRawById.mockResolvedValue(daoResult);

    const result = await EventService.updateEventRawById('e1', payload);

    expect(EventDAO.updateEventRawById).toHaveBeenCalledTimes(1);
    expect(EventDAO.updateEventRawById).toHaveBeenCalledWith('e1', payload);
    expect(result).toBe(daoResult);
  });

  it('deleteEventByIdPopulated delegates to DAO with eventId and populateSelect', async () => {
    const populateSelect = 'firstname lastname';
    const daoResult = { _id: 'e1' };
    EventDAO.deleteEventByIdPopulated.mockResolvedValue(daoResult);

    const result = await EventService.deleteEventByIdPopulated(
      'e1',
      populateSelect
    );

    expect(EventDAO.deleteEventByIdPopulated).toHaveBeenCalledTimes(1);
    expect(EventDAO.deleteEventByIdPopulated).toHaveBeenCalledWith(
      'e1',
      populateSelect
    );
    expect(result).toBe(daoResult);
  });

  it('getEventsPaginated delegates to DAO with the { filter, query } args', async () => {
    const args = { filter: { end: { $lt: new Date() } }, query: { page: '1' } };
    const daoResult = { events: [], total: 0, page: 1, limit: 20 };
    EventDAO.getEventsPaginated.mockResolvedValue(daoResult);

    const result = await EventService.getEventsPaginated(args);

    expect(EventDAO.getEventsPaginated).toHaveBeenCalledTimes(1);
    expect(EventDAO.getEventsPaginated).toHaveBeenCalledWith(args);
    expect(result).toBe(daoResult);
  });
});
