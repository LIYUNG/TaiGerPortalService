// ComplaintService is a thin business layer over ComplaintDAO. This is a UNIT
// test: the DAO is mocked so no database (in-memory or otherwise) is touched.
// Every service method delegates verbatim to its DAO counterpart, so we assert
// the DAO is called with the exact args and the service returns the DAO result.
jest.mock('../../dao/complaint.dao');

import ComplaintDAOReal from '../../dao/complaint.dao';
import ComplaintService from '../../services/complaints';

const ComplaintDAO = ComplaintDAOReal as unknown as Record<string, jest.Mock>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ComplaintService (mocked DAO)', () => {
  it('getComplaintsByRequester delegates to DAO with requesterId', async () => {
    const daoResult = [{ _id: 't1' }];
    ComplaintDAO.getComplaintsByRequester.mockResolvedValue(daoResult);

    const result = await ComplaintService.getComplaintsByRequester('req1');

    expect(ComplaintDAO.getComplaintsByRequester).toHaveBeenCalledTimes(1);
    expect(ComplaintDAO.getComplaintsByRequester).toHaveBeenCalledWith('req1');
    expect(result).toBe(daoResult);
  });

  it('getComplaints delegates to DAO with query', async () => {
    const query = { status: 'open' };
    const daoResult = [{ _id: 't1' }, { _id: 't2' }];
    ComplaintDAO.getComplaints.mockResolvedValue(daoResult);

    const result = await ComplaintService.getComplaints(query);

    expect(ComplaintDAO.getComplaints).toHaveBeenCalledTimes(1);
    expect(ComplaintDAO.getComplaints).toHaveBeenCalledWith(query);
    expect(result).toBe(daoResult);
  });

  it('findComplaintsSelect delegates to DAO with filter, select, limit', async () => {
    const filter = { requester: 'req1' };
    const daoResult = [{ _id: 't1' }];
    ComplaintDAO.findComplaintsSelect.mockResolvedValue(daoResult);

    const result = await ComplaintService.findComplaintsSelect(
      filter,
      'subject status',
      10
    );

    expect(ComplaintDAO.findComplaintsSelect).toHaveBeenCalledTimes(1);
    expect(ComplaintDAO.findComplaintsSelect).toHaveBeenCalledWith(
      filter,
      'subject status',
      10
    );
    expect(result).toBe(daoResult);
  });

  it('getComplaintByIdPopulated delegates to DAO with ticketId', async () => {
    const daoResult = { _id: 't1' };
    ComplaintDAO.getComplaintByIdPopulated.mockResolvedValue(daoResult);

    const result = await ComplaintService.getComplaintByIdPopulated('t1');

    expect(ComplaintDAO.getComplaintByIdPopulated).toHaveBeenCalledTimes(1);
    expect(ComplaintDAO.getComplaintByIdPopulated).toHaveBeenCalledWith('t1');
    expect(result).toBe(daoResult);
  });

  it('createComplaint delegates to DAO with ticket', async () => {
    const ticket = { subject: 'Help' };
    const daoResult = { _id: 't1', subject: 'Help' };
    ComplaintDAO.createComplaint.mockResolvedValue(daoResult);

    const result = await ComplaintService.createComplaint(ticket as any);

    expect(ComplaintDAO.createComplaint).toHaveBeenCalledTimes(1);
    expect(ComplaintDAO.createComplaint).toHaveBeenCalledWith(ticket);
    expect(result).toBe(daoResult);
  });

  it('getComplaintDocByIdWithRequester delegates to DAO with ticketId', async () => {
    const daoResult = { _id: 't1' };
    ComplaintDAO.getComplaintDocByIdWithRequester.mockResolvedValue(daoResult);

    const result = await ComplaintService.getComplaintDocByIdWithRequester(
      't1'
    );

    expect(ComplaintDAO.getComplaintDocByIdWithRequester).toHaveBeenCalledTimes(
      1
    );
    expect(ComplaintDAO.getComplaintDocByIdWithRequester).toHaveBeenCalledWith(
      't1'
    );
    expect(result).toBe(daoResult);
  });

  it('getComplaintByIdWithMessages delegates to DAO with ticketId', async () => {
    const daoResult = { _id: 't1', messages: [] };
    ComplaintDAO.getComplaintByIdWithMessages.mockResolvedValue(daoResult);

    const result = await ComplaintService.getComplaintByIdWithMessages('t1');

    expect(ComplaintDAO.getComplaintByIdWithMessages).toHaveBeenCalledTimes(1);
    expect(ComplaintDAO.getComplaintByIdWithMessages).toHaveBeenCalledWith(
      't1'
    );
    expect(result).toBe(daoResult);
  });

  it('updateComplaintById delegates to DAO with ticketId and fields', async () => {
    const fields = { status: 'closed' };
    const daoResult = { _id: 't1', status: 'closed' };
    ComplaintDAO.updateComplaintById.mockResolvedValue(daoResult);

    const result = await ComplaintService.updateComplaintById('t1', fields);

    expect(ComplaintDAO.updateComplaintById).toHaveBeenCalledTimes(1);
    expect(ComplaintDAO.updateComplaintById).toHaveBeenCalledWith('t1', fields);
    expect(result).toBe(daoResult);
  });

  it('getComplaintDocById delegates to DAO with ticketId', async () => {
    const daoResult = { _id: 't1' };
    ComplaintDAO.getComplaintDocById.mockResolvedValue(daoResult);

    const result = await ComplaintService.getComplaintDocById('t1');

    expect(ComplaintDAO.getComplaintDocById).toHaveBeenCalledTimes(1);
    expect(ComplaintDAO.getComplaintDocById).toHaveBeenCalledWith('t1');
    expect(result).toBe(daoResult);
  });

  it('updateComplaintRaw delegates to DAO with ticketId and payload', async () => {
    const payload = { $push: { messages: { text: 'hi' } } };
    const daoResult = { acknowledged: true };
    ComplaintDAO.updateComplaintRaw.mockResolvedValue(daoResult);

    const result = await ComplaintService.updateComplaintRaw('t1', payload);

    expect(ComplaintDAO.updateComplaintRaw).toHaveBeenCalledTimes(1);
    expect(ComplaintDAO.updateComplaintRaw).toHaveBeenCalledWith('t1', payload);
    expect(result).toBe(daoResult);
  });

  it('pullMessageById delegates to DAO with ticketId and messageId', async () => {
    const daoResult = { acknowledged: true };
    ComplaintDAO.pullMessageById.mockResolvedValue(daoResult);

    const result = await ComplaintService.pullMessageById('t1', 'm1');

    expect(ComplaintDAO.pullMessageById).toHaveBeenCalledTimes(1);
    expect(ComplaintDAO.pullMessageById).toHaveBeenCalledWith('t1', 'm1');
    expect(result).toBe(daoResult);
  });

  it('deleteComplaintById delegates to DAO with ticketId', async () => {
    const daoResult = { deletedCount: 1 };
    ComplaintDAO.deleteComplaintById.mockResolvedValue(daoResult);

    const result = await ComplaintService.deleteComplaintById('t1');

    expect(ComplaintDAO.deleteComplaintById).toHaveBeenCalledTimes(1);
    expect(ComplaintDAO.deleteComplaintById).toHaveBeenCalledWith('t1');
    expect(result).toBe(daoResult);
  });
});
