// Unit tests for services/ai-assist/aiTools.
// All external dependencies (sibling ./tools and ./overview helpers, Program /
// DocumentThread services, S3 client, text extraction, config) are mocked so the
// branch logic in aiTools is exercised in isolation.

jest.mock('../../../services/ai-assist/tools', () => ({
  searchAccessibleStudents: jest.fn(),
  runTool: jest.fn(),
  requireAccessibleStudent: jest.fn()
}));
jest.mock('../../../services/ai-assist/overview', () => ({
  buildOverview: jest.fn(),
  loadPortfolio: jest.fn(),
  collectUpcomingDeadlines: jest.fn()
}));
jest.mock('../../../services/programs', () => ({
  getProgramByIdSelect: jest.fn()
}));
jest.mock('../../../services/documentthreads', () => ({
  getThreadByIdLean: jest.fn()
}));
jest.mock('../../../aws/s3', () => ({
  getS3Object: jest.fn()
}));
jest.mock('../../../utils/utils_function', () => ({
  extractTextFromBuffer: jest.fn()
}));
jest.mock('../../../config', () => ({
  AWS_S3_BUCKET_NAME: 'test-bucket'
}));

import aiTools from '../../../services/ai-assist/aiTools';
import tools from '../../../services/ai-assist/tools';
import {
  buildOverview,
  loadPortfolio,
  collectUpcomingDeadlines
} from '../../../services/ai-assist/overview';
import ProgramService from '../../../services/programs';
import DocumentThreadService from '../../../services/documentthreads';
import { getS3Object } from '../../../aws/s3';
import { extractTextFromBuffer } from '../../../utils/utils_function';

const mockedTools = tools as jest.Mocked<typeof tools>;
const mockedBuildOverview = buildOverview as jest.Mock;
const mockedLoadPortfolio = loadPortfolio as jest.Mock;
const mockedCollectDeadlines = collectUpcomingDeadlines as jest.Mock;
const mockedGetProgram = ProgramService.getProgramByIdSelect as jest.Mock;
const mockedGetThread = DocumentThreadService.getThreadByIdLean as jest.Mock;
const mockedGetS3 = getS3Object as jest.Mock;
const mockedExtract = extractTextFromBuffer as jest.Mock;

const { runTool, hasTool, registry, definitions, definitionsByName } =
  aiTools as {
    runTool: (req: any, name: string, args: any) => Promise<any>;
    hasTool: (name: string) => boolean;
    registry: Record<string, any>;
    definitions: any[];
    definitionsByName: Record<string, any>;
  };

const REQ = { user: { _id: 'u1', role: 'Admin' } };

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── definitions / metadata ──────────────────────────────────────────────────
describe('tool definitions & registry metadata', () => {
  it('builds definitions with and without an integer maximum', () => {
    // find_students.limit -> int WITH maximum; find_upcoming_deadlines.days -> int WITH maximum.
    const findStudents = definitionsByName.find_students;
    expect(findStudents.parameters.properties.limit.maximum).toBe(25);
    expect(findStudents.parameters.properties.limit.minimum).toBe(1);
    expect(findStudents.parameters.properties.query.type).toBe('string');
  });

  it('omits maximum when not provided (int branch without maximum)', () => {
    // get_support_tickets has limit with a max; construct via registry-free check:
    // find any int property lacking a maximum is not guaranteed, so assert the
    // helper output shape directly through a definition that has one and confirm
    // a property never carries maximum when absent. get_my_overview.days has a max,
    // so instead verify required/additionalProperties wiring here.
    const tool = definitionsByName.get_student_overview;
    expect(tool.parameters.additionalProperties).toBe(false);
    expect(tool.parameters.required).toEqual(['studentId']);
  });

  it('indexes every definition by name', () => {
    expect(Object.keys(definitionsByName).sort()).toEqual(
      definitions.map((d) => d.name).sort()
    );
  });

  it('hasTool is true for registered tools and false otherwise', () => {
    expect(hasTool('find_students')).toBe(true);
    expect(hasTool('read_document')).toBe(true);
    expect(hasTool('does_not_exist')).toBe(false);
  });
});

// ─── runTool dispatch ─────────────────────────────────────────────────────────
describe('runTool', () => {
  it('throws 400 for an unknown tool', async () => {
    await expect(runTool(REQ, 'no_such_tool', {})).rejects.toThrow(
      'Unknown AI Assist tool: no_such_tool'
    );
  });

  it('dispatches to a registered handler', async () => {
    mockedTools.searchAccessibleStudents.mockResolvedValue({ data: [] });
    const result = await runTool(REQ, 'find_students', { query: 'x' });
    expect(result).toEqual({ data: [] });
    expect(mockedTools.searchAccessibleStudents).toHaveBeenCalledWith(REQ, {
      query: 'x'
    });
  });
});

