import path from 'path';
import { Role } from '@taiger-common/core';

import { ErrorResponse } from '../common/errors';
import { AWS_S3_BUCKET_NAME } from '../config';
import { getS3Object, headS3ObjectSize } from '../aws/s3';
import UserService from './users';
import StudentService from './students';
import DocumentThreadService from './documentthreads';
import { sendEmailWithAttachments } from './email/configuration';

const STAFF_ROLES = [Role.Admin, Role.Manager, Role.Agent, Role.Editor];

// A document file stored on S3: `path` is the S3 key; `name` is an optional
// display name/category (base documents only).
interface ForwardFile {
  name?: string;
  path: string;
}

const escapeHtml = (value: string | undefined) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

// Cap the combined size of all attachments. SES API v2 allows ~40 MB raw
// messages (v1 was 10 MB), so 25 MB of source files (~34 MB after base64
// encoding) stays within SES; recipient mailboxes (often ~25 MB) remain the
// practical ceiling.
const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MB = 1024 * 1024;

const toIdArray = (value: unknown) =>
  Array.isArray(value)
    ? [...new Set(value.map((v) => String(v)).filter(Boolean))]
    : [];

// Resolve a list of user ids into validated TaiGer-staff email strings. The
// client only ever sends ids; emails are looked up server-side. Throws if any
// id is unknown (400) or resolves to a non-staff user (403) — this is what
// prevents forwarding to arbitrary external addresses.
const resolveStaffEmails = async (ids: string[], label: string) => {
  if (ids.length === 0) {
    return [];
  }
  const users = await UserService.findUsersByIds(
    ids,
    'firstname lastname email role'
  );
  if (users.length !== ids.length) {
    throw new ErrorResponse(400, `Some ${label} recipients were not found.`);
  }
  const nonStaff = users.find((user) => !STAFF_ROLES.includes(user.role));
  if (nonStaff) {
    throw new ErrorResponse(403, `${label} recipients must be TaiGer staff.`);
  }
  return users.map((user) => user.email);
};

// Build a nodemailer attachment from a stored document's bytes. S3 keys may
// carry Windows-style backslashes (mirrors controllers/documents_modification.ts).
// Base-document `name`s are categories (e.g. "Transcript") with no extension, so
// the extension is taken from the stored S3 key and appended when the display
// name is missing it. Thread files already carry a real filename.
const buildAttachment = (file: ForwardFile, data: Uint8Array) => {
  const key = file.path.replace(/\\/g, '/');
  const ext = path.extname(key);
  const baseName = file.name || path.basename(key);
  const filename =
    ext && !baseName.toLowerCase().endsWith(ext.toLowerCase())
      ? `${baseName}${ext}`
      : baseName;
  return { filename, content: Buffer.from(data) };
};

const s3Key = (file: ForwardFile) => file.path.replace(/\\/g, '/');

// Stat one document's files via HeadObject (metadata only, no body download) —
// so a batch that must fail is rejected before any (possibly large) file is
// transferred. Returns the document's total size in bytes, or null if any of
// its files is absent.
const documentFilesSize = async (files: ForwardFile[]) => {
  if (files.length === 0) {
    return null;
  }
  const sizes = await Promise.all(
    files.map((file) => headS3ObjectSize(AWS_S3_BUCKET_NAME, s3Key(file)))
  );
  if (sizes.some((size) => size === null)) {
    return null;
  }
  return sizes.reduce<number>((sum, size) => sum + (size ?? 0), 0);
};

// Download every file of one selected document into attachments. Returns null
// if a stored object has vanished (race between the existence check and here).
const downloadDocumentFiles = async (files: ForwardFile[]) => {
  const attachments = [];
  for (const file of files) {
    const data = await getS3Object(AWS_S3_BUCKET_NAME, s3Key(file));
    if (!data) {
      return null;
    }
    attachments.push(buildAttachment(file, data));
  }
  return attachments;
};

