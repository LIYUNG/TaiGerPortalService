import mongoose from 'mongoose';
import path from 'path';
import {
  is_TaiGer_Agent,
  is_TaiGer_Admin,
  is_TaiGer_Editor,
  is_TaiGer_Student,
  Role
} from '@taiger-common/core';
import type {
  ICommunication,
  ICommunicationFile,
  IPermission,
  IStudent,
  IUser,
  GetCommunicationUnreadNumberResponse,
  PostCommunicationResponse,
  UpdateCommunicationMessageResponse,
  DeleteCommunicationMessageResponse,
  IgnoreCommunicationMessageResponse
} from '@taiger-common/model';

import { ErrorResponse } from '../common/errors';
import { asyncHandler, asyncRoute } from '../middlewares/error-handler';
import {
  sendAgentNewMessageReminderEmail,
  sendStudentNewMessageReminderEmail
} from '../services/email';
import logger from '../services/logger';
import { isNotArchiv } from '../constants';
import { getPermission } from '../utils/queryFunctions';
import { AWS_S3_BUCKET_NAME } from '../config';
import { ten_minutes_cache } from '../cache/node-cache';
import { deleteS3Objects, getS3Object } from '../aws/s3';
import { TENANT_SHORT_NAME } from '../constants/common';
import CommunicationService from '../services/communications';
import CommunicationDraftService from '../services/communicationDraft';
import StudentService from '../services/students';

const pageSize = 5;

// A student with its agent refs populated (as returned by the populated
// student lookups), narrowed to the fields this controller reads.
type PopulatedStudent = IStudent & {
  _id: { toString(): string };
  agents: IUser[];
};

// `findThreadPopulated` returns a live (non-lean) Mongoose document, but its
// return type is a broad lean/hydrated union (see dao/communication.dao.ts).
// This narrows to the shape actually read/mutated in `getMessages` below: a
// hydrated doc whose `readBy` has been populated to user docs (and into which a
// bare ObjectId is subsequently pushed for the mark-as-read write).
type MessageThreadDoc = Omit<ICommunication, 'readBy' | 'timeStampReadBy'> & {
  _id: { toString(): string };
   
  // populated IUser docs (read) with a raw pushed ObjectId (write); no single
  // structural type covers both without changing runtime behavior.
  readBy: any[];
  timeStampReadBy?: Record<string, Date>;
  save: () => Promise<unknown>;
  populate: (path: string, select?: string) => Promise<unknown>;
};

// A single message from a populated thread, narrowed to just the `user_id`
// ref needed to detect 3 consecutive student messages in `postMessages`.
type MessageWithUserRef = {
  user_id?: { _id: { toString(): string } };
};

// Friendly, human-readable display/download name for a chat attachment. The S3
// storage key is an opaque uuid (see middlewares/file-upload), so this name is
// what the recipient sees when downloading. Mirrors the legacy format.
const formatChatDate = (date: Date) => {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(
    date.getDate()
  )}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
};

