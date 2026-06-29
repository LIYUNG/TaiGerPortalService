import {
  detectSensitivity,
  extractPlainText
} from '../../../services/ai-assist/sensitivity';

describe('extractPlainText', () => {
  it('flattens EditorJS paragraph blocks and strips tags', () => {
    const json = JSON.stringify({
      blocks: [
        { type: 'paragraph', data: { text: 'Hello <b>there</b>' } },
        { type: 'paragraph', data: { text: 'second&nbsp;line' } }
      ]
    });
    expect(extractPlainText(json)).toBe('Hello there second line');
  });

  it('returns empty string for empty / non-JSON input', () => {
    expect(extractPlainText('')).toBe('');
    expect(extractPlainText(undefined)).toBe('');
    expect(extractPlainText('not json')).toBe('');
    expect(extractPlainText('{}')).toBe('');
  });
});

describe('detectSensitivity', () => {
  it.each([
    'I am so angry, this is unacceptable',
    'I want a refund',
    'I feel hopeless and want to give up',
    '我很失望，要投訴',
    '壓力很大，快撐不下去了',
    '我要退費'
  ])('flags sensitive content: %s', (text) => {
    expect(detectSensitivity(text).sensitive).toBe(true);
  });

  it.each([
    'Could you tell me the application deadline?',
    '請問我的 CV 還需要補什麼文件嗎？',
    ''
  ])('does not flag neutral content: %s', (text) => {
    expect(detectSensitivity(text).sensitive).toBe(false);
  });
});
