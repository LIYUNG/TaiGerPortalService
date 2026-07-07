// Shared thread-file naming/versioning.
//
// One source of truth for the student-visible name of any file attached to a
// document thread, so manual uploads (storage_messagesthread_file_s3 in
// middlewares/file-upload.ts) and server-generated attachments (e.g. the AI CV
// draft in controllers/cv_draft.ts) produce identical names and share ONE
// continuous version sequence.

interface NamedStudent {
  firstname?: string;
  lastname?: string;
}

interface NamedProgram {
  school?: string;
  program_name?: string;
}

interface ThreadFileLike {
  name?: string;
}

interface ThreadMessageLike {
  file?: ThreadFileLike[];
}

interface ThreadLike {
  messages?: ThreadMessageLike[];
}

// Next "_v{N}" version for a thread: the highest version already attached across
// all files in all messages, plus one. Reads the trailing underscore-token of
// each stored file name (e.g. "..._v3.docx" -> 3), which is how names produced
// by buildThreadFileName encode the version.
export const nextThreadFileVersion = (thread: ThreadLike): number => {
  let max = 0;
  (thread?.messages || []).forEach((message) => {
    (message?.file || []).forEach((file) => {
      const lastPart = String(file?.name ?? '').split('_').pop() ?? '';
      const version = parseInt(lastPart.replace(/[^\d]/g, ''), 10);
      if (Number.isFinite(version) && version > max) {
        max = version;
      }
    });
  });
  return max + 1;
};

// Student-visible thread file name:
//   {lastname}_{firstname}_{school}_{program}_{fileType}_v{N}{ext}
// The school/program segment is omitted when the thread has no program (general
// RL / program-less CV), matching the upload middleware. Spaces and slashes are
// normalised to underscores. `ext` must include the leading dot (e.g. ".docx").
export const buildThreadFileName = (opts: {
  student?: NamedStudent | null;
  program?: NamedProgram | null;
  fileType?: string;
  version: number;
  ext: string;
}): string => {
  const { student, program, fileType, version, ext } = opts;
  const programPart = program
    ? `${program.school}_${program.program_name}`
    : '';
  const base = [
    student?.lastname,
    student?.firstname,
    programPart,
    fileType,
    `v${version}`
  ]
    .filter(Boolean)
    .join('_');
  return `${base}${ext}`.replace(/ /g, '_').replace(/\//g, '_');
};