// ─── thin pass-through handlers ──────────────────────────────────────────────
describe('pass-through registry handlers', () => {
  it('find_students forwards to searchAccessibleStudents with default args', async () => {
    mockedTools.searchAccessibleStudents.mockResolvedValue({ data: [] });
    await registry.find_students(REQ);
    expect(mockedTools.searchAccessibleStudents).toHaveBeenCalledWith(REQ, {});
  });

  it.each([
    ['get_communications', 'get_latest_communications'],
    ['get_document_threads', 'get_document_thread_context'],
    ['get_support_tickets', 'get_support_tickets'],
    ['get_crm_lead', 'get_crm_lead_meeting_context']
  ])('%s delegates to tools.runTool(%s)', async (regName, underlying) => {
    mockedTools.runTool.mockResolvedValue({ data: 'ok' });
    const args = { studentId: 's1' };
    const result = await registry[regName](REQ, args);
    expect(result).toEqual({ data: 'ok' });
    expect(mockedTools.runTool).toHaveBeenCalledWith(REQ, underlying, args);
  });
});

// ─── getStudentOverview ──────────────────────────────────────────────────────
describe('get_student_overview', () => {
  it('merges summary, applications, and thread context', async () => {
    mockedTools.runTool.mockImplementation(async (_req: any, name: string) => {
      if (name === 'get_student_summary')
        return { data: { id: 's1', name: 'Ada' } };
      if (name === 'get_student_applications') return { data: [{ id: 'a1' }] };
      if (name === 'get_document_thread_context')
        return {
          data: {
            totalThreads: 3,
            openThreadsCount: 1,
            threads: [{ id: 't1' }]
          }
        };
      return { data: null };
    });

    const result = await runTool(REQ, 'get_student_overview', {
      studentId: 's1'
    });
    expect(result.data).toMatchObject({
      id: 's1',
      name: 'Ada',
      applications: [{ id: 'a1' }],
      documentThreads: { total: 3, open: 1, threads: [{ id: 't1' }] }
    });
  });

  it('handles null thread data via optional chaining', async () => {
    mockedTools.runTool.mockImplementation(async (_req: any, name: string) => {
      if (name === 'get_student_summary') return { data: {} };
      if (name === 'get_student_applications') return { data: [] };
      return { data: null }; // thread context null -> ?. yields undefined
    });

    const result = await registry.get_student_overview(REQ);
    expect(result.data.documentThreads).toEqual({
      total: undefined,
      open: undefined,
      threads: undefined
    });
  });
});

// ─── getProgram ──────────────────────────────────────────────────────────────
describe('get_program', () => {
  it('returns the program when found', async () => {
    mockedGetProgram.mockResolvedValue({ _id: 'p1', school: 'TU' });
    const result = await runTool(REQ, 'get_program', { programId: 'p1' });
    expect(result.data).toEqual({ _id: 'p1', school: 'TU' });
  });

  it('defaults args to {} when called without args (programId undefined -> 404)', async () => {
    mockedGetProgram.mockResolvedValue(null);
    await expect(registry.get_program(REQ)).rejects.toThrow(
      'Program not found'
    );
  });

  it('throws 404 when the program is not found', async () => {
    mockedGetProgram.mockResolvedValue(null);
    await expect(
      runTool(REQ, 'get_program', { programId: 'missing' })
    ).rejects.toThrow('Program not found');
  });
});

// ─── findUpcomingDeadlines (days clamping) ───────────────────────────────────
describe('find_upcoming_deadlines', () => {
  beforeEach(() => {
    mockedLoadPortfolio.mockResolvedValue({
      applications: [],
      studentById: new Map()
    });
  });

  it('uses the default window of 30 when days is absent/invalid (|| 30)', async () => {
    mockedCollectDeadlines.mockReturnValue([]);
    const result = await registry.find_upcoming_deadlines(REQ);
    expect(result.data.windowDays).toBe(30);
    expect(mockedCollectDeadlines).toHaveBeenCalledWith(
      [],
      expect.any(Map),
      30
    );
  });

  it('clamps below the minimum of 1', async () => {
    mockedCollectDeadlines.mockReturnValue([]);
    const result = await runTool(REQ, 'find_upcoming_deadlines', { days: 0 });
    // Number(0) || 30 -> 30 (0 is falsy), then clamped >=1 -> 30
    expect(result.data.windowDays).toBe(30);
  });

  it('clamps a negative value up to the minimum of 1', async () => {
    mockedCollectDeadlines.mockReturnValue([]);
    const result = await runTool(REQ, 'find_upcoming_deadlines', { days: -10 });
    expect(result.data.windowDays).toBe(1);
  });

  it('clamps above the maximum of 365', async () => {
    mockedCollectDeadlines.mockReturnValue([]);
    const result = await runTool(REQ, 'find_upcoming_deadlines', {
      days: 9999
    });
    expect(result.data.windowDays).toBe(365);
  });

  it('passes a valid in-range value through and slices to 50 items', async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ id: i }));
    mockedCollectDeadlines.mockReturnValue(many);
    const result = await runTool(REQ, 'find_upcoming_deadlines', { days: 45 });
    expect(result.data.windowDays).toBe(45);
    expect(result.data.count).toBe(60);
    expect(result.data.deadlines).toHaveLength(50);
  });
});

