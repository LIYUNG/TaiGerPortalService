// CommunicationDraftService is a thin pass-through to the DAO; assert it
// delegates each call with the right args and returns the DAO's result.
jest.mock('../../dao/communicationDraft.dao', () => ({
  getDraft: jest.fn(),
  upsertDraft: jest.fn(),
  deleteDraft: jest.fn(),
  addDraftFiles: jest.fn(),
  removeDraftFile: jest.fn(),
  findStaleDrafts: jest.fn()
}));

import CommunicationDraftDAO from '../../dao/communicationDraft.dao';
import CommunicationDraftService from '../../services/communicationDraft';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('CommunicationDraftService (delegates to DAO)', () => {
  it('getDraft -> DAO.getDraft', async () => {
    (CommunicationDraftDAO.getDraft as jest.Mock).mockResolvedValue('draft');
    await expect(CommunicationDraftService.getDraft('u1', 's1')).resolves.toBe(
      'draft'
    );
    expect(CommunicationDraftDAO.getDraft).toHaveBeenCalledWith('u1', 's1');
  });

  it('upsertDraft -> DAO.upsertDraft', async () => {
    (CommunicationDraftDAO.upsertDraft as jest.Mock).mockResolvedValue('d');
    await CommunicationDraftService.upsertDraft('u1', 's1', 'msg');
    expect(CommunicationDraftDAO.upsertDraft).toHaveBeenCalledWith(
      'u1',
      's1',
      'msg',
      undefined
    );
  });

  it('deleteDraft -> DAO.deleteDraft', async () => {
    await CommunicationDraftService.deleteDraft('u1', 's1');
    expect(CommunicationDraftDAO.deleteDraft).toHaveBeenCalledWith('u1', 's1');
  });

  it('addDraftFiles -> DAO.addDraftFiles', async () => {
    const files = [{ name: 'a.pdf', path: 's1/chat/u1.pdf' }];
    await CommunicationDraftService.addDraftFiles('u1', 's1', files);
    expect(CommunicationDraftDAO.addDraftFiles).toHaveBeenCalledWith(
      'u1',
      's1',
      files
    );
  });

  it('removeDraftFile -> DAO.removeDraftFile', async () => {
    await CommunicationDraftService.removeDraftFile('u1', 's1', 'k');
    expect(CommunicationDraftDAO.removeDraftFile).toHaveBeenCalledWith(
      'u1',
      's1',
      'k'
    );
  });

  it('findStaleDrafts -> DAO.findStaleDrafts', async () => {
    const before = new Date();
    await CommunicationDraftService.findStaleDrafts(before);
    expect(CommunicationDraftDAO.findStaleDrafts).toHaveBeenCalledWith(before);
  });
});
