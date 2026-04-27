/* eslint-disable no-use-before-define */
function normalizeUser(user) {
  if (!user) {
    return undefined;
  }

  return {
    id: user._id?.toString?.() || user.id,
    name: [user.firstname, user.lastname].filter(Boolean).join(' ') || undefined,
    chineseName:
      [user.lastname_chinese, user.firstname_chinese]
        .filter(Boolean)
        .join('') || undefined,
    email: user.email,
    role: user.role,
    archived: Boolean(user.archiv)
  };
}

function normalizeApplication(application) {
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

function normalizeProfileDocument(document) {
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

function normalizeMessage(message) {
  return {
    id: message._id?.toString?.() || message.id,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    author: normalizeUser(message.user_id),
    text: extractEditorText(message.message),
    attachments: (message.files || []).map((file) => ({ name: file.name })),
    ignored: Boolean(message.ignore_message)
  };
}

function normalizeProgram(program) {
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

function normalizeAdmission(admission) {
  if (admission === 'O') {
    return 'admitted';
  }

  if (admission === 'X') {
    return 'not_admitted';
  }

  return 'unknown';
}

function extractEditorText(rawMessage) {
  if (!rawMessage) {
    return '';
  }

  try {
    const parsed = JSON.parse(rawMessage);
    const editorText = extractKnownEditorBlocks(parsed);

    if (editorText.length > 0) {
      return editorText.map(stripHtml).filter(Boolean).join('\n').trim();
    }

    return collectText(parsed)
      .map(stripHtml)
      .filter(Boolean)
      .join('\n')
      .trim();
  } catch (error) {
    return stripHtml(rawMessage) || '';
  }
}

function stripHtml(value) {
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

function extractKnownEditorBlocks(value) {
  const blocks = Array.isArray(value?.blocks) ? value.blocks : [];

  return blocks
    .map((block) => block?.data?.text)
    .filter((text) => typeof text === 'string' && text.trim());
}

function collectText(value) {
  if (typeof value === 'string') {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectText);
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  const directText = ['text', 'message', 'content', 'html']
    .map((key) => value[key])
    .filter((item) => typeof item === 'string');

  if (directText.length > 0) {
    return directText;
  }

  return Object.entries(value)
    .filter(([key]) => !['id', '_id', 'type', 'version'].includes(key))
    .flatMap(([, entry]) => collectText(entry));
}

module.exports = {
  normalizeApplication,
  normalizeMessage,
  normalizeProfileDocument,
  normalizeUser
};