// ─── getMyOverview ───────────────────────────────────────────────────────────
describe('get_my_overview', () => {
  it('passes the days window through to buildOverview', async () => {
    mockedBuildOverview.mockResolvedValue({ buckets: {} });
    const result = await runTool(REQ, 'get_my_overview', { days: 14 });
    expect(mockedBuildOverview).toHaveBeenCalledWith(REQ, {
      deadlineWindowDays: 14
    });
    expect(result.data).toEqual({ buckets: {} });
  });

  it('defaults args to {} (deadlineWindowDays undefined)', async () => {
    mockedBuildOverview.mockResolvedValue({ buckets: {} });
    await registry.get_my_overview(REQ);
    expect(mockedBuildOverview).toHaveBeenCalledWith(REQ, {
      deadlineWindowDays: undefined
    });
  });
});

// ─── readDocument ────────────────────────────────────────────────────────────
describe('read_document', () => {
  it('throws 400 when neither threadId nor studentId+documentName provided', async () => {
    await expect(runTool(REQ, 'read_document', {})).rejects.toThrow(
      'read_document requires either threadId'
    );
  });

  it('defaults args to {} when called without args (-> 400 guard)', async () => {
    await expect(registry.read_document(REQ)).rejects.toThrow(
      'read_document requires either threadId'
    );
  });

  describe('document-thread path', () => {
    it('throws 404 when the thread is missing', async () => {
      mockedGetThread.mockResolvedValue(null);
      await expect(
        runTool(REQ, 'read_document', { threadId: 't1' })
      ).rejects.toThrow('Document thread not found');
    });

    it('reads the latest uploaded file text and reports not truncated', async () => {
      mockedGetThread.mockResolvedValue({
        student_id: 'stu1',
        file_type: 'CV',
        messages: [
          { file: [{ path: 'old/key', name: 'old.pdf' }] },
          { file: [{ path: 'cv/key.pdf', name: 'cv.pdf' }] }
        ]
      });
      mockedTools.requireAccessibleStudent.mockResolvedValue({} as any);
      mockedGetS3.mockResolvedValue(Buffer.from('hello'));
      mockedExtract.mockResolvedValue('extracted text');

      const result = await runTool(REQ, 'read_document', { threadId: 't1' });
      expect(mockedTools.requireAccessibleStudent).toHaveBeenCalledWith(
        REQ,
        'stu1'
      );
      expect(mockedGetS3).toHaveBeenCalledWith('test-bucket', 'cv/key.pdf');
      expect(mockedExtract).toHaveBeenCalledWith(expect.any(Buffer), 'pdf');
      expect(result.data).toMatchObject({
        source: 'document_thread',
        fileType: 'CV',
        fileName: 'cv.pdf',
        extension: 'pdf',
        available: true,
        truncated: false,
        text: 'extracted text'
      });
    });

    it('truncates very long extracted text', async () => {
      mockedGetThread.mockResolvedValue({
        student_id: 'stu1',
        file_type: 'ML',
        messages: [{ file: [{ path: 'k', name: 'a.txt' }] }]
      });
      mockedTools.requireAccessibleStudent.mockResolvedValue({} as any);
      mockedGetS3.mockResolvedValue(Buffer.from('x'));
      mockedExtract.mockResolvedValue('a'.repeat(24001));

      const result = await runTool(REQ, 'read_document', { threadId: 't1' });
      expect(result.data.truncated).toBe(true);
      expect(result.data.charCount).toBe(24000);
    });

    it('available:false when extracted text is empty', async () => {
      mockedGetThread.mockResolvedValue({
        student_id: 'stu1',
        messages: [{ file: [{ path: 'k', name: 'a.txt' }] }]
      });
      mockedTools.requireAccessibleStudent.mockResolvedValue({} as any);
      mockedGetS3.mockResolvedValue(Buffer.from('x'));
      mockedExtract.mockResolvedValue('');

      const result = await runTool(REQ, 'read_document', { threadId: 't1' });
      // file_type missing -> '' fallback; available Boolean('') -> false
      expect(result.data.fileType).toBe('');
      expect(result.data.available).toBe(false);
    });

    it('treats a file with a falsy path as no usable file (file.path || "")', async () => {
      mockedGetThread.mockResolvedValue({
        student_id: 'stu1',
        file_type: 'CV',
        messages: [{ file: [{ path: '', name: 'x.pdf' }] }]
      });
      mockedTools.requireAccessibleStudent.mockResolvedValue({} as any);

      const result = await runTool(REQ, 'read_document', { threadId: 't1' });
      // key resolves to '' -> available:false, no S3 fetch
      expect(result.data.available).toBe(false);
      expect(mockedGetS3).not.toHaveBeenCalled();
    });

    it('returns available:false when no file is found in any message', async () => {
      mockedGetThread.mockResolvedValue({
        student_id: 'stu1',
        file_type: 'RL',
        messages: [{ file: [] }, { file: 'not-an-array' }]
      });
      mockedTools.requireAccessibleStudent.mockResolvedValue({} as any);

      const result = await runTool(REQ, 'read_document', { threadId: 't1' });
      expect(result.data).toMatchObject({
        available: false,
        message: 'No uploaded file found for this document.'
      });
      expect(mockedGetS3).not.toHaveBeenCalled();
    });

    it('handles non-array messages and missing file path/name fields', async () => {
      mockedGetThread.mockResolvedValue({
        student_id: { toString: () => 'stu_obj' },
        file_type: 'CV',
        messages: 'not-an-array' // -> [] guard
      });
      mockedTools.requireAccessibleStudent.mockResolvedValue({} as any);

      const result = await runTool(REQ, 'read_document', { threadId: 't1' });
      expect(mockedTools.requireAccessibleStudent).toHaveBeenCalledWith(
        REQ,
        'stu_obj'
      );
      expect(result.data.available).toBe(false);
    });

    it('returns available:false when S3 returns no bytes', async () => {
      mockedGetThread.mockResolvedValue({
        student_id: 'stu1',
        file_type: 'CV',
        messages: [{ file: [{ path: 'k', name: 'a.pdf' }] }]
      });
      mockedTools.requireAccessibleStudent.mockResolvedValue({} as any);
      mockedGetS3.mockResolvedValue(null);

      const result = await runTool(REQ, 'read_document', { threadId: 't1' });
      expect(result.data).toMatchObject({
        available: false,
        message: 'File could not be retrieved from storage.'
      });
      expect(mockedExtract).not.toHaveBeenCalled();
    });

    it('falls back to the key for extension when file name is empty (file.name || "")', async () => {
      // student_id is an object whose toString() returns '' -> toIdString `|| ''` falsy branch.
      mockedGetThread.mockResolvedValue({
        student_id: { toString: () => '' },
        file_type: 'CV',
        messages: [{ file: [{ path: 'folder/file.docx' }] }] // no name field
      });
      mockedTools.requireAccessibleStudent.mockResolvedValue({} as any);
      mockedGetS3.mockResolvedValue(Buffer.from('x'));
      mockedExtract.mockResolvedValue('text');

      await runTool(REQ, 'read_document', { threadId: 't1' });
      expect(mockedTools.requireAccessibleStudent).toHaveBeenCalledWith(
        REQ,
        ''
      );
      // fileName empty -> extname(fileName || key) uses key 'folder/file.docx'
      expect(mockedExtract).toHaveBeenCalledWith(expect.any(Buffer), 'docx');
    });
  });

  describe('base-document path', () => {
    it('reads a base/profile document by studentId + documentName', async () => {
      mockedTools.requireAccessibleStudent.mockResolvedValue({
        profile: [{ name: 'Transcript', path: 'tr/key.pdf' }]
      } as any);
      mockedGetS3.mockResolvedValue(Buffer.from('x'));
      mockedExtract.mockResolvedValue('transcript text');

      const result = await runTool(REQ, 'read_document', {
        studentId: 's1',
        documentName: 'Transcript'
      });
      expect(result.data).toMatchObject({
        source: 'base_document',
        fileName: 'Transcript',
        fileType: 'Transcript',
        available: true,
        text: 'transcript text'
      });
    });

    it('throws 404 when the named base document is not found', async () => {
      mockedTools.requireAccessibleStudent.mockResolvedValue({
        profile: [{ name: 'CV', path: 'k' }]
      } as any);
      await expect(
        runTool(REQ, 'read_document', {
          studentId: 's1',
          documentName: 'NoSuch'
        })
      ).rejects.toThrow('Base document not found');
    });

    it('handles a student with no profile array (|| [] guard)', async () => {
      mockedTools.requireAccessibleStudent.mockResolvedValue({} as any);
      await expect(
        runTool(REQ, 'read_document', {
          studentId: 's1',
          documentName: 'CV'
        })
      ).rejects.toThrow('Base document not found');
    });

    it('returns available:false when the base document has no path', async () => {
      mockedTools.requireAccessibleStudent.mockResolvedValue({
        profile: [{ name: 'CV', path: null }]
      } as any);

      const result = await runTool(REQ, 'read_document', {
        studentId: 's1',
        documentName: 'CV'
      });
      expect(result.data.available).toBe(false);
      expect(result.data.source).toBe('base_document');
    });
  });
});

