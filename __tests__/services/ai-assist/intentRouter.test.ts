jest.mock('../../../services/openai', () => ({
  openAIClient: {
    responses: {
      create: jest.fn()
    }
  },
  OpenAiModel: { GPT_4_o: 'gpt-4o' }
}));

import { openAIClient } from '../../../services/openai';
import {
  classifyIntent,
  INTENTS
} from '../../../services/ai-assist/intentRouter';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('intentRouter classifyIntent', () => {
  it('returns a frozen list of supported intents', () => {
    expect(INTENTS).toContain('student_lookup');
    expect(INTENTS).toContain('general');
  });

  it('falls back to a general non-resolving intent when responses API is unavailable', async () => {
    const original = openAIClient.responses;
    openAIClient.responses = undefined;

    const result = await classifyIntent({
      message: 'hi',
      conversationContext: {}
    });
    expect(result).toEqual({
      intent: 'general',
      studentQuery: null,
      needsStudentResolution: false
    });

    openAIClient.responses = original;
  });

  it('normalizes a model classification into a non-general intent (always needs resolution)', async () => {
    openAIClient.responses.create.mockResolvedValue({
      output_text: JSON.stringify({
        intent: 'student_applications',
        studentQuery: '  Abby  ',
        needsStudentResolution: false
      })
    });

    const result = await classifyIntent({
      message: 'app status',
      conversationContext: {}
    });
    expect(result).toEqual({
      intent: 'student_applications',
      studentQuery: 'Abby',
      needsStudentResolution: true
    });
  });

  it('treats unknown intent as general and uses heuristic keyword detection for resolution', async () => {
    openAIClient.responses.create.mockResolvedValue({
      output_text: JSON.stringify({
        intent: 'not_a_real_intent',
        studentQuery: 'Bob',
        needsStudentResolution: true
      })
    });

    const result = await classifyIntent({
      message: 'tell me about the application for Bob',
      conversationContext: {}
    });
    expect(result.intent).toBe('general');
    expect(result.studentQuery).toBe('Bob');
    expect(result.needsStudentResolution).toBe(true);
  });

  it('does not require resolution for a general intent without student keywords', async () => {
    openAIClient.responses.create.mockResolvedValue({
      output_text: JSON.stringify({
        intent: 'general',
        studentQuery: 'whatever',
        needsStudentResolution: true
      })
    });

    const result = await classifyIntent({
      message: 'what is the weather today',
      conversationContext: {}
    });
    expect(result.intent).toBe('general');
    expect(result.needsStudentResolution).toBe(false);
  });

  it('derives needsStudentResolution from studentQuery when the model omits the boolean', async () => {
    openAIClient.responses.create.mockResolvedValue({
      output_text: JSON.stringify({
        intent: 'general',
        studentQuery: 'student Abby'
      })
    });

    const result = await classifyIntent({
      message: 'find student Abby',
      conversationContext: {}
    });
    expect(result.needsStudentResolution).toBe(true);
  });

  it('reads model output from the output array when output_text is absent', async () => {
    openAIClient.responses.create.mockResolvedValue({
      output: [
        {
          content: [
            { text: '{"intent":"student_lookup","studentQuery":"Cara"}' }
          ]
        }
      ]
    });

    const result = await classifyIntent({
      message: 'find Cara',
      conversationContext: {}
    });
    expect(result.intent).toBe('student_lookup');
    expect(result.studentQuery).toBe('Cara');
  });

  it('extracts the first JSON object when the model wraps it in prose', async () => {
    openAIClient.responses.create.mockResolvedValue({
      output_text:
        'Here you go: {"intent":"support_tickets","studentQuery":"Dan"} thanks'
    });

    const result = await classifyIntent({
      message: 'ticket for Dan',
      conversationContext: {}
    });
    expect(result.intent).toBe('support_tickets');
  });

  describe('heuristic fallback when JSON cannot be parsed', () => {
    const heuristic = async (message) => {
      openAIClient.responses.create.mockResolvedValue({
        output_text: 'no json at all here'
      });
      return classifyIntent({ message, conversationContext: {} });
    };

    it('classifies application/admission/enrol keywords', async () => {
      const result = await heuristic(
        'find the admission offer for Abby Student'
      );
      expect(result.intent).toBe('student_applications');
      expect(result.studentQuery).toBeTruthy();
    });

    it('classifies communication keywords', async () => {
      const result = await heuristic('show latest messages from Bob');
      expect(result.intent).toBe('student_communications');
    });

    it('classifies document keywords', async () => {
      const result = await heuristic('review the transcript document');
      expect(result.intent).toBe('student_documents');
    });

    it('classifies support keywords', async () => {
      const result = await heuristic('open support complaint ticket');
      expect(result.intent).toBe('support_tickets');
    });

    it('classifies a bare lookup keyword as student_lookup', async () => {
      const result = await heuristic('lookup @Carol');
      expect(result.intent).toBe('student_lookup');
      expect(result.studentQuery).toBe('lookup @Carol');
    });

    it('returns general for non-student small talk', async () => {
      const result = await heuristic('hello how are you doing');
      expect(result.intent).toBe('general');
      expect(result.needsStudentResolution).toBe(false);
    });

    it('extractStudentQuery falls back to stripped text when no find verb matches', async () => {
      const result = await heuristic('latest emails Abby');
      expect(result.intent).toBe('student_communications');
      expect(result.studentQuery).toBe('Abby');
    });

    it('extractStudentQuery returns null when stripping removes everything', async () => {
      const result = await heuristic('messages communications emails');
      expect(result.intent).toBe('student_communications');
      expect(result.studentQuery).toBeNull();
    });
  });
});