const buildChatAttachmentName = (
  student: IStudent | null,
  ext: string,
  formattedDate: string,
  suffix: string
) => {
  const name = `${student?.lastname ?? ''}_${
    student?.firstname ?? ''
  }_Attachment_${formattedDate}${suffix}${ext}`;
  return name.replace(/ /g, '_').replace(/\//g, '_');
};

// A draft holds EditorJS OutputData as a JSON string; it is "empty" when there
// is no text or no content blocks. Empty drafts are deleted rather than stored.
const isDraftEmpty = (message: unknown) => {
  if (
    typeof message !== 'string' ||
    message.trim() === '' ||
    message === '{}'
  ) {
    return true;
  }
  try {
    const parsed = JSON.parse(message);
    return !Array.isArray(parsed?.blocks) || parsed.blocks.length === 0;
  } catch {
    // Non-JSON but non-empty content — keep it.
    return false;
  }
};

// GET /api/communications/:studentId/draft — the current user's saved draft for
// this student conversation (null when none).
export const getCommunicationDraft = asyncRoute(async (req, res) => {
  const { user } = req;
  const { studentId } = req.params as { studentId: string };
  const draft = await CommunicationDraftService.getDraft(
    user._id.toString(),
    studentId
  );
  res.status(200).send({ success: true, data: draft ?? null });
});

// PUT /api/communications/:studentId/draft — upsert the draft; an empty draft is
// deleted so it doesn't linger.
export const upsertCommunicationDraft = asyncRoute(async (req, res) => {
  const {
    user,
    body: { message, source, aiModel }
  } = req;
  const { studentId } = req.params as { studentId: string };
  const userId = user._id.toString();
  // When the client saves an AI-generated reply it marks source: 'ai'; we stamp
  // provenance (model + the untouched AI text) so the send can be audited.
  // Plain human autosave omits `source` and leaves any existing provenance be.
  const aiMeta =
    source === 'ai' && !isDraftEmpty(message)
      ? {
          source: 'ai' as const,
          aiModel: typeof aiModel === 'string' ? aiModel : '',
          aiOriginalMessage: message
        }
      : undefined;
  if (isDraftEmpty(message)) {
    // An empty-text draft is only discarded when it has nothing else worth
    // keeping — no attachments and no pending AI suggestion; otherwise keep the
    // draft and just clear the text.
    const existing = await CommunicationDraftService.getDraft(
      userId,
      studentId
    );
    if (!existing?.files?.length && !existing?.aiPendingSuggestion) {
      await CommunicationDraftService.deleteDraft(userId, studentId);
      return res.status(200).send({ success: true, data: null });
    }
    const cleared = await CommunicationDraftService.upsertDraft(
      userId,
      studentId,
      ''
    );
    return res.status(200).send({ success: true, data: cleared });
  }
  const draft = await CommunicationDraftService.upsertDraft(
    userId,
    studentId,
    message,
    aiMeta
  );
  return res.status(200).send({ success: true, data: draft });
});

// PUT /api/communications/:studentId/draft/ai-suggestion — store (or clear, with
// an empty suggestion) a generated-but-not-yet-approved AI reply, so it survives
// a reload and the agent can still approve/dismiss it. Leaves `message` alone.
export const setCommunicationDraftAiSuggestion = asyncRoute(
  async (req, res) => {
    const {
      user,
      body: { suggestion, aiModel }
    } = req;
    const { studentId } = req.params as { studentId: string };
    const draft = await CommunicationDraftService.setAiPendingSuggestion(
      user._id.toString(),
      studentId,
      typeof suggestion === 'string' ? suggestion : '',
      typeof aiModel === 'string' ? aiModel : ''
    );
    res.status(200).send({ success: true, data: draft });
  }
);

// DELETE /api/communications/:studentId/draft — discard the draft: delete its
// staged attachments from S3 (they were never sent), then remove the document.
export const deleteCommunicationDraft = asyncRoute(async (req, res) => {
  const { user } = req;
  const { studentId } = req.params as { studentId: string };
  const userId = user._id.toString();
  const existing = await CommunicationDraftService.getDraft(userId, studentId);
  if (existing?.files?.length) {
    await deleteS3Objects({
      bucketName: AWS_S3_BUCKET_NAME,
      objectKeys: existing.files.map((file) => ({ Key: file.path }))
    });
  }
  await CommunicationDraftService.deleteDraft(userId, studentId);
  res.status(200).send({ success: true });
});

// POST /api/communications/:studentId/draft/files — attach. The files are
// already in S3 (MessagesChatUpload uploaded them to `<studentId>/chat/<uuid>`).
// Record friendly-named refs on the draft.
export const uploadCommunicationDraftFiles = asyncRoute(async (req, res) => {
  const { user } = req;
  const { studentId } = req.params as { studentId: string };
  // multer-S3 populates req.files as an array (single-field upload); narrow the
  // Multer union to that array for the length/map reads below.
  const uploadedFiles = req.files as Express.Multer.File[] | undefined;
  if (!uploadedFiles || uploadedFiles.length === 0) {
    throw new ErrorResponse(400, 'No file uploaded.');
  }
  const student = (await StudentService.getStudentById(
    studentId
  )) as IStudent | null;
  const formattedDate = formatChatDate(new Date());
  const multiple = uploadedFiles.length > 1;
  const files = uploadedFiles.map(
    (file: { originalname?: string; key?: string }, i: number) => ({
      name: buildChatAttachmentName(
        student,
        path.extname(file.originalname || file.key || ''),
        formattedDate,
        multiple ? `_${i + 1}` : ''
      ),
      path: file.key as string
    })
  );
  const draft = await CommunicationDraftService.addDraftFiles(
    user._id.toString(),
    studentId,
    files
  );
  res.status(200).send({ success: true, data: { files, draft } });
});

// DELETE /api/communications/:studentId/draft/files — unattach. Delete the
// staged S3 object and remove it from the draft. The path must belong to THIS
// user's draft (no deleting arbitrary keys).
export const deleteCommunicationDraftFile = asyncRoute(async (req, res) => {
  const {
    user,
    body: { path: filePath }
  } = req;
  const { studentId } = req.params as { studentId: string };
  if (!filePath || typeof filePath !== 'string') {
    throw new ErrorResponse(400, 'File path is required.');
  }
  const id = user._id.toString();
  const existing = await CommunicationDraftService.getDraft(id, studentId);
  const owns = existing?.files?.some((file) => file.path === filePath);
  if (!owns) {
    throw new ErrorResponse(404, 'File not found in draft.');
  }
  await deleteS3Objects({
    bucketName: AWS_S3_BUCKET_NAME,
    objectKeys: [{ Key: filePath }]
  });
  const draft = await CommunicationDraftService.removeDraftFile(
    id,
    studentId,
    filePath
  );
  res.status(200).send({ success: true, data: draft });
});

// TODO
export const getSearchUserMessages = asyncRoute(async (req, res) => {
  const { user } = req;
  const { q } = req.query as { q: string };

  // Get only the last communication
  const studentsWithCommunications =
    await StudentService.getStudentsWithLatestCommunication();

  const permissions = (await getPermission(req, user)) as
    | IPermission
    | undefined;
  if (
    is_TaiGer_Admin(user) ||
    (is_TaiGer_Agent(user) && permissions?.canAccessAllChat)
  ) {
    const students = await StudentService.searchStudentsByText(
      { $text: { $search: q } },
      'firstname lastname firstname_chinese lastname_chinese role pictureUrl'
    );
    // Merge the results
    const mergedResults = students.map((student) => {
      const aggregateData = studentsWithCommunications.find(
        (item) => item._id.toString() === student._id.toString()
      );
      return { ...aggregateData, ...student };
    });

    res
      .status(200)
      .send({ success: true, data: { students: mergedResults, user } });
  } else {
    const students_search = await StudentService.searchStudentsByText(
      {
        $text: { $search: q },
        agents: user._id.toString()
      },
      'firstname lastname firstname_chinese lastname_chinese role pictureUrl'
    );

    // Merge the results
    const mergedResults = students_search.map((student) => {
      const aggregateData = studentsWithCommunications.find(
        (item) => item._id.toString() === student._id.toString()
      );
      return { ...aggregateData, ...student };
    });

    res
      .status(200)
      .send({ success: true, data: { students: mergedResults, user } });
  }
});
export const getSearchMessageKeywords = asyncHandler(async (req, res) => {
  const { user } = req;

  // Get only the last communication
  const studentsWithCommunications =
    await StudentService.getStudentsWithLatestCommunication();
  if (is_TaiGer_Admin(user)) {
    const students = await StudentService.findStudentsSelect(
      { $or: [{ archiv: { $exists: false } }, { archiv: false }] },
      'firstname lastname firstname_chinese lastname_chinese role pictureUrl'
    );
    // Merge the results
    const mergedResults = students.map((student) => {
      const aggregateData = studentsWithCommunications.find(
        (item) => item._id.toString() === student._id.toString()
      );
      return { ...aggregateData, ...student };
    });

    return res
      .status(200)
      .send({ success: true, data: { students: mergedResults, user } });
  }
  const students_search = await StudentService.searchStudentsByText(
    {
      $text: { $search: req.query.q },
      agents: user._id.toString()
    },
    'firstname lastname firstname_chinese lastname_chinese role pictureUrl'
  );
  // Merge the results
  const mergedResults = students_search.map((student) => {
    const aggregateData = studentsWithCommunications.find(
      (item) => item._id.toString() === student._id.toString()
    );
    return { ...aggregateData, ...student };
  });

  return res
    .status(200)
    .send({ success: true, data: { students: mergedResults, user } });
});

export const getUnreadNumberMessages =
  asyncRoute<GetCommunicationUnreadNumberResponse>(async (req, res) => {
    const { user } = req;
    if (is_TaiGer_Student(user)) {
      const latestMessage = (await CommunicationService.getLatestByStudentId(
        user._id.toString()
      )) as ICommunication | null;
      const readBy =
        (
          latestMessage?.readBy as Array<{ toString(): string }> | undefined
        )?.map((id) => id.toString()) || [];

      return res.status(200).send({
        success: true,
        data: readBy?.includes(user._id.toString()) ? 0 : 1
      });
    }
    if (
      user.role !== Role.Admin &&
      user.role !== Role.Agent &&
      user.role !== Role.Editor
    ) {
      logger.error(`getUnreadNumberMessages: no ${TENANT_SHORT_NAME} user!`);
      throw new ErrorResponse(401, `Invalid ${TENANT_SHORT_NAME} user`);
    }
    const permissions = (await getPermission(req, user)) as
      | IPermission
      | undefined;

    const filter: Record<string, unknown> = {
      $or: [{ archiv: { $exists: false } }, { archiv: false }]
    };
    if (
      !(
        is_TaiGer_Admin(user) ||
        (is_TaiGer_Agent(user) && permissions?.canAccessAllChat)
      )
    ) {
      filter.agents = user._id.toString();
    }

    const students = await StudentService.findStudentsSelect(
      filter,
      'firstname lastname role pictureUrl'
    );
    const student_ids = students.map((stud) => stud._id);
    const studentsWithCommunications =
      await StudentService.getUnreadCommunicationStudents(
        student_ids as unknown as string[],
        user._id as unknown as string
      );

    return res.status(200).send({
      success: true,
      data: studentsWithCommunications.length
    });
  });

// TODO: refactor permission to middleware
export const getMyMessages = asyncRoute(async (req, res) => {
  const { user } = req;

  // Role is enforced at the route via permit(Admin, Manager, Agent, Editor).
  const permissions = (await getPermission(req, user)) as
    | IPermission
    | undefined;

  const filter: Record<string, unknown> = {
    $or: [{ archiv: { $exists: false } }, { archiv: false }]
  };
  if (
    !(
      is_TaiGer_Admin(user) ||
      (is_TaiGer_Agent(user) && permissions?.canAccessAllChat) ||
      (is_TaiGer_Editor(user) && permissions?.canAccessAllChat)
    )
  ) {
    // Scope to the caller's own students: agents match the `agents` field,
    // editors match the `editors` field (a user may hold both roles).
    const userId = user._id.toString();
    const ownStudentConditions: Record<string, string>[] = [];
    if (is_TaiGer_Agent(user)) {
      ownStudentConditions.push({ agents: userId });
    }
    if (is_TaiGer_Editor(user)) {
      ownStudentConditions.push({ editors: userId });
    }
    filter.$and = [{ $or: ownStudentConditions }];
  }

  const students = await StudentService.findStudentsSelect(
    filter,
    'firstname lastname role pictureUrl'
  );
  // Get only the last communication
  const student_ids = students.map((stud) => stud._id);
  const studentsWithCommunications =
    await StudentService.getStudentsWithLatestCommunicationSorted(
      student_ids as unknown as string[]
    );

  res.status(200).send({
    success: true,
    data: {
      students: studentsWithCommunications,
      user
    }
  });
});

export const loadMessages = asyncRoute(async (req, res) => {
  const { studentId, pageNumber } = req.params as {
    studentId: string;
    pageNumber: string;
  };

  const student = await StudentService.getStudentByIdSelectPopulated(
    studentId,
    'firstname lastname firstname_chinese lastname_chinese agents archiv pictureUrl',
    'agents',
    'firstname lastname email role pictureUrl'
  );
  if (!student) {
    logger.error('loadMessages: Invalid student id!');
    throw new ErrorResponse(404, 'Student tot found');
  }
  // `pageNumber` is a path param (string); the arithmetic relies on JS coercion.
  const skipAmount = ((pageNumber as unknown as number) - 1) * pageSize;
  const communication_thread = await CommunicationService.findThreadPopulated(
    studentId,
    {
      populate: 'student_id user_id readBy ignoredMessageBy',
      select:
        'firstname lastname firstname_chinese lastname_chinese role agents editors pictureUrl',
      skip: skipAmount,
      limit: pageSize
    }
  );

  // Multitenant-filter: Check student can only access their own thread!!!!

  res.status(200).send({
    success: true,
    data: [...communication_thread].reverse(),
    student
  });
});

export const getMessages = asyncRoute(async (req, res) => {
  const { user } = req;
  const { studentId } = req.params as { studentId: string };

  const student = await StudentService.getStudentByIdSelectPopulated(
    studentId,
    'firstname lastname firstname_chinese lastname_chinese agents lastLoginAt archiv pictureUrl',
    'agents editors',
    'firstname lastname email role pictureUrl'
  );
  if (!student) {
    logger.error('getMessages: Invalid student id!');
    throw new ErrorResponse(404, 'Student not found');
  }
  // Live docs: the newest message is marked-as-read (.save()) below.
  const communication_thread = await CommunicationService.findThreadPopulated(
    studentId,
    {
      populate: 'student_id user_id readBy ignoredMessageBy',
      select: 'firstname lastname role pictureUrl',
      limit: pageSize
    }
  );

  if (communication_thread.length > 0) {
    const lastElement = communication_thread[0] as unknown as MessageThreadDoc;
    const userIdStr = user._id.toString();

    // Check if user is in the readBy list
    const isUserNotInReadBy = !lastElement.readBy.some(
      (usr: { _id: { toString(): string } }) => usr._id.toString() === userIdStr
    );

    if (isUserNotInReadBy) {
      lastElement.readBy.push(new mongoose.Types.ObjectId(userIdStr));

      // Update timestamp for the user
      lastElement.timeStampReadBy = {
        ...lastElement.timeStampReadBy,
        [userIdStr]: new Date()
      };
      await lastElement.save();
      await lastElement.populate(
        'readBy',
        'firstname lastname role pictureUrl'
      );
    }
  }
  res.status(200).send({
    success: true,
    data: [...communication_thread].reverse(),
    student
  });
});

// Search a single student's chat history (this conversation only). Access is
// already scoped by multitenant_filter + chatMultitenantFilter on the route.
export const searchThreadMessages = asyncRoute(async (req, res) => {
  const { studentId } = req.params as { studentId: string };
  const { q } = req.query;

  const term = typeof q === 'string' ? q.trim() : '';
  // Require at least 2 chars to avoid scanning the whole thread for noise.
  if (term.length < 2) {
    return res.status(200).send({ success: true, data: [], total: 0 });
  }

  const { messages, total } = await CommunicationService.searchThread(
    studentId,
    term
  );

  res.status(200).send({ success: true, data: messages, total });
});

// Messages around a specific message (Instagram-style "jump to message" from a
// search result). Access scoped by multitenant_filter + chatMultitenantFilter.
export const getThreadContextMessages = asyncRoute(async (req, res) => {
  const { studentId, messageId } = req.params as {
    studentId: string;
    messageId: string;
  };

  const context = await CommunicationService.getThreadContext(
    studentId,
    messageId
  );
  if (!context) {
    throw new ErrorResponse(404, 'Message not found');
  }

  res.status(200).send({
    success: true,
    data: context.messages,
    hasOlder: context.hasOlder,
    hasNewer: context.hasNewer,
    targetId: context.targetId
  });
});

// A chunk of messages before/after a cursor message — lets the client load
// older (scroll up) or newer (scroll down) chunks from a jumped-to position.
export const getAdjacentThreadMessages = asyncRoute(async (req, res) => {
  const { studentId, messageId } = req.params as {
    studentId: string;
    messageId: string;
  };
  const { direction } = req.query;

  const dir = direction === 'before' ? 'before' : 'after';
  const { messages, hasMore } = await CommunicationService.getAdjacentMessages(
    studentId,
    messageId,
    dir
  );

  res
    .status(200)
    .send({ success: true, data: messages, hasMore, direction: dir });
});

export const getChatFile = asyncRoute(async (req, res) => {
  const { studentId, fileName } = req.params as {
    studentId: string;
    fileName: string;
  };

  // `fileName` is the (opaque) storage key segment. The friendly download name
  // is decoupled from storage and passed as `?name=`; fall back to `fileName`
  // for legacy files (where the stored name equalled the key segment).
  const downloadName =
    typeof req.query?.name === 'string' && req.query.name
      ? req.query.name
      : fileName;
  const fileKey = path.join(studentId, 'chat', fileName).replace(/\\/g, '/');

  const cache_key = `chat-${studentId}${req.originalUrl.split('/')[5]}`;
  const value = ten_minutes_cache.get(cache_key); // image name
  if (value === undefined) {
    const response = (await getS3Object(
      AWS_S3_BUCKET_NAME,
      fileKey
    )) as Uint8Array;
    const success = ten_minutes_cache.set(cache_key, Buffer.from(response));
    if (success) {
      logger.info('image cache set successfully');
    }
    res.attachment(downloadName);
    return res.end(response);
  }
  logger.info('cache hit');
  res.attachment(downloadName);
  return res.end(value);
});

// (O) notification email works
export const postMessages = asyncRoute<PostCommunicationResponse>(
  async (req, res) => {
    const { user } = req;
    const { studentId } = req.params as { studentId: string };
    const { message } = req.body;
    // TODO: check if consecutive post?
    if (is_TaiGer_Student(user)) {
      const communication_thread =
        (await CommunicationService.findThreadPopulated(studentId, {
          populate: 'student_id user_id',
          select: 'firstname lastname role pictureUrl',
          limit: 3
        })) as unknown as MessageWithUserRef[];

      if (communication_thread.length === 3) {
        let flag = true;
        for (let i = 0; i < communication_thread.length; i += 1) {
          if (communication_thread[i]?.user_id?._id.toString() === studentId) {
            flag =
              flag &&
              communication_thread[i]?.user_id?._id.toString() === studentId;
          } else {
            flag = false;
            break;
          }
        }
        if (flag) {
          logger.error(`Too much message by ${studentId}`);
          throw new ErrorResponse(
            429,
            '您至多只能發連續三條訊息！請整理好您的問題一次發問，方便 Agent 一次回復。若 Agent 尚未回覆當前留言，請把問題集中於最新一次的留言，該留言右上角鉛筆可以編輯。您的 Agent 會盡速回復您！'
          );
        }
      }
    }
    try {
      JSON.parse(message);
    } catch (e) {
      logger.error(`message collapse ${message}`);
      throw new ErrorResponse(400, 'message collapse');
    }
    // Attachments: the S3 key (file.key) is an opaque uuid, so files never
    // overwrite each other (no duplicate-extension restriction needed). We store
    // the storage key as `path` and a friendly, human-readable `name` for display
    // and download. A per-file index keeps display names distinct when several
    // files are attached at once.
    const newfile: ICommunicationFile[] = [];
    // multer-S3 populates req.files as an array (single-field upload).
    const uploadedFiles = req.files as Express.Multer.File[] | undefined;
    if (uploadedFiles && uploadedFiles.length > 0) {
      const student = (await StudentService.getStudentById(
        studentId
      )) as IStudent | null;
      const formattedDate = formatChatDate(new Date());
      const multiple = uploadedFiles.length > 1;
      for (let i = 0; i < uploadedFiles.length; i += 1) {
        const file = uploadedFiles[i] as unknown as {
          originalname?: string;
          key?: string;
        };
        const ext = path.extname(file.originalname || file.key || '');
        const suffix = multiple ? `_${i + 1}` : '';
        newfile.push({
          name: buildChatAttachmentName(student, ext, formattedDate, suffix),
          path: file.key as string
        });
      }
    }
    // Files staged on the draft (upload-on-attach) are moved onto the message.
    // `newfile` covers any files sent directly with this request (legacy /
    // upload-on-send); both are merged.
    const draft = await CommunicationDraftService.getDraft(
      user._id.toString(),
      studentId
    );
    const draftFiles = draft?.files ?? [];
    const allFiles = [...newfile, ...draftFiles];

    await CommunicationService.createCommunication({
      student_id: studentId,
      user_id: user._id,
      message,
      readBy: [new mongoose.Types.ObjectId(user._id)],
      timeStampReadBy: { [user._id?.toString()]: new Date() },
      files: allFiles,
      createdAt: new Date()
    } as unknown as Partial<ICommunication>);

    // The draft's files now belong to the message — delete the draft DOCUMENT
    // only (do NOT delete the S3 objects). Best-effort: the message is already
    // created, so a draft-delete failure must NOT fail the request (which would
    // make the client think the send failed and re-send, duplicating it). The
    // daily sweep reclaims any leftover.
    if (draft) {
      try {
        await CommunicationDraftService.deleteDraft(
          user._id.toString(),
          studentId
        );
      } catch (err) {
        logger.error('postMessages: failed to delete consumed draft', {
          studentId,
          message: (err as Error)?.message
        });
      }
    }

    const communication_latest = await CommunicationService.findThreadPopulated(
      studentId,
      {
        populate: 'student_id user_id readBy',
        select: 'firstname lastname pictureUrl',
        limit: 1
      }
    );
    res.status(200).send({
      success: true,
      // NOTE: the api type declares `data` as a single message, but this endpoint
      // has always returned the populated latest-thread array; preserved as-is and
      // bridged to the api type.
      data: communication_latest as unknown as PostCommunicationResponse['data']
    });

    const student = (await StudentService.getStudentById(
      studentId
    )) as unknown as PopulatedStudent;

    // inform agent/student
    if (is_TaiGer_Student(user)) {
      for (let i = 0; i < student.agents.length; i += 1) {
        // inform active-agent
        if (isNotArchiv(student)) {
          if (isNotArchiv(student.agents[i])) {
            // inform agent
            sendAgentNewMessageReminderEmail(
              {
                firstname: student.agents[i].firstname ?? '',
                lastname: student.agents[i].lastname ?? '',
                address: student.agents[i].email ?? ''
              },
              {
                student_firstname: student.firstname,
                student_id: student._id.toString(),
                student_lastname: student.lastname
              }
            );
          }
        }
      }
    } else {
      sendStudentNewMessageReminderEmail(
        {
          firstname: student.firstname ?? '',
          lastname: student.lastname ?? '',
          address: student.email ?? ''
        },
        {
          taiger_user_firstname: user.firstname,
          student_id: student._id.toString(),
          taiger_user_lastname: user.lastname
        }
      );
    }
  }
);

// (-) TODO email : no notification needed
export const updateAMessageInThread =
  asyncRoute<UpdateCommunicationMessageResponse>(async (req, res) => {
    const { messageId } = req.params as { messageId: string };
    const { message } = req.body;
    try {
      const thread = await CommunicationService.updateCommunication(messageId, {
        message
      });

      if (!thread) {
        logger.error('updateAMessageInThread : Invalid message thread id');
        throw new ErrorResponse(404, 'Thread not found');
      }
      res.status(200).send({
        success: true,
        data: thread as unknown as UpdateCommunicationMessageResponse['data']
      });
    } catch (e) {
      logger.error(`updateAMessageInThread error for messageId ${messageId}`);
      throw new ErrorResponse(400, 'message collapse');
    }
  });

// (-) TODO email : no notification needed
export const deleteAMessageInCommunicationThread =
  asyncRoute<DeleteCommunicationMessageResponse>(async (req, res) => {
    const { messageId } = req.params as { messageId: string };
    const msg = (await CommunicationService.getCommunicationById(
      messageId
    )) as ICommunication | null;

    // remove chat attachment cache.
    msg?.files?.map((file) =>
      ten_minutes_cache.del(
        `chat-${(msg.student_id as { toString(): string })?.toString()}${
          file.name
        }`
      )
    );

    try {
      logger.info('msg.files', { files: msg?.files });
      if ((msg?.files?.filter((file) => file.path !== '')?.length ?? 0) > 0) {
        await deleteS3Objects({
          bucketName: AWS_S3_BUCKET_NAME,
          objectKeys: msg!
            .files!.filter((file) => file.path !== '')
            .map((file) => ({
              Key: file.path
            }))
        });
      }
    } catch (err) {
      if (err) {
        logger.error('delete chat files: ', err as Record<string, unknown>);
        throw new ErrorResponse(500, 'Error occurs while deleting');
      }
    }

    try {
      await CommunicationService.deleteById(messageId);
      res.status(200).send({ success: true });
    } catch (e) {
      logger.error(`Delete error for messageId ${messageId}`);
      throw new ErrorResponse(400, 'message collapse');
    }
  });

export const IgnoreMessage = asyncRoute<IgnoreCommunicationMessageResponse>(
  async (req, res) => {
    const { user } = req;
    const { communication_messageId, ignoreMessageState } = req.params as {
      communication_messageId: string;
      ignoreMessageState: string;
    };

    try {
      await CommunicationService.updateCommunication(communication_messageId, {
        ignore_message: ignoreMessageState,
        ignoredMessageBy: user._id,
        ignoredMessageUpdatedAt: new Date()
      });
    } catch (e) {
      logger.error(
        `IgnoreMessage error for messageId ${communication_messageId}, state: ${ignoreMessageState}`
      );
      throw new ErrorResponse(400, 'message collapse');
    }

    logger.info('IgnoreMessage : save succeeds');
    res.status(200).send({ success: true });
  }
);
