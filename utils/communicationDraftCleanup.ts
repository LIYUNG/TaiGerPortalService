import CommunicationDraftService from '../services/communicationDraft';
import { deleteS3Objects } from '../aws/s3';
import { AWS_S3_BUCKET_NAME } from '../config';
import logger from '../services/logger';

// Drafts untouched for this long are considered abandoned; their staged
// attachments are orphaned in S3 and removed along with the draft.
const STALE_DRAFT_DAYS = 90; // 3 months
const DAY_MS = 24 * 60 * 60 * 1000;

// Sweep abandoned message drafts: delete their staged S3 attachments, then the
// draft documents. Safe to run repeatedly. Scheduled daily from index.ts.
const sweepStaleCommunicationDrafts = async () => {
  try {
    logger.info(
      'sweepStaleCommunicationDrafts: starting sweep for stale drafts'
    );
    const before = new Date(Date.now() - STALE_DRAFT_DAYS * DAY_MS);
    const staleDrafts = await CommunicationDraftService.findStaleDrafts(before);
    if (!staleDrafts || staleDrafts.length === 0) {
      return;
    }

    const objectKeys = staleDrafts
      .flatMap((draft) => draft.files ?? [])
      .filter((file) => file?.path)
      .map((file) => ({ Key: file.path }));
    if (objectKeys.length > 0) {
      await deleteS3Objects({
        bucketName: AWS_S3_BUCKET_NAME,
        objectKeys
      });
    }

    await Promise.all(
      staleDrafts.map((draft) =>
        CommunicationDraftService.deleteDraft(draft.user_id, draft.student_id)
      )
    );

    logger.info(
      `sweepStaleCommunicationDrafts: removed ${staleDrafts.length} stale draft(s), ${objectKeys.length} file(s)`
    );
  } catch (error) {
    logger.error('sweepStaleCommunicationDrafts failed', { error });
  }
};

export = { sweepStaleCommunicationDrafts, STALE_DRAFT_DAYS };
