jest.mock('../../services/communicationDraft', () => ({
  findStaleDrafts: jest.fn(),
  deleteDraft: jest.fn()
}));
jest.mock('../../aws/s3', () => ({
  deleteS3Objects: jest.fn()
}));
jest.mock('../../services/logger', () => ({
  info: jest.fn(),
  error: jest.fn()
}));

import CommunicationDraftService from '../../services/communicationDraft';
import { deleteS3Objects } from '../../aws/s3';
import logger from '../../services/logger';
import communicationDraftCleanup from '../../utils/communicationDraftCleanup';

const { sweepStaleCommunicationDrafts } = communicationDraftCleanup;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('sweepStaleCommunicationDrafts', () => {
  it('does nothing when there are no stale drafts', async () => {
    (CommunicationDraftService.findStaleDrafts as jest.Mock).mockResolvedValue(
      []
    );

    await sweepStaleCommunicationDrafts();

    expect(deleteS3Objects).not.toHaveBeenCalled();
    expect(CommunicationDraftService.deleteDraft).not.toHaveBeenCalled();
  });

  it('deletes stale drafts and their S3 files', async () => {
    const stale = [
      {
        user_id: 'u1',
        student_id: 's1',
        files: [{ name: 'a.pdf', path: 's1/chat/a.pdf' }]
      },
      {
        user_id: 'u2',
        student_id: 's2',
        files: [
          { name: 'b.pdf', path: 's2/chat/b.pdf' },
          { name: 'c.pdf', path: 's2/chat/c.pdf' }
        ]
      },
      // A stale draft with no files: still removed, contributes no S3 keys.
      { user_id: 'u3', student_id: 's3', files: [] }
    ];
    (CommunicationDraftService.findStaleDrafts as jest.Mock).mockResolvedValue(
      stale
    );

    await sweepStaleCommunicationDrafts();

    expect(deleteS3Objects).toHaveBeenCalledWith({
      bucketName: expect.anything(),
      objectKeys: [
        { Key: 's1/chat/a.pdf' },
        { Key: 's2/chat/b.pdf' },
        { Key: 's2/chat/c.pdf' }
      ]
    });
    expect(CommunicationDraftService.deleteDraft).toHaveBeenCalledTimes(3);
    expect(CommunicationDraftService.deleteDraft).toHaveBeenCalledWith(
      'u1',
      's1'
    );
  });

  it('skips the S3 delete when no stale draft has files', async () => {
    (CommunicationDraftService.findStaleDrafts as jest.Mock).mockResolvedValue([
      { user_id: 'u1', student_id: 's1', files: [] }
    ]);

    await sweepStaleCommunicationDrafts();

    expect(deleteS3Objects).not.toHaveBeenCalled();
    expect(CommunicationDraftService.deleteDraft).toHaveBeenCalledTimes(1);
  });

  it('logs and swallows errors (never throws from the scheduled job)', async () => {
    (CommunicationDraftService.findStaleDrafts as jest.Mock).mockRejectedValue(
      new Error('db down')
    );

    await expect(sweepStaleCommunicationDrafts()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });
});
