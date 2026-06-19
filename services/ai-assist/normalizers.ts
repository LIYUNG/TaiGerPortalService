/* eslint-disable no-use-before-define */
// Inputs are heterogeneous Mongoose lean documents (populated reference unions
// and FlattenMaps-wrapped subdocuments) whose runtime shape does not
// structurally match the strict @taiger-common/model interfaces, so these
// normalizers accept a loose record and read fields defensively.
type LeanDoc = Record<string, any>;

function normalizeUser(user: LeanDoc | null | undefined) {
  if (!user) {
    return undefined;
  }

  return {
    id: user._id?.toString?.() || user.id,
    name:
      [user.firstname, user.lastname].filter(Boolean).join(' ') || undefined,
    chineseName:
      [user.lastname_chinese, user.firstname_chinese]
        .filter(Boolean)
        .join('') || undefined,
    email: user.email,
    role: user.role,
    archived: Boolean(user.archiv)
  };
}

function normalizeApplication(application: LeanDoc) {
  return {
    id: application._id?.toString?.() || application.id,
    program: normalizeProgram(application.programId),
    status: {
      admission: application.admission,
      admissionLabel: normalizeAdmission(application.admission),
      decided: application.decided,
      closed: application.closed,
      finalEnrolment: Boolean(application.finalEnrolment)
    },
    admissionLetter: application.admission_letter
      ? {
          status: application.admission_letter.status,
          hasFile: Boolean(application.admission_letter.path),
          updatedAt: application.admission_letter.updatedAt
        }
      : undefined,
    rejectReason: application.reject_reason || undefined,
    applicationYear: application.application_year,
    uniAssist: application.uni_assist
      ? {
          status: application.uni_assist.status,
          isPaid: Boolean(application.uni_assist.isPaid),
          updatedAt: application.uni_assist.updatedAt
        }
      : undefined
  };
}

function normalizeProfileDocument(document: LeanDoc) {
  return {
    id: document._id?.toString?.(),
    name: document.name,
    status: document.status,
    required: Boolean(document.required),
    hasFile: Boolean(document.path),
    feedback: stripHtml(document.feedback),
    updatedAt: document.updatedAt
  };
}

function normalizeMessage(message: LeanDoc) {
  return {
    id: message._id?.toString?.() || message.id,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    author: normalizeUser(message.user_id),
    text: extractEditorText(message.message),
    attachments: (message.files || []).map((file: LeanDoc) => ({
      name: file.name
    })),
    ignored: Boolean(message.ignore_message)
  };
}

function normalizeProgram(program: LeanDoc | null | undefined) {
  if (!program) {
    return undefined;
  }

  return {
    id: program._id?.toString?.() || program.id,
    school: program.school,
    name: program.program_name || program.programName || program.name,
    degree: program.degree,
    semester: program.semester,
    applicationDeadline: program.application_deadline
  };
}

function normalizeAdmission(admission: string | undefined) {
  if (admission === 'O') {
    return 'admitted';
  }

  if (admission === 'X') {
    return 'not_admitted';
  }

  return 'unknown';
}

function extractEditorText(rawMessage: string | undefined) {
  if (!rawMessage) {
    return '';
  }

  try {
    const parsed = JSON.parse(rawMessage);
    const editorText = extractKnownEditorBlocks(parsed);

    if (editorText.length > 0) {
      return editorText.map(stripHtml).filter(Boolean).join('\n').trim();
    }

    return collectText(parsed).map(stripHtml).filter(Boolean).join('\n').trim();
  } catch (error) {
    return stripHtml(rawMessage) || '';
  }
}

function stripHtml(value: string | undefined) {
  if (!value) {
    return value;
  }

  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractKnownEditorBlocks(value: unknown) {
  const blocks = Array.isArray((value as { blocks?: unknown })?.blocks)
    ? (value as { blocks: Array<{ data?: { text?: unknown } }> }).blocks
    : [];

  return blocks
    .map((block: { data?: { text?: unknown } }) => block?.data?.text)
    .filter(
      (text: unknown): text is string =>
        typeof text === 'string' && Boolean(text.trim())
    );
}

function collectText(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectText);
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  const record = value as Record<string, unknown>;
  const directText = ['text', 'message', 'content', 'html']
    .map((key: string) => record[key])
    .filter((item: unknown): item is string => typeof item === 'string');

  if (directText.length > 0) {
    return directText;
  }

  return Object.entries(record)
    .filter(
      ([key]: [string, unknown]) =>
        !['id', '_id', 'type', 'version'].includes(key)
    )
    .flatMap(([, entry]: [string, unknown]) => collectText(entry));
}

export = {
  normalizeApplication,
  normalizeMessage,
  normalizeProfileDocument,
  normalizeUser
};