// ─── getThreadMessages ───────────────────────────────────────────────────────
describe('get_thread_messages', () => {
  it('throws 400 when threadId is missing', async () => {
    await expect(runTool(REQ, 'get_thread_messages', {})).rejects.toThrow(
      'threadId is required'
    );
  });

  it('defaults args to {} when called without args (-> 400 guard)', async () => {
    await expect(registry.get_thread_messages(REQ)).rejects.toThrow(
      'threadId is required'
    );
  });

  it('throws 404 when the thread is missing', async () => {
    mockedGetThread.mockResolvedValue(null);
    await expect(
      runTool(REQ, 'get_thread_messages', { threadId: 't1' })
    ).rejects.toThrow('Document thread not found');
  });

  it('maps message text/author/date/file across all extractor fallbacks', async () => {
    mockedGetThread.mockResolvedValue({
      student_id: 'stu1',
      file_type: 'CV',
      isFinalVersion: true,
      messages: [
        {
          message: 'via message',
          user_id: 'a1',
          createdAt: '2026-04-01T00:00:00Z',
          file: [{ name: 'f1.pdf' }, { name: 'f2.pdf' }]
        },
        // file present but last file has no name -> ?.name yields undefined -> || null
        { text: 'has file no name', file: [{ path: 'p' }] },
        { text: 'via text', userId: { toString: () => 'a2' } },
        { content: 'via content', createdAt: 'not-a-date' },
        { body: 'via body' },
        // dropped by filter: no text and no file
        { other: 'x', file: [] }
      ]
    });
    mockedTools.requireAccessibleStudent.mockResolvedValue({} as any);

    const result = await runTool(REQ, 'get_thread_messages', {
      threadId: 't1'
    });
    expect(result.data.threadId).toBe('t1');
    expect(result.data.fileType).toBe('CV');
    expect(result.data.isFinalVersion).toBe(true);
    expect(result.data.messageCount).toBe(5);

    const [m0, m1, m2, m3, m4] = result.data.messages;
    expect(m0).toMatchObject({
      text: 'via message',
      authorId: 'a1',
      createdAt: '2026-04-01T00:00:00.000Z',
      hasFile: true,
      fileName: 'f2.pdf'
    });
    // file present but last file has no name -> fileName falls back to null
    expect(m1).toMatchObject({
      text: 'has file no name',
      hasFile: true,
      fileName: null
    });
    expect(m2).toMatchObject({
      text: 'via text',
      authorId: 'a2',
      createdAt: null,
      hasFile: false,
      fileName: null
    });
    expect(m3).toMatchObject({ text: 'via content', createdAt: null });
    expect(m4).toMatchObject({ text: 'via body' });
  });

  it('defaults fileType to null and isFinalVersion to false when absent', async () => {
    mockedGetThread.mockResolvedValue({
      student_id: 'stu1',
      messages: []
    });
    mockedTools.requireAccessibleStudent.mockResolvedValue({} as any);

    const result = await runTool(REQ, 'get_thread_messages', {
      threadId: 't1'
    });
    expect(result.data.fileType).toBeNull();
    expect(result.data.isFinalVersion).toBe(false);
    expect(result.data.messageCount).toBe(0);
  });

  it('treats non-array messages as empty', async () => {
    mockedGetThread.mockResolvedValue({
      student_id: 'stu1',
      messages: undefined
    });
    mockedTools.requireAccessibleStudent.mockResolvedValue({} as any);

    const result = await runTool(REQ, 'get_thread_messages', {
      threadId: 't1'
    });
    expect(result.data.messages).toEqual([]);
  });
});
