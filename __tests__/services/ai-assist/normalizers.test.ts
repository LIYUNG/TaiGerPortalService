import {
  normalizeApplication,
  normalizeMessage,
  normalizeProfileDocument,
  normalizeUser
} from '../../../services/ai-assist/normalizers';

describe('ai-assist normalizers', () => {
  describe('normalizeUser', () => {
    it('returns undefined for falsy input', () => {
      expect(normalizeUser(null)).toBeUndefined();
      expect(normalizeUser(undefined)).toBeUndefined();
    });

    it('normalizes a populated user with ObjectId-like _id', () => {
      const result = normalizeUser({
        _id: { toString: () => 'user_1' },
        firstname: 'Ada',
        lastname: 'Lovelace',
        lastname_chinese: '愛',
        firstname_chinese: '達',
        email: 'ada@example.com',
        role: 'Student',
        archiv: true
      });

      expect(result).toEqual({
        id: 'user_1',
        name: 'Ada Lovelace',
        chineseName: '愛達',
        email: 'ada@example.com',
        role: 'Student',
        archived: true
      });
    });

    it('falls back to plain id and leaves name/chineseName undefined when empty', () => {
      const result = normalizeUser({ id: 'plain_id' });

      expect(result.id).toBe('plain_id');
      expect(result.name).toBeUndefined();
      expect(result.chineseName).toBeUndefined();
      expect(result.archived).toBe(false);
    });

    it('keeps only the present name part', () => {
      expect(normalizeUser({ firstname: 'Ada' }).name).toBe('Ada');
      expect(normalizeUser({ lastname: 'Lovelace' }).name).toBe('Lovelace');
    });
  });

  describe('normalizeProgram (via normalizeApplication)', () => {
    it('returns undefined program when programId is missing', () => {
      const result = normalizeApplication({ _id: 'app_1' });
      expect(result.program).toBeUndefined();
    });

    it('normalizes program via program_name, programName, or name', () => {
      expect(
        normalizeApplication({
          programId: { _id: 'p1', program_name: 'CS' }
        }).program.name
      ).toBe('CS');
      expect(
        normalizeApplication({
          programId: { id: 'p2', programName: 'DS' }
        }).program.name
      ).toBe('DS');
      expect(
        normalizeApplication({ programId: { id: 'p3', name: 'AI' } }).program
          .name
      ).toBe('AI');
    });
  });

  describe('normalizeApplication', () => {
    it('normalizes admission O to admitted and X to not_admitted', () => {
      expect(
        normalizeApplication({ admission: 'O' }).status.admissionLabel
      ).toBe('admitted');
      expect(
        normalizeApplication({ admission: 'X' }).status.admissionLabel
      ).toBe('not_admitted');
      expect(
        normalizeApplication({ admission: 'pending' }).status.admissionLabel
      ).toBe('unknown');
    });

    it('includes admissionLetter and uniAssist blocks when present', () => {
      const result = normalizeApplication({
        _id: 'app_1',
        admission: 'O',
        decided: 'O',
        closed: 'X',
        finalEnrolment: true,
        reject_reason: 'late',
        application_year: '2026',
        admission_letter: {
          status: 'received',
          path: '/file',
          updatedAt: 'd1'
        },
        uni_assist: { status: 'paid', isPaid: true, updatedAt: 'd2' }
      });

      expect(result.admissionLetter).toEqual({
        status: 'received',
        hasFile: true,
        updatedAt: 'd1'
      });
      expect(result.uniAssist).toEqual({
        status: 'paid',
        isPaid: true,
        updatedAt: 'd2'
      });
      expect(result.status.finalEnrolment).toBe(true);
      expect(result.rejectReason).toBe('late');
      expect(result.applicationYear).toBe('2026');
    });

    it('omits optional blocks when absent', () => {
      const result = normalizeApplication({ _id: 'app_1' });
      expect(result.admissionLetter).toBeUndefined();
      expect(result.uniAssist).toBeUndefined();
      expect(result.rejectReason).toBeUndefined();
    });
  });

  describe('normalizeProfileDocument', () => {
    it('normalizes a document with file and html feedback', () => {
      const result = normalizeProfileDocument({
        _id: { toString: () => 'doc_1' },
        name: 'CV',
        status: 'uploaded',
        required: true,
        path: '/cv.pdf',
        feedback: '<p>Looks <b>good</b></p>',
        updatedAt: 'd1'
      });

      expect(result).toEqual({
        id: 'doc_1',
        name: 'CV',
        status: 'uploaded',
        required: true,
        hasFile: true,
        feedback: 'Looks good',
        updatedAt: 'd1'
      });
    });

    it('handles a missing file, required flag, and empty feedback', () => {
      const result = normalizeProfileDocument({ name: 'Transcript' });
      expect(result.id).toBeUndefined();
      expect(result.required).toBe(false);
      expect(result.hasFile).toBe(false);
      expect(result.feedback).toBeUndefined();
    });
  });

  describe('normalizeMessage', () => {
    it('normalizes a message with author, files, and plain text', () => {
      const result = normalizeMessage({
        _id: 'msg_1',
        createdAt: 'c1',
        updatedAt: 'u1',
        user_id: { _id: 'agent_1', firstname: 'Agent', lastname: 'Chen' },
        message: 'Hello there',
        files: [{ name: 'a.pdf' }, { name: 'b.pdf' }],
        ignore_message: true
      });

      expect(result.id).toBe('msg_1');
      expect(result.author).toMatchObject({
        id: 'agent_1',
        name: 'Agent Chen'
      });
      expect(result.text).toBe('Hello there');
      expect(result.attachments).toEqual([
        { name: 'a.pdf' },
        { name: 'b.pdf' }
      ]);
      expect(result.ignored).toBe(true);
    });

    it('defaults files to empty array and ignored to false', () => {
      const result = normalizeMessage({ id: 'msg_2', message: '' });
      expect(result.attachments).toEqual([]);
      expect(result.ignored).toBe(false);
      expect(result.text).toBe('');
    });

    it('extracts editor.js block text from JSON message bodies', () => {
      const raw = JSON.stringify({
        blocks: [
          { data: { text: 'Please upload <b>transcript</b>' } },
          { data: { text: 'Second line' } },
          { data: {} }
        ]
      });
      const result = normalizeMessage({ id: 'm', message: raw });
      expect(result.text).toBe('Please upload transcript\nSecond line');
    });

    it('falls back to collectText for JSON without known blocks', () => {
      const raw = JSON.stringify({
        type: 'doc',
        content: 'Nested content here'
      });
      const result = normalizeMessage({ id: 'm', message: raw });
      expect(result.text).toBe('Nested content here');
    });

    it('recurses through arrays and nested objects in collectText', () => {
      const raw = JSON.stringify({
        children: [
          { id: 'skip', text: 'first' },
          { nested: { message: 'second' } }
        ]
      });
      const result = normalizeMessage({ id: 'm', message: raw });
      expect(result.text).toContain('first');
      expect(result.text).toContain('second');
    });

    it('strips html when message is not valid JSON', () => {
      const result = normalizeMessage({
        id: 'm',
        message: 'Line one<br/>Line two&amp;more'
      });
      expect(result.text).toBe('Line one\nLine two&more');
    });

    it('returns empty string for empty editor text', () => {
      const result = normalizeMessage({ id: 'm', message: undefined });
      expect(result.text).toBe('');
    });

    it('returns empty array text branch for JSON arrays with no strings', () => {
      const raw = JSON.stringify([{ version: 1 }, { id: 'x' }]);
      const result = normalizeMessage({ id: 'm', message: raw });
      expect(result.text).toBe('');
    });
  });

  describe('stripHtml entity decoding (via feedback)', () => {
    it('decodes the full set of html entities and collapses whitespace', () => {
      const result = normalizeProfileDocument({
        feedback: '&lt;tag&gt; &quot;quote&quot; it&#39;s   tight\t\nkeep'
      });
      // stripHtml decodes entities and collapses ` \t`+newline runs, but keeps
      // internal multi-space runs intact (only `[ \t]+\n` -> `\n`).
      expect(result.feedback).toBe('<tag> "quote" it\'s   tight\nkeep');
    });
  });
});