/**
 * Forward a student's documents by email. Collects the requested base
 * ("My Documents") profile files and the latest file(s) from the requested
 * CV/ML/RL document threads, then sends a single email with those attachments
 * to the resolved recipients (+ cc/bcc).
 *
 * Authorization that the requester is allowed to access this student is
 * enforced upstream by the route middleware (multitenant_filter +
 * chatMultitenantFilter). This service additionally guarantees no
 * cross-student leakage: every thread must belong to `studentId`, and base
 * docs come only from this student's profile.
 */
const forwardStudentDocuments = async ({
  studentId,
  recipientIds,
  ccIds,
  bccIds,
  threadIds,
  baseDocumentNames,
  subject,
  message,
  // Optional application/program context ({ school, program_name, degree,
  // semester }) shown in the email body when forwarding a specific application.
  program,
  // When false (default), any selected document with no uploaded file makes the
  // call return `{ status: 'missing_documents', missing }` WITHOUT sending, so
  // the UI can warn the user. When the user acknowledges, the UI re-calls with
  // `confirmMissing: true` and the email is sent with the available documents
  // only (the missing ones are skipped and reported back).
  confirmMissing
}: {
  studentId: string;
  recipientIds?: unknown;
  ccIds?: unknown;
  bccIds?: unknown;
  threadIds?: unknown;
  baseDocumentNames?: unknown;
  subject?: string;
  message?: string;
  program?: {
    school?: string;
    program_name?: string;
    degree?: string;
    semester?: string;
  };
  confirmMissing?: boolean;
}) => {
  const recipients = toIdArray(recipientIds);
  if (recipients.length === 0) {
    throw new ErrorResponse(400, 'At least one recipient is required.');
  }

  const [to, cc, bcc] = await Promise.all([
    resolveStaffEmails(recipients, 'To'),
    resolveStaffEmails(toIdArray(ccIds), 'Cc'),
    resolveStaffEmails(toIdArray(bccIds), 'Bcc')
  ]);

  const student = await StudentService.getStudentById(studentId);
  if (!student) {
    throw new ErrorResponse(404, 'Student not found.');
  }

  // Build the list of selected documents (label + the file(s) to attach).
  // Base documents (My Documents) from student.profile — matched by category.
  const descriptors = [];

  const requestedBaseNames = Array.isArray(baseDocumentNames)
    ? [...new Set(baseDocumentNames.map((name) => String(name)))]
    : [];
  const profile = student.profile || [];
  for (const name of requestedBaseNames) {
    const doc = profile.find((entry) => entry.name === name && entry.path);
    descriptors.push({ label: name, files: doc ? [doc] : [] });
  }

  // CV / ML / RL — the latest uploaded file(s) of each requested thread.
  const requestedThreadIds = toIdArray(threadIds);
  for (const threadId of requestedThreadIds) {
    const thread = await DocumentThreadService.getThreadByIdLean(threadId);
    if (!thread) {
      throw new ErrorResponse(404, `Document thread not found: ${threadId}`);
    }
    // Security check stays a hard failure — selecting another student's thread
    // is tampering, not a missing-file condition.
    if (thread.student_id?.toString() !== studentId.toString()) {
      throw new ErrorResponse(
        403,
        'A selected document thread does not belong to this student.'
      );
    }
    const fileGroups = (thread.messages || [])
      .filter((msg: { file: ForwardFile[] }) => msg.file?.length > 0)
      .map((msg: { file: ForwardFile[] }) => msg.file);
    descriptors.push({
      label: thread.file_type || 'Document',
      files: fileGroups.length > 0 ? fileGroups[fileGroups.length - 1] : []
    });
  }

  if (descriptors.length === 0) {
    throw new ErrorResponse(400, 'Select at least one document to forward.');
  }

  // Stat pass (HeadObject — no body download). Determine which selected
  // documents are available before anything is downloaded or emailed.
  const sizes = await Promise.all(
    descriptors.map((d) => documentFilesSize(d.files))
  );
  const presentDescriptors = descriptors.filter((_d, i) => sizes[i] !== null);
  const missing = [
    ...new Set(
      descriptors.filter((_d, i) => sizes[i] === null).map((d) => d.label)
    )
  ];

  // Size limit applies to what will actually be sent (the available files);
  // this is a hard error regardless of confirmation.
  const totalBytes = sizes.reduce<number>((sum, size) => sum + (size ?? 0), 0);
  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    const totalMb = (totalBytes / MB).toFixed(1);
    const limitMb = Math.round(MAX_TOTAL_ATTACHMENT_BYTES / MB);
    throw new ErrorResponse(
      400,
      `The selected documents total ${totalMb} MB, which exceeds the ${limitMb} MB email attachment limit. Please select fewer documents.`
    );
  }

  // Some documents have no file. Ask the user to acknowledge before sending so
  // they are never unaware that those documents are omitted from the email.
  if (missing.length > 0 && !confirmMissing) {
    return { status: 'missing_documents', missing };
  }

  if (presentDescriptors.length === 0) {
    throw new ErrorResponse(
      400,
      'None of the selected documents have an uploaded file.'
    );
  }

  // Download the available documents' bytes and build attachments.
  const attachments = [];
  for (const descriptor of presentDescriptors) {
    const downloaded = await downloadDocumentFiles(descriptor.files);
    if (downloaded === null) {
      throw new ErrorResponse(
        400,
        `The document "${descriptor.label}" is no longer available. Please try again.`
      );
    }
    attachments.push(...downloaded);
  }

  const studentName = `${student.firstname} ${student.lastname}`;
  const finalSubject = subject?.trim()
    ? subject.trim()
    : `Documents for ${studentName}`;

  // Intro: the sender's note when provided (plain text -> HTML, newlines
  // preserved), otherwise a default line. We never add BOTH, to avoid the
  // duplicated "Please find attached…" sentence.
  const intro = message?.trim()
    ? `<p>${escapeHtml(message.trim()).replace(/\n/g, '<br/>')}</p>`
    : `<p>Please find attached the documents for <b>${escapeHtml(
        studentName
      )}</b>.</p>`;

  // Application / program details block.
  const programRows = program
    ? [
        ['School', program.school],
        ['Program', program.program_name],
        ['Degree', program.degree],
        ['Semester', program.semester]
      ].filter(([, value]) => value && String(value).trim())
    : [];
  const programRowsHtml = programRows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:2px 12px 2px 0;color:#555">${label}</td><td style="padding:2px 0"><b>${escapeHtml(
          value
        )}</b></td></tr>`
    )
    .join('');
  const programBlock = programRows.length
    ? `<p style="margin:16px 0 4px"><b>Application</b></p><table cellpadding="0" cellspacing="0" style="border-collapse:collapse">${programRowsHtml}</table>`
    : '';

  // List of attached files.
  const fileItemsHtml = attachments
    .map((file) => `<li>${escapeHtml(file.filename)}</li>`)
    .join('');
  const fileListBlock = `<p style="margin:16px 0 4px"><b>Attached files (${attachments.length})</b></p><ul style="margin:4px 0 0 0;padding-left:20px">${fileItemsHtml}</ul>`;

  const finalMessage = `${intro}${programBlock}${fileListBlock}`;

  await sendEmailWithAttachments({
    to,
    cc,
    bcc,
    subject: finalSubject,
    message: finalMessage,
    attachments
  });

  return {
    status: 'sent',
    sentTo: to.length,
    ccCount: cc.length,
    bccCount: bcc.length,
    attachmentCount: attachments.length,
    // Documents the user acknowledged were omitted (empty unless confirmMissing).
    skipped: missing
  };
};

export = { forwardStudentDocuments };
